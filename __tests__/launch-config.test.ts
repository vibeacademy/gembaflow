// @vitest-environment node
/**
 * Tests for lib/launch.ts — launch-mode config parsing.
 *
 * The load-bearing guarantee is fail-open: ONLY the exact string
 * "coming_soon" gates. Absent flag, typos, nulls, wrong types — all parse
 * to "live", so a template-born app that never touches launch.config.json
 * behaves exactly as it did before the gate existed.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  parseLaunchMode,
  getLaunchMode,
  getAppName,
  isAllowedWhileGated,
} from "@/lib/launch";

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@/launch.config.json");
});

describe("parseLaunchMode", () => {
  it('parses "coming_soon"', () => {
    expect(parseLaunchMode("coming_soon")).toBe("coming_soon");
  });

  it('parses "live"', () => {
    expect(parseLaunchMode("live")).toBe("live");
  });

  it("treats an absent flag as live (fail-open)", () => {
    expect(parseLaunchMode(undefined)).toBe("live");
  });

  it("treats null, typos, and wrong types as live (fail-open)", () => {
    expect(parseLaunchMode(null)).toBe("live");
    expect(parseLaunchMode("comingsoon")).toBe("live");
    expect(parseLaunchMode("COMING_SOON")).toBe("live");
    expect(parseLaunchMode(true)).toBe("live");
    expect(parseLaunchMode(1)).toBe("live");
    expect(parseLaunchMode({})).toBe("live");
  });
});

describe("shipped launch.config.json", () => {
  it("ships live — zero behavior change out of the box", () => {
    expect(getLaunchMode()).toBe("live");
  });

  it("ships a non-empty app name", () => {
    expect(getAppName().length).toBeGreaterThan(0);
  });
});

describe("config degradation", () => {
  it("falls back to live + default app name when fields are missing", async () => {
    vi.doMock("@/launch.config.json", () => ({ default: {} }));
    const launch = await import("@/lib/launch");

    expect(launch.getLaunchMode()).toBe("live");
    expect(launch.getAppName()).toBe("Agile Flow");
  });

  it("gates when the flag is coming_soon and brands from app_name", async () => {
    vi.doMock("@/launch.config.json", () => ({
      default: { launch_mode: "coming_soon", app_name: "  Founder App  " },
    }));
    const launch = await import("@/lib/launch");

    expect(launch.getLaunchMode()).toBe("coming_soon");
    expect(launch.getAppName()).toBe("Founder App");
  });
});

describe("isAllowedWhileGated", () => {
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
    "/favicon.ico",
  ])("allowlists %s", (path) => {
    expect(isAllowedWhileGated(path)).toBe(true);
  });

  it.each(["/", "/dashboard", "/protected", "/api/anything"])(
    "gates %s",
    (path) => {
      expect(isAllowedWhileGated(path)).toBe(false);
    }
  );

  it("does not allowlist lookalike prefixes (segment boundary)", () => {
    expect(isAllowedWhileGated("/login-help")).toBe(false);
    expect(isAllowedWhileGated("/coming-soonish")).toBe(false);
    expect(isAllowedWhileGated("/login/nested")).toBe(true);
  });
});
