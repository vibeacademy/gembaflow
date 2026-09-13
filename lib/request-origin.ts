import type { NextRequest } from "next/server";

/**
 * Resolve the PUBLIC origin of the deployment from proxy headers.
 *
 * Pattern Library reference: Pattern #10 / #24 — behind a reverse proxy
 * (Render, and PR-preview environments) the Next.js server binds to an
 * internal address, so `request.url` / `request.nextUrl.origin` is something
 * like `http://localhost:10000` — NOT the public URL. Building redirect /
 * return URLs from `request.url` therefore sends users to `localhost:10000`.
 * The proxy forwards the real public host in `x-forwarded-host`
 * (+ `x-forwarded-proto`); use those for any URL a browser will be
 * redirected to.
 *
 * Precedence: x-forwarded-host (+ proto) → Origin header → Host header →
 * request.nextUrl.origin (last resort — may be the internal address).
 *
 * Ported from vibeacademy/website lib/request-origin.ts (production donor).
 */
export function getPublicOrigin(request: NextRequest): string {
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost) {
    // May be comma-separated when multiple proxies are chained; take the first.
    const host = forwardedHost.split(",")[0]?.trim() ?? forwardedHost.trim();
    const protoRaw = request.headers.get("x-forwarded-proto") ?? "https";
    const proto = protoRaw.split(",")[0]?.trim() ?? "https";
    return `${proto}://${host}`;
  }

  // Same-origin fetches / POSTs carry a browser Origin header.
  const origin = request.headers.get("origin");
  if (origin) return origin;

  const host = request.headers.get("host");
  if (host) {
    const proto =
      host.startsWith("localhost") || host.startsWith("127.0.0.1")
        ? "http"
        : "https";
    return `${proto}://${host}`;
  }

  return request.nextUrl.origin;
}
