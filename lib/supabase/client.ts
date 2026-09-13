/**
 * Supabase browser client — anon key, no cookies.
 *
 * Pattern Library reference: Pattern #24 (Magic Link Auth: Complete
 * Implementation), File 1. Ported from vibeacademy/website
 * lib/supabase/client.ts (production donor).
 *
 * Use this client ONLY in 'use client' components.
 *
 * IMPORTANT:
 *   - Only call getSession() here for UI rendering — never for access
 *     decisions. getSession() is NOT re-validated against the server; use
 *     getUser() server-side for any auth check.
 *   - Never import this from a server component or route handler.
 *   - The singleton pattern avoids creating multiple GoTrueClient instances,
 *     which would trigger a console warning in the browser.
 *   - Callers must gate on isSupabaseConfigured() (lib/env.ts) first — when
 *     Supabase is not configured this returns null instead of a client, so
 *     an unconfigured template-born app never crashes.
 */
import { createBrowserClient } from "@supabase/ssr";

let client: ReturnType<typeof createBrowserClient> | null = null;

/**
 * Returns a singleton Supabase browser client, or null when Supabase is not
 * configured (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY absent).
 * Safe to call multiple times — returns the same instance.
 */
export function getSupabaseBrowserClient() {
  // Literal member access so Next.js inlines the values into the client bundle.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  if (!client) {
    client = createBrowserClient(url, anonKey);
  }
  return client;
}
