/**
 * POST /api/auth/signout
 *
 * CSRF-protected sign-out route.
 *
 * Pattern Library reference: Pattern #24 (Magic Link Auth: Complete
 * Implementation). Ported from vibeacademy/website
 * app/api/auth/signout/route.ts (production donor).
 *
 * SameSite=Lax does NOT block cross-origin form POSTs, so we verify the
 * Origin header against the public deployment origin before clearing the
 * session. This prevents an attacker from silently signing users out via a
 * cross-origin form.
 *
 * Flow:
 *  1. Verify request Origin matches getPublicOrigin(request) — 403 if
 *     mismatch. Session is NOT cleared on an Origin mismatch.
 *  2. Create the anon+cookie Supabase client and call signOut(). An
 *     unauthenticated sign-out (session already gone) is a no-op and does
 *     NOT return an error — we redirect to / in all non-403 cases.
 *  3. Redirect 302 to the public origin's root path.
 *
 * Graceful degradation: when Supabase is not configured there is no session
 * to clear — skip straight to the redirect instead of crashing.
 *
 * Only POST is exported — no GET, PUT, PATCH, DELETE, or HEAD handlers.
 * Clients MUST use <form method="POST"> or fetch/XHR with method: 'POST'.
 */
import { NextRequest, NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/env";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getPublicOrigin } from "@/lib/request-origin";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const publicOrigin = getPublicOrigin(request);

  // Step 1: Origin verification (CSRF protection).
  // Browsers always send Origin for cross-origin requests and for
  // same-origin form POSTs. Reject anything that doesn't match our public
  // deployment origin.
  const requestOrigin = request.headers.get("origin");
  if (!requestOrigin || requestOrigin !== publicOrigin) {
    return new NextResponse(null, { status: 403 });
  }

  // Step 2: Sign out. signOut() is safe to call even when no session exists —
  // it clears local cookie state and returns no error in that case.
  // When Supabase is not configured there is no session at all; skip.
  if (isSupabaseConfigured()) {
    const supabase = await createSupabaseServer();
    await supabase.auth.signOut();
  }

  // Step 3: Redirect to the public origin root.
  return NextResponse.redirect(`${publicOrigin}/`, { status: 302 });
}
