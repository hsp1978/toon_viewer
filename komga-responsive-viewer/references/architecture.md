# Architecture Notes

These notes summarize the research source in `../../docs/compass_artifact_wf-ac7b1133-2017-4d73-a901-8ee6bdbe99af_text_markdown.md`. Use the source document when exact citations or full context are needed.

## Default Architecture

Use Komga as the media server and build a custom responsive frontend on top of it. The main product value is reader UX, not backend parity. Komga already provides the expensive backend features: scanning, metadata aggregation, thumbnails, search, OPDS, users, progress, and duplicate detection.

Recommended stack:

- Backend: Komga container, treated as a headless API service.
- Frontend: Next.js 15 or the current project-standard Next.js version.
- Mobile first step: PWA.
- Native wrapper if needed: Capacitor around the same web code.
- Backend migration only if API integration becomes a blocker.

## Komga Facts

Komga is MIT licensed. Its repository is organized around a Kotlin/Spring Boot backend, a Vue 2/Vuetify/TypeScript web UI served by the backend, and a tray wrapper. Do not describe Komga as Angular; Angular is Kavita's frontend stack.

Storage and indexing:

- Main metadata DB: SQLite `database.sqlite`.
- Background task queue DB: separate SQLite tasks DB.
- Full-text search: Apache Lucene.
- Metadata inputs: ComicInfo.xml, EPUB OPF, and manual edits.

Major capabilities:

- Multiple filesystem libraries with scanning and per-library settings.
- Series, books, collections, read lists, read progress, and user access control.
- OPDS v1.2 and v2.0, Kobo Sync, KOReader Sync, REST API, and file downloads.
- Thumbnail generation, sidecar covers, uploaded covers, and duplicate detection.
- Multi-user auth plus OAuth2/OIDC support.

Supported formats from the research:

- Books: CBZ, CBR with RAR limitations, EPUB 2/3, and PDF.
- Images: JPG, PNG, WebP, GIF, and AVIF.
- CBR/RAR can be converted to CBZ in the background.

## API Integration

Use REST first for the custom frontend. Komga exposes versioned API paths under `/api/v1/` and a Swagger UI/OpenAPI surface. Verify the active server version before implementing endpoint details.

Expected auth options:

- Basic Auth.
- `X-API-Key` header.
- Session auth with `KOMGA-SESSION` cookie or `X-Auth-Token` header.

Important API areas:

- Libraries: list and navigate libraries.
- Series and books: browse catalog and open readers.
- Metadata: inspect or patch book/series metadata where supported.
- Collections and read lists: expose curated reading.
- Read progress: sync web and mobile progress through Komga.

Use OPDS when integrating external readers or when OPDS v2 progression behavior is specifically useful. REST remains better for a first-party custom web client because it is richer and easier to shape into app state.

## Architecture Decision Rules

Choose Komga plus custom frontend when the task is about browsing, reading, responsive layout, gestures, progress sync, PWA behavior, or self-hosted deployment.

Consider FastAPI plus PostgreSQL only when several backend-only requirements are confirmed, such as:

- Persisting custom automatic webtoon detection flags server-side.
- Adding custom metadata fields not representable through Komga.
- Preserving a folder model Komga cannot scan correctly.
- Replacing Komga auth or progress semantics.

Consider a Komga fork only when direct internal changes are required and the project can absorb Kotlin/Spring maintenance.
