// @vitest-environment node
//
// NextResponse.next() checks request.headers against Node's Headers class;
// jsdom's Headers is a different constructor, so this suite runs in the
// node environment (no DOM needed here).
/**
 * Tests for updateSession (lib/supabase/middleware.ts — Pattern #24).
 *
 * Covers:
 *  1. Graceful degradation — Supabase unconfigured → plain passthrough, no
 *     Supabase client constructed, no redirect, NO crash (acceptance
 *     criterion: a template-born app with no Supabase must still run).
 *  2. Unauthenticated request to /protected → redirect to
 *     /login?next=/protected on the PUBLIC origin.
 *  3. Segment-boundary prefix match — /protected-lookalike is NOT guarded.
 *  4. Unauthenticated request to an unguarded route → passthrough.
 *  5. Authenticated request to /protected → passthrough.
 *
 * Supabase is fully mocked — no real network calls.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mockGetUser = vi.fn();
const mockCreateServerClient = vi.fn(() => ({
  auth: { getUser: mockGetUser },
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (...args: unknown[]) =>
    mockCreateServerClient(...(args as [])),
}));

import { updateSession } from "@/lib/supabase/middleware";

const PUBLIC_ORIGIN = "https://myapp.example.com";

function makeRequest(path: string): NextRequest {
  return new NextRequest(`http://localhost:10000${path}`, {
    headers: {
      "x-forwarded-host": "myapp.example.com",
      "x-forwarded-proto": "https",
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("updateSession", () => {
  it("passes through without touching Supabase when unconfigured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");

    const res = await updateSession(makeRequest("/protected"));

    expect(mockCreateServerClient).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBeNull();
  });

  it("redirects unauthenticated /protected requests to /login?next=", async () => {
    const res = await updateSession(makeRequest("/protected"));

    expect(res.headers.get("location")).toBe(
      `${PUBLIC_ORIGIN}/login?next=%2Fprotected`
    );
  });

  it("guards /protected sub-paths but not lookalike prefixes", async () => {
    const subPath = await updateSession(makeRequest("/protected/reports"));
    expect(subPath.headers.get("location")).toBe(
      `${PUBLIC_ORIGIN}/login?next=%2Fprotected%2Freports`
    );

    const lookalike = await updateSession(makeRequest("/protected-lookalike"));
    expect(lookalike.headers.get("location")).toBeNull();
  });

  it("passes through unauthenticated requests to unguarded routes", async () => {
    const res = await updateSession(makeRequest("/"));

    expect(mockGetUser).toHaveBeenCalled();
    expect(res.headers.get("location")).toBeNull();
  });

  it("passes through authenticated requests to /protected", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });

    const res = await updateSession(makeRequest("/protected"));

    expect(res.headers.get("location")).toBeNull();
  });
});
