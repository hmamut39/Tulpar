// Coverage of a component index and a token set: what was read, how well, and what was not.
// The numbers the matcher's quality will depend on, measured rather than assumed.

import type { ComponentIndex, TokenSet } from "./code-model.ts";

export interface IndexCoverage {
  components: number;
  deprecatedComponents: number;
  withDescription: number;
  props: {
    total: number;
    /** Runtime API rather than design-facing, e.g. static members. */
    internal: number;
    designFacing: number;
    /** Design-facing props by resolved type. "none" means no type was read. */
    byType: Record<string, number>;
    /** Design-facing props whose type came from each source. */
    typeSource: Record<string, number>;
    enumsWithValues: number;
    /** Enum-looking names the reader could not expand, e.g. "BUTTON_KIND" left as text. */
    unresolvedNamedTypes: number;
  };
  slots: { total: number; bySource: Record<string, number>; componentsWithout: number };
  events: number;
  /** Fields whose value came from a low-confidence reader, by "field:source". */
  lowConfidence: Record<string, number>;
  gaps: string[];
}

export function indexCoverage(index: ComponentIndex): IndexCoverage {
  const c: IndexCoverage = {
    components: index.components.length,
    deprecatedComponents: 0,
    withDescription: 0,
    props: { total: 0, internal: 0, designFacing: 0, byType: {}, typeSource: {}, enumsWithValues: 0, unresolvedNamedTypes: 0 },
    slots: { total: 0, bySource: {}, componentsWithout: 0 },
    events: 0,
    lowConfidence: {},
    gaps: index.gaps,
  };
  const inc = (o: Record<string, number>, k: string) => (o[k] = (o[k] ?? 0) + 1);

  for (const comp of index.components) {
    if (comp.deprecated) c.deprecatedComponents++;
    if (comp.description) c.withDescription++;
    for (const p of comp.props) {
      c.props.total++;
      if (p.internal) {
        c.props.internal++;
        continue;
      }
      c.props.designFacing++;
      const kind = p.type ? (p.type.kind === "enum" ? (p.type.open ? "enum (open)" : "enum") : p.type.kind) : "none";
      inc(c.props.byType, kind);
      inc(c.props.typeSource, p.provenance.type?.source ?? "none");
      if (p.type?.kind === "enum" && p.type.values.length) c.props.enumsWithValues++;
      if (p.type?.kind === "other" && /^[A-Z][A-Z0-9_]*$/.test(p.type.text.replace(/\s*\|\s*undefined$/, ""))) c.props.unresolvedNamedTypes++;
      for (const [field, prov] of Object.entries(p.provenance)) if (prov.confidence === "low") inc(c.lowConfidence, `${field}:${prov.source}`);
    }
    c.slots.total += comp.slots.length;
    for (const s of comp.slots) inc(c.slots.bySource, s.provenance.source);
    if (!comp.slots.length) c.slots.componentsWithout++;
    c.events += comp.events.length;
  }
  return c;
}

export interface TokenCoverage {
  tokens: number;
  modes: string[];
  byType: Record<string, number>;
  /** Token values (per mode) that could not be resolved to a fixed value. */
  unresolvedValues: number;
  unresolvedReasons: Record<string, number>;
  /** Tokens whose code reference was not confirmed in code. */
  unconfirmedCodeRefs: number;
  gaps: string[];
}

export function tokenCoverage(set: TokenSet): TokenCoverage {
  const c: TokenCoverage = { tokens: set.tokens.length, modes: set.modes, byType: {}, unresolvedValues: 0, unresolvedReasons: {}, unconfirmedCodeRefs: 0, gaps: set.gaps };
  for (const t of set.tokens) {
    c.byType[t.type] = (c.byType[t.type] ?? 0) + 1;
    for (const v of Object.values(t.values)) {
      if (v.kind !== "unresolved") continue;
      c.unresolvedValues++;
      c.unresolvedReasons[v.reason] = (c.unresolvedReasons[v.reason] ?? 0) + 1;
    }
    if (t.codeRefConfirmed === false) c.unconfirmedCodeRefs++;
  }
  return c;
}
