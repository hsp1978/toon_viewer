---
name: komga-responsive-viewer
description: Build or modify self-hosted Komga-backed webtoon and comic viewer apps. Use when planning or implementing a Next.js, PWA, or Capacitor client for Komga, automatic webtoon-vs-paged detection, responsive single-page and spread layouts, reader gestures and zoom, reading-progress sync, image optimization, Docker or Cloudflare Tunnel deployment, or evaluating when to keep Komga versus move to FastAPI.
---

# Komga Responsive Viewer

## Core Direction

Use this skill to keep work aligned with the research in `../docs/compass_artifact_wf-ac7b1133-2017-4d73-a901-8ee6bdbe99af_text_markdown.md`.

Default to Komga as a headless media backend plus a custom responsive frontend. Treat backend replacement as a later migration, not the MVP. The reader UX is the differentiator: automatic webtoon detection, mobile gestures, adaptive single/spread layouts, image performance, and reading-progress sync.

Do:

- Use Komga REST API first; use OPDS v2 for external-reader compatibility or progression features when useful.
- Bias implementation toward Next.js and PWA first, then Capacitor if native packaging is needed.
- Correct stale assumptions: Komga web UI is Vue 2, Vuetify, and TypeScript; Angular belongs to Kavita.
- Keep documentation and implementation artifacts phase-based so each phase ends with a working reader.

Avoid:

- Reimplementing scanning, metadata, OPDS, search, users, thumbnails, duplicate detection, or library management in the MVP.
- Forking Komga unless API-only integration cannot cover a required backend behavior.
- Starting with a marketing site instead of a usable library browser and reader.

## Workflow

1. Identify the phase.

Phase 0 covers Komga deployment, API exploration, library/series/book browsing, and automatic reader mode. Phase 1 covers gestures, spread handling, image optimization, read-progress sync, and PWA/offline behavior. Phase 2 covers Capacitor packaging, large offline downloads, performance tuning, and optional backend migration.

2. Choose the architecture.

Default to Komga backend plus a custom Next.js frontend. Consider FastAPI only after backend-only requirements accumulate, such as server-side persisted detection flags or custom metadata fields. Consider a Komga fork only when keeping Komga internals matters more than the Kotlin/Spring maintenance cost.

3. Build the viewer behavior.

Prefer explicit metadata and tags first, then image aspect-ratio heuristics. Use continuous vertical scrolling for long-strip webtoons. Use a paged reader for normal comics, with single/spread switching based on viewport and orientation. Keep landscape pages, first pages, and last pages single-width in spread mode.

4. Integrate Komga APIs.

Read the local Komga OpenAPI or `/swagger-ui.html` before coding endpoint assumptions. Support Basic Auth, `X-API-Key`, or session auth depending on deployment. Treat Komga read-progress as the single source of truth across web and mobile.

5. Validate on real devices.

Test desktop, tablet landscape, and mobile portrait. Check webtoon-vs-comic auto mode on real library samples. Check pinch, double-tap, swipe, and keyboard behavior. Check memory use and scroll jank with oversized webtoon images.

## References

- Read `references/architecture.md` for backend, API, storage, and mobile strategy.
- Read `references/viewer-ux.md` for automatic mode detection, layout, gestures, and image optimization.
- Read `references/deployment-roadmap.md` for self-hosting, OIDC, mobile distribution, and phase planning.
- Read the source research in `../docs/` when exact evidence, dates, or caveats are needed.
