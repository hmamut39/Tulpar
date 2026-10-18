// Generated Dart, formatted the way Dart is: `dart format`, the language's own formatter.
// Files it cannot parse come back as written, for the build to report.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { sdk } from "./sdk.ts";

export async function formatDart(root: string, files: { path: string; content: string }[]): Promise<{ path: string; content: string }[]> {
  const dart = files.filter((f) => f.path.endsWith(".dart"));
  if (!dart.length) return files;
  const dir = join(root, ".tulpar", "flutter", "format", randomUUID());
  try {
    for (const f of dart) {
      mkdirSync(dirname(join(dir, f.path)), { recursive: true });
      writeFileSync(join(dir, f.path), f.content);
    }
    const run = await sdk("dart", ["format", "."], dir, 120_000);
    if (run.code !== 0) return files;
    return files.map((f) => (f.path.endsWith(".dart") ? { ...f, content: readFileSync(join(dir, f.path), "utf8") } : f));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
