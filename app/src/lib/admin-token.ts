const STORAGE_KEY = "panelshift:adminToken";

/**
 * Holds the admin token for the current tab only.
 *
 * sessionStorage rather than localStorage: the token authorises irreversible
 * deletes, so it should not outlive the browsing session on a shared or
 * borrowed device.
 */
export function loadAdminToken(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveAdminToken(token: string) {
  if (typeof window === "undefined") return;
  try {
    if (token) {
      window.sessionStorage.setItem(STORAGE_KEY, token);
    } else {
      window.sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Ignore write failures (private mode, quota, etc.)
  }
}
