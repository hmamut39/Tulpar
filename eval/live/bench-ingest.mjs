// Turns a recorded live run (bench-<time>.json + bench-usage.json) into eval/results/<time>.json, the
// benchmark's format: per case, its status, attempts, seconds, exact tokens, and each check that ran.
// usage: node bench-ingest.mjs bench-<time>.json
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = import.meta.dirname;
const run = JSON.parse(readFileSync(join(dir, process.argv[2]), "utf8"));
const usage = JSON.parse(readFileSync(join(dir, "bench-usage.json"), "utf8"));
const results = [];
let model;
for (const r of run.results) {
  if (!r.job || !r.report) {
    console.log(`skip ${r.project}: ${r.refused ?? r.error ?? r.state ?? "no report"}`);
    continue;
  }
  const u = usage[r.job];
  if (!u) console.log(`no usage saved for ${r.project}: tokens left out`);
  model ??= u?.model;
  results.push({
    id: `${process.env.CASE_PREFIX ?? "card"}-${r.project}`,
    status: r.status,
    attempts: r.attempts,
    inputTokens: u?.inputTokens,
    outputTokens: u?.outputTokens,
    seconds: r.seconds,
    checks: Object.fromEntries(r.report.checks.filter((c) => c.status !== "not-checked").map((c) => [c.id, c.status === "pass"])),
  });
}
const at = run.at;
const file = join("C:/Users/Afiyat/Tulpar/eval/results", `${at.replace(/[:.]/g, "-")}.json`);
writeFileSync(file, JSON.stringify({ at, model: `openai:${model}`.replace(/^openai:openai:/, "openai:"), source: "live site (tulparsi.com), sent as the Figma plugin sends a frame", results }, null, 2) + "\n");
console.log(`${results.length} cases → ${file}`);
for (const r of results) console.log(`${r.id.padEnd(24)} ${r.status.padEnd(16)} failing: ${Object.entries(r.checks).filter(([, ok]) => !ok).map(([k]) => k).join(", ") || "none"}`);
