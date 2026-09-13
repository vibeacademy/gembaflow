/**
 * Auth callback route handler — server side.
 *
 * Handles the redirect from Supabase Auth after a magic-link click.
 * Exchanges the one-time PKCE code for a session and writes the session
 * cookie (via @supabase/ssr), then redirects into the app.
 *
 * Pattern Library reference: Pattern #24 (Magic Link Auth: Complete
 * Implementation), File 5 — magic-link auth needs TWO callback handlers.
 * This route handles server-side code exchange (PKCE `?code=`) and OTP
 * verification (`?token_hash=`). The hash-fragment case
 * (#access_token=... in the URL hash, which never reaches the server) is
 * handled by the client-side page at app/(auth)/auth/callback/page.tsx.
 *
 * Ported from vibeacademy/website app/api/auth/callback/route.ts
 * (production donor), with website-specific logic stripped (entitlement
 * grants, tier-based routing, analytics events).
 *
 * Guardrails:
 * - getUser() is used (not getSession()) for all auth decisions.
 * - Cookie defaults (httpOnly, Secure, SameSite=Lax) come from @supabase/ssr
 *   and are NOT overridden here.
 * - The `next` param is validated to prevent open-redirect attacks: only
 *   path-relative URLs (starting with / but not //) are honoured.
 * - Redirect URLs are built from the PUBLIC origin (proxy headers, Pattern
 *   #10) — request.url is the internal bind address behind Render's proxy.
 * - Graceful degradation: when Supabase is not configured, redirects to
 *   /login (which renders a "Supabase not configured" state) instead of
 *   crashing.
 */
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import {
  isSupabaseConfigured,
  getSupabaseUrl,
  getSupabaseAnonKey,
} from "@/lib/env";
import { getPublicOrigin } from "@/lib/request-origin";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const nextParam = url.searchParams.get("next");

  // Derive the PUBLIC origin from proxy headers — request.url is the internal
  // bind address behind Render's proxy (e.g. http://localhost:10000), which
  // would redirect users off the public site.
  const origin = getPublicOrigin(request);

  // Graceful degradation: no Supabase configured → nothing to exchange.
  if (!isSupabaseConfigured()) {
    return NextResponse.redirect(`${origin}/login?error=supabase_not_configured`);
  }

  if (!code && !(tokenHash && type)) {
    // Neither a PKCE code nor an OTP token hash — unexpected state.
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const cookieStore = await cookies();

  const supabase = createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value, options }) =>
          cookieStore.set(name, value, options)
        );
      },
    },
  });

  if (code) {
    const { error: exchangeError } =
      await supabase.auth.exchangeCodeForSession(code);

    if (exchangeError) {
      console.error(
        "[auth/callback] code exchange failed:",
        exchangeError.message
      );
      // The PKCE-verifier-missing case: the magic link was opened in a
      // different browser/device than the one that requested it. The PKCE
      // verifier cookie only exists in the originating browser session, so
      // this is expected PKCE behaviour (prevents link forwarding), not a
      // bug. Surface a distinct error code so the login page can explain.
      if (exchangeError.message.includes("code verifier")) {
        return NextResponse.redirect(
          `${origin}/login?error=link_opened_elsewhere`
        );
      }
      return NextResponse.redirect(`${origin}/login?error=auth_failed`);
    }
  } else if (tokenHash && type) {
    // OTP-style link (?token_hash=...&type=magiclink) — Pattern #24 File 5.
    const { error: verifyError } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as "magiclink",
    });
    if (verifyError) {
      console.error("[auth/callback] OTP verify failed:", verifyError.message);
      return NextResponse.redirect(`${origin}/login?error=auth_failed`);
    }
  }

  // Use getUser() (not getSession()) to confirm the session is valid
  // server-side before redirecting into the app.
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    console.error(
      "[auth/callback] getUser() failed after exchange:",
      userError?.message
    );
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  // Validate the `next` param to prevent open-redirect attacks.
  // Only allow relative paths starting with / (no protocol-relative or
  // absolute URLs).
  const redirectPath =
    nextParam !== null && nextParam.startsWith("/") && !nextParam.startsWith("//")
      ? nextParam
      : "/";

  return NextResponse.redirect(`${origin}${redirectPath}`);
}
