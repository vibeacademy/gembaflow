/**
 * Tests for POST /api/auth/signout (Pattern #24).
 *
 * Ported from the vibeacademy/website donor test suite (generic parts):
 *  1. Mismatched Origin → 403; Supabase signOut is NOT called.
 *  2. Missing Origin header → 403; Supabase signOut is NOT called.
 *  3. Correct Origin → signOut called, 302 redirect to /.
 *  4. Graceful degradation — Supabase unconfigured → 302 redirect to /
 *     without constructing a Supabase client (never crashes).
 *
 * Supabase is fully mocked — no real network calls.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mockSignOut = vi.fn();
const mockCreateSupabaseServer = vi.fn(async () => ({
  auth: { signOut: mockSignOut },
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServer: (...args: unknown[]) =>
    mockCreateSupabaseServer(...(args as [])),
}));

import { POST } from "@/app/api/auth/signout/route";

const PUBLIC_ORIGIN = "https://myapp.example.com";

function makeRequest(originHeader?: string): NextRequest {
  const headers: Record<string, string> = {
    "x-forwarded-host": "myapp.example.com",
    "x-forwarded-proto": "https",
  };
  if (originHeader !== undefined) headers["origin"] = originHeader;

  return new NextRequest("http://localhost:10000/api/auth/signout", {
    method: "POST",
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  mockSignOut.mockResolvedValue({ error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/auth/signout", () => {
  it("returns 403 and does not sign out when Origin mismatches", async () => {
    const res = await POST(makeRequest("https://evil.example.com"));

    expect(res.status).toBe(403);
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it("returns 403 and does not sign out when Origin is missing", async () => {
    const res = await POST(makeRequest(undefined));

    expect(res.status).toBe(403);
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it("signs out and 302-redirects to root on matching Origin", async () => {
    const res = await POST(makeRequest(PUBLIC_ORIGIN));

    expect(mockSignOut).toHaveBeenCalledOnce();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${PUBLIC_ORIGIN}/`);
  });

  it("redirects without touching Supabase when unconfigured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");

    const res = await POST(makeRequest(PUBLIC_ORIGIN));

    expect(mockCreateSupabaseServer).not.toHaveBeenCalled();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${PUBLIC_ORIGIN}/`);
  });

  it("exports no GET handler", async () => {
    const routeModule = await import("@/app/api/auth/signout/route");
    expect("GET" in routeModule).toBe(false);
  });
});
