// Saves each finished benchmark job's exact token usage (the site keeps a job for about an hour).
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const dir = import.meta.dirname;
const outFile = join(dir, "bench-usage.json");
const usage = existsSync(outFile) ? JSON.parse(readFileSync(outFile, "utf8")) : {};
for (;;) {
  const files = readdirSync(dir).filter((f) => /^bench-\d.*\.json$/.test(f)).sort();
  const results = files.length ? JSON.parse(readFileSync(join(dir, files.at(-1)), "utf8")).results : [];
  for (const r of results) {
    if (!r.job || usage[r.job]) continue;
    const res = await fetch(`https://tulparsi.com/api/jobs/${r.job}`).catch(() => undefined);
    if (!res?.ok) continue;
    const job = await res.json();
    if (job.result?.usage) {
      usage[r.job] = { project: r.project, ...job.result.usage, model: job.result.model };
      writeFileSync(outFile, JSON.stringify(usage, null, 1));
      console.log(r.project, JSON.stringify(job.result.usage));
    }
  }
  const log = readFileSync(join(dir, "bench-run.log"), "utf8");
  if (/^exit /m.test(log) && results.every((r) => !r.job || usage[r.job])) break;
  await new Promise((r) => setTimeout(r, 60_000));
}
