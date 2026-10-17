// Repository retrieval: how the team's own code already uses each design-system component, so a
// generation follows its conventions (the props it sets, how it lays components out). Lexical: the
// components' tags in the project's source files, read as written. No embeddings needed for this.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const SOURCE = /\.(tsx|jsx|vue|svelte|html)$/;
const SKIP = /^(node_modules|dist|build|out|coverage|\.tulpar|\.git|\.cache)$/;

/**
 * Up to `perComponent` uses of each named component, from different files where possible: the whole
 * opening tag (props and all), as the team wrote it. Generated files (.tulpar) and dependencies are skipped.
 */
export function codebaseExamples(root: string, components: string[], perComponent = 2): Record<string, { file: string; code: string }[]> {
  const out: Record<string, { file: string; code: string }[]> = {};
  const wanted = components.filter((c) => /^[A-Z][\w.]*$/.test(c) || /^[a-z]+-[\w-]+$/.test(c));
  if (!wanted.length) return out;
  const files = sourceFiles(root);
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    if (text.length > 200_000) continue;
    for (const name of wanted) {
      if ((out[name]?.length ?? 0) >= perComponent || !text.includes(`<${name}`)) continue;
      // One example per file per component: variety beats repetition.
      if (out[name]?.some((e) => e.file === relative(root, file).replace(/\\/g, "/"))) continue;
      const tag = openingTag(text, name);
      if (!tag) continue;
      (out[name] ??= []).push({ file: relative(root, file).replace(/\\/g, "/"), code: tag });
    }
    if (wanted.every((n) => (out[n]?.length ?? 0) >= perComponent)) break;
  }
  return out;
}

/** The first `<Name …>` opening tag in the text, whole (attributes may span lines and hold braces), whitespace collapsed. */
export function openingTag(text: string, name: string): string | undefined {
  const re = new RegExp(String.raw`<${name.replace(/\./g, "\\.")}(?=[\s/>])`, "g");
  for (let m = re.exec(text); m; m = re.exec(text)) {
    let depth = 0;
    let quote = "";
    for (let i = m.index + 1; i < text.length && i < m.index + 1500; i++) {
      const ch = text[i]!;
      if (quote) {
        if (ch === quote) quote = "";
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") quote = ch;
      else if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === ">" && depth === 0) {
        const tag = text.slice(m.index, i + 1).replace(/\s+/g, " ");
        return tag.length > 320 ? `${tag.slice(0, 317)}…>` : tag;
      }
    }
  }
  return undefined;
}

function sourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 8 || out.length > 5000) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const f of entries) {
      if (SKIP.test(f)) continue;
      const path = join(dir, f);
      try {
        if (statSync(path).isDirectory()) walk(path, depth + 1);
        else if (SOURCE.test(extname(f) ? f : "") && !/\.(test|spec|stories)\./.test(f)) out.push(path);
      } catch {
        // unreadable entry
      }
    }
  };
  walk(root, 0);
  return out;
}
