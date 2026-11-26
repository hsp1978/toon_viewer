const ORIGINAL_QUALITY_KEY = "panelshift:originalQuality";

/** Whether the reader should load untouched page files instead of the lighter re-encoded ones. */
export function loadOriginalQuality(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(ORIGINAL_QUALITY_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveOriginalQuality(enabled: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ORIGINAL_QUALITY_KEY, String(enabled));
  } catch {
    // Ignore write failures (private mode, quota, etc.)
  }
}
