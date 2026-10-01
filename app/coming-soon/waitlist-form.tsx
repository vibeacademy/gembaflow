/**
 * Waitlist email form for the coming-soon landing page.
 *
 * Submits to POST /api/waitlist (route handler, server-side service-role
 * insert) — deliberately NO client-side Supabase here: the browser bundle
 * of a pre-launch landing page should not carry an authenticated data
 * client for a table anon can't touch anyway (RLS, zero policies).
 *
 * Duplicate submissions get the same success state as fresh ones — the
 * route makes them indistinguishable on purpose.
 */
"use client";

import { useState } from "react";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_email: "That doesn't look like an email address. Check it and try again.",
  not_configured: "Signups aren't set up on this deployment yet. Try again later.",
};

const GENERIC_ERROR = "Something went wrong saving your email. Try again in a moment.";

export function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "joined" | "error">(
    "idle"
  );
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("loading");
    setErrorMessage("");

    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (res.ok) {
        setStatus("joined");
        return;
      }

      const body: unknown = await res.json().catch(() => null);
      const code =
        body !== null && typeof body === "object"
          ? String((body as Record<string, unknown>).error ?? "")
          : "";
      setStatus("error");
      setErrorMessage(ERROR_MESSAGES[code] ?? GENERIC_ERROR);
    } catch {
      setStatus("error");
      setErrorMessage(GENERIC_ERROR);
    }
  }

  if (status === "joined") {
    return (
      <div className="auth-card" role="status" aria-live="polite">
        <p className="auth-title">You&rsquo;re on the list</p>
        <p className="auth-muted">
          We&rsquo;ll email <strong>{email}</strong> when we launch. Nothing
          else — no newsletter.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="auth-form coming-soon-form" noValidate>
      <label htmlFor="waitlist-email">Email address</label>
      <input
        id="waitlist-email"
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
        {status === "loading" ? "Joining…" : "Join the waitlist"}
      </button>
    </form>
  );
}
