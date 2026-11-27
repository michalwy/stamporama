import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { appBaseUrl } from "./app-url";
import { oauthBaseUrl } from "./oauth-rules";
import { clientAddress, rateLimit } from "./rate-limit";

// What the OAuth routes share and the pure rules cannot hold (#2715): reading the instance's address
// off a request, the two headers every answer carries, and the rate limit.
//
// **These endpoints are reachable without a credential, which is `rate-limit.ts`'s own premise** —
// registration by anyone at all, the token and revocation endpoints by anyone holding a guess. A
// real client registers once and refreshes about once an hour, so the allowances below are far above
// anything it does and far below what a script would need.
//
// **None of them answers CORS headers.** claude.ai and every desktop client call them from a server
// or a native process; a page in a browser is the one caller that would need them, and none of these
// is meant to be driven by one. It also leaves ADR-0051's first deviation exactly where it was.

/** The instance's public base URL for this request (`oauth-rules.ts`, `oauthBaseUrl`). */
export function requestBaseUrl(request: NextRequest): string {
  return oauthBaseUrl(appBaseUrl(), request.url);
}

/** A token or a client id must never be served from a cache (RFC 6749 §5.1). */
const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" } as const;

export function oauthJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export function oauthError(error: string, description: string, status = 400): NextResponse {
  return oauthJson({ error, error_description: description }, status);
}

const WINDOW_MS = 10 * 60 * 1000;

/** How many calls one address may make per ten minutes, by endpoint. */
export const OAUTH_RATE_LIMITS = { register: 20, token: 300, revoke: 60 } as const;

/** `null` when the call may go ahead, the `429` to return when it may not. */
export function oauthRateLimited(
  request: NextRequest,
  endpoint: keyof typeof OAUTH_RATE_LIMITS
): NextResponse | null {
  const limited = rateLimit(
    `oauth-${endpoint}:${clientAddress(request.headers)}`,
    OAUTH_RATE_LIMITS[endpoint],
    WINDOW_MS
  );
  if (limited.ok) return null;
  return NextResponse.json(
    { error: "slow_down", error_description: "Too many requests. Try again later." },
    { status: 429, headers: { ...NO_STORE, "Retry-After": String(limited.retryAfter) } }
  );
}

/**
 * The fields of a token or revocation request. Form-encoded is what RFC 6749 specifies; a JSON
 * object is read too, because clients that send one exist and refusing them proves nothing.
 */
export async function readOAuthForm(request: NextRequest): Promise<URLSearchParams> {
  const text = await request.text();
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const params = new URLSearchParams();
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value === "string") params.set(key, value);
        }
      }
    } catch {
      // An unreadable body is an empty one: the caller reports the missing field.
    }
    return params;
  }
  return new URLSearchParams(text);
}

/**
 * The instance's public base URL as a page sees it: a server component is handed headers, not a
 * request. `BETTER_AUTH_URL` when set, the forwarded or direct host otherwise.
 */
export function headersBaseUrl(requestHeaders: Headers): string {
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost";
  const proto = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim() || "http";
  return oauthBaseUrl(appBaseUrl(), `${proto}://${host}/`);
}
