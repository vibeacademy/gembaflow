/**
 * Typed environment variable accessors with fail-fast validation.
 *
 * Pattern Library reference: Pattern #24 (Magic Link Auth: Complete
 * Implementation) — env-var conventions match what preview-deploy.yml
 * injects into preview environments:
 *
 *   NEXT_PUBLIC_SUPABASE_URL       Supabase project URL (branch URL in previews)
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY  Publishable/anon key (safe for the client)
 *   SUPABASE_SERVICE_ROLE_KEY      service_role key (server-side ONLY)
 *
 * All getters validate at first call (lazy, not import-time) so that
 * `npm run build` succeeds when Supabase is not configured. Use
 * isSupabaseConfigured() to gate any code path that would otherwise call a
 * getter without configuration — a template-born app with NO Supabase
 * project must still build and run (auth simply reports "not configured").
 *
 * Ported from vibeacademy/website lib/env.ts (production donor), reduced to
 * the generic Supabase accessors.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * True when the public Supabase URL + anon key are both present.
 *
 * IMPORTANT: uses LITERAL process.env.NEXT_PUBLIC_* member access — Next.js
 * only inlines env vars into client bundles for literal expressions, so this
 * check works in both server and client code. Do not refactor to dynamic
 * process.env[name] lookups.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

// ---------------------------------------------------------------------------
// Public (embedded at build time by Next.js)
// ---------------------------------------------------------------------------

export function getSupabaseUrl(): string {
  return requireEnv("NEXT_PUBLIC_SUPABASE_URL");
}

export function getSupabaseAnonKey(): string {
  return requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
}

// ---------------------------------------------------------------------------
// Server-only (never exposed to client bundles)
// ---------------------------------------------------------------------------

export function getSupabaseServiceRoleKey(): string {
  return requireEnv("SUPABASE_SERVICE_ROLE_KEY");
}
