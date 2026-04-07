/**
 * Next.js Middleware — Auth0 v4 route handling + protection.
 *
 * 1.  /auth/* requests are delegated to the Auth0 SDK which handles
 *     login, callback, logout, and profile routes automatically.
 * 2.  All other matched requests require an active session.
 *     Unauthenticated visitors are redirected to /auth/login.
 * 3.  Static assets, Next.js internals, and favicon are excluded
 *     via the matcher config so they never hit this middleware.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";

export async function middleware(request: NextRequest) {
  // Let the Auth0 SDK handle authentication routes
  // (/auth/login, /auth/callback, /auth/logout, /auth/profile)
  const authResponse = await auth0.middleware(request);

  // Auth routes are fully handled by the SDK — return immediately
  if (request.nextUrl.pathname.startsWith("/auth")) {
    return authResponse;
  }

  // Skip auth check for the health endpoint (used by Docker healthcheck)
  if (request.nextUrl.pathname === "/api/health") {
    return NextResponse.next();
  }

  // For all other routes, verify the user has an active session
  const session = await auth0.getSession(request);

  if (!session) {
    // Store the originally requested URL so we can redirect back after login
    const loginUrl = new URL("/auth/login", request.nextUrl.origin);
    loginUrl.searchParams.set("returnTo", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Authenticated — continue with the Auth0 response
  // (which may include updated session cookies)
  return authResponse;
}

export const config = {
  matcher: [
    // Match all routes EXCEPT:
    //   /_next/*          Next.js internals (static, image optimiser)
    //   /favicon.ico      Browser icon
    //   /icon.svg         PWA / tab icon
    //   /*.ext            Common static file extensions
    "/((?!_next/static|_next/image|favicon\\.ico|icon\\.svg|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico)$).*)",
  ],
};
