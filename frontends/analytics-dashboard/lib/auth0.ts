/**
 * Auth0 SDK configuration for Next.js App Router.
 *
 * Uses @auth0/nextjs-auth0 v4 which provides:
 * - Server-side session management (encrypted cookie)
 * - Automatic PKCE flow via /auth/* routes
 * - Middleware for route protection
 * - React hooks for client components (useUser)
 *
 * v4 env-var mapping:
 *   AUTH0_DOMAIN            — Auth0 tenant domain (e.g. your-tenant.auth0.com)
 *   AUTH0_CLIENT_ID         — Auth0 application client ID
 *   AUTH0_CLIENT_SECRET     — Auth0 application client secret
 *   AUTH0_SECRET            — Random 32+ byte hex string for cookie encryption
 *   APP_BASE_URL            — App base URL (e.g. http://localhost:3003)
 *
 * We derive AUTH0_DOMAIN from the legacy AUTH0_ISSUER_BASE_URL if
 * AUTH0_DOMAIN is not set, so existing .env files keep working.
 */
import { Auth0Client } from "@auth0/nextjs-auth0/server";

/**
 * Extract bare domain from an issuer URL.
 * "https://my-tenant.auth0.com" → "my-tenant.auth0.com"
 * "https://my-tenant.auth0.com/" → "my-tenant.auth0.com"
 */
function domainFromIssuer(issuerUrl: string | undefined): string | undefined {
  if (!issuerUrl) return undefined;
  try {
    return new URL(issuerUrl).hostname;
  } catch {
    // If it's already a bare domain, return as-is
    return issuerUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
  }
}

const domain =
  process.env.AUTH0_DOMAIN ||
  domainFromIssuer(process.env.AUTH0_ISSUER_BASE_URL);

export const auth0 = new Auth0Client({
  domain,
  clientId: process.env.AUTH0_CLIENT_ID,
  clientSecret: process.env.AUTH0_CLIENT_SECRET,
  secret: process.env.AUTH0_SECRET,
  appBaseUrl:
    process.env.APP_BASE_URL || process.env.AUTH0_BASE_URL,

  authorizationParameters: {
    scope: "openid profile email",
  },
});
