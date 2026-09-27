// Which code token a Figma variable is. Figma's REST API gives only variable ids on
// free and professional plans (names need the Enterprise Variables API), so a variable
// is identified by value: the tokens whose value in the given mode equals the colour
// Figma resolved. Every use of the same variable narrows the candidates.

import type { DesignToken, TokenSet } from "../code-model.ts";
import type { Color, DesignNode } from "../model.ts";

export interface TokenHint {
  variable: string;
  /** Candidate token names, best first. Empty when no token has the value. */
  tokens: { name: string; codeRef?: string }[];
  uses: number;
}

const close = (a: Color, b: Color) => Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b), Math.abs(a.a - b.a)) <= 1.5 / 255;

export function tokenHints(root: DesignNode, set: TokenSet, mode: string): TokenHint[] {
  const colorTokens = set.tokens.filter((t) => t.type === "color");
  const valueIn = (t: DesignToken) => t.values[mode] ?? t.values.default;
  const candidates = new Map<string, { names: Set<string>; uses: number }>();

  // Only what the generated code styles itself: visible layers outside component instances.
  // An instance's colours are its component's own business (and often hidden states).
  const visit = (n: DesignNode) => {
    if (!n.visible || n.kind === "instance") return;
    const paints = [...n.fills, ...(n.stroke?.paints ?? [])];
    for (const p of paints) {
      if (p.kind !== "solid" || (p.token && p.token.source !== "variable")) continue;
      const color = { ...p.color, a: p.color.a * p.opacity };
      const matching = new Set(colorTokens.filter((t) => { const v = valueIn(t); return v?.kind === "color" && close(v.color, color); }).map((t) => t.name));
      // Unbound colours (e.g. read from a screenshot) are keyed by their value.
      const key = p.token?.id ?? `#${[color.r, color.g, color.b].map((c) => Math.round(c * 255).toString(16).padStart(2, "0")).join("")}`;
      const seen = candidates.get(key);
      if (!seen) candidates.set(key, { names: matching, uses: 1 });
      else {
        // Intersect, unless that would leave nothing (then keep what we had: the value data disagrees).
        const both = new Set([...seen.names].filter((x) => matching.has(x)));
        candidates.set(key, { names: both.size ? both : seen.names, uses: seen.uses + 1 });
      }
    }
    if (n.kind !== "text") n.children.forEach(visit);
  };
  visit(root);

  const byName = new Map(set.tokens.map((t) => [t.name, t]));
  return [...candidates].map(([variable, { names, uses }]) => ({
    variable,
    uses,
    // Shorter names first: "layer-01" before "layer-accent-hover-01" for the same value.
    tokens: [...names].filter((n) => byName.get(n)?.codeRefConfirmed !== false).sort((a, b) => a.length - b.length || a.localeCompare(b)).map((name) => ({ name, ...(byName.get(name)?.codeRef && { codeRef: byName.get(name)!.codeRef }) })),
  }));
}
