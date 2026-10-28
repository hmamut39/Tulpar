// Tailwind CSS for a generated component, compiled in strict mode: Tailwind's own scale (p-4,
// text-sm, bg-blue-500) is switched off, so every spacing, colour, size and type value is an
// arbitrary value carrying a design-system token, e.g. gap-[var(--cds-spacing-05,16px)]. Layout
// utilities (flex, grid, items-center, w-full), zero (m-0, gap-0: no design value) and the breakpoints
// (md:…) stay. A class that only
// works with Tailwind's scale is reported by name, so the repair loop can fix it instead of the
// style silently vanishing.

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { compile } from "tailwindcss";

const require = createRequire(import.meta.url);
const twDir = dirname(require.resolve("tailwindcss/package.json"));

const BREAKPOINTS = "--breakpoint-sm: 40rem; --breakpoint-md: 48rem; --breakpoint-lg: 64rem; --breakpoint-xl: 80rem; --breakpoint-2xl: 96rem;";
const STRICT = `@import "tailwindcss/utilities.css" layer(utilities);\n@theme { --*: initial; --spacing: 0.25rem; ${BREAKPOINTS} }\n`;
const FULL = `@import "tailwindcss/theme.css" layer(theme);\n@import "tailwindcss/utilities.css" layer(utilities);\n`;

type Compiler = Awaited<ReturnType<typeof compile>>;
const loadStylesheet = async (id: string, base: string) => {
  const path = id.startsWith("tailwindcss/") ? join(twDir, id.slice("tailwindcss/".length)) : join(base, id);
  return { path, base: dirname(path), content: readFileSync(path, "utf8") };
};
// Compiled once per process; build() is given each component's own class names. A compiler keeps the
// candidates it has seen, so each component gets fresh ones (compiling the theme takes milliseconds).
const fresh = (css: string): Promise<Compiler> => compile(css, { base: twDir, loadStylesheet });

export interface TailwindResult {
  css: string;
  /** Classes that exist only with Tailwind's own scale (p-4, text-sm): they draw nothing here. */
  offScale: string[];
}

/** Class names written in string literals (className="…", class="…", cn("…")), as Tailwind would find them. */
export function classCandidates(source: string): string[] {
  const strings = source.match(/"[^"\n]*"|'[^'\n]*'|`[^`]*`/g) ?? [];
  const out = new Set<string>();
  for (const s of strings) for (const c of s.slice(1, -1).match(/[^<>"'`\s]*[^<>"'`\s:]/g) ?? []) out.add(c);
  return [...out];
}

export async function tailwindCss(sources: string[]): Promise<TailwindResult> {
  const candidates = [...new Set(sources.flatMap(classCandidates))];
  const [strict, full] = await Promise.all([fresh(STRICT), fresh(FULL)]);
  let css = strict.build(candidates);
  const withScale = full.build(candidates);
  const offScale = candidates.filter((c) => {
    const selector = `.${cssEscape(c)}`;
    return withScale.includes(selector) && !css.includes(selector);
  });
  // The spacing unit is kept so zero compiles (m-0 → 0px); any other step of Tailwind's spacing scale
  // (p-4 → calc(var(--spacing) * 4)) is not a design value: named, and its rule dropped.
  css = css.replace(/(?:^|\n)[ ]*\.((?:\\.|[^\s{])+)\s*\{([^{}]*)\}/g, (rule, selector: string, body: string) => {
    if (!body.includes("var(--spacing)")) return rule;
    offScale.push(selector.replace(/\\(.)/g, "$1"));
    return "";
  });
  css = css.replace(/:root, :host \{\s*--spacing: [^;]+;\s*\}\n?/, "");
  return { css, offScale: [...new Set(offScale)] };
}

/** The message a build fails with when classes rely on Tailwind's own scale. */
export function offScaleMessage(offScale: string[], prefix: string): string {
  const t = (kind: string, fallback: string) => `var(--${prefix ? `${prefix}-` : ""}${kind},${fallback})`;
  const example = `p-[${t("…", "16px")}]`;
  // The form each rejected class takes with a token: a weight is not written like a size (a repair that
  // only hears "use a token" kept writing font-normal three times).
  const hints = new Set<string>();
  for (const c of offScale) {
    const base = c.replace(/^.*:/, "");
    if (/^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/.test(base)) hints.add(`a font weight: font-[${t("…font-weight…", "400")}] (Tailwind reads a variable named …weight… as a weight)`);
    else if (/^text-(xs|sm|base|lg|[2-9]?xl)$/.test(base)) hints.add(`a font size: text-[length:${t("…font-size…", "14px")}]`);
    else if (/^leading-/.test(base)) hints.add(`a line height: leading-[${t("…line-height…", "20px")}]`);
    else if (/^tracking-/.test(base)) hints.add(`letter spacing: tracking-[${t("…letter-spacing…", "0px")}]`);
    else if (/^rounded/.test(base)) hints.add(`a radius: rounded-[${t("…radius…", "4px")}]`);
    else if (/^(bg|text|border|ring|fill|stroke)-[a-z]+-\d+$/.test(base)) hints.add(`a colour: bg-[${t("…color…", "#…")}] or text-[color:${t("…", "#…")}]`);
  }
  return `Tailwind's own scale is switched off here, so these classes draw nothing: ${offScale.slice(0, 12).join(", ")}. Use layout utilities (flex, grid, items-center, w-full) as they are, and write every spacing, colour, size, radius and type value as an arbitrary value with a design-system token and its fallback, e.g. ${example}.${hints.size ? ` Written with a token: ${[...hints].join("; ")}.` : ""}`;
}

/**
 * Tailwind with the project's own theme (shadcn/ui): its stylesheet (index.css: @import "tailwindcss",
 * its @theme and its :root tokens) compiled as the app compiles it. Tailwind's scale is the design
 * system's here, so nothing is switched off. Two sheets: the design system's, for every class the
 * project's components and the generated code use (with its theme variables, base styles and fonts),
 * and the generated code's own utilities, which the token checks read.
 */
export async function tailwindThemeCss(themeFile: string, designSystemSources: string[], sources: string[]): Promise<{ designSystem: string; css: string }> {
  const own = [...new Set(sources.flatMap(classCandidates))];
  const all = [...new Set([...designSystemSources.flatMap(classCandidates), ...own])];
  const theme = readFileSync(themeFile, "utf8");
  const load = async (id: string, base: string) => {
    const path = resolveCssImport(id, base);
    return { path, base: dirname(path), content: absoluteUrls(readFileSync(path, "utf8"), dirname(path)) };
  };
  const compiler = () => compile(absoluteUrls(theme, dirname(themeFile)), { base: dirname(themeFile), loadStylesheet: load });
  const [ds, mine] = await Promise.all([compiler(), compiler()]);
  // A theme step written as a formula (--radius-xl: calc(var(--radius) * 1.4)) is inlined by @theme
  // inline, and would read as arithmetic on a token. It is the design system's step: defined by name on
  // every element (as inline resolves it, per element, so a dark subtree keeps working) and used by name.
  const steps = themeFormulas(theme);
  let css = layerBlock(mine.build(own), "utilities");
  for (const [name, value] of steps) css = css.split(`: ${value};`).join(`: var(--${name});`);
  const defined = steps.length ? `\n*, ::before, ::after { ${steps.map(([n, v]) => `--${n}: ${v};`).join(" ")} }\n` : "";
  return { designSystem: ds.build(all) + defined, css };
}

/** Variables of the theme's @theme inline blocks whose value is a formula: [name, value]. */
function themeFormulas(css: string): [string, string][] {
  const out: [string, string][] = [];
  for (const block of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/@theme\s+inline\s*\{([^{}]*)\}/g))
    for (const d of block[1]!.matchAll(/--([\w-]+)\s*:\s*(calc\([^;]+\))\s*;/g)) out.push([d[1]!, d[2]!.trim()]);
  return out;
}

/** A stylesheet @import as a bundler resolves it: a relative path, or a package's style entry or exported .css file. */
export function resolveCssImport(id: string, base: string): string {
  if (/^\.{1,2}\//.test(id) || isAbsolute(id)) return resolve(base, id);
  if (id === "tailwindcss") return join(twDir, "index.css");
  if (id.startsWith("tailwindcss/")) return join(twDir, id.slice("tailwindcss/".length));
  const name = id.split("/").slice(0, id.startsWith("@") ? 2 : 1).join("/");
  const sub = id.slice(name.length);
  let pkgDir: string | undefined;
  for (let d = base; ; d = dirname(d)) {
    if (existsSync(join(d, "node_modules", name, "package.json"))) {
      pkgDir = join(d, "node_modules", name);
      break;
    }
    if (dirname(d) === d) break;
  }
  if (!pkgDir) throw new Error(`Stylesheet not found: ${id} (from ${base})`);
  const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")) as { style?: string; main?: string; exports?: unknown };
  const pick = (t: unknown): string | undefined => (typeof t === "string" ? t : t && typeof t === "object" ? pick((t as Record<string, unknown>).style ?? (t as Record<string, unknown>).default) : undefined);
  const exportsMap = pkg.exports && typeof pkg.exports === "object" && !Array.isArray(pkg.exports) ? (pkg.exports as Record<string, unknown>) : {};
  let target = pick(exportsMap[`.${sub}`]);
  if (!target)
    for (const [key, value] of Object.entries(exportsMap)) {
      const star = key.indexOf("*");
      if (star < 0 || !`.${sub}`.startsWith(key.slice(0, star)) || !`.${sub}`.endsWith(key.slice(star + 1))) continue;
      target = pick(value)?.replace("*", `.${sub}`.slice(star, `.${sub}`.length - (key.length - star - 1)));
      if (target) break;
    }
  if (!target && !sub) target = pkg.style ?? (pkg.main?.endsWith(".css") ? pkg.main : "index.css");
  return join(pkgDir, target ?? sub.slice(1));
}

/** url(./files/font.woff2) made absolute (file:), so the sheet works from wherever the page loads it. */
function absoluteUrls(css: string, dir: string): string {
  return css.replace(/url\(\s*(['"]?)(?![a-z]+:|#|\/)([^'")]+)\1\s*\)/gi, (_m, _q, path: string) => `url("${pathToFileURL(resolve(dir, path)).href}")`);
}

/** The contents of `@layer name { … }` in compiled CSS, wrapped again so it keeps its place in the cascade. */
function layerBlock(css: string, name: string): string {
  const start = css.indexOf(`@layer ${name} {`);
  if (start < 0) return "";
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(start, i + 1);
  }
  return "";
}

function cssEscape(s: string): string {
  // As CSS.escape does (Node has none): every other ASCII character backslashed, a leading digit as a code point.
  return s.replace(/[^a-zA-Z0-9_\-\u00a0-\uffff]/g, (ch) => `\\${ch}`).replace(/^(\d)/, (d) => `\\3${d} `);
}
