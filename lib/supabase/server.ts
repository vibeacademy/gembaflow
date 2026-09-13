/**
 * Supabase server client — anon key + cookie-based session.
 *
 * Pattern Library reference: Pattern #24 (Magic Link Auth: Complete
 * Implementation), File 2. Ported from vibeacademy/website
 * lib/supabase/server.ts (production donor).
 *
 * Use this client in:
 * - Server Components (async)
 * - Route Handlers
 *
 * Always call getUser() (not getSession()) for auth verification.
 * getSession() reads from the cookie without re-validating the JWT
 * server-side and must NOT be used for access decisions.
 *
 * Never import this from a 'use client' file, and never from middleware —
 * next/headers cookies() is not available in the Edge runtime (middleware
 * builds its client inline; see lib/supabase/middleware.ts).
 *
 * Callers must gate on isSupabaseConfigured() (lib/env.ts) — the env getters
 * throw when Supabase is not configured. Validation is lazy (first call),
 * so `npm run build` succeeds without any Supabase configuration.
 *
 * NOTE: In Next.js 15, cookies() returns Promise<ReadonlyRequestCookies>,
 * so createSupabaseServer() is async. Callers must await it.
 */
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseUrl, getSupabaseAnonKey } from "@/lib/env";

export async function createSupabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Ignored in Server Components, where cookies cannot be set.
          // Session refresh is middleware's job (lib/supabase/middleware.ts).
        }
      },
    },
  });
}
