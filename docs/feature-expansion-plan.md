# 기능 확장 계획서 — 범용 문서/파일 뷰어

작성일: 2026-06-05 · 대상 저장소: `viewer/`

## 1. 배경과 목표

현재 서비스(`toon_viewer`)는 **Next.js 16 + React 19 프론트엔드 + Komga 백엔드**로 구성된 웹툰/만화 뷰어다. Komga는 만화를 페이지 이미지로만 서빙하므로, 아래 기능들은 **Komga를 우회해 앱이 직접 문서를 파싱**해야 한다.

추가하려는 기능(NeeView 기능군과 동일):

- PDF 보기: 렌더링 + 목차(TOC) + 텍스트 검색
- 텍스트 보기: UTF-8 / EUC-KR / Shift-JIS / Johab 자동 감지
- 일본 Aozora Bunko: 루비(ruby), 세로쓰기, 삽화 렌더링
- EPUB 리더: spine 기반 챕터, TOC, 세로쓰기
- 압축 직접 보기: zip / rar / 7z / cbz / cbr
- WebDAV 원격 이미지 탐색
- 즐겨찾기 / 최근 / 북마크 / 검색 / 썸네일 / 샤프닝 / 두 장 보기

### 확정된 방향 (사용자 결정)

1. **웹 스택 유지** — `.NET`(Windows PDF, PdfPig)은 사용하지 않고 웹 동등 기술로 대체.
2. **Komga와 독립된 파일 브라우저 모드 신설** — 로컬 폴더 + WebDAV를 탐색하는 별도 진입점. Komga 만화 카탈로그는 그대로 공존.
3. **MVP에 4개 기능군 전부 포함** — 압축 / PDF / EPUB·텍스트·Aozora / WebDAV+편의기능.

### 환경 사실 (2026-06-05 컨테이너 점검 결과)

- Node v20.20.2.
- 시스템 압축 바이너리(`7z`, `unrar`, `unar`, `bsdtar`) **없음** → 서버측 압축은 **WASM 라이브러리 우선**(시스템 의존성 0). 네이티브 바이너리는 있으면 가속용으로만 사용.
- libiconv에 `JOHAB`/`CP1361` 존재 → **Johab 디코딩은 `node-iconv`(libiconv 바인딩)로 처리 가능**.
- `sharp` npm은 libvips를 번들하므로 시스템 vips 없이도 썸네일/샤프닝 동작.

## 2. 기술 매핑 (.NET → 웹)

| 기능 | NeeView(.NET) | 본 프로젝트(웹) | 실행 위치 |
|------|---------------|-----------------|-----------|
| PDF 렌더·TOC·검색 | Windows PDF + PdfPig | `pdfjs-dist` (PDF.js) | 클라이언트 |
| 텍스트 인코딩 감지 | .NET Encoding | `jschardet` 감지 + `TextDecoder`/`node-iconv` 디코드 | 서버 |
| Aozora 루비/세로 | 자체 파서 + WPF | 자체 파서 + CSS `writing-mode`/`<ruby>` | 서버 파싱 + 클라 렌더 |
| EPUB spine/TOC/세로 | 자체 | `epubjs` (epub.js) | 클라이언트 |
| 압축 zip/rar/7z | SevenZipSharp 등 | `libarchive.js`(WASM) | 서버 |
| WebDAV | .NET HttpClient | `webdav` npm + 서버 프록시 | 서버 |
| 썸네일/샤프닝 | WIC | `sharp`(서버) + canvas/WebGL(라이브) | 양쪽 |
| 두 장 보기 | 자체 | **이미 구현됨**(`reader-mode.ts` spread) | 클라이언트 |

## 3. 아키텍처

### 3.1 새 도메인 개념

기존 `Library/Series/Book/ComicPage`(Komga 전용)와 **별개로** 파일 시스템 추상화를 둔다.

```
FileSource   = "local" | "webdav"        // 설정으로 등록된 루트들
FsNode       = { source, path, name, kind, size?, mtime?, mime?, isArchive, thumbUrl? }
  kind       = "dir" | "file" | "archive" | "archive-entry"
DocKind      = "image" | "pdf" | "epub" | "text" | "aozora" | "archive" | "other"
```

**주소 체계 (path addressing):**
- 일반: `local:/<root-id>/sub/dir/file.cbz`
- 압축 내부 중첩: `...file.cbz!/inner/page-001.jpg` (`!/` 구분자로 아카이브 내부 진입; 다중 중첩 허용)

> 핵심 결정: 모든 뷰어는 "이미지 URL 목록" 또는 "원본 바이트 스트림"이라는 **공통 인터페이스**로 콘텐츠를 받는다. 그래야 기존 `reader.tsx`를 Komga에 묶이지 않게 일반화해 재사용할 수 있다.

### 3.2 서버 API (신규 `/api/files/...`)

모든 라우트는 **설정된 루트 화이트리스트 밖 경로를 거부**(경로 traversal 방지, `path.resolve` 후 루트 prefix 검증).

| 라우트 | 역할 |
|--------|------|
| `GET /api/files/browse?source&path` | 디렉터리/아카이브 항목 목록(`FsNode[]`) |
| `GET /api/files/raw?source&path` | 원본 바이트 스트림. **HTTP Range 지원**(PDF/EPUB/대용량 필수) |
| `GET /api/files/archive/list?source&path` | 아카이브 엔트리 목록 |
| `GET /api/files/archive/entry?source&path&entry` | 아카이브 내부 단일 파일 스트림 |
| `GET /api/files/text?source&path` | `{ encoding, confidence, kind, content }` (감지+디코드, Aozora 판별) |
| `GET /api/files/thumb?source&path&w&h` | Sharp 생성 썸네일(디스크 캐시, key=path+mtime) |
| `GET /api/files/favorites` `POST/DELETE` | 즐겨찾기 CRUD |
| `GET /api/files/bookmarks` `POST/DELETE` | 북마크(문서+위치) CRUD |
| `GET /api/files/recent` `POST` | 최근 열람 기록 |
| `GET /api/files/search?q&source&path` | 파일명/메타 검색 |

> **Next.js 16 주의:** `app/AGENTS.md`가 경고하듯 이 버전은 라우트 핸들러/`params`/스트리밍 규약이 학습 데이터와 다를 수 있다. 라우트 작성 전 `app/node_modules/next/dist/docs/`의 해당 가이드를 반드시 확인한다. 특히 동적 `params`가 Promise 형태인지, Response 스트리밍/Range 처리 방식.

### 3.3 영속화 (즐겨찾기/북마크/최근)

Komga와 독립적이어야 하므로 자체 저장소가 필요하다.

- **권장:** `better-sqlite3` 단일 파일 DB(`<config>/viewer.db`). 동기 API라 라우트에서 단순.
- 대안: JSON 파일 스토어(소규모면 충분). 멀티 디바이스 동기화가 필요 없으면 localStorage도 가능하나, 서버 저장이 기기 간 일관성에 유리.
- 환경변수: `VIEWER_DATA_DIR`(기본 `./data-store`), `.gitignore`에 추가.

### 3.4 클라이언트 컴포넌트

```
catalog-shell.tsx (기존)         ← Komga 모드 (그대로 유지)
files-shell.tsx (신규)           ← 파일 브라우저 모드: 트리/그리드 + 썸네일 + 즐겨찾기/최근
  └─ DocViewer (디스패처)        ← DocKind 보고 적절한 리더 선택
       ├─ ImageReader            ← reader.tsx 일반화 (Komga 비종속, 이미지 URL 목록 입력)
       ├─ PdfReader (신규)       ← PDF.js: 렌더 + TOC 패널 + 텍스트 검색
       ├─ EpubReader (신규)      ← epub.js: spine/TOC/세로쓰기
       └─ TextReader (신규)      ← 인코딩 표시 + plain/Aozora(루비·세로) 렌더
```

**최상위 네비게이션:** 헤더에 `만화(Komga)` / `파일` 토글 추가.

## 4. 기능별 구현 메모

### 4.1 압축 직접 보기 (zip/rar/7z/cbz/cbr)
- 서버 `libarchive.js`(WASM)로 엔트리 목록/추출. 시스템 바이너리 불필요.
- 이미지 엔트리만 정렬해 `ImageReader`에 전달 → 기존 만화 뷰어 UX 그대로 재사용.
- 비이미지 엔트리(아카이브 안의 pdf/txt/epub)는 `DocViewer`로 재디스패치(중첩 `!/` 주소).
- **주의:** RAR5/암호화/솔리드 아카이브는 라이브러리별 지원 편차 → 실패 시 친절한 폴백 메시지. 대용량은 엔트리 단위 스트림(전체 전개 금지)으로 메모리 보호.
- 선택 가속: 호스트에 `7z`/`unrar` 있으면 spawn 경로로 전환(추후).

### 4.2 PDF 뷰어 (목차/검색)
- 클라이언트 `pdfjs-dist`. 원본은 `/api/files/raw`로 Range 스트림.
- TOC: `pdf.getOutline()`. 검색: 페이지별 `getTextContent()` 인덱싱 후 하이라이트.
- PDF.js worker를 Next.js 번들에 맞게 설정(`workerSrc`) — Turbopack/webpack 워커 로딩 확인 필요.
- 두 장 보기/줌은 `ImageReader`와 UX 통일.

### 4.3 텍스트 인코딩 자동 감지
- 서버 `/api/files/text`: `jschardet`로 후보 감지 → 디코드.
  - UTF-8 / EUC-KR / Shift-JIS: `TextDecoder`(또는 `iconv-lite`).
  - **Johab: `node-iconv`로 libiconv `JOHAB` 디코드**(환경 점검에서 지원 확인됨).
- BOM 우선 처리, 신뢰도 낮으면 사용자 수동 인코딩 선택 드롭다운 제공.

### 4.4 Aozora Bunko
- 서버 파서: 루비 `｜漢字《かんじ》`, 방점, `［＃...］` 주석 지시문 파싱 → 구조화 토큰.
- 클라 렌더: `<ruby><rt>` + CSS `writing-mode: vertical-rl; text-orientation: upright`.
- 삽화 지시문(`［＃挿絵...］`)은 동봉 이미지로 해석(아카이브/폴더 동거 이미지 매핑).
- 세로/가로 토글, 글자 크기/행간 조절.

### 4.5 EPUB 리더
- 클라이언트 `epubjs`. 원본은 `/api/files/raw`.
- spine 순회로 챕터 이동, `book.navigation.toc`로 TOC 패널.
- 세로쓰기 EPUB(`page-progression-direction: rtl`, `writing-mode`) 존중.
- 진행률은 CFI(EPUB 위치) 기준으로 북마크/최근에 저장.

### 4.6 WebDAV 원격 탐색
- 서버 `webdav` npm 클라이언트. 브라우저 CORS 회피 위해 **항상 서버 프록시 경유**.
- 설정: `WEBDAV_URL`, `WEBDAV_USER`, `WEBDAV_PASS`(복수 원격 지원하려면 배열/JSON).
- `browse`/`raw` 라우트가 source=`webdav`일 때 로컬 FS 대신 WebDAV 호출로 분기.
- 인증정보는 서버에만 보관, 클라이언트로 노출 금지.

### 4.7 편의 기능
- **즐겨찾기/최근/북마크:** SQLite 스토어(3.3). 북마크는 `{source,path,locator}`(페이지·CFI·스크롤).
- **검색:** 1차는 파일명/경로 검색. 2차로 PDF/EPUB/텍스트 본문 인덱싱(선택).
- **썸네일:** `sharp` 리사이즈, 디스크 캐시(`thumb/<hash>.webp`), 아카이브 첫 이미지/PDF 1p/EPUB 표지에서 추출.
- **샤프닝:** 라이브 토글은 클라 canvas/WebGL 언샤프 마스크(원본 보존); 썸네일은 서버 `sharp.sharpen()`.
- **두 장 보기:** 기존 `getPagedWindow`/spread 로직 재사용(신규 작업 없음, 일반화만).

## 5. 단계별 로드맵

각 단계 종료 시 **실제로 동작하는 뷰어**가 남도록 구성.

### Phase A — 파일 브라우저 골격 + 이미지
- 로컬 루트 설정, 경로 샌드박싱, `browse`/`raw`/`thumb` 라우트.
- `files-shell.tsx`(트리/그리드 + 썸네일), 헤더 `만화/파일` 토글.
- `reader.tsx`를 Komga 비종속 `ImageReader`로 일반화 → 폴더 내 이미지 시퀀스 보기.
- WebDAV source 분기 추가(폴더/이미지 탐색).
- **산출물:** 로컬·WebDAV 폴더의 이미지 묶음을 기존 만화 UX로 열람.

### Phase B — 압축 직접 보기
- `libarchive.js` 서버 통합, `archive/list`·`archive/entry`, 중첩 `!/` 주소.
- zip/cbz → rar/cbr → 7z 순으로 검증.
- **산출물:** zip/rar/7z/cbz/cbr 내부 이미지 열람.

### Phase C — PDF 뷰어
- `PdfReader`(PDF.js): 렌더 + TOC + 텍스트 검색 + 줌/스프레드.
- **산출물:** PDF 목차 탐색·본문 검색.

### Phase D — EPUB · 텍스트 · Aozora
- `/api/files/text` 인코딩 감지(+Johab), `TextReader`(plain/Aozora, 세로·루비).
- `EpubReader`(epub.js, spine/TOC/세로).
- **산출물:** 소설/전자책/Aozora 열람.

### Phase E — 편의 기능 마감
- SQLite 스토어, 즐겨찾기/북마크/최근, 파일명 검색, 라이브 샤프닝 토글.
- **산출물:** 일상 사용 가능한 라이브러리 경험.

> 사용자가 MVP에 전부 포함을 원했으므로 A→E를 1차 릴리스 범위로 본다. 단계 구분은 통합 리스크를 줄이기 위한 구현 순서일 뿐 범위 축소가 아니다.

## 6. 신규 의존성(예정)

서버: `libarchive.js`, `webdav`, `sharp`, `jschardet`, `iconv-lite`, `iconv`(node-iconv, Johab용), `better-sqlite3`
클라이언트: `pdfjs-dist`, `epubjs`

> 버전은 설치 시점 최신으로 고정하고 `app/package.json`에 추가. `node-iconv`/`better-sqlite3`/`sharp`는 네이티브 빌드 → 배포 이미지에 빌드 도구 또는 prebuilt 확인.

## 7. 리스크 / 확인 필요

1. **Next.js 16 규약** — 라우트 핸들러·`params`(Promise?)·Range 스트리밍을 `node_modules/next/dist/docs/`로 검증 후 코딩.
2. **WASM 압축 한계** — RAR5/암호화/솔리드, 초대용량 메모리. 폴백 메시지 + 스트리밍 설계.
3. **경로 보안** — 로컬 FS 샌드박싱(루트 화이트리스트 + traversal 차단)이 1순위.
4. **PDF.js worker 번들링** — Turbopack 환경 worker 로딩 경로.
5. **네이티브 모듈 배포** — `sharp`/`node-iconv`/`better-sqlite3`의 타깃 플랫폼 빌드.
6. **세로쓰기 폰트** — 일본어/한국어 세로쓰기용 웹폰트와 `text-orientation` 브라우저 차이.
7. **PWA/오프라인** — 신규 대용량(PDF/EPUB) 캐시 전략은 Phase E 이후 별도 검토.

## 8. 다음 단계

이 계획 승인 시 Phase A부터 착수한다. 시작 전 확정할 소소한 설정:
- 로컬 루트 경로(들)와 WebDAV 원격 정보(env 키 네이밍).
- 영속화: SQLite vs JSON 파일 최종 택일.
- `만화/파일` 모드 진입 UX(탭 vs 별도 라우트).
