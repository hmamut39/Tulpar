// tulpar verify <projectDir> <implementation> --frame <nodeId> [--theme white]

import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { VerifyReport } from "@tulpar/core";
import { loadContext, verifyEntry } from "./pipeline.ts";
import { loadProject, withAdapter } from "./project.ts";

export interface VerifyOptions {
  frame: string;
  theme?: string;
  out: string;
  cache: string;
  /** Print nothing; the caller reads the returned report. */
  quiet?: boolean;
}

export async function verifyCommand(projectDir: string, entry: string, options: VerifyOptions): Promise<{ code: number; report?: VerifyReport }> {
  const project = await loadProject(projectDir);
  let result: { report: VerifyReport; png?: string };
  try {
    result = await withAdapter(project, async (host) => {
      const ctx = await loadContext(host, project, { frame: options.frame, ...(process.env.FIGMA_TOKEN && { figmaToken: process.env.FIGMA_TOKEN }) }, options.out, options.cache);
      return verifyEntry(host, project, ctx, entry, options.theme);
    });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return { code: 2 };
  }
  const { report, png } = result;

  const out = join(options.out, basename(project.root), "verify", basename(entry).replace(/\.[^.]+$/, ""));
  await mkdir(out, { recursive: true });
  await writeFile(join(out, "report.json"), JSON.stringify(report, null, 2));
  if (png) await writeFile(join(out, "render.png"), Buffer.from(png, "base64"));
  if (!options.quiet) {
    printReport(report);
    console.log(`\nWritten to ${out}`);
  }
  return { code: report.verdict === "pass" ? 0 : 1, report };
}

export function printReport(r: VerifyReport): void {
  const mark = { pass: "✓", fail: "✗", "not-checked": "–" } as const;
  console.log(`${r.frame.name} (${r.frame.id}, ${r.frame.width}×${r.frame.height})`);
  for (const c of r.checks) {
    console.log(`  ${mark[c.status]} ${c.status === "not-checked" ? `${c.title}: not checked (${c.summary})` : c.summary}`);
    for (const d of c.details.filter((d) => !d.startsWith("✓"))) console.log(`      ${d}`);
  }
  for (const w of r.warnings) console.log(`  ! ${w}`);
  console.log(`Verdict: ${r.verdict.toUpperCase()}${r.verdict === "incomplete" ? " (no check failed, but not everything could be checked)" : ""}`);
  if (r.renderer) console.log(`Rendered with ${r.renderer.name} ${r.renderer.version} on ${r.renderer.os}`);
}
