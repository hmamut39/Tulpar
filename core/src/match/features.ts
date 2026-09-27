// Per-pair signals between a Figma component and a code component.
// Each is a number in [0, 1], or null when the signal cannot apply (so an absent
// description never counts as a mismatch). Strongest signals first; see
// docs/00-research-and-plan.md §2.

import type { CodeComponent, CodeProp } from "../code-model.ts";
import type { ComponentDef, PropDef } from "../model.ts";
import { containment, figmaNameTokens, headToken, normValue, tokenOverlap, tokens, valueOverlap } from "./text.ts";

export const FEATURES = ["docLink", "description", "props", "values", "name", "head", "nameContained", "page"] as const;
export type FeatureName = (typeof FEATURES)[number];
export type Features = Record<FeatureName, number | null>;

/** One aligned property pair, kept as evidence. */
export interface PropPair {
  figma: string;
  code: string;
  score: number;
}

export interface PairEvidence {
  features: Features;
  props: PropPair[];
}

/** Code-side facts prepared once per component. */
export interface CodeSide {
  component: CodeComponent;
  nameTokens: string[];
  props: CodeProp[];
  slots: string[];
}

export function prepareCode(component: CodeComponent, prefix: string | undefined): CodeSide {
  const strip = (ts: string[]) => (prefix && ts[0] === prefix ? ts.slice(1) : ts);
  const fromName = strip(tokens(component.name));
  const fromExport = component.exportName ? strip(tokens(component.exportName)) : [];
  // Prefer the export name when the tag name adds nothing (e.g. both "button").
  const nameTokens = fromExport.length > fromName.length ? fromExport : fromName;
  return {
    component,
    nameTokens,
    props: component.props.filter((p) => !p.internal && !p.deprecated),
    slots: component.slots.map((s) => s.name),
  };
}

export function features(figma: ComponentDef, code: CodeSide): PairEvidence {
  const figmaTokens = figmaNameTokens(figma.name);
  const pageTokens = figmaNameTokens(figma.page);
  const head = headToken(figma.name);
  const { score: props, pairs } = alignProps(figma.props, code);

  return {
    features: {
      docLink: figma.links.length ? (figma.links.some((l) => linkNames(l, code)) ? 1 : 0) : null,
      description: figma.description.trim() ? (containment(code.nameTokens, tokens(figma.description)) === 1 ? 1 : 0) : null,
      props,
      values: variantValues(figma.props, code),
      name: tokenOverlap(figmaTokens, code.nameTokens),
      head: head ? (code.nameTokens.at(-1) === head ? 1 : 0) : null,
      nameContained: containment(code.nameTokens, [...figmaTokens, ...pageTokens]),
      page: pageTokens.length ? tokenOverlap(pageTokens, code.nameTokens) : null,
    },
    props: pairs,
  };
}

function linkNames(uri: string, code: CodeSide): boolean {
  const u = uri.toLowerCase();
  return u.includes(code.component.name.toLowerCase()) || (!!code.component.exportName && u.includes(code.component.exportName.toLowerCase()));
}

/**
 * Align Figma properties with code props and slots, greedily by pair score.
 * Returns the share of Figma's properties that found a counterpart, weighted by
 * how well they match. Null when the Figma component has no properties.
 */
function alignProps(figmaProps: PropDef[], code: CodeSide): { score: number | null; pairs: PropPair[] } {
  if (!figmaProps.length) return { score: null, pairs: [] };
  const targets = [
    ...code.props.map((p) => ({ kind: "prop" as const, name: p.name, prop: p })),
    ...code.slots.map((s) => ({ kind: "slot" as const, name: s, prop: undefined })),
  ];
  const candidates: { f: number; t: number; score: number }[] = [];
  figmaProps.forEach((fp, f) =>
    targets.forEach((t, ti) => {
      const score = t.kind === "slot" ? slotSim(fp, t.name) : propSim(fp, t.prop!);
      if (score >= 0.3) candidates.push({ f, t: ti, score });
    }),
  );
  candidates.sort((a, b) => b.score - a.score);
  const usedF = new Set<number>();
  const usedT = new Set<number>();
  const pairs: PropPair[] = [];
  let total = 0;
  for (const c of candidates) {
    if (usedF.has(c.f) || usedT.has(c.t)) continue;
    usedF.add(c.f);
    usedT.add(c.t);
    total += c.score;
    pairs.push({ figma: figmaProps[c.f]!.name, code: targets[c.t]!.kind === "slot" ? `slot "${targets[c.t]!.name}"` : targets[c.t]!.name, score: round(c.score) });
  }
  return { score: total / figmaProps.length, pairs };
}

function propSim(fp: PropDef, cp: CodeProp): number {
  const name = tokenOverlap(tokens(fp.name), [...tokens(cp.name), ...cp.aliases.flatMap(tokens)]);
  const t = cp.type?.kind;
  switch (fp.type) {
    case "variant": {
      const options = fp.options ?? [];
      if (t === "enum") return 0.5 * name + 0.5 * valueOverlap(options, cp.type!.kind === "enum" ? cp.type!.values : []);
      // A variant value that names a boolean prop: State=Disabled ↔ disabled.
      if (t === "boolean") return options.some((o) => normValue(o) === normValue(cp.name) || tokens(o).join(" ") === tokens(cp.name).join(" ")) ? 0.8 : name * 0.7;
      if (t === "string") return name * 0.6;
      return name * 0.3;
    }
    case "boolean":
      return t === "boolean" ? name : name * 0.3;
    case "text":
      return t === "string" ? name : name * 0.3;
    case "instance-swap":
      return name * 0.3;
  }
}

function slotSim(fp: PropDef, slot: string): number {
  const slotTokens = slot ? tokens(slot) : [];
  const name = slotTokens.length ? tokenOverlap(tokens(fp.name), slotTokens) : 0;
  switch (fp.type) {
    case "instance-swap":
      return slot ? name : 0.4;
    case "text":
      // Label text usually lands in the default slot.
      return slot ? name * 0.8 : 0.5;
    case "boolean":
      // "Show icon" toggles whether the icon slot is filled.
      return name * 0.6;
    case "variant":
      return 0;
  }
}

/**
 * How well Figma's variant values are covered by the code component's enums
 * (or name its boolean props). Mean over variant properties; null when there are none.
 */
function variantValues(figmaProps: PropDef[], code: CodeSide): number | null {
  const variants = figmaProps.filter((p) => p.type === "variant" && p.options?.length);
  if (!variants.length) return null;
  const enums = code.props.filter((p) => p.type?.kind === "enum").map((p) => (p.type!.kind === "enum" ? p.type!.values : []));
  const booleans = new Set(code.props.filter((p) => p.type?.kind === "boolean").map((p) => normValue(p.name)));
  let sum = 0;
  for (const v of variants) {
    const options = v.options!;
    const byEnum = Math.max(0, ...enums.map((values) => valueOverlap(options, values)));
    const byBoolean = options.filter((o) => booleans.has(normValue(o))).length / options.length;
    sum += Math.max(byEnum, byBoolean);
  }
  return sum / variants.length;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
