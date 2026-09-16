/** Shared cookie-parsing for API route handlers — every route that needs the session token
 * repeats this one-liner; centralizing it avoids the regex drifting between copies. */
export function getSessionToken(req: Request): string | undefined {
  const cookie = req.headers.get("cookie") ?? "";
  return cookie.match(/lifeos_session=([^;]+)/)?.[1];
}
