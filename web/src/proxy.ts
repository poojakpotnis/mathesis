import { auth } from "@/auth";
import { NextResponse } from "next/server";

// Public routes that must work without any auth at all:
// - /sign-in: the page that lets the user start the Google flow.
// - /about: portfolio-facing project description; no app data exposed.
// - /screenshots: static marketing imagery referenced by /about.
// - /api/auth/*: Auth.js endpoints (sign-in callback, sign-out, session).
const PUBLIC_PREFIXES = ["/sign-in", "/about", "/screenshots", "/api/auth"];

function isPublic(pathname: string): boolean {
  for (const p of PUBLIC_PREFIXES) {
    if (pathname === p || pathname.startsWith(p + "/")) return true;
  }
  return false;
}

export default auth((req) => {
  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return;

  // Programmatic calls (Python scraper, eval harness) carry a Bearer
  // header. Let them through so the route handler can do its
  // MATHESIS_API_KEY check. No session required for these.
  if (req.headers.get("authorization")?.startsWith("Bearer ")) return;

  if (req.auth) return;

  const signInUrl = new URL("/sign-in", req.nextUrl.origin);
  signInUrl.searchParams.set("callbackUrl", pathname);
  return NextResponse.redirect(signInUrl);
});

export const config = {
  // Skip static assets and Next internals; everything else goes through
  // the gate and is filtered by isPublic / Bearer presence above.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
