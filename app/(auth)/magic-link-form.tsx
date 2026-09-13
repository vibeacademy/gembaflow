/**
 * Shared magic-link email form used by /login and /signup.
 *
 * Pattern Library reference: Pattern #24 (Magic Link Auth: Complete
 * Implementation), File 7. Ported from vibeacademy/website
 * app/(auth)/login/page.tsx + signup/page.tsx (production donor) — the two
 * donor pages share this exact mechanism with different copy, so the
 * starter extracts it once.
 *
 * Supabase Auth does not distinguish between signup and login for
 * magic-link flows: signInWithOtp creates the user if they do not exist,
 * or signs in the existing user if they do. No passwords are stored.
 *
 * Key details:
 * - emailRedirectTo uses window.location.origin (never hardcoded) so the
 *   flow works unchanged in production AND PR-preview environments
 *   (Patterns #1/#4/#23 — preview-deploy.yml allow-lists
 *   <preview-url>/api/auth/callback).
 * - A valid relative ?next= param (set by the middleware guard) is carried
 *   through to the callback so the user lands back where they intended.
 * - Graceful degradation: when Supabase is not configured
 *   (NEXT_PUBLIC_SUPABASE_* unset at build time), renders a
 *   "Supabase not configured" notice instead of a broken form.
 * - The post-send confirmation ("check your email") renders inline as the
 *   donor does — Pattern #24's /check-email page is folded into this state.
 */
"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/** Human-readable messages for ?error= codes set by the callback route. */
const ERROR_MESSAGES: Record<string, string> = {
  missing_code: "That sign-in link was missing its code. Please request a new one.",
  auth_failed: "We couldn't sign you in with that link. It may have expired — request a new one.",
  link_opened_elsewhere:
    "Magic links only work in the browser that requested them. Request a new link from this browser.",
  supabase_not_configured: "Authentication is not configured for this deployment.",
};

export function MagicLinkForm({
  heading,
  intro,
  cta,
}: {
  heading: string;
  intro: string;
  cta: string;
}) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "sent" | "error">(
    "idle"
  );
  const [errorMessage, setErrorMessage] = useState("");

  // Surface ?error= codes from the callback route (read client-side to keep
  // this page statically prerenderable without a Suspense boundary).
  useEffect(() => {
    const error = new URLSearchParams(window.location.search).get("error");
    if (error) {
      setStatus("error");
      setErrorMessage(
        ERROR_MESSAGES[error] ?? "Something went wrong signing you in."
      );
    }
  }, []);

  // Literal member access — inlined into the client bundle by Next.js.
  const configured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("loading");
    setErrorMessage("");

    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setStatus("error");
      setErrorMessage(ERROR_MESSAGES.supabase_not_configured);
      return;
    }

    // Carry a valid relative ?next= (set by the middleware guard) through to
    // the callback. Same open-redirect guard as the callback route.
    const next = new URLSearchParams(window.location.search).get("next");
    const nextSuffix =
      next && next.startsWith("/") && !next.startsWith("//")
        ? `?next=${encodeURIComponent(next)}`
        : "";

    // CRITICAL: use origin so this works in preview environments.
    const redirectTo = `${window.location.origin}/api/auth/callback${nextSuffix}`;

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: redirectTo,
      },
    });

    if (error) {
      setStatus("error");
      setErrorMessage(error.message);
      return;
    }

    setStatus("sent");
  }

  return (
    <main className="auth-main">
      <h1>{heading}</h1>
      {!configured ? (
        <div className="auth-card">
          <p className="auth-title">Supabase not configured</p>
          <p className="auth-muted">
            Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
            <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to enable magic-link
            sign-in. See <code>docs/PLATFORM-GUIDE.md</code>.
          </p>
        </div>
      ) : status === "sent" ? (
        <div className="auth-card" role="status" aria-live="polite">
          <p className="auth-title">Check your email</p>
          <p className="auth-muted">
            We sent a magic link to <strong>{email}</strong>. Click it to sign
            in — no password needed.
          </p>
        </div>
      ) : (
        <div className="auth-card">
          <p className="auth-muted">{intro}</p>
          <form onSubmit={handleSubmit} className="auth-form" noValidate>
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="you@example.com"
            />
            {status === "error" && (
              <p className="auth-error" role="alert">
                {errorMessage}
              </p>
            )}
            <button type="submit" disabled={status === "loading" || !email}>
              {status === "loading" ? "Sending…" : cta}
            </button>
          </form>
        </div>
      )}
    </main>
  );
}
