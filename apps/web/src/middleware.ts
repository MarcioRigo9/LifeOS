import { NextResponse, type NextRequest } from "next/server";

// Edge-safe check: only confirms a session cookie is PRESENT, never validates it against the
// database (middleware has no Postgres access here) — real authorization still happens per
// request via requireHouseholdContext (SECURITY_MODEL.md §3). This only avoids flashing
// authenticated pages at a logged-out visitor before the client-side redirect would kick in.
const PUBLIC_PATHS = ["/login", "/register"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasSession = req.cookies.has("lifeos_session");
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p);

  if (!hasSession && !isPublic && !pathname.startsWith("/api")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  if (hasSession && isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest).*)"],
};
