/**
 * Tests for GET /api/auth/callback (Pattern #24, server-side handler).
 *
 * Covers:
 *  1. Graceful degradation — Supabase unconfigured → redirect to /login
 *     with error=supabase_not_configured (never crashes).
 *  2. Missing code AND token_hash → redirect with error=missing_code.
 *  3. Successful PKCE code exchange → redirect to public origin root.
 *  4. Valid relative ?next= is honoured; absolute/protocol-relative ?next=
 *     is rejected (open-redirect guard).
 *  5. "code verifier" exchange failure → error=link_opened_elsewhere.
 *  6. Generic exchange failure → error=auth_failed.
 *  7. Redirects use the PUBLIC origin from x-forwarded-host (Pattern #10),
 *     not the internal request URL.
 *
 * Supabase and next/headers are fully mocked — no real network calls.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mockExchangeCodeForSession = vi.fn();
const mockVerifyOtp = vi.fn();
const mockGetUser = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: {
      exchangeCodeForSession: mockExchangeCodeForSession,
      verifyOtp: mockVerifyOtp,
      getUser: mockGetUser,
    },
  })),
}));

// Route handlers read the cookie store via next/headers, which is not
// available outside a Next.js request scope — mock it.
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    getAll: () => [],
    set: () => {},
  })),
}));

import { GET } from "@/app/api/auth/callback/route";

const PUBLIC_ORIGIN = "https://myapp.example.com";

function makeRequest(query: string): NextRequest {
  // Internal bind address on purpose — redirects must use x-forwarded-host.
  return new NextRequest(`http://localhost:10000/api/auth/callback${query}`, {
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
  mockExchangeCodeForSession.mockResolvedValue({ error: null });
  mockVerifyOtp.mockResolvedValue({ error: null });
  mockGetUser.mockResolvedValue({
    data: { user: { id: "user-1", email: "user@example.com" } },
    error: null,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/auth/callback", () => {
  it("redirects to /login with supabase_not_configured when env is absent", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");

    const res = await GET(makeRequest("?code=abc"));

    expect(res.headers.get("location")).toBe(
      `${PUBLIC_ORIGIN}/login?error=supabase_not_configured`
    );
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("redirects with missing_code when neither code nor token_hash present", async () => {
    const res = await GET(makeRequest(""));

    expect(res.headers.get("location")).toBe(
      `${PUBLIC_ORIGIN}/login?error=missing_code`
    );
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("exchanges the PKCE code and redirects to the public origin root", async () => {
    const res = await GET(makeRequest("?code=abc"));

    expect(mockExchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(mockGetUser).toHaveBeenCalled();
    expect(res.headers.get("location")).toBe(`${PUBLIC_ORIGIN}/`);
  });

  it("honours a valid relative ?next= param", async () => {
    const res = await GET(makeRequest("?code=abc&next=/protected"));

    expect(res.headers.get("location")).toBe(`${PUBLIC_ORIGIN}/protected`);
  });

  it("rejects protocol-relative and absolute ?next= values (open-redirect guard)", async () => {
    const protocolRelative = await GET(
      makeRequest("?code=abc&next=//evil.example.com")
    );
    expect(protocolRelative.headers.get("location")).toBe(`${PUBLIC_ORIGIN}/`);

    const absolute = await GET(
      makeRequest("?code=abc&next=https%3A%2F%2Fevil.example.com")
    );
    expect(absolute.headers.get("location")).toBe(`${PUBLIC_ORIGIN}/`);
  });

  it("routes 'code verifier' exchange failures to link_opened_elsewhere", async () => {
    mockExchangeCodeForSession.mockResolvedValue({
      error: { message: "invalid request: code verifier not found in storage" },
    });

    const res = await GET(makeRequest("?code=abc"));

    expect(res.headers.get("location")).toBe(
      `${PUBLIC_ORIGIN}/login?error=link_opened_elsewhere`
    );
  });

  it("routes generic exchange failures to auth_failed", async () => {
    mockExchangeCodeForSession.mockResolvedValue({
      error: { message: "invalid code" },
    });

    const res = await GET(makeRequest("?code=abc"));

    expect(res.headers.get("location")).toBe(
      `${PUBLIC_ORIGIN}/login?error=auth_failed`
    );
  });

  it("verifies OTP token_hash links and redirects to root", async () => {
    const res = await GET(makeRequest("?token_hash=th&type=magiclink"));

    expect(mockVerifyOtp).toHaveBeenCalledWith({
      token_hash: "th",
      type: "magiclink",
    });
    expect(res.headers.get("location")).toBe(`${PUBLIC_ORIGIN}/`);
  });

  it("redirects to auth_failed when getUser() finds no valid session", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const res = await GET(makeRequest("?code=abc"));

    expect(res.headers.get("location")).toBe(
      `${PUBLIC_ORIGIN}/login?error=auth_failed`
    );
  });
});
