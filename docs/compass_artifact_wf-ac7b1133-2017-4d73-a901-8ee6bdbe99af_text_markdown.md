# Komga 유사 웹툰/만화 뷰어 앱 개발 계획서 — 종합 기술 리서치 보고서

> 작성 기준일: 2026-05-29 · 대상: 인프라 매니저(자체호스팅, 1인 개인용) · 개발 스타일: 바이브 코딩(AI 어시스턴트) + 마크다운 문서화

---

## TL;DR

- **권장 아키텍처는 "Komga 백엔드(MIT 라이선스) 재사용 + 커스텀 반응형 프론트엔드"다.** Komga는 검증된 미디어 서버로 OpenAPI 3.1 REST API, OPDS v1.2/v2.0, ComicInfo.xml/EPUB 메타데이터, 멀티유저·OIDC 인증, 썸네일·스캔·중복감지를 모두 제공한다. 사용자가 원하는 차별화 포인트(반응형 뷰어)는 **거의 100% 프론트엔드 영역**이므로, 백엔드를 FastAPI로 재구현하는 것은 큰 기능 손실을 감수하는 비효율적 선택이다.
- **차별화 기회는 실재한다.** Komga 내장 DIVINA 웹리더는 "Webtoon(연속 세로 스트립)" 모드를 제공하지만 ① 웹툰을 **자동 감지하지 않고** 시리즈별 `readingDirection` 메타데이터를 수동 설정해야 하며 ② 웹툰 모드에서 **줌·터치 제스처·스케일 옵션이 없고** ③ 챕터 간 자동 전환·이음새 처리에 다수의 미해결 GitHub 이슈가 있다. **이미지 종횡비 기반 자동 모드 전환 + 모바일 제스처 + 디바이스 적응형 레이아웃**이 명확하고 실현 가능한 개선 지점이다.
- **모바일은 PWA로 먼저 검증하고, 네이티브가 필요하면 Capacitor로 웹 코드를 래핑하라.** 사용자가 Next.js 경험자이고 1인 자체호스팅이므로 React Native 풀 네이티브의 진입장벽(별도 코드베이스·빌드 체인·플랫폼별 디버깅)은 과하다. iOS App Store 공식 배포에는 Apple Developer Program($99/년)이 필요하지만, 개인용이라면 무료 Apple ID 사이드로드 또는 TestFlight로 충분하다.

---

## Key Findings

### 1. Komga 분석 — 차별화의 토대로 삼되 재구현하지 말 것

**기술 스택(공식 확인).** Komga 저장소의 `DEVELOPING.md`에 따르면 Komga는 3개 프로젝트로 구성된다: `komga`(Kotlin/Spring Boot 백엔드, API 제공 + 프론트엔드 정적 자산 서빙), `komga-webui`("a VueJS frontend, built at compile time and served by the backend at runtime"), `komga-tray`(데스크톱 트레이 래퍼). 백엔드는 Kotlin · Spring Boot · jOOQ, 프론트엔드는 **Vue.js 2 · Vuetify · TypeScript**다.

> ⚠️ **사용자 요구사항의 "Angular UI" 가정은 부정확하다.** Komga의 UI는 Vue.js다. Angular UI는 경쟁자 **Kavita**(.NET 8 + Angular)의 스택이다. 계획서 작성 시 이 점을 정정해야 한다.

**데이터 저장.** Komga는 **SQLite를 이중 DB로 사용**한다 — 메인 데이터용 `database.sqlite`와 백그라운드 작업 큐용 `tasks` DB를 분리해, 작업 큐 연산이 사용자 쿼리를 막지 않도록 설계되어 있다. 전문검색은 **Apache Lucene**으로 색인(title, summary, authors, tags, genres, publisher, ISBN). 설정은 Spring Boot 프로파일/환경변수 또는 `application.yml`로 한다.

**라이선스.** **MIT** (저장소 LICENSE 파일 확인). 포크·수정·커스텀 프론트엔드 연결에 법적 제약이 없다 — 옵션 A/C 모두 합법적으로 가능.

**기능 목록(전체).**
- 라이브러리(파일시스템 디렉터리 단위) 관리, 다중 라이브러리, 자동 스캔, 라이브러리별 설정/접근제어
- 콘텐츠 조직: **Collections**(시리즈 그룹), **Read Lists**(개별 북의 읽기 순서, ComicRack `.cbl` 임포트 지원)
- 메타데이터: ComicInfo.xml(사이드카/임베디드) + EPUB OPF + 수동 편집, 시리즈 레벨 메타데이터 자동 집계(`MetadataAggregationService`)
- 썸네일: 생성/사이드카(cover.jpg)/유저 업로드 3계층, 우선순위 선택
- 읽기 진행 추적(멀티유저 독립), 검색·필터(Lucene)
- **OPDS v1.2(Atom XML) + v2.0(JSON, 스트리밍·진행 동기화)**, "Keep Reading"·"On Deck" 피드
- **Kobo Sync**, **KOReader Sync**, REST API, 파일 다운로드(북/시리즈/리스트), **중복 파일·중복 페이지 감지/제거**
- 멀티유저(라이브러리별 접근제어, 연령 제한), 소셜 로그인(OAuth2/OIDC)

**지원 파일 포맷.** 공식 문서 기준 **CBZ, CBR(RAR5·solid 아카이브 제외 — 플랫폼별), EPUB(2/3), PDF**. RAR/CBR은 백그라운드에서 CBZ로 자동 변환. 이미지: JPG/PNG/WebP/GIF/AVIF. 파일 분석 시 페이지 치수(width/height)를 추출해 양면 모드에서 landscape 페이지를 올바르게 표시한다.

**REST API 구조.** `/api/v1/` 경로 버저닝, 현재 API 버전 1.23.x대. 인증은 **Basic Auth · `X-API-Key` 헤더 · 세션(`KOMGA-SESSION` 쿠키 / `X-Auth-Token` 헤더)**. 주요 엔드포인트: `/api/v1/libraries`, `/series`, `/books`, `/books/{id}/metadata`(PATCH), `/series/{id}/metadata/refresh`, `/collections`, `/readlists`, 읽기진행 엔드포인트. OPDS 컨트롤러는 OpenAPI 스펙에서 의도적으로 제외(프로토콜 준수 분리).

**라이브러리 스캔/메타데이터.** "1폴더 = 1시리즈" 규칙(`/comics/marvel/amazing-spider-man/` 안의 CBZ는 모두 해당 시리즈의 이슈로 파일명 정렬). ComicInfo.xml은 아카이브 루트에 위치하며, `<Manga>YesAndRightToLeft</Manga>` 값이 자동으로 우→좌 읽기 방향을 설정하는 **유일한 자동 동작**이다.

**한계/단점(차별화 지점 — 서브에이전트 1차 출처 검증).** Komga의 DIVINA 웹리더(`komga.org/docs/guides/webreader-divina/`)는 4개 모드(Left to right / Right to left / Vertical / **Webtoon: "displays all the pages in a continuous vertical strip"**)를 제공하지만 다음 약점이 있다:
1. **웹툰 자동 감지 부재.** "The Webreader will automatically use the *Reading direction* specified in the Book metadata" — 즉 메타데이터에 의존할 뿐, 실제 이미지가 롱스트립인지 자동 판별하지 않는다. `readingDirection` 값(LEFT_TO_RIGHT, RIGHT_TO_LEFT, VERTICAL, WEBTOON)을 **시리즈별로 수동 설정**해야 한다. 라이브러리 전역 기본값조차 없다는 불만이 다수(GitHub #873).
2. **웹툰 모드 기능 빈약.** 문서가 "Touch gestures are available in the Page reader only" 및 Scale type·Double pages를 "Paged reader only"로 명시 — **연속/웹툰 모드에는 줌·스케일·터치 제스처가 없다.**
3. **챕터 전환·이음새·성능 결함.** 스크롤 끝에서 다음 챕터 자동 전환 안 됨(#722), 다음 챕터 이미지 미로딩(#259), 챕터 간 갭 제어 불가(#427), 웹툰 모드 데스크톱에서 이미지 과대 표시·줌 불가(#264, #1079), 프리로딩이 실효 없음(#1323).

→ **결론: 차별화는 "백엔드 교체"가 아니라 "웹툰/만화 자동 감지 + 제스처·줌·디바이스 적응 뷰어"에 있다.** 이것은 정확히 사용자가 원하는 기능이며, 100% 프론트엔드 작업이다.

### 2. 유사 프로젝트 벤치마킹

| 프로젝트 | 스택 | 강점 | 약점/시사점 |
|---|---|---|---|
| **Komga** | Kotlin/Spring Boot + Vue | 안정적 REST API, OPDS v1+v2, Kobo/KOReader Sync, 중복감지 | 웹툰 UX 약함(위 참조), JVM 시작 느림 |
| **Kavita** | .NET 8 + Angular | EPUB/라이트노벨 강점, AniList 메타데이터, 빠른 시작, 현대적 UI | **OPDS v1만** 지원 |
| **Mihon(구 Tachiyomi)** | Android(Kotlin) | 최강 모바일 리더, 자동 웹툰 감지(SY 포크: "Automatic webtoon detection"), Komga 확장 | Android 전용 |
| **Suwayomi(구 Tachidesk)** | JVM 서버 + React PWA | 자체호스팅 + Tachiyomi 확장 생태계, 멀티플랫폼 | 온라인 소스 중심 |
| **Paperback/Aidoku/Yomu/KMReader/Komic** | iOS 네이티브 | 이미 Komga iOS 클라이언트 생태계 존재 | **이미 다수 존재 → 단순 클라이언트로는 차별화 부족** |
| **YACReader** | Qt/C++ | 데스크톱+서버, 오래된 안정성 | 모던 반응형 약함 |

**핵심 시사점**: iOS Komga 클라이언트(Panels, Paperback, Komic, KMReader, Yomu 등)는 이미 풍부하다. 사용자가 만들 가치가 있는 것은 "또 하나의 클라이언트"가 아니라 **반응형 자동 적응 뷰어**라는 차별화된 UX다.

### 3. 반응형 뷰어 구현 기술 — 최우선 차별화

**웹툰 vs 만화 자동 감지(이미지 종횡비 분석).** 핵심 알고리즘은 페이지 이미지의 height/width 비율 분석이다. Komga가 분석 단계에서 추출하는 페이지 치수(width/height)를 REST API로 받거나, 프론트엔드에서 첫 N페이지를 측정해 판별한다. 업계 관행상 **세로:가로 비율 2.5:1 초과**를 롱스트립/강제분할 임계값으로 사용한다(웹툰은 폭 800~1280px, 높이 5000~20000px로 비율 1:6 이상이 일반적; 만화는 690×1024 등 가로 우세). 권장 로직:
- 시리즈 첫 3~5페이지 평균 종횡비 측정 → 비율 > 2.0~2.5면 **세로 연속 스크롤(webtoon)**, 그 외 페이지형.
- ComicInfo.xml의 `readingDirection`/태그(webtoon, manhwa, long strip)가 있으면 우선 적용(Mihon/Tachimanga 방식: "Automatically enable Webtoon mode if the entry's tags contain 'webtoon', 'long strip', 'manhwa'").

**양면/한면 토글.** 화면 가로폭 > 세로폭 + 태블릿/데스크톱 = 양면(spread, 펼친 책), 모바일/세로 = 단면. landscape 페이지(width > height)와 첫/마지막 페이지는 항상 단면 처리(Komga·OpenComic 공통 관행). 사용자 수동 토글 + orientation 이벤트(`window.matchMedia('(orientation: landscape)')`) 기반 자동 전환.

**모바일 제스처·줌.**
- 웹: `react-zoom-pan-pinch` 또는 `tokagemushi/manga-viewer`(zero-dependency, RTL/LTR, 핀치 줌, spread, 스와이프, 키보드 내비). WebView 내장 시 `scrollEnabled=false`로 두고 뷰어가 제스처 처리.
- React Native: `react-native-gesture-image-viewer`(Reanimated 기반 60fps, 핀치/더블탭/스와이프/팬, iOS·Android·Web 호환).
- 컴포넌트형 웹 라이브러리: `react-comic-viewer`(스와이프 페이지 이동, 더블탭 2x 줌 — 단, iOS Safari Fullscreen API 미지원 주의).

**이미지 최적화.**
- **WebP/AVIF 변환 + lazy loading + prefetch.** 웹툰의 초대형 이미지는 2000~3000px 단위로 분할 서빙하면 디코딩·메모리 부담이 줄어든다(Komga #1323 프리로딩 실효성 문제의 교훈: `display:none` 대신 실제 렌더 우선).
- **썸네일 생성**: libvips/Sharp 권장. libvips 8.13 공식 릴리스 노트는 ImageMagick6 대비 "around 10x faster, needs 4x less memory"로 보고하며, Criteo 엔지니어링은 ImageMagick 대비 "expecting up to 5.5 times faster", 프로덕션 실측 "230% faster in average"로 보고한다. FastAPI(Python)면 `pyvips`, Node/Next API면 `sharp`.

### 4. 백엔드 아키텍처 옵션 — 권장: 옵션 A

| | 옵션 A: Komga + 커스텀 프론트엔드 | 옵션 B: FastAPI + PostgreSQL 신규 | 옵션 C: Komga 포크 |
|---|---|---|---|
| 개발 속도 | ★★★★★ (백엔드 즉시 가용) | ★★ (스캔·메타·OPDS 재구현) | ★★★ |
| 사용자 친숙도 | ★★★ (REST 소비만) | ★★★★★ (FastAPI/PG 보유) | ★ (Kotlin/Spring 필요) |
| 제어/커스터마이징 | ★★★ (백엔드 변경은 Kotlin) | ★★★★★ | ★★★★ |
| 검증/안정성 | ★★★★★ | ★★ | ★★★★ |
| 차별화 달성 | ★★★★★ (뷰어는 FE 영역) | ★★★★★ | ★★★★ |

**권장: 옵션 A.** 차별화가 전부 프론트엔드에 있으므로, Komga를 헤드리스 백엔드처럼 쓰고 REST API/OPDS v2를 소비하는 Next.js 커스텀 리더를 만든다. **단, 백엔드를 손대야 하는 기능(예: 서버측 자동 웹툰 감지 플래그 저장)이 누적되면 옵션 B로 점진 이행**한다. FastAPI 선례가 충분하다 — ComicOPDS(FastAPI + SQLite FTS5 + 썸네일 캐시 + OPDS PSE 1.1, 17만+ CBZ 스트레스 테스트), Issued(FastAPI + HTMX, CBZ/CBR + 웹리더 + OPDS)는 사용자 스택과 거의 동일한 참고 구현이다.

**FastAPI로 직접 페이지 서빙 시**: CBZ는 단순 ZIP이므로 `zipfile`로 페이지 인덱스를 열고 페이지 번호로 개별 이미지를 스트리밍 응답. 메타데이터는 ComicInfo.xml(Anansi Project 스키마 v2.1 draft)을 파싱. PostgreSQL에 시리즈/북/페이지치수/읽기진행 테이블 설계.

### 5. 프론트엔드/모바일 앱 기술 선택

**웹 프론트엔드: Next.js 15(기존 스택) 권장.** 사용자 친숙도가 결정적이며, 반응형은 CSS/JS로 충분히 달성된다.

**모바일 — 진입장벽 현실 평가 및 단계적 권장:**

1. **PWA(1순위 검증)**: Next.js를 PWA로 만들어 홈 화면 추가. **장점**: 추가 코드 0, 즉시 배포, 자체호스팅과 궁합 최상. **iOS 제약(반드시 인지)**: Cache API는 모바일에서 파티션당 약 50MiB(≈52MB) 고정 한도(Love2Dev: "the hard limit for the Mobile devices"); iOS/iPadOS 13.4부터 script-writable storage에 **7일 상한** — PWA를 7일간 안 열면 저장 데이터가 삭제될 수 있음(Tigren); 백그라운드 동기화 없음; App Store 미등재; 푸시는 iOS 16.4+ 홈화면 설치 시에만. → **만화 뷰어는 PWA 적합도가 높다**(오프라인 카탈로그 브라우징·캐싱·읽기). 단 대용량 오프라인 다운로드가 핵심이면 한계.

2. **Capacitor(2순위 — 네이티브 필요 시)**: 기존 Next.js 웹 코드를 WebView 네이티브 컨테이너로 래핑. **장점**: 코드 재사용 최대, 웹 기술 그대로 App Store/Play Store 배포, AI 코딩 산출물(React/HTML/CSS)을 "번역세(translation tax)" 없이 그대로 사용 — 바이브 코딩 선호와 최적 궁합. NextNative 같은 Next.js+Capacitor 패턴 존재. **단점**: WebView 성능 상한, 일부 네이티브 플러그인 생태계가 RN보다 얇음.

3. **React Native + Solito(3순위 — 성능 극대화 시)**: Next.js와 RN을 모노레포로 통합, Solito가 내비게이션 통일(코드 ~90% 공유), Tamagui/NativeWind로 UI 공유. **장점**: 네이티브 스크롤 물리·60fps 제스처(웹툰 스크롤 품질에 유리). **단점**: 모노레포 설정·버전 동기화 부담, 1인 프로젝트엔 초기 비용 큼. npm 다운로드는 Expo/RN이 압도적이지만 1인 개인용에는 과투자.

4. **Flutter/풀 네이티브(비추천)**: Dart 학습·별도 코드베이스로 사용자 스택(JS/TS)과 단절. AI 코딩 산출물도 대부분 React/HTML이라 비효율.

**코드 공유 전략**: PWA→Capacitor 경로는 단일 Next.js 코드베이스 유지. RN까지 갈 경우만 Turborepo + Solito 모노레포(`apps/next`, `apps/expo`, `packages/app|ui`).

### 6. 자체 호스팅 배포

**Docker Compose + Cloudflare Tunnel(기존 보유).** Komga 컨테이너(`gotson/komga`)에 config·data 볼륨 마운트, `JAVA_TOOL_OPTIONS=-Xmx512m`로 JVM 힙 제한(대형 라이브러리에서 2GB 폭주 방지). Synology NAS는 Container Manager로 `--user UID:GID` 지정해 권한 설정. 외부 노출은 Cloudflare Tunnel로 포트 개방 없이 처리.

**인증(사용자 OpenLDAP 활용).** Komga는 **OAuth2/OIDC** 소셜 로그인을 지원(`spring.security.oauth2.client`, RS256 JWT, `issuer-uri` 자동 디스커버리). OpenLDAP을 직접 붙이는 대신 **Authelia 또는 Authentik을 IdP로 두고 LDAP 백엔드 연결 → Komga는 OIDC 클라이언트로 연동**하는 것이 정석(Authelia/Authentik 공식 Komga 통합 문서 존재). 주의: Komga는 OIDC 로그인 전에 동일 이메일의 로컬 유저가 존재해야 하며(GitHub #716), 자동 생성은 `oauth2-account-creation: true`로 활성화. 1인 사용이면 JWT/세션만으로도 충분하므로 OIDC는 선택사항.

**모바일 앱 배포 옵션:**
- **iOS**: 공식 Apple Developer Program은 "99 USD per membership year"(Apple Membership Details). 무료 Apple ID(Personal Team)는 App ID 최대 10개·테스트 기기 3대로 각각 **7일 후 만료**(재서명 필요) — 1인 개인용엔 충분. 유료 가입 시 **TestFlight**(외부 테스터 최대 10,000명, 단 "build becomes unavailable for testers after 90 days") 또는 **Ad Hoc**(만료 없이 최대 100대 직접 설치).
- **Android**: APK 직접 배포(가장 간단), F-Droid, 또는 Play Store. Capacitor/RN/PWA(TWA) 모두 가능.
- **권장**: 개인용이므로 **PWA 홈화면 설치 → (필요시) iOS 무료 사이드로드 / Android APK 직접 배포**. App Store 정식 배포는 가족 공유 등 확장 시에만.

### 7. 데이터 저장 및 파일 관리

- **NAS 마운트/스캔**: Synology 볼륨을 Docker 볼륨으로 마운트, Komga 라이브러리가 "1폴더=1시리즈"로 스캔. 기존 폴더 구조 유지가 중요하면 옵션 B(Issued식 구조 보존 스캔)도 고려.
- **썸네일 생성/캐싱**: libvips(`pyvips`/`sharp`) — shrink-on-load로 초대형 이미지도 빠르게 처리. ImageMagick은 폴백.
- **메타데이터 DB 설계**(옵션 B 채택 시): `series`(title, status, readingDirection, ageRating), `book`(seriesId, number, filePath, pageCount), `page`(bookId, index, width, height, mediaType), `read_progress`(userId, bookId, page, completed, lastModified). ComicInfo.xml 필드(Series, Number, Volume, Writer, Manga, StoryArc, AgeRating 등)를 매핑.
- **읽기 진행 동기화(웹↔모바일)**: Komga REST의 read-progress 엔드포인트를 **단일 진실 소스(single source of truth)**로 삼아 웹·모바일이 동일 API에 동기화. OPDS v2.0의 Progression API(Readium 제안 표준)도 활용 가능. 오프라인 시 로컬 저장 후 재연결 시 동기화(Komic+ 방식 참고).

### 8. 개발 로드맵 권장사항

**MVP 정의(최소 기능)**: Komga 백엔드 + Next.js 반응형 웹 리더(자동 웹툰 감지 + 양면/단면 토글 + 기본 제스처). 이것만으로 Komga 대비 명확한 차별점이 생긴다.

| 단계 | 기간 | 작업 | 검증 포인트 |
|---|---|---|---|
| **Phase 0 — 토대** | 0–1개월 | Docker Compose로 Komga 배포(Cloudflare Tunnel) · REST API 탐색(`/swagger-ui.html`) · Next.js 스캐폴딩 + 라이브러리/시리즈/북 목록 뷰 · **종횡비 자동 웹툰 감지 + 세로 스크롤/페이지 토글 뷰어** | 실제 라이브러리에서 웹툰/만화가 올바른 모드로 자동 표시되는가? 데스크톱/태블릿/모바일 3종에서 레이아웃 정상? |
| **Phase 1 — 핵심 UX** | 1–3개월 | 핀치 줌·더블탭·스와이프 제스처 · 양면 spread(landscape 예외 처리) · WebP/AVIF + lazy/prefetch · 읽기 진행 동기화(REST) · PWA화(매니페스트·서비스워커·오프라인 캐시) · (선택) OIDC | 진행상황이 기기 간 동기화되는가? PWA 홈화면 설치·오프라인 브라우징 동작? iOS 7일 스토리지 한계 대응책 마련? |
| **Phase 2 — 모바일/확장** | 3–6개월 | Capacitor로 iOS/Android 네이티브 래핑 · 오프라인 다운로드(대용량) · 푸시(신규 시리즈) · 성능 튜닝(초대형 웹툰 이미지 분할 서빙) · 필요 시 백엔드를 FastAPI로 점진 이행 | 네이티브 앱에서 스크롤·제스처가 매끄러운가? 오프라인 다운로드 신뢰성? App Store 사이드로드/TestFlight 배포 검증? |

각 단계는 **"동작하는 산출물 + 마크다운 문서"**로 마무리(바이브 코딩 워크플로). Phase 0의 자동 감지 뷰어가 가장 위험·가치가 높은 핵심이므로 가장 먼저 검증한다.

---

## Details

**왜 백엔드 재구현이 함정인가.** Komga가 무료로 제공하는 것들 — Lucene 전문검색, 중복 페이지 감지, ComicInfo/EPUB 메타데이터 집계, OPDS v1+v2, Kobo/KOReader Sync, 멀티유저 접근제어, 썸네일 3계층 — 을 FastAPI로 동등하게 재구현하려면 수개월이 든다. 반면 사용자의 차별화 욕구(반응형 뷰어)는 이 중 어느 것도 백엔드 변경을 요구하지 않는다. 따라서 **"Komga를 헤드리스로 쓰고 프론트엔드에 집중"**이 비용 대비 효과가 가장 크다. 백엔드 커스터마이징이 정말 필요해지는 시점(예: 자동 감지 결과를 서버에 영구 저장, 커스텀 메타데이터 필드)에 옵션 B로 갈아타도 늦지 않으며, 그때는 프론트엔드가 이미 검증된 상태다.

**자동 웹툰 감지의 구현 디테일.** Komga REST는 페이지별 width/height를 제공한다(분석 시 추출). 프론트엔드에서 시리즈의 첫 3~5페이지 종횡비 중앙값을 계산 → height/width ≥ 2.0이면 webtoon, 그 외 paged. 더 정교하게는 ComicInfo.xml 태그/`readingDirection`(WEBTOON/VERTICAL)을 우선하고, 없으면 종횡비 휴리스틱으로 폴백, 사용자가 언제든 수동 오버라이드. 이는 Komga가 못 하는 "메타데이터 없이도 올바른 모드"를 달성한다.

**OPDS vs REST 선택.** 커스텀 프론트엔드를 직접 만들 것이므로 **REST API(OpenAPI 3.1)가 우선** — 더 풍부하고 진행상황·메타데이터 PATCH가 가능. OPDS는 서드파티 리더 호환(Mihon, Paperback 등)을 추가로 제공하고 싶을 때 활용. Komga가 OPDS v2(JSON·스트리밍·Progression API)를 지원하므로 모바일 동기화에도 유용.

---

## Recommendations

**1단계(즉시 실행)** — Komga를 Docker Compose로 배포하고 Cloudflare Tunnel로 노출. `/swagger-ui.html`로 REST API를 파악하고, Next.js 15로 라이브러리 브라우징 + **종횡비 기반 자동 웹툰/만화 감지 뷰어**를 만든다. 이것이 MVP이자 핵심 차별점.

**2단계** — 제스처(핀치/더블탭/스와이프)·양면 토글·이미지 최적화·읽기진행 동기화를 완성하고 PWA화. iOS PWA 스토리지 7일 한계에 대비해 "자주 안 열면 캐시 소실" 안내 또는 핵심 데이터 서버 동기화.

**3단계** — 네이티브가 필요하면 **Capacitor로 동일 웹 코드를 래핑**(RN 풀 전환은 비추천). iOS는 무료 사이드로드/TestFlight, Android는 APK 직접 배포.

**진행 방향을 바꿀 벤치마크(thresholds):**
- PWA 오프라인 캐시 50MB 한계가 사용 경험을 해치면 → Capacitor로 이행.
- 백엔드 변경 요구(서버측 자동감지 저장·커스텀 필드)가 3건 이상 누적되면 → FastAPI(옵션 B)로 점진 이행.
- 웹툰 스크롤이 WebView에서 끊기면(jank) → 해당 화면만 React Native 네이티브 모듈로 분리.
- 가족/지인 공유로 사용자가 늘면 → OIDC(Authelia/Authentik + OpenLDAP) 도입 + App Store 정식 배포 검토.

---

## Caveats

- **"Angular UI" 가정 정정**: Komga의 프론트엔드는 **Vue.js**(Vue 2 + Vuetify + TypeScript)다. Angular는 경쟁자 Kavita의 스택. 계획서에 반영 필요.
- **종횡비 임계값 2.5:1**은 주로 AI 이미지 처리 파이프라인(웹툰 강제 분할)의 관행 수치로, 뷰어 UX에서는 2.0~2.5 범위에서 실제 라이브러리로 튜닝해야 한다. 절대적 기준이 아니다.
- **Komga 웹툰 약점 관련 GitHub 이슈(#264, #427, #722, #1079, #1323 등)**는 시점에 따라 일부가 해결될 수 있으니, 구현 직전 최신 Komga 릴리스(현재 1.24.x대)에서 재확인 권장.
- **iOS 무료 사이드로드의 7일 재서명**은 개인 1인용엔 감내 가능하나, 매주 재설치 번거로움이 크면 $99 Developer 가입이 현실적.
- **OPDS v2의 Progression/Positions API는 "proposed standard"**(Readium)로 표기되어 있어, 클라이언트 호환성은 구현체마다 다를 수 있다.
- 본 보고서의 성능 수치(libvips 10x/5.5x 등)는 벤더/벤치마크 환경에 따른 값이며, 실제 NAS·GPU 서버 환경에서 자체 측정 권장.