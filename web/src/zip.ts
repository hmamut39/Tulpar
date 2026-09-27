// A zip of the generated files, for download.

import { strToU8, zipSync } from "fflate";

export function zipFiles(files: { path: string; content: string }[]): Buffer {
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) entries[f.path] = strToU8(f.content);
  return Buffer.from(zipSync(entries, { level: 6 }));
}
