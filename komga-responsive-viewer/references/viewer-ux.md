# Viewer UX Reference

Use this reference when implementing reader behavior, responsive layout, gestures, and image handling.

## Automatic Reader Mode

Infer reader mode in this order:

1. User override for the current book or series.
2. Komga or ComicInfo metadata such as `readingDirection` values `WEBTOON` or `VERTICAL`.
3. Tags or genres such as `webtoon`, `long strip`, or `manhwa`.
4. Image aspect-ratio heuristic from the first 3 to 5 readable pages.
5. Fallback to paged mode.

Suggested heuristic:

```ts
type PageSize = { width: number; height: number };

export function inferReaderMode(
  pages: PageSize[],
  tags: string[] = [],
  readingDirection?: string,
): "webtoon" | "paged" {
  const normalizedTags = tags.map((tag) => tag.toLowerCase());
  if (readingDirection === "WEBTOON" || readingDirection === "VERTICAL") {
    return "webtoon";
  }
  if (normalizedTags.some((tag) => ["webtoon", "long strip", "manhwa"].includes(tag))) {
    return "webtoon";
  }

  const ratios = pages
    .slice(0, 5)
    .filter((page) => page.width > 0 && page.height > 0)
    .map((page) => page.height / page.width)
    .sort((a, b) => a - b);

  if (ratios.length === 0) return "paged";
  const median = ratios[Math.floor(ratios.length / 2)];
  return median >= 2.2 ? "webtoon" : "paged";
}
```

Treat `2.0` to `2.5` as a tuning range, not a universal truth. Tune against the user's real library.

## Layout Rules

Webtoon mode:

- Render a continuous vertical strip.
- Avoid artificial chapter gaps unless the user chooses them.
- Preserve zoom and pan behavior; Komga's built-in webtoon mode is weak here.
- Preload upcoming visible content in a way that actually decodes and paints soon enough to help scrolling.

Paged mode:

- Mobile portrait defaults to a single page.
- Tablet and desktop landscape may default to a two-page spread.
- Landscape pages render as single pages even in spread mode.
- First and last pages render as single pages to preserve comic-book reading conventions.
- Support LTR and RTL page order.

## Gestures and Input

For web implementations, evaluate `react-zoom-pan-pinch`, `react-comic-viewer`, or a dedicated manga viewer library before hand-rolling gesture physics. If wrapping in Capacitor, keep the WebView scroll and gesture ownership clear so the reader does not fight native scrolling.

Expected controls:

- Pinch zoom.
- Double-tap zoom.
- Pan while zoomed.
- Swipe or tap-zone page navigation in paged mode.
- Scroll restoration and progress updates in webtoon mode.
- Keyboard navigation on desktop.

## Image Performance

Use lazy loading and adjacent-page prefetching, but verify with real rendering behavior. Hidden images that never decode will not fix scroll stutter.

For oversized webtoon images, consider server-side or build-time splitting into 2000 to 3000 px tall segments. Serve WebP or AVIF variants where practical. Prefer Sharp in Node or pyvips/libvips in Python for thumbnails and conversions.

Validation checks:

- Very tall strips do not exhaust memory on mobile Safari.
- Fast scrolling does not reveal blank pages for long.
- Reader controls do not cause layout shifts.
- Progress sync does not fire excessive writes while scrolling.
- Images remain crisp at common mobile and tablet widths.
