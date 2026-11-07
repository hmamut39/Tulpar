// tulpar verify-changed <projectDir> [changed files...] [--format text|github|json]
//
// The pull-request check: each component the project lists in tulpar.json's "verify" (its file and the Figma frame
// it implements) is built, drawn and compared with its frame when the pull request touches it, whoever wrote it.
// A component that fails fails the run; one with checks that could not run is reported, not failed.
//
//   "verify": [{ "entry": "src/SignInCard.tsx", "figma": "https://www.figma.com/design/…?node-id=12-34", "test": "src/SignInCard.test.tsx" }]

import { basename, dirname, join, relative, resolve } from "node:path";
import { parseFigmaUrl } from "@tulpar/core";
import { loadProject } from "./project.ts";
import { verifyCommand } from "./verify.ts";

export interface VerifyTarget {
  entry: string;
  /** A Figma frame link, or a node id with the project's file key. */
  figma?: string;
  frame?: string;
  test?: string;
}

export interface VerifyChangedOptions {
  out: string;
  cache: string;
  format?: "text" | "github" | "json";
}

// Card.tsx, Card.module.css, Card.test.tsx and Card.stories.tsx are all Card.
const stem = (f: string) => basename(f).replace(/(\.(test|spec|stories|module))?\.[^.]+$/, "");

/**
 * The targets a change touches: its entry, its test, or a file beside the entry with the same name (its stylesheet).
 * No changed files listed means every target.
 */
export function touched(targets: VerifyTarget[], changed: string[], projectDir: string): VerifyTarget[] {
  if (!changed.length) return targets;
  const files = changed.map((f) => resolve(f).replace(/\\/g, "/"));
  return targets.filter((t) => {
    const entry = resolve(projectDir, t.entry).replace(/\\/g, "/");
    const test = t.test ? resolve(projectDir, t.test).replace(/\\/g, "/") : undefined;
    return files.some((f) => f === entry || f === test || (dirname(f) === dirname(entry) && stem(f) === stem(entry)));
  });
}

export function frameOf(t: VerifyTarget): string | undefined {
  return t.frame ?? (t.figma ? parseFigmaUrl(t.figma)?.nodeId : undefined);
}

export async function verifyChangedCommand(projectDir: string, changed: string[], options: VerifyChangedOptions): Promise<number> {
  const project = await loadProject(projectDir);
  const targets = ((project.config as { verify?: VerifyTarget[] }).verify ?? []).filter((t) => t && typeof t.entry === "string");
  const format = options.format ?? "text";
  if (!targets.length) {
    console.log('No components to verify: list them in tulpar.json under "verify" (entry and figma link).');
    return 0;
  }
  // Changed files arrive relative to the repository (the working directory), not to the project.
  const picked = touched(targets, changed.map((f) => resolve(f)), project.root);
  if (!picked.length) {
    console.log("No listed component changed.");
    return 0;
  }
  let failed = 0;
  const results: { entry: string; verdict: string; failing: string[] }[] = [];
  for (const t of picked) {
    const frame = frameOf(t);
    const file = relative(process.cwd(), join(project.root, t.entry)).replace(/\\/g, "/");
    if (!frame) {
      failed++;
      results.push({ entry: t.entry, verdict: "error", failing: ["no Figma frame: give it a figma link with node-id"] });
      if (format === "github") console.log(`::error file=${file},title=Tulpar verify::No Figma frame for ${t.entry}: give it a figma link with node-id.`);
      continue;
    }
    const { report } = await verifyCommand(project.root, t.entry, { frame, out: options.out, cache: options.cache, quiet: format !== "text", ...(t.test && { test: t.test }) });
    const failing = (report?.checks ?? []).filter((c) => c.status === "fail").map((c) => `${c.title}: ${c.summary}`);
    const verdict = report?.verdict ?? "error";
    if (verdict === "fail" || verdict === "error") failed++;
    results.push({ entry: t.entry, verdict, failing });
    if (format === "github") {
      if (verdict === "fail") for (const f of failing) console.log(`::error file=${file},title=Tulpar verify::${f}`);
      else if (verdict === "error") console.log(`::error file=${file},title=Tulpar verify::It could not be built or drawn.`);
      else if (verdict === "incomplete") console.log(`::warning file=${file},title=Tulpar verify::No check failed; some could not run.`);
      else console.log(`::notice file=${file},title=Tulpar verify::Matches its Figma frame.`);
    }
  }
  if (format === "json") console.log(JSON.stringify({ results }));
  console.log(`${picked.length} component(s) verified against Figma: ${failed ? `${failed} failed` : "none failed"}`);
  return failed ? 1 : 0;
}
