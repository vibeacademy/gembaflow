// @vitest-environment node
// Tests for scripts/workshop-fleet-check.sh — instructor fleet observability
// (gh-gf-524).
//
// Strategy (mirrors ruleset-probe.test.mjs): run the script with a controlled
// PATH containing a stub `curl` that dispatches canned responses per URL. No
// real network is called; jq is the real one from the host PATH.
//
// Classification branches under test:
//   GREEN   — marker 200 + valid JSON (duration/mode/optional workshop echo)
//   YELLOW  — marker 404 + repo exists (bootstrap in progress)
//   YELLOW  — marker 200 but stale vs --since (guardrail c)
//   YELLOW  — marker 200 but invalid JSON
//   RED     — marker 404 + repo 404 (fork not found)
//   RED     — network failure
// plus input handling: stdin, -f file, roster-CSV auto-detect, comments.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const SCRIPT = join(REPO_ROOT, "scripts", "workshop-fleet-check.sh");

let workDir;

/** ISO8601 UTC without fractional seconds. */
function isoSecondsAgo(seconds) {
  return new Date(Date.now() - seconds * 1000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");
}

/**
 * Build a stub `curl` that dispatches on URL substrings.
 *
 * @param {Array<{match: string, code: number, body?: string}>} routes
 *   First route whose `match` is a substring of the requested URL wins.
 *   Unmatched URLs exit 7 (curl's could-not-connect) to surface surprises.
 */
function makeCurlStub(routes) {
  const dir = mkdtempSync(join(workDir, "stub-"));
  const cases = routes
    .map((r, i) => {
      const bodyFile = join(dir, `body-${i}`);
      writeFileSync(bodyFile, r.body ?? "");
      return `  *"${r.match}"*) code=${r.code}; bodyfile="${bodyFile}" ;;`;
    })
    .join("\n");

  const body = `#!/bin/bash
# Stub curl for workshop-fleet-check tests — dispatches on the URL.
out=""
url=""
args=("$@")
i=0
while [ $i -lt \${#args[@]} ]; do
  a="\${args[$i]}"
  case "$a" in
    -o) i=$((i+1)); out="\${args[$i]}" ;;
    -w|-H) i=$((i+1)) ;;
    -*) ;;
    http://*|https://*) url="$a" ;;
  esac
  i=$((i+1))
done
code=""
bodyfile=""
case "$url" in
${cases}
  *) exit 7 ;;
esac
if [ -n "$out" ] && [ "$out" != "/dev/null" ]; then
  cat "$bodyfile" > "$out"
fi
printf '%s' "$code"
exit 0
`;
  const curlPath = join(dir, "curl");
  writeFileSync(curlPath, body);
  chmodSync(curlPath, 0o755);
  return dir;
}

/** Run the fleet-check with stubbed curl, given stdin and extra args. */
function runCheck(stubDir, { stdin = "", args = [] } = {}) {
  const res = spawnSync("/bin/bash", [SCRIPT, ...args], {
    encoding: "utf8",
    input: stdin,
    env: {
      ...process.env,
      PATH: [stubDir, process.env.PATH].join(":"),
      GITHUB_TOKEN: "",
    },
  });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function marker(overrides = {}) {
  return JSON.stringify({
    schema_version: "1",
    completed_at: isoSecondsAgo(60),
    version: "1.8.0",
    mode: "solo",
    duration_seconds: 123,
    ...overrides,
  });
}

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "fleet-check-test-"));
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("classification", () => {
  it("GREEN when the marker exists and parses (duration + mode echoed)", () => {
    const stub = makeCurlStub([
      { match: "raw.githubusercontent.com/owner/done/main/", code: 200, body: marker() },
    ]);
    const { status, stdout } = runCheck(stub, { stdin: "owner/done\n" });
    expect(status).toBe(0);
    expect(stdout).toContain("GREEN owner/done (123s, mode=solo)");
    expect(stdout).toContain("Summary: 1 green / 0 yellow / 0 red (1 forks)");
  });

  it("GREEN echoes the optional workshop cohort when present", () => {
    const stub = makeCurlStub([
      {
        match: "raw.githubusercontent.com/owner/cohort/main/",
        code: 200,
        body: marker({ workshop: "2026-10-nashville" }),
      },
    ]);
    const { stdout } = runCheck(stub, { stdin: "owner/cohort\n" });
    expect(stdout).toContain("GREEN owner/cohort (123s, mode=solo, workshop=2026-10-nashville)");
  });

  it("GREEN renders a null duration_seconds as ?s (marker written without a timing signal)", () => {
    const stub = makeCurlStub([
      {
        match: "raw.githubusercontent.com/owner/notime/main/",
        code: 200,
        body: marker({ duration_seconds: null }),
      },
    ]);
    const { stdout } = runCheck(stub, { stdin: "owner/notime\n" });
    expect(stdout).toContain("GREEN owner/notime (?s, mode=solo)");
  });

  it("YELLOW when the fork exists but the marker is missing on both branches", () => {
    const stub = makeCurlStub([
      { match: "raw.githubusercontent.com/owner/wip/main/", code: 404 },
      { match: "raw.githubusercontent.com/owner/wip/gembaflow/bootstrap-marker/", code: 404 },
      { match: "api.github.com/repos/owner/wip", code: 200, body: "{}" },
    ]);
    const { stdout } = runCheck(stub, { stdin: "owner/wip\n" });
    expect(stdout).toContain("YELLOW owner/wip (marker missing — bootstrap in progress?)");
    expect(stdout).toContain("Summary: 0 green / 1 yellow / 0 red (1 forks)");
  });

  it("RED when the fork itself does not exist (marker 404 on both branches + repo 404)", () => {
    const stub = makeCurlStub([
      { match: "raw.githubusercontent.com/owner/ghost/main/", code: 404 },
      { match: "raw.githubusercontent.com/owner/ghost/gembaflow/bootstrap-marker/", code: 404 },
      { match: "api.github.com/repos/owner/ghost", code: 404, body: "{}" },
    ]);
    const { stdout } = runCheck(stub, { stdin: "owner/ghost\n" });
    expect(stdout).toContain("RED owner/ghost (fork not found)");
    expect(stdout).toContain("Summary: 0 green / 0 yellow / 1 red (1 forks)");
  });

  it("GREEN with annotation when the marker lives on the fallback branch (main push blocked by ruleset)", () => {
    const stub = makeCurlStub([
      { match: "raw.githubusercontent.com/owner/protected/main/", code: 404 },
      {
        match: "raw.githubusercontent.com/owner/protected/gembaflow/bootstrap-marker/",
        code: 200,
        body: marker(),
      },
    ]);
    const { status, stdout } = runCheck(stub, { stdin: "owner/protected\n" });
    expect(status).toBe(0);
    expect(stdout).toContain("GREEN owner/protected (123s, mode=solo, marker on fallback branch)");
    expect(stdout).toContain("Summary: 1 green / 0 yellow / 0 red (1 forks)");
  });

  it("fallback-branch marker still honors --since staleness (YELLOW stale, not GREEN)", () => {
    const stub = makeCurlStub([
      { match: "raw.githubusercontent.com/owner/oldfb/main/", code: 404 },
      {
        match: "raw.githubusercontent.com/owner/oldfb/gembaflow/bootstrap-marker/",
        code: 200,
        body: marker({ completed_at: isoSecondsAgo(7200) }),
      },
    ]);
    const { stdout } = runCheck(stub, {
      stdin: "owner/oldfb\n",
      args: ["--since", isoSecondsAgo(3600)],
    });
    expect(stdout).toContain("YELLOW owner/oldfb (stale marker from");
    expect(stdout).not.toContain("GREEN owner/oldfb");
  });

  it("default-branch marker wins — no fallback annotation when main has the marker", () => {
    const stub = makeCurlStub([
      { match: "raw.githubusercontent.com/owner/done/main/", code: 200, body: marker() },
    ]);
    const { stdout } = runCheck(stub, { stdin: "owner/done\n" });
    expect(stdout).toContain("GREEN owner/done (123s, mode=solo)");
    expect(stdout).not.toContain("marker on fallback branch");
  });

  it("YELLOW (stale) when the marker predates --since; GREEN without --since", () => {
    const staleBody = marker({ completed_at: isoSecondsAgo(7200) });
    const stub = makeCurlStub([
      { match: "raw.githubusercontent.com/owner/stale/main/", code: 200, body: staleBody },
    ]);
    const since = isoSecondsAgo(3600); // session started an hour ago

    const withSince = runCheck(stub, { stdin: "owner/stale\n", args: ["--since", since] });
    expect(withSince.stdout).toContain("YELLOW owner/stale (stale marker from");
    expect(withSince.stdout).toContain("predates session start)");

    const withoutSince = runCheck(stub, { stdin: "owner/stale\n" });
    expect(withoutSince.stdout).toContain("GREEN owner/stale");
  });

  it("GREEN when the marker is fresher than --since", () => {
    const stub = makeCurlStub([
      {
        match: "raw.githubusercontent.com/owner/fresh/main/",
        code: 200,
        body: marker({ completed_at: isoSecondsAgo(60) }),
      },
    ]);
    const { stdout } = runCheck(stub, {
      stdin: "owner/fresh\n",
      args: ["--since", isoSecondsAgo(3600)],
    });
    expect(stdout).toContain("GREEN owner/fresh");
  });

  it("YELLOW when the marker fetch returns 200 but invalid JSON", () => {
    const stub = makeCurlStub([
      { match: "raw.githubusercontent.com/owner/garbled/main/", code: 200, body: "<html>not json" },
    ]);
    const { stdout } = runCheck(stub, { stdin: "owner/garbled\n" });
    expect(stdout).toContain("YELLOW owner/garbled (marker unreadable — invalid JSON)");
  });

  it("RED on network failure (curl could not connect)", () => {
    const stub = makeCurlStub([]); // every URL exits 7
    const { status, stdout } = runCheck(stub, { stdin: "owner/unreachable\n" });
    expect(status).toBe(0);
    expect(stdout).toContain("RED owner/unreachable (fetch failed");
  });
});

describe("input handling", () => {
  it("accepts the workshop-provision roster CSV via -f (header skipped, repo_slug extracted)", () => {
    const stub = makeCurlStub([
      { match: "raw.githubusercontent.com/ws/attendee-1/main/", code: 200, body: marker() },
      { match: "raw.githubusercontent.com/ws/attendee-2/main/", code: 404 },
      { match: "api.github.com/repos/ws/attendee-2", code: 200, body: "{}" },
    ]);
    const csv = join(workDir, "roster.csv");
    writeFileSync(
      csv,
      "username,repo_slug,render_service_id,supabase_project_ref,status\n" +
        "alice,ws/attendee-1,srv-1,ref-1,provisioned\n" +
        "bob,ws/attendee-2,srv-2,ref-2,provisioned\n",
    );
    const { status, stdout } = runCheck(stub, { args: ["-f", csv] });
    expect(status).toBe(0);
    expect(stdout).toContain("GREEN ws/attendee-1");
    expect(stdout).toContain("YELLOW ws/attendee-2");
    expect(stdout).toContain("Summary: 1 green / 1 yellow / 0 red (2 forks)");
  });

  it("skips blank lines and #-comments; CRLF input is tolerated", () => {
    const stub = makeCurlStub([
      { match: "raw.githubusercontent.com/owner/done/main/", code: 200, body: marker() },
    ]);
    const { stdout } = runCheck(stub, {
      stdin: "# cohort roster\r\n\r\nowner/done\r\n",
    });
    expect(stdout).toContain("GREEN owner/done");
    expect(stdout).toContain("(1 forks)");
  });

  it("warns and skips malformed non-slug lines without dying", () => {
    const stub = makeCurlStub([
      { match: "raw.githubusercontent.com/owner/done/main/", code: 200, body: marker() },
    ]);
    const { status, stdout, stderr } = runCheck(stub, {
      stdin: "not-a-slug\nowner/done\n",
    });
    expect(status).toBe(0);
    expect(stderr).toContain("skipping unrecognized line: not-a-slug");
    expect(stdout).toContain("(1 forks)");
  });

  it("exits 2 with usage on unknown arguments", () => {
    const stub = makeCurlStub([]);
    const { status, stderr } = runCheck(stub, { args: ["--bogus"], stdin: "" });
    expect(status).toBe(2);
    expect(stderr).toContain("unknown argument");
  });

  it("exits 2 on an unparseable --since", () => {
    const stub = makeCurlStub([]);
    const { status, stderr } = runCheck(stub, { args: ["--since", "yesterday"], stdin: "" });
    expect(status).toBe(2);
    expect(stderr).toContain("could not parse");
  });

  it("honors --branch when building the raw URL", () => {
    const stub = makeCurlStub([
      { match: "raw.githubusercontent.com/owner/done/develop/", code: 200, body: marker() },
    ]);
    const { stdout } = runCheck(stub, { stdin: "owner/done\n", args: ["--branch", "develop"] });
    expect(stdout).toContain("GREEN owner/done");
  });
});
