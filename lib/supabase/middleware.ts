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

  // Graceful skip: no Supabase configured → no session to refresh, nothing
  // to guard. The middleware must never crash on missing env (Pattern #24).
  if (!isSupabaseConfigured()) {
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

  const { pathname } = request.nextUrl;
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
