/**
 * Auth callback page — client side.
 *
 * Pattern Library reference: Pattern #24 (Magic Link Auth: Complete
 * Implementation), File 6. **This is the critical file most
 * implementations miss.** Some Supabase auth flows put tokens in the URL
 * hash fragment (#access_token=...). Hash fragments never reach the
 * server, so the server-side route at /api/auth/callback cannot handle
 * them — this client-side page performs the token exchange instead via
 * the Supabase JS client's automatic hash detection.
 *
 * The PKCE ?code= flow (the default for the starter's magic links) is
 * handled server-side by app/api/auth/callback/route.ts; this page is the
 * hash-fragment companion Pattern #24 requires.
 */
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { AuthChangeEvent } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();

    // Graceful degradation: no Supabase configured → nothing to exchange.
    if (!supabase) {
      router.replace("/login?error=supabase_not_configured");
      return;
    }

    // Supabase JS client automatically detects hash-fragment tokens.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event: AuthChangeEvent) => {
      if (event === "SIGNED_IN") {
        // Honour a valid relative ?next= param (same open-redirect guard as
        // the server-side callback).
        const next = new URLSearchParams(window.location.search).get("next");
        const target =
          next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
        router.push(target);
        router.refresh();
      }
    });

    // Surface errors from the hash (e.g. expired link).
    const hash = window.location.hash.substring(1);
    if (hash) {
      const params = new URLSearchParams(hash);
      const error = params.get("error_description");
      if (error) {
        router.replace(`/login?error=${encodeURIComponent(error)}`);
      }
    }

    return () => {
      subscription.unsubscribe();
    };
  }, [router]);

  return (
    <main className="auth-main">
      <div className="auth-card" role="status" aria-live="polite">
        <p className="auth-title">Signing you in…</p>
        <p className="auth-muted">Please wait while we verify your identity.</p>
      </div>
    </main>
  );
}
