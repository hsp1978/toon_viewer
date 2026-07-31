# Panelshift 배포 매뉴얼 (개발 서버 → 운영 서버)

개발 서버에서 만든 변경을 운영 서버로 전달하는 절차를 정리한 문서입니다.

## 0. 검증 범위 (먼저 읽어주세요)

이 문서의 내용은 검증 수준이 다릅니다. 혼동하지 않도록 구분해 둡니다.

**이 문서의 절차는 2026-07-31 `testserver`에 실제로 적용되어 검증되었습니다.** 배포된 리비전은 `f221ad6` (`feat/desktop-web-ui-polish`)입니다.

| 구분 | 내용 |
|---|---|
| ✅ 운영 서버에서 실제 검증됨 | clone → `npm ci` → build → systemd 등록 → 8장 체크리스트 전항목 통과. 실제 라이브러리 렌더링, 썸네일·페이지 이미지 프록시, 자동 재시작 |
| ✅ 개발 서버에서 검증됨 | `NEXT_PUBLIC_` 빌드 시점 고정 동작 (3장) |
| ⚠️ 미완료 | **linger 미설정** (sudo 비밀번호 필요). 현재 상태로는 재부팅 후 자동 기동되지 않습니다 — 4.6절 참조 |

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
- **Komga를 tailnet에 노출할 필요가 없어집니다.** Komga 바인딩을 `127.0.0.1:25600`으로 좁혀도 앱은 정상 동작합니다 (4.5절).

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
| Komga 바인딩 | `0.0.0.0:25600` | tailnet·LAN에 노출된 상태 (4.5절) |
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
| `NEXT_PUBLIC_CATALOG_MODE` | **빌드** | 바꾸려면 재빌드 필수 |
| `NEXT_PUBLIC_API_BASE_URL` | **빌드** | 미설정 시 상대 경로 `/api/...` 사용 |
| `KOMGA_BASE_URL` | 런타임 | 재시작만으로 반영 |
| `KOMGA_API_KEY` | 런타임 | 재시작만으로 반영 |
| `KOMGA_USERNAME` / `KOMGA_PASSWORD` | 런타임 | API 키 대신 Basic 인증 사용 시 |
| `KOMGA_FORCE_MOCK` | 런타임 | 런타임 mock 스위치 |
| `KOMGA_MAX_LIST_PAGES` | 런타임 | 카탈로그 조회 페이지 수 |
| `KOMGA_BOOTSTRAP_BOOK_LIMIT` | 런타임 | 페이지 크기 선반영 대상 수 |

**규칙: 빌드 전에 `.env.local`을 먼저 배치하세요.** 순서를 지키는 것만으로 이 함정 전체를 피할 수 있습니다.

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

**선택 사항 — Komga 노출 축소.** 앱이 같은 호스트에서 `localhost`로 부르게 되면, Komga를 더 이상 tailnet에 열어둘 이유가 없습니다. 기존 Komga의 포트 매핑을 `127.0.0.1:25600:25600`으로 좁히면 공격 표면이 줄어듭니다. 단, 개발 서버가 여전히 `100.114.4.40:25600`을 직접 참조하고 있으므로 **개발 환경을 먼저 정리한 뒤에** 적용하세요 (11장 참조).

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

`scripts/deploy.sh` 로 저장해 두면 편합니다. 실패 시 재시작하지 않고 멈춥니다.

```bash
#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="/home/ubuntu/panelshift"
APP_DIR="$APP_ROOT/app"
BRANCH="${1:-main}"
HEALTH_HOST="100.114.4.40"        # 유닛의 --hostname 과 반드시 일치

cd "$APP_DIR"

# 시크릿 누락 시 mock 모드가 구워지는 것을 방지 (3장 참조)
if [[ ! -f .env.local ]]; then
  echo "중단: $APP_DIR/.env.local 이 없습니다. 빌드하면 mock 모드가 고정됩니다." >&2
  exit 1
fi

PREV_REV="$(git -C "$APP_ROOT" rev-parse HEAD)"
echo "현재 리비전: $PREV_REV"

git -C "$APP_ROOT" fetch origin "$BRANCH"
git -C "$APP_ROOT" merge --ff-only "origin/$BRANCH"

npm ci

# 빌드 실패 시 여기서 종료되므로 기존 서비스는 계속 동작합니다
npm run build

systemctl --user restart panelshift

# 기동 확인
sleep 5
for i in $(seq 1 12); do
  if curl -fsS "http://$HEALTH_HOST:3001/api/komga/health" >/dev/null 2>&1; then
    HEALTH="$(curl -sS "http://$HEALTH_HOST:3001/api/komga/health")"
    echo "$HEALTH"
    # mode 가 mock 이면 3장 함정에 빠진 것이므로 성공으로 취급하지 않습니다
    if [[ "$HEALTH" != *'"mode":"komga"'* ]]; then
      echo "중단: mock 모드로 빌드되었습니다. .env.local 확인 후 재빌드하세요." >&2
      exit 1
    fi
    echo "배포 성공"
    exit 0
  fi
  sleep 3
done

echo "헬스체크 실패. 롤백 방법은 7장 참조. 직전 리비전: $PREV_REV" >&2
journalctl --user -u panelshift -n 40 --no-pager >&2
exit 1
```

> 헬스체크 URL의 호스트는 유닛의 `--hostname` 설정과 일치시켜야 합니다. Tailscale IP에 바인딩했다면 `127.0.0.1`로는 **응답하지 않습니다** (개발 서버에서 확인함). 그래서 `HEALTH_HOST`를 상단에서 한 번만 정의하도록 했습니다.
>
> 스크립트는 HTTP 200뿐 아니라 `"mode":"komga"` 까지 확인합니다. 3장의 mock 함정은 HTTP 200을 정상 반환하기 때문에, 상태 코드만으로는 절대 잡히지 않습니다.

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

# 3. Komga 연결 + 모드 확인  ★ 가장 중요
curl -s http://$HOST:3001/api/komga/health
# 기대값: {"ok":true,"mode":"komga","status":200}
# mode가 "mock"이면 3장 함정에 빠진 것입니다 → .env.local 배치 후 재빌드

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

- 🔴 **인증 없는 파일 삭제 엔드포인트.** `DELETE /api/komga/series/[seriesId]` 는 Komga의 `/api/v1/series/{id}/file` 을 호출합니다. 이는 **디스크에서 만화 파일을 실제로 삭제**하며 되돌릴 수 없습니다. 앱에 인증이 없으므로, 앱에 도달할 수 있는 누구든 `curl -X DELETE` 한 줄로 시리즈를 영구 삭제할 수 있습니다. 현재는 tailnet 바인딩이 유일한 방어선입니다. 최소한 확인 토큰이나 관리자 인증을 붙이거나, 파일 삭제 대신 Komga에서 숨김 처리하는 방식을 검토하세요.
- **앱 자체 인증 없음.** 현재는 네트워크 경계(Tailscale/리버스 프록시)에만 의존합니다. 인터넷 노출 시 필수 과제입니다.
- **Komga가 `0.0.0.0:25600`에 열려 있음.** 앱이 `localhost`로 부르게 된 지금은 tailnet 노출이 불필요합니다. 4.5절 방식으로 좁히는 것을 권장합니다 (개발 서버 참조를 끊은 뒤).
- **`.env`와 `.env.local`의 모순.** 저장소의 `.env`가 `mock`, `.env.local`이 `komga`인 구조는 3장 사고를 유발합니다. `.env`에서 `NEXT_PUBLIC_CATALOG_MODE` 줄을 제거하고 mock 실행 시에만 명시적으로 지정하는 편이 안전합니다.
- **헬스체크가 얕음.** `/api/komga/health`는 연결만 봅니다. 배포 검증을 자동화하려면 실제 시리즈 1건 조회까지 확인하는 편이 낫습니다.
- **스테이징 없음.** 개발 서버가 곧 테스트 환경입니다. 5.2절의 `NEXT_DIST_DIR` 검증 빌드가 임시 대안입니다.

### 이전 후 정리할 것

운영 배포가 끝나면 개발 서버(`alienware-1`)에 남는 잔재가 있습니다.

- **개발 서버의 미사용 Komga 컨테이너.** `alienware-1`에 `panelshift-komga`가 `127.0.0.1:25600`으로 2일 넘게 떠 있지만, `.env.local`이 `100.114.4.40`을 가리키고 있어 **아무도 쓰지 않습니다.** 혼동과 자원 낭비이므로 정리 대상입니다. 단, 로컬 목업 테스트용으로 남겨둘 생각이면 그대로 두어도 무방합니다.
- **개발 서버의 systemd 유닛.** 운영이 뜬 뒤에도 개발 서버 유닛을 계속 돌릴지 결정하세요. 둘 다 살아 있으면 폰에서 어느 쪽에 접속 중인지 헷갈릴 수 있습니다. 중지하려면 `systemctl --user disable --now panelshift`.
- **Komga의 tailnet 노출 축소.** 개발 서버가 `100.114.4.40:25600`을 직접 참조하는 것을 끊은 뒤라야 4.5절의 loopback 바인딩 축소를 안전하게 적용할 수 있습니다.
