/**
 * Launch-mode config accessors — coming-soon / dark-prod gate.
 *
 * The flip surface is `launch.config.json` at the repo root: committed
 * config-as-code, NOT an env var, so flipping coming_soon → live is a
 * one-line PR whose preview deployment shows the LIVE state while prod
 * still shows coming-soon. An env var could not give you that
 * review-the-flip-before-merge property (and changing one requires a
 * redeploy anyway — docs/PATTERN-LIBRARY.md #8).
 *
 * Graceful degradation: an absent or unrecognized `launch_mode` is treated
 * as "live" — a template-born app that never touches the config behaves
 * exactly as before this feature existed. The gate itself lives in
 * lib/supabase/middleware.ts (updateSession), which consumes
 * getLaunchMode() + isAllowedWhileGated().
 */
import launchConfig from "@/launch.config.json";

export type LaunchMode = "coming_soon" | "live";

/** Path the middleware rewrites gated anonymous requests to. */
export const COMING_SOON_PATH = "/coming-soon";

/**
 * Parse an unknown config value into a LaunchMode.
 *
 * Only the exact string "coming_soon" gates; everything else — absent,
 * null, typos, wrong types — is "live". Fail-open by design: a broken
 * config must never lock a production app behind the landing page.
 */
export function parseLaunchMode(value: unknown): LaunchMode {
  return value === "coming_soon" ? "coming_soon" : "live";
}

/** Launch mode from launch.config.json (absent/invalid → "live"). */
export function getLaunchMode(): LaunchMode {
  return parseLaunchMode(
    (launchConfig as Record<string, unknown>).launch_mode
  );
}

/** App name for the coming-soon page (template-brandable via config). */
export function getAppName(): string {
  const name = (launchConfig as Record<string, unknown>).app_name;
  return typeof name === "string" && name.trim() !== ""
    ? name.trim()
    : "Agile Flow";
}

/**
 * Paths that MUST pass through while the coming-soon gate is up.
 *
 * - the landing page itself + its waitlist submission endpoint
 * - the full auth surface (/login, /signup, both callbacks, signout) so
 *   dark-prod users can sign in end-to-end WHILE the gate is up
 * - monitoring endpoints and static assets
 *
 * Several of these (_next/*, /api/health, /api/error*, /api/auth/callback,
 * favicon/sitemap/robots) are already excluded by the middleware matcher in
 * middleware.ts and never reach the gate in production — they are listed
 * here anyway as defense-in-depth so the gate is safe under any matcher.
 */
const GATE_ALLOWLIST = [
  "/coming-soon",
  "/api/waitlist",
  "/login",
  "/signup",
  "/api/auth/callback",
  "/auth/callback",
  "/api/auth/signout",
  "/api/health",
  "/api/error",
  "/api/error-events",
  "/_next",
  "/favicon.ico",
  "/sitemap.xml",
  "/robots.txt",
];

/**
 * True when `pathname` may be served while launch_mode is "coming_soon".
 *
 * Segment-boundary prefix match (same rule as PROTECTED_PREFIXES in
 * lib/supabase/middleware.ts): an entry matches its exact path and any
 * slash-separated sub-path, but not lookalike prefixes ("/login-help" is
 * NOT allowlisted by "/login").
 */
export function isAllowedWhileGated(pathname: string): boolean {
  return GATE_ALLOWLIST.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + "/")
  );
}
