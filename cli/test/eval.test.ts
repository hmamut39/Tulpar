// The eval scorecard: per case, pass rates per check, and the change since the previous run.

import { describe, expect, it } from "vitest";
import { summary, type EvalRun } from "../src/eval.ts";

const run = (at: string, results: EvalRun["results"]): EvalRun => ({ at, model: "m", results });
const result = (id: string, status: EvalRun["results"][number]["status"], checks: Record<string, boolean>) => ({ id, status, attempts: 1, inputTokens: 100, outputTokens: 50, seconds: 10, checks });

describe("eval scorecard", () => {
  it("scores cases and checks, and compares with the previous run on the same cases", () => {
    const before = run("t0", [result("a", "failed", { layout: false, visual: true }), result("b", "verified", { layout: true, visual: true }), result("gone", "failed", { layout: false })]);
    const now = run("t1", [result("a", "verified", { layout: true, visual: true }), result("b", "failed", { layout: true, visual: false })]);
    const text = summary(now, before);
    expect(text).toMatch(/1\/2 cases with no failing check \(same as last run\) · 300 tokens · 2 attempts/);
    expect(text).toMatch(/✓ a: verified, 1 attempt/);
    expect(text).toMatch(/✗ b: failed \(failing: visual\)/);
    // "gone" is not in this run, so it does not weigh on the comparison.
    expect(text).toMatch(/layout\s+100% \(\+50 points since last run\)/);
    expect(text).toMatch(/visual\s+50% \(-50 points since last run\)/);
  });

  it("has no comparison on the first run", () => {
    expect(summary(run("t0", [result("a", "verified", { layout: true })]))).not.toMatch(/since last run|same as last run/);
  });
});
