// A report's failures as data: check, element, problem, fix.

import { describe, expect, it } from "vitest";
import { findingsOf } from "../src/index.ts";

const check = (id: string, status: string, summary: string, details: string[] = []) => ({ id, title: id, status, summary, details });

describe("findings", () => {
  it("reads the element, what is wrong and the fix from each failing line", () => {
    const report = {
      checks: [
        check("layout", "fail", "layout within tolerance on 2/3 elements", [
          "✓ Title (900:2): within tolerance",
          '✗ $5.99 / lb (4368:321211): width 92 → 76 (-16) (tolerance ±3) — the design\'s text is 20px: use the type style of that size (var(--aura-line-height-xl))',
          "✗ Footer (2:1): x 0 → 8 (+8) (tolerance ±1)",
        ]),
        check("type", "fail", "1 token of the wrong kind", ["✗ lineHeight: var(--sl-font-size-x-large, 24px) — a font-size token used for lineHeight; use a line-height token"]),
        check("tests", "fail", "1 of 2 generated tests pass"),
        check("colors", "pass", "all from tokens", ["✗ never read: the check passed"]),
      ],
    };
    expect(findingsOf(report as never)).toEqual([
      { check: "layout", element: { id: "4368:321211", name: "$5.99 / lb" }, problem: "width 92 → 76 (-16) (tolerance ±3)", fix: "the design's text is 20px: use the type style of that size (var(--aura-line-height-xl))" },
      { check: "layout", element: { id: "2:1", name: "Footer" }, problem: "x 0 → 8 (+8) (tolerance ±1)" },
      { check: "type", problem: "lineHeight: var(--sl-font-size-x-large, 24px)", fix: "a font-size token used for lineHeight; use a line-height token" },
      { check: "tests", problem: "1 of 2 generated tests pass" },
    ]);
  });

  it("has none for a report with no failure", () => {
    expect(findingsOf({ checks: [check("layout", "pass", "ok"), check("tests", "not-checked", "no runner")] } as never)).toEqual([]);
  });
});
