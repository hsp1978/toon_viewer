# Panelshift

Responsive Komga-backed comic and webtoon reader prototype.

## Run in mock mode

```bash
npm install
npm run dev -- --hostname 0.0.0.0 --port 3001
```

Open `http://localhost:3001`.

## Connect to Komga

Copy `.env.example` to `.env.local`, then remove or change `NEXT_PUBLIC_CATALOG_MODE=mock`.

```bash
KOMGA_BASE_URL=http://localhost:25600
KOMGA_API_KEY=your-api-key
# or use KOMGA_USERNAME / KOMGA_PASSWORD for Basic Auth
```

The app reads Komga from the Next.js server process, so secrets are not exposed to the browser. Page images, read progress, series books, and thumbnails are proxied through `/api/komga/...` routes.

Useful knobs:

- `KOMGA_MAX_LIST_PAGES`: how many paged catalog API responses to fetch for the library/series overview.
- `KOMGA_BOOTSTRAP_BOOK_LIMIT`: how many books get page dimensions loaded when a series book list is fetched.
- `KOMGA_FORCE_MOCK=true`: force mock data even when `KOMGA_BASE_URL` is set.

## Local Komga compose

From the repository root:

```bash
docker-compose up -d komga
```

The compose file mounts:

- `./komga/config` to `/config`
- `./library` to `/data`

The Komga image is pinned to `gotson/komga:1.24.4`, matching the active OpenAPI version seen during this setup. By default the compose port binds to `127.0.0.1`; set `KOMGA_BIND_ADDRESS=0.0.0.0` only when a firewall, VPN, or reverse proxy already protects the service.

## Production notes

Build and run the Next app explicitly:

```bash
npm run build
npm run start:local
```

Use `npm run start:lan` only for a trusted LAN/Tailscale deployment. For internet access, put the app behind an authenticated reverse proxy or tunnel instead of opening inbound ports directly.
