// tulpar match <projectDir> [--evaluate]

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { OpenAiLlm, createMatcher, evaluate, evaluateRerank, labelled, matchLibrary, type Evaluation, type Library, type MatchResult, type RerankEvaluation } from "@tulpar/core";
import { loadProject, withAdapter } from "./project.ts";

export async function match(projectDir: string, outDir: string, doEvaluate: boolean, doRerank = false): Promise<number> {
  const project = await loadProject(projectDir);
  const libraryPath = join(outDir, "library.json");
  if (!existsSync(libraryPath)) {
    console.error(`No Figma library at ${libraryPath}. Run \`tulpar library ${project.config.figma?.fileKey ?? "<fileKey>"}\` first.`);
    return 2;
  }
  const library: Library = JSON.parse(await readFile(libraryPath, "utf8"));
  const { index, links } = await withAdapter(project, async (host) => ({
    index: await host.call("index", project.params),
    links: host.manifest!.capabilities.links ? await host.call("links", project.params) : undefined,
  }));
  const out = join(outDir, basename(project.root));
  await mkdir(out, { recursive: true });

  console.log(`Figma library: ${library.components.length} components (${library.source.fileName})`);
  console.log(`Code index: ${index.components.length} components (${index.package?.name ?? index.adapter})`);
  console.log(`Explicit links: ${links ? `${links.links.length} from ${new Set(links.links.map((l) => l.source)).size} files` : "not checked (adapter cannot read them)"}`);
  for (const g of links?.gaps ?? []) console.log(`  – ${g}`);

  if (doEvaluate) {
    if (!links?.links.length) {
      console.log("\n– evaluation: not checked (no explicit links to score against)");
      return 1;
    }
    const results: Evaluation[] = [];
    // Labels looked at during development are reported, but only held-out ones measure the matcher.
    const dev = new Set((project.config.evaluation as { developmentSet?: string[] } | undefined)?.developmentSet ?? []);
    const heldOut = new Set(library.components.map((c) => c.id).filter((id) => !dev.has(id)));
    for (const mode of ["prior", "leave-one-out"] as const) {
      for (const subset of dev.size ? (["all", "held-out"] as const) : (["all"] as const)) {
        const e = evaluate(library, index, links.links, mode, subset === "held-out" ? { scoreOnly: heldOut } : {});
        results.push(e);
        printEvaluation(e);
      }
    }
    if (dev.size) console.log(`\n${dev.size} labels are the development set: the matcher was tuned while looking at them.`);
    await writeFile(join(out, "evaluation.json"), JSON.stringify(results, null, 2));
    console.log(`\nWritten to ${join(out, "evaluation.json")}`);
    if (doRerank) {
      const llm = OpenAiLlm.fromEnv();
      if (!llm) {
        console.log("\n– re-ranking: not checked (no OPENAI_API_KEY)");
        return 1;
      }
      const { items } = labelled(library, index, links.links);
      const prior = createMatcher(index);
      const rankings = new Map(items.map((it) => [it.def.id, prior.rank(it.def)]));
      const r = await evaluateRerank(items, rankings, index, llm);
      printRerank(r, llm.name);
      await writeFile(join(out, "rerank.json"), JSON.stringify(r, null, 2));
      console.log(`Written to ${join(out, "rerank.json")}`);
    }
    // The gate (Likely ≥ 95% precision) can only pass on a calibrated, large enough evaluation.
    return results.some((e) => e.calibration) ? 0 : 1;
  }

  const results = matchLibrary(library, index, { links: links?.links ?? [] });
  await writeFile(join(out, "matches.json"), JSON.stringify(results, null, 2));
  printMatches(results);
  console.log(`\nWritten to ${join(out, "matches.json")}`);
  return 0;
}

function printRerank(r: RerankEvaluation, model: string): void {
  const pct = (x: number, n = 1) => `${Math.round((x / (n || 1)) * 100)}%`;
  console.log(`\nRe-ranking the top 3 with ${model} (all ${r.labelled} labels; the model never sees them)`);
  console.log(`  top-1 correct: matcher ${pct(r.before.top1)} → with the model ${pct(r.after.top1)}`);
  console.log(`  model picked ${r.after.picked}, correct ${r.after.pickedCorrect} (${pct(r.after.pickedCorrect, r.after.picked)}); said none ${r.after.abstained}`);
  console.log(`  high confidence ${r.after.high}, correct ${r.after.highCorrect} (${pct(r.after.highCorrect, r.after.high)})`);
  console.log(`  tokens: ${r.usage.inputTokens} in, ${r.usage.outputTokens} out`);
  for (const c of r.changes) console.log(`  ${c.right ? "✓" : "✗"} ${c.figma}: matcher ${c.matcher}, model ${c.model ?? "none"} (${c.confidence}); expected ${c.expected.join(" | ")}`);
}

function printEvaluation(e: Evaluation): void {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  console.log(`\nEvaluation — ${e.mode}, ${e.subset === "held-out" ? "held-out labels only" : "all labels"} (labels hidden from the matcher)`);
  console.log(`  labelled Figma components scored: ${e.labelled}`);
  if (!e.labelled) return;
  for (const [why, n] of Object.entries(e.unusable)) console.log(`  – ${n} links not usable: ${why}`);
  console.log(`  top-1 correct: ${pct(e.top1)}, right answer in top 3: ${pct(e.top3)}`);
  for (const tier of ["likely", "possible", "unmatched"] as const) {
    const t = e.tiers[tier];
    console.log(`  ${tier.padEnd(9)} ${String(t.count).padStart(3)}${tier === "unmatched" ? "" : `, correct ${t.correct}${t.count ? ` (${pct(t.correct / t.count)})` : ""}`}`);
  }
  console.log(`  recall: ${pct(e.recall)}, abstained: ${pct(e.abstained)}`);
  if (e.calibration) console.log(`  calibration: fitted on ${e.calibration.fittedOn}; Likely at p ≥ ${e.calibration.likely.toFixed(2)}; ECE ${e.ece?.toFixed(3)}`);
  for (const n of e.notes) console.log(`  note: ${n}`);
  for (const err of e.errors.slice(0, 12)) {
    console.log(`  ✗ ${err.figma}: expected ${err.expected.join(" | ")}, got ${err.got ?? "nothing"}${err.score !== undefined ? ` (${err.score})` : ""} [${err.tier}]`);
  }
  if (e.errors.length > 12) console.log(`  … ${e.errors.length - 12} more`);
}

function printMatches(results: MatchResult[]): void {
  const count = (t: string) => results.filter((r) => r.tier === t).length;
  console.log(`\nMatches: ${count("verified")} verified, ${count("likely")} likely, ${count("possible")} possible, ${count("unmatched")} unmatched`);
  for (const r of results.filter((r) => !r.figma.private).slice(0, 25)) {
    const best = r.best ? `${r.best.component} (${r.best.score.toFixed(2)})` : "—";
    console.log(`  ${r.tier.padEnd(9)} ${r.figma.name.slice(0, 40).padEnd(40)} → ${best}   ${r.reason}`);
  }
}
