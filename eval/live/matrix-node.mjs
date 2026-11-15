// A frame through every project the live site offers, sent the way the Figma plugin sends it (the frame's REST JSON
// and its picture), so no Figma API call is made. One run at a time, at most one start every 6.5 minutes (the site's
// limit is 10 runs an hour), within a budget. Writes full reports to matrix-node-<time>.json. Never prints the code.
// usage: node matrix-node.mjs <budget dollars> [project ids…]
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire("C:/Users/Afiyat/Tulpar/package.json");
const { PNG } = require("pngjs");

const SITE = "https://tulparsi.com";
const out = process.env.BENCH_OUT ?? import.meta.dirname;
const env = readFileSync("C:/Users/Afiyat/Tulpar/.env", "utf8");
const accessCode = /^TULPAR_ACCESS_CODES=(.*)$/m.exec(env)?.[1]?.trim().replace(/^["']|["']$/g, "").split(",")[0]?.trim();
if (!accessCode) throw new Error("no invite code in .env");
const budget = Number(process.argv[2]);
const only = process.argv.slice(3);
const cost = (u) => ((u?.inputTokens ?? 0) + (u?.outputTokens ?? 0)) * 0.00007;

// The "Tomato" product card from Figma basics' Product page, cut from the cached page and its cached picture.
const cache = "C:/Users/Afiyat/Tulpar/.cache/figma/YI0iMSOjTzMgKegxEetqvm";
const entry = JSON.parse(readFileSync(`${cache}/nodes/4368-321189.json`, "utf8")).entry;
const page = entry.document;
const find = (n) => (n.id === "4368:321208" ? n : (n.children ?? []).map(find).find(Boolean));
const card = find(page);
const pb = page.absoluteBoundingBox;
const cb = card.absoluteBoundingBox;
const full = PNG.sync.read(readFileSync(`${cache}/images/4368-321189@1x.png`));
const crop = new PNG({ width: cb.width, height: cb.height });
PNG.bitblt(full, crop, cb.x - pb.x, cb.y - pb.y, cb.width, cb.height, 0, 0);
const image = `data:image/png;base64,${PNG.sync.write(crop).toString("base64")}`;
const figmaNode = { document: card, components: entry.components ?? {}, componentSets: entry.componentSets ?? {}, styles: entry.styles ?? {} };

const config = await (await fetch(`${SITE}/api/config`)).json();
const projects = config.projects.filter((p) => !only.length || only.includes(p.id));
const results = [];
const runAt = new Date().toISOString();
const stamp = runAt.replace(/[:.]/g, "-");
let spent = 0;
let lastStart = 0;
for (const project of projects) {
  if (spent + 1.2 > budget) {
    console.log(`STOP before ${project.id}: spent ~$${spent.toFixed(2)} of $${budget}`);
    break;
  }
  const wait = lastStart + 6.5 * 60_000 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastStart = Date.now();
  const started = Date.now();
  const res = await fetch(`${SITE}/api/jobs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ project: project.id, figmaUrl: "", figmaNode, image, name: "ProductCard", scale: "1", accessCode }) });
  const data = await res.json();
  if (!res.ok) {
    console.log(`${project.id}: refused ${res.status}: ${data.error}`);
    results.push({ project: project.id, refused: data.error });
    continue;
  }
  let job;
  for (;;) {
    await new Promise((r) => setTimeout(r, 4000));
    const r = await fetch(`${SITE}/api/jobs/${data.id}`).catch(() => undefined);
    if (r?.status === 404) break;
    if (!r?.ok) continue;
    job = await r.json();
    if (job.state !== "queued" && job.state !== "running") break;
    if (Date.now() - started > 40 * 60_000) break;
  }
  const r = job?.result ?? {};
  const c = cost(r.usage);
  spent += c;
  const failing = (r.report?.checks ?? []).filter((x) => x.status === "fail").map((x) => `${x.id}: ${x.summary}`);
  results.push({ job: data.id, project: project.id, label: project.label, state: job?.state, status: r.status, verdict: r.report?.verdict, seconds: Math.round((Date.now() - started) / 1000), attempts: r.attempts?.length, cost: Math.round(c * 100) / 100, report: r.report, files: r.files, attemptsFailing: r.attempts?.map((a) => a.failing), attemptsDetails: r.attempts?.map((a) => a.details), events: job?.events?.map((e) => e.text), error: job?.error });
  console.log(`${project.id.padEnd(18)} ${String(r.report?.verdict ?? job?.state ?? "lost").padEnd(10)} ${Math.round((Date.now() - started) / 1000)}s ~$${c.toFixed(2)} ${failing.join(" | ").slice(0, 260)}${job?.error ? ` ERROR ${job.error.slice(0, 160)}` : ""}`);
  writeFileSync(join(out, "matrix-node-latest.json"), JSON.stringify({ results }, null, 1));
  writeFileSync(join(out, `bench-${stamp}.json`), JSON.stringify({ at: runAt, results }, null, 1));
}
console.log(`SPENT ~$${spent.toFixed(2)}; written ${join(out, "matrix-node-latest.json")}`);
