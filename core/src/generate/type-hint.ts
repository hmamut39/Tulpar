// The design system's type styles that produce each text size in the design. A model picking a style by
// its Figma name can land on a class that does not exist or renders another size (Carbon's stylesheet has
// no .cds--type-heading-03; the browser's h2 size showed instead, 40 px tall for a 20/28 title). Matching
// by value, against the token groups the design system really declares (heading-03-font-size and
// heading-03-line-height), gives the variables that draw it.

import type { DesignToken, TokenSet } from "../code-model.ts";
import type { DesignNode } from "../model.ts";

export interface TypeHint {
  /** As the outline writes it: "20/28 w400". */
  text: string;
  /** The token group, e.g. "heading-03". */
  style: string;
  /** Property → code reference: fontSize, lineHeight, and fontWeight / letterSpacing when the group has them. */
  refs: Record<string, string>;
}

interface Group {
  name: string;
  size?: number;
  lineHeight?: { ratio?: number; points?: number };
  weight?: number;
  refs: Record<string, string>;
}

const PARTS: [suffix: string, property: string][] = [
  ["-font-size", "fontSize"],
  ["-line-height", "lineHeight"],
  ["-font-weight", "fontWeight"],
  ["-letter-spacing", "letterSpacing"],
];

export function typeHints(root: DesignNode, set: TokenSet, mode: string): TypeHint[] {
  const groups = new Map<string, Group>();
  const value = (t: DesignToken) => t.values[mode] ?? t.values.default ?? Object.values(t.values)[0];
  for (const t of set.tokens) {
    const part = PARTS.find(([suffix]) => t.name.endsWith(suffix));
    if (!part || !t.codeRef) continue;
    const name = t.name.slice(0, -part[0].length);
    const g = groups.get(name) ?? { name, refs: {} };
    const v = value(t);
    // With the value as the fallback: a design system may declare its type tokens only inside some
    // components (Carbon's live on .cds--guidebanner), so elsewhere only the fallback draws.
    const fallback = v?.kind === "dimension" ? `${Math.round(v.points * 100) / 100}px` : v?.kind === "number" ? String(v.value) : undefined;
    g.refs[part[1]] = fallback && /^var\(--[\w-]+\)$/.test(t.codeRef) ? t.codeRef.replace(/\)$/, `, ${fallback})`) : t.codeRef;
    if (part[1] === "fontSize" && v?.kind === "dimension") g.size = v.points;
    if (part[1] === "lineHeight" && v?.kind === "number") g.lineHeight = { ratio: v.value };
    if (part[1] === "lineHeight" && v?.kind === "dimension") g.lineHeight = { points: v.points };
    if (part[1] === "fontWeight" && v?.kind === "number") g.weight = v.value;
    groups.set(name, g);
  }
  const complete = [...groups.values()].filter((g) => g.size && g.lineHeight && g.refs.fontSize && g.refs.lineHeight);
  if (!complete.length) return [];

  const seen = new Map<string, TypeHint>();
  const visit = (n: DesignNode) => {
    if (!n.visible) return;
    if (n.kind === "text" && n.style.fontSize && n.style.lineHeight) {
      const { fontSize, lineHeight, fontWeight } = n.style;
      const key = `${round(fontSize)}/${round(lineHeight)} w${fontWeight ?? ""}`;
      if (!seen.has(key)) {
        const lh = (g: Group) => g.lineHeight!.points ?? g.lineHeight!.ratio! * g.size!;
        const fits = complete.filter((g) => Math.abs(g.size! - fontSize) < 0.5 && Math.abs(lh(g) - lineHeight) < 1);
        // A weight that also matches beats one that does not; then the shortest name (body-01 over body-compact-01).
        fits.sort((a, b) => Number(b.weight === fontWeight) - Number(a.weight === fontWeight) || a.name.length - b.name.length);
        const best = fits[0];
        if (best) seen.set(key, { text: key, style: best.name, refs: best.refs });
      }
    }
    if ("children" in n) for (const c of n.children) visit(c);
  };
  visit(root);
  return [...seen.values()];
}

const round = (n: number) => Math.round(n * 10) / 10;
