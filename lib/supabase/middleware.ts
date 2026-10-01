/**
 * Middleware session refresh + coarse auth guard.
 *
 * Pattern Library reference: Pattern #24 (Magic Link Auth: Complete
 * Implementation), File 3. Ported from vibeacademy/website middleware.ts
 * (production donor), with website-specific logic (rate limiting, /member
 * and /account guards) stripped for the starter.
 *
 * Responsibilities:
 * 1. Refresh the Supabase session cookie on every request so tokens do not
 *    expire mid-session.
 * 2. Redirect unauthenticated requests to /login?next=<original-path> for
 *    protected route prefixes (only /protected by default — the starter
 *    guards a single example page; broaden PROTECTED_PREFIXES as your app
 *    grows).
 * 3. Coming-soon gate (lib/launch.ts): when launch.config.json sets
 *    launch_mode "coming_soon", anonymous requests to non-allowlisted paths
 *    are REWRITTEN (not redirected — the URL stays put) to /coming-soon.
 *    Authenticated users bypass the gate entirely — that IS the dark-prod
 *    access mechanism, no extra tokens. When launch_mode is "live" or
 *    absent, the gate is inert and behavior is identical to pre-gate.
 *
 * Graceful degradation (Pattern #24 / #14): when Supabase is not configured
 * (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY unset), this
 * no-ops — the app must build AND run without any Supabase project.
 *
 * Guardrails (from the donor):
 * - Session check uses getUser() (not getSession()) — validates the JWT
 *   server-side, not just reads the cookie.
 * - Cookie defaults (httpOnly, Secure, SameSite=Lax) come from @supabase/ssr
 *   and are NOT overridden here.
 * - Does NOT use createSupabaseServer() from lib/supabase/server.ts because
 *   that calls next/headers cookies(), unavailable in the Edge runtime. The
 *   anon client is constructed inline with NextRequest/NextResponse cookie
 *   helpers, per @supabase/ssr docs.
 */
import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isSupabaseConfigured, getSupabaseUrl, getSupabaseAnonKey } from "@/lib/env";
import { getPublicOrigin } from "@/lib/request-origin";
import {
  COMING_SOON_PATH,
  getLaunchMode,
  isAllowedWhileGated,
} from "@/lib/launch";

/**
 * Route prefixes that require an authenticated session.
 *
 * The starter ships with a single example protected page (/protected).
 * Add your own prefixes here as you build authenticated areas.
 */
const PROTECTED_PREFIXES = ["/protected"];

export async function updateSession(
  request: NextRequest
): Promise<NextResponse> {
  let response = NextResponse.next({
    request,
  });

  const { pathname } = request.nextUrl;

  // Coming-soon gate precondition — config-driven, NOT Supabase-driven.
  // Whether THIS request is actually gated still depends on the session
  // (authenticated users bypass), resolved below.
  const gateActive =
    getLaunchMode() === "coming_soon" && !isAllowedWhileGated(pathname);

  // Graceful skip: no Supabase configured → no session to refresh, nothing
  // to guard. The middleware must never crash on missing env (Pattern #24).
  //
  // With Supabase unconfigured there is no way to authenticate, so under an
  // active coming-soon gate EVERYONE is anonymous and everyone gets the
  // landing page. Acceptable by design: the gate is config-driven and a
  // deliberately-flipped coming_soon flag should gate even a half-configured
  // deployment, and the allowlist keeps /coming-soon + monitoring reachable.
  if (!isSupabaseConfigured()) {
    if (gateActive) {
      return NextResponse.rewrite(new URL(COMING_SOON_PATH, request.url));
    }
    return response;
  }

  const supabase = createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // Write to both the request (for downstream handlers) and the response.
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        response = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  // getUser() validates the JWT server-side. Never use getSession() for auth
  // decisions — it reads from the cookie without re-validating the JWT.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Coming-soon gate: anonymous + gated path → rewrite to the landing page.
  // Rewrite (not redirect) keeps the requested URL in the address bar and
  // discloses nothing about which routes exist. Authenticated users fall
  // through to normal serving — dark prod. No session cookies are lost by
  // returning a fresh rewrite response here: an anonymous request has no
  // session to refresh.
  if (gateActive && !user) {
    return NextResponse.rewrite(new URL(COMING_SOON_PATH, request.url));
  }

  // Segment-boundary-aware prefix match: a prefix guards its exact path and
  // any sub-path separated by a slash, but NOT paths that merely start with
  // the same characters (e.g. "/protected" must not guard "/protected-docs").
  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + "/")
  );

  if (isProtected && !user) {
    // Redirect to login, preserving the original path as the `next` param so
    // the user lands back where they intended after signing in. Build the
    // URL from the PUBLIC origin (proxy headers) — request.url is the
    // internal bind address behind Render's proxy (e.g. http://localhost:10000).
    const loginUrl = new URL("/login", getPublicOrigin(request));
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}
