/**
 * POST /api/waitlist — coming-soon landing page email collection.
 *
 * Server-side only: the landing page never touches Supabase from the
 * client. Inserts go through the service-role client
 * (lib/supabase/service.ts) because waitlist_signups has RLS enabled with
 * ZERO policies — anon cannot write it (see
 * supabase/migrations/20260918051627_waitlist_signups.sql). This route
 * serves anonymous visitors and performs exactly one controlled insert;
 * it never reads the table back to the caller.
 *
 * Dedupe is the DB unique constraint on email: a 23505 unique-violation is
 * returned as the SAME friendly success as a fresh insert ("you're on the
 * list") — never an error, and no signal about whether an email was
 * already subscribed.
 *
 * Graceful degradation: with Supabase (or the service-role key)
 * unconfigured, responds 503 with a stable `not_configured` error code —
 * the app still builds and runs; the landing form shows a not-configured
 * notice instead of the form (app/coming-soon/page.tsx).
 *
 * This path is on the coming-soon gate allowlist (lib/launch.ts) — it must
 * remain reachable while the gate is up, or the form it serves would be
 * gated away from the only audience it exists for.
 */
import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/env";
import { createSupabaseService } from "@/lib/supabase/service";

/** Postgres unique-violation SQLSTATE — the dedupe signal, not an error. */
const UNIQUE_VIOLATION = "23505";

/**
 * Pragmatic server-side email shape check: one @, no whitespace, a dot in
 * the domain, sane length. The magic-link flow is the real verifier — this
 * only rejects obvious garbage before it reaches the table.
 */
function isValidEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(request: Request) {
  let email: unknown;
  try {
    const body: unknown = await request.json();
    email =
      body !== null && typeof body === "object"
        ? (body as Record<string, unknown>).email
        : undefined;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (typeof email !== "string") {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }

  // Normalize before validating/inserting so the unique constraint dedupes
  // case/whitespace variants of the same address.
  const normalized = email.trim().toLowerCase();
  if (!isValidEmail(normalized)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }

  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const supabase = createSupabaseService();
  const { error } = await supabase
    .from("waitlist_signups")
    .insert({ email: normalized });

  if (error && error.code !== UNIQUE_VIOLATION) {
    console.error("[waitlist] insert failed:", error.code, error.message);
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }

  // Fresh insert and duplicate are deliberately indistinguishable.
  return NextResponse.json({ ok: true });
}
