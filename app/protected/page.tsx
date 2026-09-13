/**
 * /protected — example authenticated page.
 *
 * Pattern Library reference: Pattern #24 (Magic Link Auth: Complete
 * Implementation). The middleware (lib/supabase/middleware.ts) guards this
 * route: unauthenticated visitors are redirected to /login?next=/protected.
 * This page re-checks the session server-side as defense in depth — the
 * middleware is a coarse guard, the page is authoritative (donor guardrail).
 *
 * getUser() (never getSession()) validates the JWT server-side.
 *
 * Graceful degradation: when Supabase is not configured, the middleware
 * does not guard anything, so this page renders a "not configured" notice
 * instead of crashing or redirect-looping.
 */
import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/env";
import { createSupabaseServer } from "@/lib/supabase/server";

// Session state lives in cookies — this page must never be statically cached.
export const dynamic = "force-dynamic";

export default async function ProtectedPage() {
  if (!isSupabaseConfigured()) {
    return (
      <main className="auth-main">
        <h1>Protected page</h1>
        <div className="auth-card">
          <p className="auth-title">Supabase not configured</p>
          <p className="auth-muted">
            This page is auth-guarded once Supabase is configured. Set{" "}
            <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
            <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to enable magic-link
            sign-in. See <code>docs/PLATFORM-GUIDE.md</code>.
          </p>
        </div>
      </main>
    );
  }

  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/protected");
  }

  return (
    <main className="auth-main">
      <h1>Protected page</h1>
      <p>
        You are signed in as <strong>{user.email}</strong>.
      </p>
      <p className="auth-muted">
        This page is guarded by the middleware (<code>/protected</code> prefix)
        and re-verified server-side with <code>getUser()</code>.
      </p>
      <form action="/api/auth/signout" method="POST">
        <button type="submit">Sign out</button>
      </form>
    </main>
  );
}
