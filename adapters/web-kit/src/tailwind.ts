// Tailwind CSS for a generated component, compiled in strict mode: Tailwind's own scale (p-4,
// text-sm, bg-blue-500) is switched off, so every spacing, colour, size and type value is an
// arbitrary value carrying a design-system token, e.g. gap-[var(--cds-spacing-05,16px)]. Layout
// utilities (flex, grid, items-center, w-full), zero (m-0, gap-0: no design value) and the breakpoints
// (md:…) stay. A class that only
// works with Tailwind's scale is reported by name, so the repair loop can fix it instead of the
// style silently vanishing.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
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
  const example = prefix ? `p-[var(--${prefix}-…,16px)]` : "p-[var(--token,16px)]";
  return `Tailwind's own scale is switched off here, so these classes draw nothing: ${offScale.slice(0, 12).join(", ")}. Use layout utilities (flex, grid, items-center, w-full) as they are, and write every spacing, colour, size, radius and type value as an arbitrary value with a design-system token and its fallback, e.g. ${example}.`;
}

function cssEscape(s: string): string {
  // As CSS.escape does (Node has none): every other ASCII character backslashed, a leading digit as a code point.
  return s.replace(/[^a-zA-Z0-9_\-\u00a0-\uffff]/g, (ch) => `\\${ch}`).replace(/^(\d)/, (d) => `\\3${d} `);
}
