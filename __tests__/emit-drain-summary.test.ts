import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { render, recommendedActions, postSlackSummary, postIssueComment } from "../scripts/emit-drain-summary.mjs";

import { EventEmitter } from "node:events";

function makeChildProcess({ exitCode = 0, errorEvent, stderr = "" }: { exitCode?: number; errorEvent?: Error; stderr?: string } = {}) {
  const child = new EventEmitter() as any;
  child.stdin = {
    write: vi.fn(),
    end: vi.fn(),
  };
  child.stderr = new EventEmitter();
  child.stdout = new EventEmitter();
  setTimeout(() => {
    if (stderr) child.stderr.emit("data", Buffer.from(stderr));
    if (errorEvent) child.emit("error", errorEvent);
    else child.emit("close", exitCode);
  }, 0);
  return child;
}

const baseState = () => ({
  drainId: "drain-2026-06-08T03:00Z",
  startTime: "2026-06-08T03:00:00Z",
  endTime: "2026-06-08T05:30:00Z",
  shipped: [] as any[],
  blocked: [] as any[],
  rolledBack: [] as any[],
  skipped: [] as any[],
  productionStatus: {
    sentryBaselineBefore: 0.5,
    sentryBaselineAfter: 0.4,
    healthCheckOk: true,
  },
});

describe("render", () => {
  it("renders all sections with full state", () => {
    const state = {
      ...baseState(),
      shipped: [
        {
          bead: "va-131",
          title: "drain wake-up summary",
          safetyClass: "internal",
          prNumber: 200,
          mergeSha: "abcdef1234567890",
          deployId: "dep-1",
          durationMs: 600_000,
          auditCommentUrl: "https://github.com/example/issues/131#issuecomment-1",
        },
        {
          bead: "va-166",
          title: "dark-deploy demonstration",
          safetyClass: "flagged",
          prNumber: 201,
          mergeSha: "fedcba9876543210",
          deployId: "dep-2",
          durationMs: 900_000,
          auditCommentUrl: "https://github.com/example/issues/166#issuecomment-2",
        },
      ],
      blocked: [
        {
          bead: "va-132",
          title: "drain hardening",
          reason: "NO-GO review — missing rate-limit test",
          prNumber: 202,
          auditCommentUrl: "https://github.com/example/issues/132#issuecomment-3",
        },
      ],
      rolledBack: [
        {
          bead: "va-999",
          title: "regression sample",
          prNumber: 203,
          rollbackRunId: "run-7",
          auditCommentUrl: "https://github.com/example/issues/999#issuecomment-4",
        },
      ],
      skipped: [
        { bead: "va-500", title: "auth change", reason: "safety:hot" },
        { bead: "va-501", title: "second reversible", reason: "rate-limited" },
      ],
    };

    const md = render(state);

    expect(md).toContain("# Drain wake-up summary — drain-2026-06-08T03:00Z");
    expect(md).toContain("**Started:** 2026-06-08T03:00:00Z");
    expect(md).toContain("**Duration:** 2h 30m");

    expect(md).toContain("## Tickets shipped (2)");
    expect(md).toContain("va-131");
    expect(md).toContain("drain wake-up summary");
    expect(md).toContain("flagged");
    expect(md).toContain("abcdef1");
    expect(md).toContain("https://github.com/example/issues/131#issuecomment-1");

    expect(md).toContain("## Tickets blocked (1)");
    expect(md).toContain("NO-GO review");

    expect(md).toContain("## Tickets rolled back (1)");
    expect(md).toContain("run-7");

    expect(md).toContain("## Tickets skipped (2)");
    expect(md).toContain("safety:hot");
    expect(md).toContain("rate-limited");

    expect(md).toContain("## Production status");
    expect(md).toContain("0.50 errors/min");
    expect(md).toContain("0.40 errors/min");
    expect(md).toContain("healthy");

    expect(md).toContain("## Recommended morning actions");
  });

  it("renders empty arrays gracefully (none-this-run lines)", () => {
    const md = render(baseState());
    expect(md).toContain("## Tickets shipped (0)");
    expect(md).toContain("_None this run._");
    expect(md).toContain("_No follow-up actions recommended; drain ran clean._");
  });

  it("renders the 'Tickets merged but not deployed' section when state has entries (per #189)", () => {
    const state = {
      ...baseState(),
      mergedNotDeployed: [
        {
          bead: "va-178",
          title: "--post-issue shorthand",
          safetyClass: "internal",
          prNumber: 187,
          mergeSha: "6cb97174ce5bfd6ba15c92a4ead68820b1de346e",
          reason: "Render build_failed with exit 127 (same root cause as #188)",
          auditCommentUrl: "https://github.com/example/issues/178#issuecomment-1",
        },
      ],
    };
    const md = render(state);
    expect(md).toContain("## Tickets merged but not deployed (1)");
    expect(md).toContain("va-178");
    expect(md).toContain("internal");
    expect(md).toContain("#187");
    expect(md).toContain("6cb9717"); // short SHA
    expect(md).toContain("Render build_failed");
    expect(md).toContain("https://github.com/example/issues/178#issuecomment-1");
  });

  it("renders 'None this run.' when mergedNotDeployed is empty", () => {
    const md = render(baseState());
    expect(md).toContain("## Tickets merged but not deployed (0)");
  });

  it("renders the abort notice prominently when aborted=true", () => {
    const state = { ...baseState(), aborted: true, abortReason: "consecutive-failure threshold" };
    const md = render(state);
    expect(md).toContain("⚠ **Drain aborted early.** Reason: consecutive-failure threshold");
  });

  it("renders abort with fallback reason when abortReason missing", () => {
    const state = { ...baseState(), aborted: true };
    const md = render(state);
    expect(md).toContain("⚠ **Drain aborted early.** Reason: (not provided)");
  });

  it("prepends the resumed-from-interruption banner when resumedFromInterruption=true (per #204)", () => {
    const state = {
      ...baseState(),
      resumedFromInterruption: true,
      originalStartTime: "2026-06-10T22:00:00Z",
      resumedAt: "2026-06-11T01:30:00Z",
    };
    const md = render(state);
    expect(md).toContain("⚠ **This drain run was resumed after an interruption.**");
    expect(md).toContain("Originally started at 2026-06-10T22:00:00Z");
    expect(md).toContain("resumed at 2026-06-11T01:30:00Z");
    expect(md).toContain("gap of 3h 30m");
  });

  it("does NOT render the resumption banner when resumedFromInterruption is unset/false", () => {
    const md = render(baseState());
    expect(md).not.toContain("This drain run was resumed after an interruption");
  });

  it("falls back to startTime + unknown when resumption timestamps are missing", () => {
    const state = { ...baseState(), resumedFromInterruption: true };
    const md = render(state);
    expect(md).toContain("⚠ **This drain run was resumed after an interruption.**");
    expect(md).toContain("Originally started at 2026-06-08T03:00:00Z");
    expect(md).toContain("resumed at (unknown)");
    expect(md).toContain("gap of unknown");
  });

  it("renders both resumption banner AND abort notice when a resumed run subsequently aborts", () => {
    const state = {
      ...baseState(),
      resumedFromInterruption: true,
      originalStartTime: "2026-06-10T22:00:00Z",
      resumedAt: "2026-06-11T01:30:00Z",
      aborted: true,
      abortReason: "consecutive-failure threshold",
    };
    const md = render(state);
    expect(md).toContain("⚠ **This drain run was resumed after an interruption.**");
    expect(md).toContain("⚠ **Drain aborted early.** Reason: consecutive-failure threshold");
  });

  it("flags large drains (>20 shipped) for daytime human review", () => {
    const shipped = Array.from({ length: 21 }, (_, i) => ({
      bead: `va-${1000 + i}`,
      title: `ticket ${i}`,
      safetyClass: "internal",
      prNumber: 2000 + i,
      mergeSha: "deadbeef000",
      deployId: "dep",
      durationMs: 60_000,
      auditCommentUrl: "https://example.com",
    }));
    const md = render({ ...baseState(), shipped });
    expect(md).toContain("⚠ **Large drain — flagged for daytime human review** (21 tickets shipped, threshold 20).");
  });

  it("does NOT flag at threshold (exactly 20 shipped)", () => {
    const shipped = Array.from({ length: 20 }, (_, i) => ({
      bead: `va-${1000 + i}`,
      title: `ticket ${i}`,
      safetyClass: "internal",
      prNumber: 2000 + i,
      mergeSha: "deadbeef000",
      deployId: "dep",
      durationMs: 60_000,
      auditCommentUrl: "https://example.com",
    }));
    const md = render({ ...baseState(), shipped });
    expect(md).not.toContain("Large drain");
  });

  it("marks production DEGRADED when Sentry baseline more than doubled", () => {
    const state = {
      ...baseState(),
      productionStatus: {
        sentryBaselineBefore: 0.5,
        sentryBaselineAfter: 2.0,
        healthCheckOk: true,
      },
    };
    const md = render(state);
    expect(md).toContain("Overall: **DEGRADED**");
  });

  it("marks production DEGRADED when health check fails", () => {
    const state = {
      ...baseState(),
      productionStatus: { sentryBaselineBefore: 0.5, sentryBaselineAfter: 0.5, healthCheckOk: false },
    };
    const md = render(state);
    expect(md).toContain("Overall: **DEGRADED**");
  });

  it("formats duration as Ns when under a minute", () => {
    const state = {
      ...baseState(),
      startTime: "2026-06-08T03:00:00Z",
      endTime: "2026-06-08T03:00:45Z",
    };
    expect(render(state)).toContain("**Duration:** 45s");
  });

  it("escapes pipe characters in title and reason cells", () => {
    const state = {
      ...baseState(),
      blocked: [{ bead: "va-1", title: "weird | title", reason: "had | pipes", prNumber: 100 }],
    };
    const md = render(state);
    expect(md).toContain("weird \\| title");
    expect(md).toContain("had \\| pipes");
  });
});

describe("recommendedActions", () => {
  it("emits release-flip prompt for safety:flagged shipped tickets", () => {
    const state = {
      ...baseState(),
      shipped: [{ bead: "va-166", safetyClass: "flagged" }],
    };
    const recs = recommendedActions(state);
    expect(recs).toEqual([
      expect.stringContaining("Review release flip for va-166"),
    ]);
  });

  it("does NOT emit release-flip for safety:internal shipped tickets", () => {
    const state = {
      ...baseState(),
      shipped: [{ bead: "va-131", safetyClass: "internal" }],
    };
    expect(recommendedActions(state)).toEqual([]);
  });

  it("emits manual-queue promotion for skipped safety:hot tickets", () => {
    const state = {
      ...baseState(),
      skipped: [{ bead: "va-500", reason: "safety:hot" }],
    };
    expect(recommendedActions(state)).toEqual([
      expect.stringContaining("Promote va-500 to the morning manual queue"),
    ]);
  });

  it("does NOT emit manual-queue promotion for rate-limited skips", () => {
    const state = {
      ...baseState(),
      skipped: [{ bead: "va-501", reason: "rate-limited" }],
    };
    expect(recommendedActions(state)).toEqual([]);
  });

  it("emits triage prompt for blocked tickets including the reason", () => {
    const state = {
      ...baseState(),
      blocked: [{ bead: "va-132", reason: "agent-merge gate denied" }],
    };
    expect(recommendedActions(state)).toEqual([
      expect.stringContaining("Triage blocked va-132 — agent-merge gate denied."),
    ]);
  });

  it("emits investigation prompt for rolled-back tickets", () => {
    const state = {
      ...baseState(),
      rolledBack: [{ bead: "va-999", rollbackRunId: "run-7" }],
    };
    expect(recommendedActions(state)).toEqual([
      expect.stringContaining("Investigate rolled-back va-999"),
    ]);
  });

  it("emits deploy-pipeline investigation prompt for merged-but-not-deployed tickets (per #189)", () => {
    const state = {
      ...baseState(),
      mergedNotDeployed: [
        {
          bead: "va-178",
          prNumber: 187,
          mergeSha: "6cb9717ab",
          reason: "Render build_failed",
        },
      ],
    };
    const recs = recommendedActions(state);
    expect(recs.length).toBe(1);
    expect(recs[0]).toContain("Investigate Render deploy for va-178");
    expect(recs[0]).toContain("6cb9717");
    expect(recs[0]).toContain("not live");
    expect(recs[0]).toContain("not a code issue");
  });

  it("emits abort-cause prompt when aborted", () => {
    const state = { ...baseState(), aborted: true, abortReason: "consecutive-failure threshold" };
    expect(recommendedActions(state)).toEqual([
      expect.stringContaining("Investigate drain abort cause"),
    ]);
  });
});

describe("postSlackSummary (env-gated)", () => {
  const originalWebhook = process.env.DRAIN_SLACK_WEBHOOK_URL;

  beforeEach(() => {
    delete process.env.DRAIN_SLACK_WEBHOOK_URL;
  });

  afterEach(() => {
    if (originalWebhook === undefined) {
      delete process.env.DRAIN_SLACK_WEBHOOK_URL;
    } else {
      process.env.DRAIN_SLACK_WEBHOOK_URL = originalWebhook;
    }
    vi.restoreAllMocks();
  });

  it("returns {posted: false} when DRAIN_SLACK_WEBHOOK_URL is unset (no-op)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await postSlackSummary("md", baseState());
    expect(result).toEqual({ posted: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("POSTs short summary when webhook env is set", async () => {
    process.env.DRAIN_SLACK_WEBHOOK_URL = "https://hooks.slack.test/x";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 }) as any,
    );
    const state = {
      ...baseState(),
      shipped: [{ bead: "va-1" }, { bead: "va-2" }],
      blocked: [{ bead: "va-3" }],
    };
    const result = await postSlackSummary("md", state);
    expect(result).toEqual({ posted: true });
    expect(fetchSpy).toHaveBeenCalledOnce();
    const call = fetchSpy.mock.calls[0];
    expect(call[0]).toBe("https://hooks.slack.test/x");
    const body = JSON.parse((call[1]?.body as string) ?? "{}");
    expect(body.text).toContain("shipped 2");
    expect(body.text).toContain("blocked 1");
    expect(body.text).toContain(state.drainId);
  });

  it("returns error info without throwing when Slack returns non-2xx", async () => {
    process.env.DRAIN_SLACK_WEBHOOK_URL = "https://hooks.slack.test/x";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 500 }) as any,
    );
    const result = await postSlackSummary("md", baseState());
    expect(result.posted).toBe(false);
    expect(result.error).toContain("500");
  });

  it("returns error info without throwing when fetch itself throws", async () => {
    process.env.DRAIN_SLACK_WEBHOOK_URL = "https://hooks.slack.test/x";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    const result = await postSlackSummary("md", baseState());
    expect(result.posted).toBe(false);
    expect(result.error).toContain("network down");
  });

  it("marks aborted runs in the Slack short summary", async () => {
    process.env.DRAIN_SLACK_WEBHOOK_URL = "https://hooks.slack.test/x";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 }) as any,
    );
    await postSlackSummary("md", { ...baseState(), aborted: true });
    const body = JSON.parse((fetchSpy.mock.calls[0][1]?.body as string) ?? "{}");
    expect(body.text).toContain("(ABORTED)");
  });
});

describe("postIssueComment (--post-issue shorthand)", () => {
  it("returns error when issueNumber is missing", async () => {
    const result = await postIssueComment("md", "");
    expect(result).toEqual({ posted: false, error: "missing issueNumber" });
  });

  it("returns error when issueNumber is undefined", async () => {
    const result = await postIssueComment("md", undefined as any);
    expect(result.posted).toBe(false);
    expect(result.error).toContain("missing issueNumber");
  });

  it("shells to `gh issue comment N --body-file -` with the rendered Markdown on stdin", async () => {
    const spawnImpl: any = vi.fn((..._args: any[]) => makeChildProcess({ exitCode: 0 }));
    const result = await postIssueComment("# rendered markdown\n\nbody", 186, { spawnImpl });
    expect(result).toEqual({ posted: true });
    expect(spawnImpl).toHaveBeenCalledOnce();
    const [cmd, args] = spawnImpl.mock.calls[0];
    expect(cmd).toBe("gh");
    expect(args).toEqual(["issue", "comment", "186", "--body-file", "-"]);
    const child = spawnImpl.mock.results[0].value;
    expect(child.stdin.write).toHaveBeenCalledWith("# rendered markdown\n\nbody");
    expect(child.stdin.end).toHaveBeenCalled();
  });

  it("accepts string issueNumber (CLI passes args as strings)", async () => {
    const spawnImpl: any = vi.fn((..._args: any[]) => makeChildProcess({ exitCode: 0 }));
    const result = await postIssueComment("md", "42", { spawnImpl });
    expect(result).toEqual({ posted: true });
    expect(spawnImpl.mock.calls[0][1][2]).toBe("42");
  });

  it("returns posted=false + error with exit code when gh exits non-zero", async () => {
    const spawnImpl = vi.fn(() => makeChildProcess({ exitCode: 1, stderr: "gh: authentication required\n" }));
    const result = await postIssueComment("md", 186, { spawnImpl: spawnImpl as any });
    expect(result.posted).toBe(false);
    expect(result.error).toContain("gh exited 1");
    expect(result.error).toContain("authentication required");
  });

  it("returns posted=false + error when gh spawn emits an error event (e.g., gh not installed)", async () => {
    const spawnImpl = vi.fn(() => makeChildProcess({ errorEvent: new Error("spawn ENOENT") }));
    const result = await postIssueComment("md", 186, { spawnImpl: spawnImpl as any });
    expect(result.posted).toBe(false);
    expect(result.error).toContain("spawn ENOENT");
  });

  it("returns posted=false + error when spawn synchronously throws", async () => {
    const spawnImpl = vi.fn(() => {
      throw new Error("synchronous spawn failure");
    });
    const result = await postIssueComment("md", 186, { spawnImpl: spawnImpl as any });
    expect(result.posted).toBe(false);
    expect(result.error).toContain("synchronous spawn failure");
  });
});
