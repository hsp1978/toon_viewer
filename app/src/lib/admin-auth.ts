import { timingSafeEqual } from "node:crypto";

export const ADMIN_TOKEN_HEADER = "x-admin-token";

type AuthFailure = { ok: false; status: number; error: string };
type AuthSuccess = { ok: true };

function safeEquals(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // timingSafeEqual throws on length mismatch, so compare lengths separately.
  // The length of the configured token is not secret.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Guards destructive routes with a shared token from `ADMIN_TOKEN`.
 *
 * Fails closed: with no token configured the route is refused outright rather
 * than left open, because the operation behind it deletes files from disk and
 * the app has no other authentication in front of it.
 */
export function authorizeAdmin(request: Request): AuthSuccess | AuthFailure {
  const expected = process.env.ADMIN_TOKEN?.trim();

  if (!expected) {
    return {
      ok: false,
      status: 503,
      error: "ADMIN_TOKEN is not configured on the server, so destructive actions are disabled.",
    };
  }

  const provided = request.headers.get(ADMIN_TOKEN_HEADER)?.trim();
  if (!provided || !safeEquals(provided, expected)) {
    return { ok: false, status: 403, error: "Invalid or missing admin token." };
  }

  return { ok: true };
}
