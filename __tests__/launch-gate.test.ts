// @vitest-environment node
//
// NextResponse.next() checks request.headers against Node's Headers class;
// jsdom's Headers is a different constructor, so this suite runs in the
// node environment (same reason as auth-middleware.test.ts).
/**
 * Tests for the coming-soon gate inside updateSession
 * (lib/supabase/middleware.ts + lib/launch.ts).
 *
 * Gate matrix:
 *  1. live → passthrough for everyone (gate inert).
 *  2. coming_soon + anonymous → REWRITE to /coming-soon (URL preserved).
 *  3. coming_soon + authenticated → passthrough (dark-prod access).
 *  4. coming_soon + anonymous + allowlisted path → passthrough (the auth
 *     flow and the waitlist must work end-to-end WHILE the gate is up).
 *  5. Supabase unconfigured + coming_soon → everyone is anonymous →
 *     everyone (non-allowlisted) gets the landing rewrite; unconfigured +
 *     live keeps the pre-existing plain passthrough.
 *
 * getLaunchMode is mocked (the shipped config is "live"); everything else
 * in lib/launch — the allowlist, the rewrite path — is the real module.
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

let mockLaunchMode: "coming_soon" | "live" = "live";
vi.mock("@/lib/launch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/launch")>();
  return {
    ...actual,
    getLaunchMode: () => mockLaunchMode,
  };
});

import { updateSession } from "@/lib/supabase/middleware";

function makeRequest(path: string): NextRequest {
  return new NextRequest(`http://localhost:10000${path}`, {
    headers: {
      "x-forwarded-host": "myapp.example.com",
      "x-forwarded-proto": "https",
    },
  });
}

/** The rewrite target set by NextResponse.rewrite(), if any. */
function rewriteTarget(res: Response): string | null {
  return res.headers.get("x-middleware-rewrite");
}

function signIn() {
  mockGetUser.mockResolvedValue({
    data: { user: { id: "user-1" } },
    error: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLaunchMode = "live";
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("coming-soon gate (updateSession)", () => {
  it("live mode: anonymous requests pass through untouched", async () => {
    const res = await updateSession(makeRequest("/"));

    expect(rewriteTarget(res)).toBeNull();
    expect(res.headers.get("location")).toBeNull();
  });

  it("coming_soon + anonymous → rewrite to /coming-soon", async () => {
    mockLaunchMode = "coming_soon";

    const res = await updateSession(makeRequest("/"));

    expect(rewriteTarget(res)).toBe("http://localhost:10000/coming-soon");
  });

  it("coming_soon + anonymous gates deep paths too", async () => {
    mockLaunchMode = "coming_soon";

    const res = await updateSession(makeRequest("/dashboard/reports"));

    expect(rewriteTarget(res)).toBe("http://localhost:10000/coming-soon");
  });

  it("coming_soon + authenticated → full app (dark prod)", async () => {
    mockLaunchMode = "coming_soon";
    signIn();

    const res = await updateSession(makeRequest("/"));

    expect(rewriteTarget(res)).toBeNull();
    expect(res.headers.get("location")).toBeNull();
  });

  it("coming_soon + authenticated: /protected still serves normally", async () => {
    mockLaunchMode = "coming_soon";
    signIn();

    const res = await updateSession(makeRequest("/protected"));

    expect(rewriteTarget(res)).toBeNull();
    expect(res.headers.get("location")).toBeNull();
  });

  it("coming_soon + anonymous: /protected gets the landing, not the login redirect (no route disclosure)", async () => {
    mockLaunchMode = "coming_soon";

    const res = await updateSession(makeRequest("/protected"));

    expect(rewriteTarget(res)).toBe("http://localhost:10000/coming-soon");
    expect(res.headers.get("location")).toBeNull();
  });

  it.each([
    "/coming-soon",
    "/api/waitlist",
    "/login",
    "/signup",
    "/api/auth/callback",
    "/auth/callback",
    "/api/auth/signout",
    "/api/health",
    "/_next/static/chunks/app.js",
  ])("coming_soon + anonymous: allowlisted %s passes through", async (path) => {
    mockLaunchMode = "coming_soon";

    const res = await updateSession(makeRequest(path));

    expect(rewriteTarget(res)).toBeNull();
    expect(res.headers.get("location")).toBeNull();
  });

  it("coming_soon + anonymous: allowlist is segment-boundary strict", async () => {
    mockLaunchMode = "coming_soon";

    const res = await updateSession(makeRequest("/login-help"));

    expect(rewriteTarget(res)).toBe("http://localhost:10000/coming-soon");
  });

  it("Supabase unconfigured + coming_soon → everyone gets the landing (all anonymous)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    mockLaunchMode = "coming_soon";

    const res = await updateSession(makeRequest("/dashboard"));

    expect(mockCreateServerClient).not.toHaveBeenCalled();
    expect(rewriteTarget(res)).toBe("http://localhost:10000/coming-soon");
  });

  it("Supabase unconfigured + coming_soon: allowlisted paths still pass", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    mockLaunchMode = "coming_soon";

    const res = await updateSession(makeRequest("/coming-soon"));

    expect(rewriteTarget(res)).toBeNull();
  });

  it("Supabase unconfigured + live: plain passthrough (pre-existing behavior)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");

    const res = await updateSession(makeRequest("/protected"));

    expect(mockCreateServerClient).not.toHaveBeenCalled();
    expect(rewriteTarget(res)).toBeNull();
    expect(res.headers.get("location")).toBeNull();
  });

  it("live mode: the pre-existing /protected login redirect is unchanged", async () => {
    const res = await updateSession(makeRequest("/protected"));

    expect(res.headers.get("location")).toBe(
      "https://myapp.example.com/login?next=%2Fprotected"
    );
  });
});
