/**
 * Coming-soon landing page — the public face of a dark-prod deployment.
 *
 * When launch.config.json sets launch_mode "coming_soon", the middleware
 * (lib/supabase/middleware.ts) REWRITES every anonymous request for a
 * non-allowlisted path here — the visitor's URL doesn't change, and no
 * route structure is disclosed. Logged-in users never see this page: they
 * get the full app (dark prod). The page is also directly routable at
 * /coming-soon in live mode, which is how you preview it before flipping.
 *
 * Brandable via launch.config.json app_name. Email submission goes through
 * POST /api/waitlist (server-side service-role insert) — no client-side
 * Supabase on this page. With Supabase unconfigured the form gives way to
 * a not-configured notice and the page still renders (graceful
 * degradation, Pattern #24 philosophy).
 */
import type { Metadata } from "next";
import { isSupabaseConfigured } from "@/lib/env";
import { getAppName } from "@/lib/launch";
import { WaitlistForm } from "./waitlist-form";

export function generateMetadata(): Metadata {
  return {
    title: `${getAppName()} — coming soon`,
  };
}

export default function ComingSoonPage() {
  const appName = getAppName();

  return (
    <main className="coming-soon-main">
      <h1 className="coming-soon-title">{appName}</h1>
      <p className="coming-soon-tagline">
        We&rsquo;re building something here. It isn&rsquo;t ready yet.
      </p>

      {isSupabaseConfigured() ? (
        <>
          <p className="auth-muted">
            Leave your email and we&rsquo;ll let you know the moment it opens.
          </p>
          <WaitlistForm />
        </>
      ) : (
        <div className="auth-card">
          <p className="auth-title">Waitlist not configured</p>
          <p className="auth-muted">
            Set <code>NEXT_PUBLIC_SUPABASE_URL</code>,{" "}
            <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>, and{" "}
            <code>SUPABASE_SERVICE_ROLE_KEY</code> to collect signups. See{" "}
            <code>docs/PLATFORM-GUIDE.md</code>.
          </p>
        </div>
      )}
    </main>
  );
}
