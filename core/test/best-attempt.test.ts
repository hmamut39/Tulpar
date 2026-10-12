// The attempt delivered when none passes: the one closest to the design, never a blank page.

import { describe, expect, it } from "vitest";
import { bestAttempt, type VerifyReport } from "../src/index.ts";

const report = (fails: string[], skips: string[] = []) =>
  ({ verdict: "fail", checks: [...fails.map((id) => ({ id, status: "fail" })), ...skips.map((id) => ({ id, status: "skip" }))] }) as unknown as VerifyReport;

describe("best attempt", () => {
  it("is the one with the fewest failing checks, the later on a tie", () => {
    const a = { rejected: [], report: report(["layout", "pixels", "fonts"]) };
    const b = { rejected: [], report: report(["layout", "pixels"]) };
    const c = { rejected: [], report: report(["pixels", "text"]) };
    expect(bestAttempt([a, b, c])).toBe(c);
  });

  it("is never one that crashed: its skipped checks are not passes", () => {
    const drew = { rejected: [], report: report(["components", "layout", "fonts", "pixels"]) };
    const crashed = { rejected: [], report: report(["render"], ["components", "layout", "pixels"]) };
    expect(bestAttempt([drew, crashed])).toBe(drew);
  });
});
