// How far a design is built with the chosen design system. A frame made with another (Figma's sample
// grocery site, built with Carbon) has no Carbon components, and sizes and colours Carbon has no token
// for: the code takes the nearest tokens, so its layout and pixels differ where the design does. The
// report says so up front, instead of a list of failures with no reason.

import type { TokenSet } from "../code-model.ts";
import type { Color, DesignNode } from "../model.ts";
import { hex, nearestColorToken } from "../generate/accent.ts";
import { isPlaceholder } from "../generate/page.ts";
import { tokenKind } from "./token-kind.ts";

export interface DesignFit {
  /** Component instances in the frame (placeholders and icons aside), and how many are the design system's. */
  components: { total: number; mapped: number };
  /** Text sizes (px) the design system has no font-size token for. */
  sizes: number[];
  /** Line heights (px, at the text size they are set at) no line-height token gives: px tokens, or ratios times the size. */
  lineHeights: { size: number; lineHeight: number }[];
  /** Colours the design paints that no colour token comes close to. */
  colors: string[];
}

const opaque = (c: Color) => c.a > 0.9;

export function designFit(root: DesignNode, tokens: TokenSet | undefined, isMapped: (n: DesignNode) => boolean): DesignFit {
  let total = 0;
  let mapped = 0;
  const sizes = new Set<number>();
  const lines = new Map<string, { size: number; lineHeight: number }>();
  const colors = new Set<string>();
  const visit = (n: DesignNode, inside: boolean) => {
    if (!n.visible) return;
    if (n.kind === "instance" && !inside && !isPlaceholder(n) && !(n.box && n.box.width <= 32 && n.box.height <= 32)) {
      total++;
      if (isMapped(n)) mapped++;
    }
    if (n.kind === "text" && n.style.fontSize) sizes.add(Math.round(n.style.fontSize * 10) / 10);
    if (n.kind === "text" && n.style.fontSize && n.style.lineHeight) {
      const l = { size: Math.round(n.style.fontSize * 10) / 10, lineHeight: Math.round(n.style.lineHeight * 10) / 10 };
      lines.set(`${l.size}/${l.lineHeight}`, l);
    }
    // A component's own paint is the design system's business; the frame's own layers are what code draws.
    if (!inside) for (const f of n.fills ?? []) if (f.kind === "solid" && opaque(f.color) && f.opacity > 0.9) colors.add(hex(f.color));
    if ("children" in n) for (const c of n.children) visit(c, inside || n.kind === "instance");
  };
  visit(root, false);
  const tokenSizes = (tokens?.tokens ?? []).filter((t) => tokenKind(t.name, t.type) === "font-size").flatMap((t) => Object.values(t.values)).flatMap((v) => (v?.kind === "dimension" ? [v.points] : []));
  // A line-height token is a length (24px) or a ratio of the text's size (Shoelace's 1.4): either gives a line height.
  const lineTokens = (tokens?.tokens ?? []).filter((t) => tokenKind(t.name, t.type) === "line-height").flatMap((t) => Object.values(t.values));
  const gives = (l: { size: number; lineHeight: number }) =>
    lineTokens.some((v) => (v?.kind === "dimension" && Math.abs(v.points - l.lineHeight) < 0.5) || (v?.kind === "number" && Math.abs(v.value * l.size - l.lineHeight) < 0.5));
  return {
    components: { total, mapped },
    sizes: tokenSizes.length ? [...sizes].filter((s) => !tokenSizes.some((t) => Math.abs(t - s) < 0.5)).sort((a, b) => b - a) : [],
    lineHeights: lineTokens.length ? [...lines.values()].filter((l) => !gives(l)) : [],
    colors: tokens ? [...colors].filter((c) => (nearestColorToken(c, tokens)?.distance ?? 1) > 0.03) : [],
  };
}

/** The note for a frame not built with the design system, or undefined when it is (or it cannot be told). */
export function fitNote(fit: DesignFit, designSystem: string): string | undefined {
  const foreign = fit.components.total > 0 && fit.components.mapped === 0;
  const gaps = fit.sizes.length + fit.lineHeights.length + fit.colors.length;
  if (!foreign && gaps < 3) return undefined;
  const parts = [
    foreign ? `none of its ${fit.components.total} components are ${designSystem}'s` : "",
    fit.sizes.length ? `it uses ${fit.sizes.length === 1 ? "a text size" : "text sizes"} ${designSystem} has no token for (${fit.sizes.slice(0, 4).map((s) => `${s}px`).join(", ")})` : "",
    fit.lineHeights.length ? `${fit.lineHeights.length === 1 ? "a line height" : "line heights"} no ${designSystem} line-height token gives (${fit.lineHeights.slice(0, 4).map((l) => `${l.lineHeight}px at ${l.size}px`).join(", ")})` : "",
    fit.colors.length ? `${fit.colors.length === 1 ? "a colour" : "colours"} no ${designSystem} token comes close to (${fit.colors.slice(0, 4).join(", ")})` : "",
  ].filter(Boolean);
  return `This design is not built with ${designSystem}: ${parts.join("; ")}. The code uses ${designSystem}'s nearest tokens, so its layout and pixels differ from the design there. That is the design system's limit, not a coding mistake: to match it exactly, add those values to the design system, or pick the design system the design was made with.`;
}
