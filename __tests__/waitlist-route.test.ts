// @vitest-environment node
/**
 * Tests for POST /api/waitlist (app/api/waitlist/route.ts).
 *
 * Covers:
 *  1. Valid email → 200 { ok: true }, service-role insert with the
 *     NORMALIZED (trimmed, lowercased) address.
 *  2. Duplicate email (Postgres 23505 unique violation) → SAME friendly
 *     200 success — dedupe is never surfaced as an error.
 *  3. Invalid / missing email, malformed JSON → 4xx, no insert attempted.
 *  4. Supabase unconfigured → 503 not_configured, no insert attempted
 *     (graceful degradation — the app runs without Supabase).
 *  5. Non-unique-violation DB error → 500.
 *
 * The service-role client is fully mocked — no real network calls.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockInsert = vi.fn();
const mockFrom = vi.fn(() => ({ insert: mockInsert }));
const mockCreateSupabaseService = vi.fn(() => ({ from: mockFrom }));

vi.mock("@/lib/supabase/service", () => ({
  createSupabaseService: () => mockCreateSupabaseService(),
}));

import { POST } from "@/app/api/waitlist/route";

function makeRequest(body: string): Request {
  return new Request("http://localhost:10000/api/waitlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  mockInsert.mockResolvedValue({ error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/waitlist", () => {
  it("inserts a valid email and returns success", async () => {
    const res = await POST(makeRequest(JSON.stringify({ email: "founder@example.com" })));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockFrom).toHaveBeenCalledWith("waitlist_signups");
    expect(mockInsert).toHaveBeenCalledWith({ email: "founder@example.com" });
  });

  it("normalizes case and whitespace before inserting", async () => {
    const res = await POST(
      makeRequest(JSON.stringify({ email: "  Founder@Example.COM " }))
    );

    expect(res.status).toBe(200);
    expect(mockInsert).toHaveBeenCalledWith({ email: "founder@example.com" });
  });

  it("returns the SAME success for a duplicate email (23505)", async () => {
    mockInsert.mockResolvedValue({
      error: { code: "23505", message: "duplicate key value" },
    });

    const res = await POST(makeRequest(JSON.stringify({ email: "founder@example.com" })));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it.each(["not-an-email", "spaces in@example.com", "missing@dot", ""])(
    "rejects invalid email %j with 400 and no insert",
    async (email) => {
      const res = await POST(makeRequest(JSON.stringify({ email })));

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_email" });
      expect(mockInsert).not.toHaveBeenCalled();
    }
  );

  it("rejects a missing / non-string email with 400", async () => {
    const missing = await POST(makeRequest(JSON.stringify({})));
    expect(missing.status).toBe(400);

    const nonString = await POST(makeRequest(JSON.stringify({ email: 42 })));
    expect(nonString.status).toBe(400);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON with 400", async () => {
    const res = await POST(makeRequest("this is not json"));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_json" });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("degrades to 503 not_configured when Supabase is unconfigured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");

    const res = await POST(makeRequest(JSON.stringify({ email: "founder@example.com" })));

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "not_configured" });
    expect(mockCreateSupabaseService).not.toHaveBeenCalled();
  });

  it("degrades to 503 when only the service-role key is missing", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");

    const res = await POST(makeRequest(JSON.stringify({ email: "founder@example.com" })));

    expect(res.status).toBe(503);
    expect(mockCreateSupabaseService).not.toHaveBeenCalled();
  });

  it("returns 500 on a non-duplicate insert failure", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mockInsert.mockResolvedValue({
      error: { code: "42P01", message: "relation does not exist" },
    });

    const res = await POST(makeRequest(JSON.stringify({ email: "founder@example.com" })));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "insert_failed" });
    consoleError.mockRestore();
  });
});
