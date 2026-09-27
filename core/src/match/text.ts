// Name and value normalisation shared by the matcher's signals.
// Framework-free: works on names as written in any language ("TextInput",
// "text-input", "text_input", "Text input - Default", "UI shell / Header").

const SYNONYMS: Record<string, string> = {
  btn: "button",
  nav: "navigation",
  img: "image",
  pic: "picture",
  desc: "description",
  num: "number",
  msg: "message",
  txt: "text",
  dlg: "dialog",
  // "Left panel" in design is commonly "side nav" in code; kept out on purpose: a
  // synonym table that encodes one design system's naming would fake the benchmark.
};

/** Split any identifier or label into lowercase word tokens. */
export function tokens(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((t) => SYNONYMS[t] ?? t);
}

// Words design kits add to component names that say nothing about which component it is.
const FIGMA_NOISE = new Set(["item", "items", "base", "bases", "default", "component", "variant", "variants", "master", "template"]);

/** Tokens of a Figma component or page name, without kit filler words. */
export function figmaNameTokens(name: string): string[] {
  const all = tokens(name);
  const core = all.filter((t) => !FIGMA_NOISE.has(t));
  return core.length ? core : all;
}

/**
 * The word that says what a component is: the last word of its name, ignoring
 * filler. Figma kits write "Group - Flavor" ("Tag - Read-only", "Text input - Fluid"),
 * so only the part before " - " counts.
 */
export function headToken(name: string): string | undefined {
  const primary = name.split(/\s[-–—/]\s/)[0] ?? name;
  return figmaNameTokens(primary).at(-1);
}

/** Jaro-Winkler similarity in [0, 1]. */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatch = new Array<boolean>(a.length).fill(false);
  const bMatch = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - range); j < Math.min(b.length, i + range + 1); j++) {
      if (bMatch[j] || a[i] !== b[j]) continue;
      aMatch[i] = bMatch[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let t = 0;
  for (let i = 0, k = 0; i < a.length; i++) {
    if (!aMatch[i]) continue;
    while (!bMatch[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const jaro = (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < 4 && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

/** Two tokens match when equal, or near-equal and long enough that it isn't chance. */
function tokenSim(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 4 || b.length < 4) return 0;
  const s = jaroWinkler(a, b);
  return s >= 0.92 ? s : 0;
}

/**
 * Soft Dice overlap of two token lists, in [0, 1]: each token counts by its best
 * match on the other side.
 */
export function tokenOverlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const best = (xs: string[], ys: string[]) => xs.reduce((sum, x) => sum + Math.max(...ys.map((y) => tokenSim(x, y))), 0);
  return (best(a, b) + best(b, a)) / (a.length + b.length);
}

/** Fraction of `part`'s tokens found in `whole`. */
export function containment(part: string[], whole: string[]): number {
  if (!part.length) return 0;
  return part.filter((p) => whole.some((w) => tokenSim(p, w) > 0)).length / part.length;
}

// Size and emphasis vocabularies that design tools spell out and code abbreviates.
const VALUE_ALIASES: Record<string, string> = {
  "extra small": "xs",
  "x small": "xs",
  xsmall: "xs",
  small: "sm",
  medium: "md",
  large: "lg",
  "extra large": "xl",
  "x large": "xl",
  xlarge: "xl",
  "2x large": "2xl",
  "2xl": "2xl",
  xxl: "2xl",
  "extra extra large": "2xl",
  "2x small": "2xs",
  xxs: "2xs",
  true: "true",
  on: "true",
  yes: "true",
  false: "false",
  off: "false",
  no: "false",
};

/** Normalise an enum or variant value: "Extra large" → "xl", "Danger primary" → "danger primary". */
export function normValue(value: string | number | boolean): string {
  const v = String(value).trim().toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ");
  const bare = v.replace(/\s*\(.*\)$/, ""); // "Large (48px)" → "large"
  return VALUE_ALIASES[bare] ?? bare;
}

/** Jaccard overlap of two value sets after normalisation. */
export function valueOverlap(a: (string | number | boolean)[], b: (string | number | boolean)[]): number {
  const A = new Set(a.map(normValue));
  const B = new Set(b.map(normValue));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/**
 * The name prefix shared by most names in a list (e.g. "cds" in "cds-button"),
 * which carries no information for matching. Undefined when there is none.
 */
export function commonPrefix(names: string[], share = 0.5): string | undefined {
  const counts = new Map<string, number>();
  for (const n of names) {
    const first = tokens(n)[0];
    if (first) counts.set(first, (counts.get(first) ?? 0) + 1);
  }
  const [top, count] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? [];
  return top && count! / names.length > share ? top : undefined;
}
