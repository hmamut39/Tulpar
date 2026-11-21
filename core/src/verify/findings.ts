// A report's failures as data an agent can act on: which check, which element, what is wrong, and what fixes it.
// The checks write each failure as one line, "✗ <element> (<figma id>): <what differs> — <the fix>"; this reads
// those lines back, so an agent calling Tulpar (MCP, the API, CI) gets fields instead of prose to parse.

import type { VerifyReport } from "./verify.ts";

export interface Finding {
  /** The check that failed (layout, colors, type, safety…). */
  check: string;
  /** The design element it is about, when the failure names one. */
  element?: { id: string; name: string };
  /** What is wrong. */
  problem: string;
  /** What fixes it, when the check says (a token, a value, the element to fix first). */
  fix?: string;
}

const NAMED = /^(.+?) \(([\w:;.-]+)\): ([\s\S]*)$/;

/** Every failing line of the report's failing checks, as a finding. */
export function findingsOf(report: Pick<VerifyReport, "checks">): Finding[] {
  return report.checks
    .filter((c) => c.status === "fail")
    .flatMap((c) => {
      const lines = c.details.filter((d) => d.startsWith("✗")).map((d) => d.replace(/^✗\s*/, ""));
      // A failing check with no line of its own (the build, a test run) is one finding: its summary.
      if (!lines.length) return [{ check: c.id, problem: c.summary }];
      return lines.map((line): Finding => {
        const named = NAMED.exec(line);
        const body = named ? named[3]! : line;
        const at = body.indexOf(" — ");
        const problem = (at < 0 ? body : body.slice(0, at)).trim();
        const fix = at < 0 ? undefined : body.slice(at + 3).trim();
        return { check: c.id, ...(named && { element: { id: named[2]!, name: named[1]! } }), problem, ...(fix && { fix }) };
      });
    });
}
