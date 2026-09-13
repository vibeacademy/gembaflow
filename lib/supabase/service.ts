/**
 * Supabase service-role client — bypasses Row Level Security.
 *
 * Pattern Library reference: Pattern #24 (Magic Link Auth: Complete
 * Implementation). Ported from vibeacademy/website lib/supabase/service.ts
 * (production donor).
 *
 * Use this client ONLY in:
 * - Webhook handlers
 * - Admin-only server operations
 *
 * NEVER use this client in:
 * - Server Components
 * - Route Handlers that serve authenticated users
 * - Any 'use client' file
 * - Middleware
 *
 * The service role key must NEVER appear in NEXT_PUBLIC_* variables
 * or any code path that could reach the client bundle.
 *
 * Callers must gate on configuration: getSupabaseServiceRoleKey() throws
 * when SUPABASE_SERVICE_ROLE_KEY is absent (lazy, so builds succeed without
 * Supabase configuration).
 */
import { createClient } from "@supabase/supabase-js";
import { getSupabaseUrl, getSupabaseServiceRoleKey } from "@/lib/env";

export function createSupabaseService() {
  return createClient(getSupabaseUrl(), getSupabaseServiceRoleKey());
}
