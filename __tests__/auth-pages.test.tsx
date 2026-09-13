/**
 * Render tests for the magic-link auth pages (Pattern #24).
 *
 * Verifies the graceful-degradation acceptance criterion at the UI layer:
 * with no Supabase env configured the pages render a "Supabase not
 * configured" notice instead of a broken form; with env configured they
 * render the email form.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

import LoginPage from "@/app/(auth)/login/page";
import SignupPage from "@/app/(auth)/signup/page";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("auth pages — graceful degradation", () => {
  it("login renders a not-configured notice without Supabase env", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");

    render(<LoginPage />);

    expect(screen.getByText("Supabase not configured")).toBeDefined();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("signup renders a not-configured notice without Supabase env", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");

    render(<SignupPage />);

    expect(screen.getByText("Supabase not configured")).toBeDefined();
  });
});

describe("auth pages — configured", () => {
  it("login renders the email form when Supabase env is set", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");

    render(<LoginPage />);

    expect(screen.getByLabelText("Email address")).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Send magic link" })
    ).toBeDefined();
  });

  it("signup renders the email form with signup copy", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");

    render(<SignupPage />);

    expect(
      screen.getByRole("button", { name: "Create account" })
    ).toBeDefined();
  });
});
