# Panelshift 배포 매뉴얼 (개발 서버 → 운영 서버)

개발 서버에서 만든 변경을 운영 서버로 전달하는 절차를 정리한 문서입니다.

## 0. 검증 범위 (먼저 읽어주세요)

이 문서의 내용은 검증 수준이 다릅니다. 혼동하지 않도록 구분해 둡니다.

**이 문서의 절차는 2026-07-31 `testserver`에 실제로 적용되어 검증되었습니다.** 배포된 리비전은 `f221ad6` (`feat/desktop-web-ui-polish`)입니다.

| 구분 | 내용 |
|---|---|
| ✅ 운영 서버에서 실제 검증됨 | clone → `npm ci` → build → systemd 등록 → 8장 체크리스트 전항목 통과. 실제 라이브러리 렌더링, 썸네일·페이지 이미지 프록시, 자동 재시작 |
| ✅ 개발 서버에서 검증됨 | `NEXT_PUBLIC_` 빌드 시점 고정 동작 (3장) |
| ✅ 완료 | linger 설정(재부팅 내구성), Komga 노출 축소(4.5.1절), 개발 서버 중복 구동 해제 |
| ⚠️ 남음 | `docker.service`의 tailscaled 순서 지정(sudo 필요, 4.5.1절), Android APK 재빌드(10장) |

---

## 1. 구성 이해

### 1.1 대상 호스트

| 역할 | 호스트 | Tailscale IP |
|---|---|---|
| 개발 서버 | `alienware-1` | `100.92.142.40` |
| **운영 서버** | **`testserver`** | **`100.114.4.40`** |

운영 서버는 **이미 Komga가 돌고 있는 바로 그 호스트**입니다. 즉 배포 후 앱과 Komga가 같은 머신에 놓입니다.

### 1.2 배포 전후 구조 변화

현재 (개발 서버에서 tailnet 너머 Komga 사용):

```
[브라우저/폰] ──▶ alienware-1 : Next 앱 (3001)
                        │  X-API-Key, tailnet 왕복
                        ▼
                 testserver : Komga (25600)
```

배포 후 (운영 서버에서 앱·Komga 동거):

```
[브라우저/폰] ──▶ testserver : Next 앱 (3001)
                        │  X-API-Key, localhost (네트워크 왕복 없음)
                        ▼
                 testserver : Komga (25600)
```

이 이전으로 얻는 것:

- **Komga 호출이 loopback으로 바뀝니다.** 페이지 이미지·썸네일은 전부 앱 서버가 프록시하므로 이미지 1장마다 tailnet을 왕복하던 것이 사라집니다. 만화 뷰어 특성상 체감 차이가 가장 큰 부분입니다.
- **Komga의 LAN 노출을 없앨 수 있습니다.** 앱은 루프백만 있으면 되므로 바인딩을 좁힐 수 있습니다 (4.5.1절).

핵심 원칙: **Komga API 키는 Next 서버 프로세스에만 존재합니다.** 페이지 이미지·썸네일·읽기 진행률은 모두 `/api/komga/...` 라우트로 프록시되어 브라우저에 키가 노출되지 않습니다. 배포 시 이 경계를 깨지 않는 것이 가장 중요합니다.

### 1.3 런타임 요구사항

운영 서버에서 배포 전에 확인하세요.

```bash
node -v          # 20 이상
npm -v
git --version
systemctl --user is-system-running   # user systemd 사용 가능해야 함
docker ps | grep -i komga            # 기존 Komga 컨테이너 확인
free -h          # 빌드에 여유 메모리 필요
sudo -n true     # 무인 sudo 가능 여부 (linger 설정에 필요)
```

**실제 확인된 운영 서버 환경 (2026-07-31)**

| 항목 | 값 | 비고 |
|---|---|---|
| OS | Ubuntu 22.04.3 LTS (x86_64) | |
| Node / npm | **v24.15.0** / 11.16.0 | 개발 서버(v20.20.2)와 다르지만 빌드·구동 정상 확인 |
| Komga | `gotson/komga:latest`, 2개월 가동 | 저장소 compose의 핀 버전(1.24.4)과 다름 |
| Komga 바인딩 | 최초 `0.0.0.0:25600` → 현재 루프백 + tailscale IP | 4.5.1절에서 축소 완료 |
| 메모리 | 3.8Gi (가용 2.0Gi) + swap 3.8Gi | 빌드는 통과했으나 여유롭지 않음 |
| 디스크 | 313G 중 136G 여유 | |
| sudo | **비밀번호 필요** | `/opt` 사용 불가 → `~/panelshift`에 설치 |

Node 버전이 개발 서버와 다르지만(20 vs 24) 빌드·구동 모두 문제없었습니다. 다만 **빌드 산출물을 서버 간에 복사하는 방식(2장의 세 번째 옵션)은 이 차이 때문에 더욱 권장하지 않습니다.** 각 서버에서 빌드하세요.

---

## 2. 전달 경로 선택

| 방식 | 적합한 상황 | 비고 |
|---|---|---|
| **git pull (권장)** | 일반적인 모든 경우 | 이력 추적·롤백이 쉽습니다. 저장소: `https://github.com/hsp1978/toon_viewer.git` |
| rsync | 운영 서버에 git/네트워크가 없을 때 | `node_modules`, `.next`, `.env*` 는 **반드시 제외**하고 전송 후 현지 빌드 |
| 빌드 산출물 복사 | 운영 서버가 빌드하기엔 사양이 낮을 때 | Node 버전·아키텍처가 완전히 같아야 합니다. 권장하지 않습니다 |

아래는 **git 방식**을 기준으로 서술합니다.

> 참고: 저장소에 추적된 파일은 64개이며, 시크릿 파일은 전부 `.gitignore` 처리되어 있습니다. 추적되는 env 파일은 `app/.env.example` **하나뿐**입니다. 즉 **실제 시크릿은 git으로 전달되지 않습니다** — 3.2절대로 별도 전달해야 합니다.

---

## 3. ⚠️ 가장 중요한 함정: 빌드 시점에 고정되는 변수

배포 사고가 가장 많이 나는 지점입니다. Next.js는 `NEXT_PUBLIC_` 접두사 변수를 **빌드 시점에 리터럴로 치환**하고, 조건식까지 접어버립니다.

개발 서버 빌드 산출물에서 실제로 확인한 결과입니다. 원본 소스는:

```ts
// src/lib/komga-client.ts
forceMock: process.env.NEXT_PUBLIC_CATALOG_MODE === "mock" || process.env.KOMGA_FORCE_MOCK === "true",
```

컴파일된 결과는:

```js
forceMock:"true"===process.env.KOMGA_FORCE_MOCK
```

`NEXT_PUBLIC_CATALOG_MODE === "mock"` 비교가 **사라졌습니다.** 빌드 당시 값이 `komga`였기 때문에 `false`로 확정되어 제거된 것입니다.

여기서 나오는 결론 두 가지:

1. **운영 서버에서 `.env.local` 없이 빌드하면 `.env`의 `mock` 값이 구워집니다.** 이후 환경변수를 아무리 고쳐도 앱은 계속 mock 데이터를 보여줍니다. 에러도 안 납니다. "서비스는 뜨는데 내 만화가 안 보인다"의 원인이 이것입니다.
2. 반대로 카탈로그 모드를 런타임에 되돌릴 수 있는 유일한 스위치는 **`KOMGA_FORCE_MOCK`** 입니다. 이 변수는 컴파일 후에도 `process.env` 조회로 남아 있습니다.

### 3.1 변수 분류표

| 변수 | 시점 | 비고 |
|---|---|---|
| **`CATALOG_MODE`** | 런타임 | **권장.** `komga` / `mock`. 아래 `NEXT_PUBLIC_` 값을 항상 이깁니다 |
| `NEXT_PUBLIC_CATALOG_MODE` | **빌드** | 레거시. 바꾸려면 재빌드 필요 |
| `NEXT_PUBLIC_API_BASE_URL` | **빌드** | 미설정 시 상대 경로 `/api/...` 사용 |
| `KOMGA_BASE_URL` | 런타임 | 재시작만으로 반영 |
| `KOMGA_API_KEY` | 런타임 | 재시작만으로 반영 |
| `KOMGA_USERNAME` / `KOMGA_PASSWORD` | 런타임 | API 키 대신 Basic 인증 사용 시 |
| `KOMGA_FORCE_MOCK` | 런타임 | 런타임 mock 스위치 |
| `KOMGA_MAX_LIST_PAGES` | 런타임 | 카탈로그 조회 페이지 수 |
| `KOMGA_BOOTSTRAP_BOOK_LIMIT` | 런타임 | 페이지 크기 선반영 대상 수 |
| **`ADMIN_TOKEN`** | 런타임 | 시리즈 삭제에 필수. 미설정이면 삭제가 503으로 거부됩니다 (9.1절) |

**규칙: 빌드 전에 `.env.local`을 먼저 배치하세요.** 순서를 지키는 것만으로 이 함정 전체를 피할 수 있습니다.

### 3.1.1 mock으로 구워졌을 때의 응급 복구

`CATALOG_MODE`가 런타임에 읽히므로, 잘못 구워진 빌드도 **재빌드 없이** 되살릴 수 있습니다. 실제로 검증한 동작입니다.

```bash
# mock이 구워진 빌드를 그대로 기동 → mock
curl -s localhost:3001/api/komga/health
# {"ok":true,"mode":"mock"}

# 같은 빌드에 CATALOG_MODE만 주입 → komga 로 복구
CATALOG_MODE=komga <기동 명령>
# {"ok":true,"mode":"komga","status":200,"libraries":1,"series":218}
```

유닛에 적용하려면 `Environment=CATALOG_MODE=komga` 한 줄을 넣고 재시작하면 됩니다. 다만 이건 응급 처치이고, 정상 경로는 `.env.local`을 갖춘 뒤 재빌드하는 것입니다.

### 3.2 시크릿 전달 방법

`.env.local`은 git에 없으므로 별도 경로로 옮깁니다. 셸 히스토리에 키가 남지 않는 방식을 쓰세요.

```bash
# 개발 서버(alienware-1)에서 운영 서버(testserver)로
scp /home/ubuntu/viewer/app/.env.local 100.114.4.40:/home/ubuntu/panelshift/app/.env.local
```

⚠️ **그대로 복사하면 안 됩니다.** 개발 서버의 `.env.local`은 `KOMGA_BASE_URL=http://100.114.4.40:25600`을 가리킵니다. 이 값이 운영 서버에 그대로 들어가면 앱이 자기 자신의 tailnet 주소로 우회 호출하게 됩니다. 동작은 하지만 1.2절의 이점이 사라집니다. 복사 후 반드시 `localhost`로 고치세요.

```bash
# 운영 서버에서
sed -i 's|^KOMGA_BASE_URL=.*|KOMGA_BASE_URL=http://localhost:25600|' /home/ubuntu/panelshift/app/.env.local
grep KOMGA_BASE_URL /home/ubuntu/panelshift/app/.env.local
```

또는 운영 서버에서 직접 작성합니다.

```bash
cp app/.env.example app/.env.local
chmod 600 app/.env.local
# 편집기로 열어 실제 값 입력
```

> ⚠️ `.env.example`의 기본값도 `NEXT_PUBLIC_CATALOG_MODE=mock` 입니다. 복사만 하고 이 줄을 `komga`로 고치지 않으면, API 키를 정확히 넣었어도 mock 모드가 구워집니다. 복사 후 반드시 확인하세요:
>
> ```bash
> grep NEXT_PUBLIC_CATALOG_MODE app/.env.local   # → komga 여야 함
> ```
>
> 참고로 `.env.example`의 `KOMGA_MAX_LIST_PAGES=3`, `KOMGA_BOOTSTRAP_BOOK_LIMIT=40`은 개발 서버 실사용 값(`20`, `0`)과 다릅니다. 운영에서는 개발 서버 값을 기준으로 삼으세요.

`app/.env.local` 내용 형식:

```bash
NEXT_PUBLIC_CATALOG_MODE=komga
KOMGA_BASE_URL=http://localhost:25600     # 운영 서버는 Komga와 동거하므로 localhost
KOMGA_API_KEY=<실제-키>
KOMGA_USERNAME=
KOMGA_PASSWORD=
KOMGA_FORCE_MOCK=false
KOMGA_MAX_LIST_PAGES=20
KOMGA_BOOTSTRAP_BOOK_LIMIT=0
```

기존 API 키(개발 서버가 쓰던 것)는 `testserver`의 Komga에서 발급된 것이므로 **그대로 재사용 가능합니다.** 새로 발급할 필요가 없습니다.

> `.env.local`은 `.env`보다 우선합니다. 저장소의 `.env`는 `NEXT_PUBLIC_CATALOG_MODE=mock`이므로, `.env.local`이 없으면 조용히 mock으로 떨어집니다. 파일 존재 여부를 배포 스크립트에서 검사하는 것을 권장합니다 (5장 스크립트에 포함).

---

## 4. 최초 배포 (1회만)

운영 서버에서 실행합니다. 설치 경로는 `/home/ubuntu/panelshift` 입니다.

> `/opt/panelshift`를 쓰지 않는 이유: 운영 서버는 무인 sudo가 불가능해 `/opt` 아래에 디렉터리를 만들 수 없습니다. 홈 디렉터리는 sudo 없이 쓸 수 있고, systemd **user** 유닛과도 잘 맞습니다.

### 4.1 소스 가져오기

```bash
git clone --branch feat/desktop-web-ui-polish \
  https://github.com/hsp1978/toon_viewer.git ~/panelshift
cd ~/panelshift
git log --oneline -1        # 의도한 리비전인지 확인
```

> 현재 운영에 올라간 것은 `main`이 아니라 `feat/desktop-web-ui-polish` 브랜치입니다. 데스크톱 레이아웃 개선과 시리즈 숨김/삭제 기능이 이 브랜치에만 있기 때문입니다. main으로 병합한 뒤에는 5장의 갱신 절차에서 브랜치명을 바꾸세요.

### 4.2 의존성 설치

```bash
cd /home/ubuntu/panelshift/app
npm ci        # package-lock.json 기준 재현 설치. npm install 대신 ci 사용
```

### 4.3 시크릿 배치 (빌드 **전**)

3.2절 참고. 이 단계를 건너뛰면 mock 모드가 구워집니다.

```bash
test -f /home/ubuntu/panelshift/app/.env.local && echo OK || echo "중단: .env.local 없음"
```

### 4.4 빌드

```bash
cd /home/ubuntu/panelshift/app
npm run build
```

### 4.5 Komga — 건드리지 마세요 🚫

**운영 서버에는 이미 Komga가 돌고 있습니다. 이 저장소의 `docker-compose up`을 실행하지 마세요.**

저장소의 `docker-compose.yml`은 `./komga/config`와 `./library`를 마운트하는 **별도의 새 인스턴스**를 띄웁니다. 운영 서버에서 이를 실행하면:

- 컨테이너 이름(`panelshift-komga`)이나 25600 포트가 충돌하거나,
- 충돌을 피해 뜨더라도 **기존 라이브러리·읽기 진행률이 없는 빈 Komga**가 새로 생깁니다.

기존 Komga는 그대로 두고 앱만 붙이는 것이 목표입니다. 상태만 확인하세요.

```bash
docker ps | grep -i komga                                   # 기존 컨테이너 확인
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:25600/api/v1/series   # → 401 (살아있음)
```

`401`이면 정상입니다 (인증 없이 불렀으므로). 연결 자체가 안 되면 Komga가 loopback에 바인딩되어 있는지 확인하세요.

### 4.5.1 Komga 노출 범위 (적용 완료)

Komga는 `webtoon-scraper` 스택의 일부이며, 정의 파일은 이 저장소가 아니라 **`/home/ubuntu/webtoon-scraper/docker-compose.yml`** 입니다.

원래 `"25600:25600"`(= `0.0.0.0`)이라 LAN의 모든 기기가 Komga에 직접 닿았습니다. 현재는 두 주소로만 좁혀져 있습니다.

```yaml
  komga:
    ports:
      - "127.0.0.1:25600:25600"      # 패널시프트 앱이 쓰는 경로
      - "100.114.4.40:25600:25600"   # tailnet에서 Komga 웹 UI 접근용
```

| 출발지 | 결과 |
|---|---|
| 앱 → `localhost:25600` | ✅ 200 |
| tailnet → `100.114.4.40:25600` | ✅ 200 |
| LAN → `192.168.219.102:25600` | 🚫 차단 |

> ⚠️ **루프백을 반드시 함께 남겨두세요.** Tailscale IP 하나만 지정하면 `127.0.0.1` 바인딩이 사라져서 **앱이 Komga에 닿지 못합니다.** 실제로 이 상태가 되어 health가 `{"ok":false,"error":"fetch failed"}`로 떨어진 적이 있습니다. 두 줄 다 있어야 합니다.

적용 방법:

```bash
cd /home/ubuntu/webtoon-scraper
cp docker-compose.yml docker-compose.yml.bak-$(date +%Y%m%d-%H%M%S)
# ports 를 위와 같이 두 줄로 수정
docker compose config --quiet          # 문법 확인
docker compose up -d --no-deps komga   # komga 만 재생성
```

`--no-deps`로 같은 스택의 다른 컨테이너(스크레이퍼 등)는 건드리지 않습니다.

**부팅 순서 주의.** `docker.service`는 `tailscaled.service`에 의존하지 않습니다. 재부팅 시 tailscale IP가 붙기 전에 docker가 먼저 뜨면 `100.114.4.40` 바인딩이 실패합니다. `restart: unless-stopped` 정책이 재시도하므로 대개 스스로 복구되지만, 확실히 하려면 sudo로 순서를 지정하세요.

```bash
sudo systemctl edit docker.service
# 아래 내용 추가
# [Unit]
# After=tailscaled.service
# Wants=tailscaled.service
```

이 설정을 넣지 않아도 `127.0.0.1` 바인딩은 항상 성공하므로 **앱 자체는 부팅 직후에도 정상 동작합니다.** 영향받는 것은 tailnet에서의 Komga UI 접근뿐입니다.

### 4.6 systemd 서비스 등록

개발 서버에 등록된 유닛(`~/.config/systemd/user/panelshift.service`)을 운영 서버용으로 옮깁니다. 아래 3개 값을 환경에 맞게 고치세요.

- `WorkingDirectory` — 설치 경로
- `ExecStart`의 node 절대 경로 — `which node` 결과로 대체
- `--hostname` — 바인딩 주소

```ini
[Unit]
Description=Panelshift (Next.js) comic reader
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/home/ubuntu/panelshift/app

ExecStartPre=/bin/bash -c 'for i in $(seq 1 60); do /usr/sbin/ip -4 addr show tailscale0 2>/dev/null | grep -q "inet 100.114.4.40/" && exit 0; sleep 2; done; echo "tailscale0 에 100.114.4.40 미할당" >&2; exit 1'

ExecStart=/usr/bin/node /home/ubuntu/panelshift/app/node_modules/next/dist/bin/next start --hostname 100.114.4.40 --port 3001

Environment=NODE_ENV=production
Environment=PATH=/usr/local/bin:/usr/bin:/bin

Restart=always
RestartSec=5
StartLimitIntervalSec=0

StandardOutput=journal
StandardError=journal
SyslogIdentifier=panelshift

[Install]
WantedBy=default.target
```

등록:

```bash
mkdir -p ~/.config/systemd/user
# 위 내용을 ~/.config/systemd/user/panelshift.service 로 저장
systemctl --user daemon-reload
systemctl --user enable --now panelshift.service
sudo loginctl enable-linger $USER    # 필수: 로그아웃/재부팅 후에도 유지
```

🔴 **현재 운영 서버에 이 설정이 빠져 있습니다.** 무인 sudo가 불가능해 자동화하지 못했습니다. 운영 서버에서 직접 실행해주세요.

```bash
sudo loginctl enable-linger ubuntu
loginctl show-user ubuntu --property=Linger   # → Linger=yes 확인
```

이걸 하지 않으면 SSH 세션이 모두 끊기거나 재부팅했을 때 서비스가 내려가고 다시 올라오지 않습니다. 개발 서버(`alienware-1`)도 동일하게 미설정 상태입니다.

### 4.7 환경별 주의점

**nvm으로 node를 설치한 경우** — systemd는 `.bashrc`를 읽지 않아 `node`를 찾지 못합니다. `ExecStart`에 절대 경로를 쓰고 `PATH`에도 해당 디렉터리를 추가하세요. 개발 서버 유닛이 이 방식입니다.

```ini
ExecStart=/home/ubuntu/.nvm/versions/node/v20.20.2/bin/node /home/ubuntu/panelshift/app/node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3001
Environment=PATH=/home/ubuntu/.nvm/versions/node/v20.20.2/bin:/usr/local/bin:/usr/bin:/bin
```

**Tailscale IP에 바인딩하는 경우** — 부팅 시 `tailscale0`에 IP가 붙기 전에 서비스가 뜨면 `EADDRNOTAVAIL`로 죽습니다. user 유닛은 시스템 유닛인 `tailscaled.service`에 `After=`로 순서를 걸 수 없으므로, 대기 로직을 넣습니다.

```ini
ExecStartPre=/bin/bash -c 'for i in $(seq 1 60); do /usr/sbin/ip -4 addr show tailscale0 2>/dev/null | grep -q "inet <TAILSCALE_IP>/" && exit 0; sleep 2; done; exit 1'
```

**바인딩 주소 선택**

| 주소 | 접근 범위 | 권장 상황 |
|---|---|---|
| `100.114.4.40` (Tailscale IP) | tailnet 기기만 | **운영 서버 기본 권장.** 폰에서 직접 접속 가능하면서 외부 비노출 |
| `127.0.0.1` | 이 호스트만 | 앞에 리버스 프록시를 둘 때 |
| `0.0.0.0` | LAN 전체 + 방화벽 열려 있으면 외부 | 앱 자체에 인증이 없으므로 주의 |

위 유닛 예시는 Tailscale IP 바인딩(`100.114.4.40`)을 기준으로 작성되어 있으며, 그에 맞춰 `ExecStartPre` 대기 로직도 포함했습니다. 개발 서버에서 이 방식이 검증되었습니다 (자동 재시작·loopback 격리 확인).

앱에는 자체 인증이 없습니다. 인터넷 노출이 필요하면 `0.0.0.0`으로 포트를 여는 대신 **인증이 붙은 리버스 프록시나 터널 뒤에 두세요.**

---

## 5. 갱신 배포 (반복 작업)

**순서가 중요합니다: 빌드 성공을 확인한 다음 재시작합니다.** 반대로 하면 실패한 빌드로 서비스가 내려갑니다.

```bash
cd /home/ubuntu/panelshift
git pull --ff-only origin main
cd app
npm ci                                  # package-lock.json 변경 시에만 필요하나, 항상 해도 안전
npm run build                           # 여기서 실패하면 재시작하지 않고 중단
systemctl --user restart panelshift
```

### 5.1 배포 스크립트

`scripts/deploy.sh` 가 위 절차를 그대로 수행합니다. 저장소에 포함되어 있으므로 운영 서버에서 바로 쓸 수 있습니다.

```bash
cd ~/panelshift
./scripts/deploy.sh                 # 현재 체크아웃된 브랜치를 갱신 배포
./scripts/deploy.sh main            # 특정 브랜치를 지정
```

동작 요약:

| 단계 | 실패 시 |
|---|---|
| `.env.local` 존재 확인 | 즉시 중단 (mock 모드로 구워지는 것 방지) |
| `git fetch` + `merge --ff-only` | 즉시 중단 |
| `npm ci` → `npm run build` | **재시작하지 않고 중단** — 기존 서비스는 계속 동작 |
| `systemctl --user restart` | — |
| 헬스체크 (최대 60초) | 로그 40줄 출력 후 실패 반환 |

인자를 주지 않으면 **현재 체크아웃된 브랜치**를 그대로 씁니다. 실수로 배포 대상이 바뀌지 않도록 한 것입니다. 경로나 서비스명이 다르면 `PANELSHIFT_ROOT`, `PANELSHIFT_SERVICE`, `PANELSHIFT_HEALTH_HOST`, `PANELSHIFT_HEALTH_PORT` 로 덮어쓸 수 있습니다.

> 헬스체크 호스트는 systemd 유닛의 `ExecStart=` 줄에서 `--hostname` 값을 읽어 자동으로 맞춥니다. Tailscale IP에 바인딩했다면 `127.0.0.1`로는 응답하지 않기 때문입니다.
>
> 그리고 HTTP 200만 보지 않고 `"mode":"komga"` 와 `"ok":true` 까지 확인합니다. 3장의 mock 함정은 정상적으로 200을 반환하므로 상태 코드만으로는 절대 잡히지 않습니다.

### 5.2 라이브 빌드를 건드리지 않고 미리 검증하기

`next.config.ts`는 `NEXT_DIST_DIR` 환경변수로 출력 디렉터리를 바꿀 수 있게 되어 있습니다.

```ts
...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
```

이를 이용하면 **현재 서비스 중인 `.next`를 그대로 둔 채** 새 코드가 빌드되는지 확인할 수 있습니다.

```bash
NEXT_DIST_DIR=.next-verify npm run build     # 라이브 .next 무손상
# 통과하면 실제 빌드 후 재시작
npm run build && systemctl --user restart panelshift
```

무중단 배포는 아닙니다. 재시작 시 수 초의 단절은 발생합니다. "빌드 깨짐으로 인한 장시간 장애"를 막는 장치로 이해하세요.

---

## 6. 데이터·시크릿은 배포 대상이 아님

git으로 넘어가지 않으며, 넘겨서도 안 되는 것들입니다.

| 대상 | 위치 | 처리 |
|---|---|---|
| Komga API 키 등 | `app/.env.local` | 3.2절 방식으로 별도 전달, `chmod 600` |
| 만화 파일 | `library/` | 별도 동기화 (rsync 등). 저장소에서 제외됨 |
| Komga 설정·DB | `komga/config/` | 운영 서버에서 자체 관리. 개발 것을 덮어쓰지 마세요 |
| 빌드 산출물 | `app/.next/` | 운영 서버에서 생성 |
| 의존성 | `app/node_modules/` | `npm ci`로 생성 |

---

## 7. 롤백

```bash
cd /home/ubuntu/panelshift
git log --oneline -10                       # 되돌릴 리비전 확인
git checkout <직전-리비전>
cd app && npm ci && npm run build
systemctl --user restart panelshift
```

빌드 산출물을 미리 백업해 두면 더 빠르게 되돌릴 수 있습니다.

```bash
# 배포 전
cp -a app/.next app/.next.bak
# 롤백 시
rm -rf app/.next && mv app/.next.bak app/.next
systemctl --user restart panelshift
```

---

## 8. 배포 후 검증 체크리스트

최초 배포와 주요 변경 후에는 전부 확인하세요. 운영 서버(`testserver`)에서 실행합니다.

```bash
HOST=100.114.4.40

# 1. 서비스 상태
systemctl --user is-active panelshift            # → active

# 2. 포트 바인딩 (의도한 주소인지)
ss -tlnp | grep 3001                             # → 100.114.4.40:3001

# 3. Komga 연결 + 모드 + 실제 콘텐츠 확인  ★ 가장 중요
curl -s http://$HOST:3001/api/komga/health
# 기대값: {"ok":true,"mode":"komga","status":200,"libraries":1,"series":218}
# - mode가 "mock"      → 3장 함정. .env.local 배치 후 재빌드 (또는 3.1.1 응급 복구)
# - series가 0         → ok:false 로 내려옵니다. 빈 Komga를 보고 있다는 뜻
# 헬스체크는 인증 통과뿐 아니라 실제 시리즈가 보이는지까지 확인하므로
# 배포 게이트로 그대로 쓸 수 있습니다.

# 3-1. 삭제 보호가 살아있는지 (파일을 지우지 않는 안전한 확인)
curl -s -o /dev/null -w "토큰 없이 삭제 -> %{http_code} (403 또는 503 이어야 정상)\n" \
  -X DELETE "http://$HOST:3001/api/komga/series/NONEXISTENT"

# 4. 페이지 렌더링
curl -s -o /dev/null -w "%{http_code}\n" http://$HOST:3001/     # → 200

# 4-1. 기존 Komga가 손상되지 않았는지 (라이브러리가 그대로 보이는지)
curl -s -H "X-API-Key: $(grep ^KOMGA_API_KEY /home/ubuntu/panelshift/app/.env.local | cut -d= -f2)" \
  "http://localhost:25600/api/v1/series?size=1" | head -c 200

# 5. 자동 재시작 동작
kill -9 $(systemctl --user show panelshift -p MainPID --value)
sleep 8 && systemctl --user is-active panelshift  # → active (PID가 바뀜)

# 6. 재부팅 내구성
loginctl show-user $USER --property=Linger        # → Linger=yes
```

3번의 `mode` 값을 반드시 눈으로 확인하세요. 이 값이 mock이면 서비스는 정상으로 보이지만 실제 라이브러리가 아닌 더미 데이터를 보여주고 있는 상태입니다.

---

## 9. 트러블슈팅

| 증상 | 원인 | 조치 |
|---|---|---|
| 서비스는 도는데 만화가 안 보이고 더미 데이터만 나옴 | 빌드 시점에 `.env.local`이 없어 mock이 구워짐 | `.env.local` 배치 후 **재빌드**. 재시작만으로는 안 고쳐집니다 (3장) |
| `status=203/EXEC` 로 기동 실패 | systemd가 nvm의 node를 못 찾음 | `ExecStart`에 node 절대 경로 사용 (4.7절) |
| 부팅 후에만 죽어 있음 | Tailscale IP 바인딩인데 IP 할당 전에 기동 | `ExecStartPre` 대기 로직 추가 (4.7절) |
| 로그아웃하면 내려감 | linger 미설정 | `sudo loginctl enable-linger $USER` |
| 폰에서 접속 불가 | `127.0.0.1` 바인딩 | `--hostname`을 Tailscale IP 또는 `0.0.0.0`으로 변경 후 재시작 |
| `/api/komga/health`가 `ok:false` | Komga 미도달 또는 키 무효 | 아래 진단 명령 참조 |
| 코드를 고쳤는데 반영 안 됨 | 재빌드 누락 | `npm run build` 후 재시작. 유닛은 빌드를 하지 않습니다 |

### 9.1 삭제 보호 (`ADMIN_TOKEN`)

시리즈 삭제는 Komga 디스크에서 파일을 지우며 되돌릴 수 없습니다. 그래서 이 경로만 토큰으로 막혀 있습니다. 읽기 경로는 영향받지 않습니다.

| 상황 | 응답 |
|---|---|
| `ADMIN_TOKEN` 미설정 | `503` — 삭제 기능 자체가 비활성 (fail-closed) |
| 헤더 없음 / 토큰 불일치 | `403` |
| 토큰 일치 | 정상 삭제 |

토큰 발급·적용:

```bash
openssl rand -hex 24                                   # 토큰 생성
echo "ADMIN_TOKEN=<생성된-값>" >> ~/panelshift/app/.env.local
systemctl --user restart panelshift                    # 런타임 변수이므로 재시작만
```

UI에서는 삭제 확인창에 토큰 입력란이 나옵니다. 서버가 수락한 토큰만 `sessionStorage`에 기억되므로 탭을 닫으면 지워지고, `403`을 받으면 저장된 값이 폐기됩니다.

**삭제 기능을 아예 막고 싶다면** `ADMIN_TOKEN`을 비워두면 됩니다. 그것만으로 모든 삭제 요청이 503으로 거부됩니다.

> 검증 시 주의: Komga는 **존재하지 않는 시리즈 ID에 대한 삭제도 `202 Accepted`로 응답**합니다(비동기 작업으로 접수). 따라서 앱이 `200`을 돌려줬다고 해서 실제로 뭔가 지워졌다는 뜻은 아닙니다. 토큰 통과 여부만 확인하려면 위 8장 3-1처럼 **토큰 없이 403/503이 나오는지**를 보세요. 실제 삭제 여부는 `series` 개수 변화로 확인해야 합니다.

Komga 연결 진단:

```bash
KEY="$(grep ^KOMGA_API_KEY /home/ubuntu/panelshift/app/.env.local | cut -d= -f2)"

# 도달성 + 키 유효성 (401이면 키 문제, 연결 자체가 안 되면 Komga가 안 떠 있음)
curl -s -H "X-API-Key: $KEY" http://localhost:25600/api/v2/users/me

# 카탈로그 조회
curl -s -o /dev/null -w "%{http_code}\n" -H "X-API-Key: $KEY" \
  "http://localhost:25600/api/v1/series?size=1"
```

> `/api/v1/users/me`는 이 Komga 버전(1.24.4)에 없습니다. 404가 나오면 키가 틀린 게 아니라 엔드포인트가 틀린 것입니다. 계정 확인은 `/api/v2/users/me`를 쓰세요.

로그 확인:

```bash
journalctl --user -u panelshift -n 100 --no-pager
journalctl --user -u panelshift -f              # 실시간
```

---

## 10. Android 래퍼 재배포

Android 앱은 화면만 감싸는 껍데기이고 실제 로직은 운영 서버가 처리합니다. 따라서 **서버 코드만 바뀌었다면 APK를 다시 만들 필요가 없습니다.**

APK 재빌드가 필요한 경우는 접속 대상 서버가 바뀔 때입니다.

이번 이전에서는 접속 대상이 `100.92.142.40`(개발) → `100.114.4.40`(운영)으로 **바뀌므로 재빌드가 필요합니다.**

```bash
cd /home/ubuntu/panelshift/app
CAPACITOR_SERVER_URL=http://100.114.4.40:3001 npm run mobile:sync
npm run mobile:build:android
```

`CAPACITOR_SERVER_URL`이 `http://`로 시작하면 평문 HTTP가 자동 허용됩니다(LAN 테스트용). 외부에서 접속하는 운영 환경이라면 HTTPS를 쓰세요.

---

## 11. 개선 여지 (미적용)

지금 구조에서 아쉬운 점을 남겨둡니다.

### 해결됨

- ✅ **파일 삭제 엔드포인트 무방비** → `ADMIN_TOKEN` 게이트 추가, 미설정 시 fail-closed (9.1절)
- ✅ **mock 빌드 함정** → `CATALOG_MODE` 런타임 변수 도입. 잘못 구워진 빌드도 재빌드 없이 복구 (3.1.1절)
- ✅ **헬스체크가 얕음** → 라이브러리·시리즈 개수까지 확인하고, 시리즈가 0이면 `ok:false` 반환

### 남은 것

- ✅ **Komga `0.0.0.0` 노출** → 루프백 + tailscale IP 두 주소로 축소, LAN 차단 확인 (4.5.1절)
- ✅ **개발/운영 중복 구동** → 개발 서버(`alienware-1`) 유닛 `disable --now` 처리. 되살리려면 `systemctl --user enable --now panelshift`

### 남은 것

운영자가 **한 명이고 tailnet 안에서만** 쓰는 현재 전제에서는 아래 항목들이 실질적 위험은 아닙니다. 전제가 바뀔 때 다시 보세요.

- **앱 자체 인증 없음.** 삭제는 막혔지만 카탈로그 열람과 이미지 조회는 tailnet 경계에만 의존합니다. tailnet은 기기 단위로 인증된 사설망이므로 1인 사용에는 충분합니다. **인터넷에 노출하거나 남과 공유하게 되면** `src/proxy.ts`(Next 16에서 middleware의 새 이름) 기반 게이트나 인증 리버스 프록시가 필요합니다.
- **`ADMIN_TOKEN`이 공유 비밀.** 사용자별 신원 구분이 없고, 회수하려면 값을 바꿔 재시작해야 합니다. 관리자 1인 구조에는 적정하지만, 여러 명이 쓰게 되면 계정 체계가 필요합니다.
- **스테이징 없음.** 개발 서버가 곧 테스트 환경입니다. 5.2절의 `NEXT_DIST_DIR` 검증 빌드가 임시 대안입니다.
- **삭제가 실제로 동작하는지 미확인.** Komga의 `/data`는 `:ro`(읽기 전용)로 마운트되어 있습니다. 그래서 시리즈 삭제가 파일까지 지우지 못하고 실패할 가능성이 있습니다. Komga가 비동기 `202`로 응답하는 탓에 호출 결과만으로는 알 수 없고, 확인하려면 실제로 한 건 지워봐야 하므로 검증하지 않았습니다.

### 이전 후 정리할 것

운영 배포가 끝나면 개발 서버(`alienware-1`)에 남는 잔재가 있습니다.

- **개발 서버의 미사용 Komga 컨테이너.** `alienware-1`에 `panelshift-komga`가 `127.0.0.1:25600`으로 2일 넘게 떠 있지만, `.env.local`이 `100.114.4.40`을 가리키고 있어 **아무도 쓰지 않습니다.** 혼동과 자원 낭비이므로 정리 대상입니다. 단, 로컬 목업 테스트용으로 남겨둘 생각이면 그대로 두어도 무방합니다.
- **개발 서버의 systemd 유닛.** 운영이 뜬 뒤에도 개발 서버 유닛을 계속 돌릴지 결정하세요. 둘 다 살아 있으면 폰에서 어느 쪽에 접속 중인지 헷갈릴 수 있습니다. 중지하려면 `systemctl --user disable --now panelshift`.
- **Komga의 tailnet 노출 축소.** 개발 서버가 `100.114.4.40:25600`을 직접 참조하는 것을 끊은 뒤라야 4.5절의 loopback 바인딩 축소를 안전하게 적용할 수 있습니다.
