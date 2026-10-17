// tulpar check <projectDir> [files...] [--format text|github|json]
//
// Reviews component code against the design system, whoever wrote it (a person or a model), with no
// model and no design: the check a team runs on every pull request.
// - Hard-coded values: colours, type and spacing written as literals instead of tokens, found by the
//   framework's own static scan (styles, inline styles, stylesheets, CSS-in-JS).
// - Invented tokens: var(--<prefix>-…) names the design system does not have, which silently fall
//   back or draw nothing.
// Given files (a pull request's changed files) are mapped to their components: Card.module.css and
// Card.styles.ts to Card.tsx, card.component.html to card.component.ts.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import type { StyleFact } from "@tulpar/core";
import { loadProject, withAdapter } from "./project.ts";

export interface CheckFinding {
  kind: "hard-coded" | "invented-token";
  /** Path relative to the current directory, for editors and CI annotations. */
  file: string;
  line?: number;
  message: string;
}

export interface CheckOptions {
  format?: "text" | "github" | "json";
  quiet?: boolean;
}

/** The files a framework's components live in. */
const COMPONENT_FILE: Record<string, RegExp> = {
  react: /\.(tsx|jsx)$/,
  vue: /\.vue$/,
  svelte: /\.svelte$/,
  angular: /\.component\.ts$/,
  "web-components": /\.html$/,
};

export async function checkCommand(projectDir: string, files: string[], options: CheckOptions = {}): Promise<{ code: number; findings: CheckFinding[] }> {
  const project = await loadProject(projectDir);
  const root = project.root;
  const isComponent = COMPONENT_FILE[project.config.adapter] ?? /\.(tsx|jsx|vue|svelte)$/;
  const entries = [...new Set((files.length ? files.map((f) => resolve(f)) : allFiles(root)).map((f) => componentOf(f, isComponent)).filter((f): f is string => !!f && f.startsWith(root)))];
  const findings: CheckFinding[] = [];
  const here = (abs: string) => relative(process.cwd(), abs).replace(/\\/g, "/");

  await withAdapter(project, async (host) => {
    const caps = host.manifest!.capabilities;
    const tokens = caps.tokens ? await host.call("tokens", project.params) : undefined;
    const known = new Set((tokens?.tokens ?? []).map((t) => t.name));
    const prefix = (project.params.config as { tokens?: { css?: { prefix?: string }; prefix?: string } }).tokens?.css?.prefix ?? (project.params.config as { tokens?: { prefix?: string } }).tokens?.prefix;
    for (const entry of entries) {
      const rel = relative(root, entry).replace(/\\/g, "/");
      if (caps.staticProvenance) {
        const analysis = await host.call("analyze", { ...project.params, entry: rel }).catch(() => undefined);
        for (const fact of analysis?.literals ?? []) findings.push(literalFinding(fact, root, here));
      }
      // Invented tokens, in the component and the files beside it that share its name. With a token prefix
      // (--cds-), any unknown name under it; without one (Radix's --space-3), an unknown name in a family the
      // design system uses (--space-33), never a variable the code declares itself.
      if (known.size) {
        const files = [entry, ...siblings(entry)];
        const declared = new Set(files.flatMap((f) => [...readFileSync(f, "utf8").matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]!.slice(2))));
        const families = new Set([...known].map((n) => n.split("-")[0]!));
        for (const file of files) {
          const text = readFileSync(file, "utf8");
          for (const m of text.matchAll(new RegExp(prefix ? String.raw`var\(\s*--(${prefix}-[\w-]+)` : String.raw`var\(\s*--([\w-]+)`, "g"))) {
            if (known.has(m[1]!) || declared.has(m[1]!)) continue;
            if (!prefix && !families.has(m[1]!.split("-")[0]!)) continue;
            const line = text.slice(0, m.index).split("\n").length;
            findings.push({ kind: "invented-token", file: here(file), line, message: `--${m[1]} is not a token of the design system` });
          }
        }
      }
    }
  });

  const unique = [...new Map(findings.map((f) => [`${f.kind}|${f.file}|${f.line}|${f.message}`, f])).values()];
  if (!options.quiet) print(unique, entries.length, options.format ?? "text");
  return { code: unique.length ? 1 : 0, findings: unique };
}

function literalFinding(fact: StyleFact, root: string, here: (abs: string) => string): CheckFinding {
  const [file, line] = (fact.at ?? "").split(/:(?=\d+$)/);
  return {
    kind: "hard-coded",
    file: file ? here(join(root, file)) : "",
    ...(line && { line: Number(line) }),
    message: `hard-coded ${fact.property} ${JSON.stringify(fact.written)}: use a design-system token`,
  };
}

function print(findings: CheckFinding[], checked: number, format: "text" | "github" | "json"): void {
  if (format === "json") {
    console.log(JSON.stringify({ checked, findings }));
    return;
  }
  if (format === "github") {
    // GitHub Actions annotations: each finding is marked on its line in the pull request.
    for (const f of findings) console.log(`::error file=${f.file}${f.line ? `,line=${f.line}` : ""},title=Tulpar ${f.kind}::${f.message}`);
  } else {
    for (const f of findings) console.log(`✗ ${f.file}${f.line ? `:${f.line}` : ""}  ${f.message}`);
  }
  console.log(`${checked} component(s) checked: ${findings.length ? `${findings.length} finding(s)` : "no hard-coded values, no invented tokens"}`);
}

/** The component a file belongs to: itself, or the component file sharing its name in the same folder. */
function componentOf(file: string, isComponent: RegExp): string | undefined {
  if (!existsSync(file)) return undefined;
  if (isComponent.test(file)) return file;
  const stem = stemOf(file);
  const dir = dirname(file);
  return readdirSync(dir).map((f) => join(dir, f)).find((f) => isComponent.test(f) && stemOf(f) === stem);
}

/** Card.tsx, Card.module.css, Card.styles.ts → "Card"; card.component.html → "card". */
function stemOf(file: string): string {
  return basename(file).replace(/\.(component|module|styles|test|spec|stories)?\.[^.]+$/, "").replace(/\.[^.]+$/, "");
}

function siblings(entry: string): string[] {
  const dir = dirname(entry);
  const stem = stemOf(entry);
  return readdirSync(dir)
    .map((f) => join(dir, f))
    .filter((f) => f !== entry && stemOf(f) === stem && /\.(css|scss|less|ts|js|html)$/.test(f) && !/\.(test|spec)\./.test(f));
}

/** Every file of the project, outside dependencies and build output. */
function allFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 8) return;
    for (const f of readdirSync(dir)) {
      if (/^(node_modules|dist|build|out|coverage)$/.test(f) || f.startsWith(".")) continue;
      const path = join(dir, f);
      if (statSync(path).isDirectory()) walk(path, depth + 1);
      else if (extname(f)) out.push(path);
    }
  };
  walk(root, 0);
  return out;
}
