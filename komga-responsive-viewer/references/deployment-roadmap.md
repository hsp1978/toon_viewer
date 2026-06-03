# Deployment and Roadmap

Use this reference for self-hosting, auth, mobile packaging, and phase planning. The underlying research was captured on 2026-05-29; verify platform policies, package versions, and Komga release behavior before implementation.

## Self-Hosting

Recommended deployment:

- Run Komga with Docker Compose using the official `gotson/komga` image.
- Mount separate config and data volumes.
- Mount comic libraries from NAS storage with stable UID/GID permissions.
- Limit JVM memory for small servers, for example with `JAVA_TOOL_OPTIONS=-Xmx512m`, then tune from observed load.
- Expose remotely through Cloudflare Tunnel rather than opening inbound ports.

For Synology, use Container Manager or Compose with explicit user IDs so Komga can read library files and write config/cache data.

## Auth

For one-person use, Komga's local auth, API key, or session auth can be enough.

For LDAP-backed SSO, put Authelia or Authentik in front of OpenLDAP and connect Komga through OIDC. Komga may require matching local accounts or account creation settings depending on configuration, so verify login behavior in the target version.

## Mobile Packaging

Start with PWA because it keeps a single Next.js codebase and fits self-hosting. Be careful with iOS storage and background limits when offline downloads become important.

Move to Capacitor when native packaging, larger offline storage, or platform distribution becomes necessary. Use React Native only if web and WebView performance cannot meet reader requirements and the project can absorb a second runtime.

Distribution defaults:

- iOS personal use: PWA home-screen install first, then free sideloading or TestFlight if needed.
- Android personal use: PWA or direct APK distribution.
- Public or family sharing: evaluate paid Apple Developer membership and store policies.

## Roadmap

Phase 0:

- Deploy Komga with Docker Compose.
- Explore `/swagger-ui.html` and confirm auth.
- Scaffold Next.js library, series, and book browsing.
- Implement automatic webtoon-vs-paged detection.
- Build a usable reader with vertical webtoon mode and paged mode.

Phase 1:

- Add pinch, double-tap, swipe, and keyboard input.
- Add spread mode with landscape-page exceptions.
- Add read-progress sync against Komga.
- Add WebP/AVIF and lazy/prefetch image handling.
- Add PWA manifest and offline cache strategy.

Phase 2:

- Wrap with Capacitor if native distribution or stronger offline storage is needed.
- Add large offline downloads.
- Tune oversized webtoon image segmentation.
- Add OIDC if more users are onboarded.
- Reassess FastAPI migration only if backend requirements are now concrete.

## Decision Thresholds

Move from PWA to Capacitor if offline cache limits or install/distribution needs become a real user problem.

Start FastAPI migration planning if at least three backend-only requirements cannot be handled through Komga API, metadata, or client-side state.

Consider React Native only if reader jank persists after image splitting, virtualization, and WebView tuning.
