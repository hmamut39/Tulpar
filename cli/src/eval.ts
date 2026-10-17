// tulpar eval [--only <id,id>] [--cases eval/cases.json]
//
// The eval benchmark: the same designs on every run (eval/cases.json), across frameworks and styling,
// generated and verified as a user's run would be. For each case: the verdict, which checks passed, the
// attempts, the tokens and the time; for the run: pass rates per check, compared with the previous run.
// Results go to eval/results/<timestamp>.json. Every case calls the model: a run costs money.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { tokenCost, type OutputChoice } from "@tulpar/core";
import { generateCommand } from "./generate.ts";

interface EvalCase {
  id: string;
  project: string;
  name: string;
  frame?: string;
  image?: string;
  output?: OutputChoice;
}

export interface CaseResult {
  id: string;
  status: "verified" | "unchecked-remain" | "failed" | "error";
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  seconds: number;
  /** Check id → passed (true), failed (false); not-checked checks are left out. */
  checks: Record<string, boolean>;
  error?: string;
}

export interface EvalRun {
  at: string;
  model?: string;
  results: CaseResult[];
}

export async function evalCommand(options: { casesFile?: string; only?: string[]; out?: string; cache?: string } = {}): Promise<number> {
  const casesFile = resolve(options.casesFile ?? "eval/cases.json");
  const all = (JSON.parse(readFileSync(casesFile, "utf8")) as { cases: EvalCase[] }).cases;
  const cases = options.only?.length ? all.filter((c) => options.only!.includes(c.id)) : all;
  if (!cases.length) {
    console.error(`No cases${options.only ? ` named ${options.only.join(", ")}` : ""} in ${casesFile}.`);
    return 2;
  }
  console.log(`Running ${cases.length} case(s); each calls the model.`);
  const results: CaseResult[] = [];
  let model: string | undefined;
  for (const c of cases) {
    const started = Date.now();
    process.stdout.write(`  ${c.id} … `);
    try {
      const outcome = await generateCommand(c.project, {
        name: c.name,
        out: options.out ?? "out",
        cache: options.cache ?? ".cache/figma",
        quiet: true,
        resultsDir: join(tmpdir(), "tulpar-eval", c.id),
        ...(c.frame && { frame: c.frame }),
        ...(c.image && { image: resolve(c.image) }),
        ...(c.output && { output: c.output }),
      });
      const r = outcome.result;
      model ??= r?.model;
      const checks: Record<string, boolean> = {};
      for (const check of r?.report?.checks ?? []) if (check.status !== "not-checked") checks[check.id] = check.status === "pass";
      results.push({
        id: c.id,
        status: r ? r.status : "error",
        attempts: r?.attempts.length ?? 0,
        inputTokens: r?.usage.inputTokens ?? 0,
        outputTokens: r?.usage.outputTokens ?? 0,
        seconds: Math.round((Date.now() - started) / 1000),
        checks,
        ...(outcome.error && { error: outcome.error }),
      });
    } catch (err) {
      results.push({ id: c.id, status: "error", attempts: 0, inputTokens: 0, outputTokens: 0, seconds: Math.round((Date.now() - started) / 1000), checks: {}, error: (err as Error).message });
    }
    const last = results.at(-1)!;
    console.log(`${last.status}${last.error ? ` (${last.error.split("\n")[0]})` : ""}, ${last.attempts} attempt(s), ${last.seconds}s`);
  }

  const run: EvalRun = { at: new Date().toISOString(), ...(model && { model }), results };
  const dir = resolve("eval/results");
  const previous = latestRun(dir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${run.at.replace(/[:.]/g, "-")}.json`), JSON.stringify(run, null, 2) + "\n");
  console.log("");
  console.log(summary(run, previous));
  return results.some((r) => r.status === "error") ? 1 : 0;
}

/** The scorecard: per case, then pass rates per check, each compared with the previous run where it ran the same case. */
export function summary(run: EvalRun, previous?: EvalRun): string {
  const lines: string[] = [];
  const passed = run.results.filter((r) => r.status === "verified" || r.status === "unchecked-remain").length;
  const tokens = run.results.reduce((n, r) => n + r.inputTokens + r.outputTokens, 0);
  const prevRate = previous ? rate(previous.results.filter((p) => run.results.some((r) => r.id === p.id)), (r) => r.status === "verified" || r.status === "unchecked-remain") : undefined;
  lines.push(`Eval ${run.at}${run.model ? ` · ${run.model}` : ""}`);
  const cost = tokenCost({ inputTokens: run.results.reduce((n, r) => n + r.inputTokens, 0), outputTokens: run.results.reduce((n, r) => n + r.outputTokens, 0) });
  lines.push(`  ${passed}/${run.results.length} cases with no failing check${delta(passed / run.results.length, prevRate)} · ${tokens.toLocaleString("en-US")} tokens${cost === undefined ? "" : ` (≈ $${cost.toFixed(2)})`} · ${run.results.reduce((n, r) => n + r.attempts, 0)} attempts`);
  for (const r of run.results) {
    const failing = Object.entries(r.checks).filter(([, ok]) => !ok).map(([id]) => id);
    lines.push(`  ${r.status === "verified" ? "✓" : r.status === "unchecked-remain" ? "–" : "✗"} ${r.id}: ${r.status}${failing.length ? ` (failing: ${failing.join(", ")})` : ""}, ${r.attempts} attempt(s)`);
  }
  const ids = [...new Set(run.results.flatMap((r) => Object.keys(r.checks)))].sort();
  lines.push("  Pass rate per check:");
  for (const id of ids) {
    const now = rate(run.results.filter((r) => id in r.checks), (r) => r.checks[id]!);
    const before = previous ? rate(previous.results.filter((r) => id in r.checks && run.results.some((x) => x.id === r.id)), (r) => r.checks[id]!) : undefined;
    lines.push(`    ${id.padEnd(11)} ${pct(now)}${delta(now, before)}`);
  }
  return lines.join("\n");
}

function rate<T>(items: T[], ok: (t: T) => boolean): number {
  return items.length ? items.filter(ok).length / items.length : 0;
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

function delta(now: number, before: number | undefined): string {
  if (before === undefined) return "";
  const d = Math.round((now - before) * 100);
  return d === 0 ? " (same as last run)" : ` (${d > 0 ? "+" : ""}${d} points since last run)`;
}

function latestRun(dir: string): EvalRun | undefined {
  if (!existsSync(dir)) return undefined;
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  return files.length ? (JSON.parse(readFileSync(join(dir, files.at(-1)!), "utf8")) as EvalRun) : undefined;
}
