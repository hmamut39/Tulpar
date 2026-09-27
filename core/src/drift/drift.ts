// Drift: what changed between two readings of a code library, and which confirmed
// mappings it touches. A confirmed mapping is never re-matched silently; each change
// becomes a finding for a human (docs/00-research-and-plan.md §2, "Keeping it fresh").

import { createHash } from "node:crypto";
import type { CodeComponent, CodeProp, ComponentIndex, TypeShape } from "../code-model.ts";
import type { ComponentDef } from "../model.ts";
import { features, prepareCode } from "../match/features.ts";
import { commonPrefix, tokenOverlap, tokens } from "../match/text.ts";

export type DriftSeverity = "breaks-mapping" | "affects-mapping" | "info";

export type DriftKind =
  | "component-removed"
  | "component-renamed"
  | "component-added"
  | "component-deprecated"
  | "prop-removed"
  | "prop-added"
  | "prop-renamed"
  | "prop-type-changed"
  | "enum-values-changed"
  | "default-changed"
  | "prop-deprecated"
  | "slot-removed"
  | "slot-added"
  | "event-removed"
  | "event-added";

export interface DriftFinding {
  severity: DriftSeverity;
  kind: DriftKind;
  /** The component's name in the earlier reading. */
  component: string;
  detail: string;
  /** Figma components confirmed as this code component. */
  figma?: string[];
  /** Figma properties that were aligned to the changed prop or slot. */
  alignedFigmaProps?: string[];
}

export interface DriftReport {
  from: { package?: string; version?: string };
  to: { package?: string; version?: string };
  summary: {
    before: number;
    after: number;
    unchanged: number;
    changed: number;
    added: number;
    removed: number;
    renamed: number;
  };
  bySeverity: Record<DriftSeverity, number>;
  findings: DriftFinding[];
}

export interface DriftOptions {
  /** Code component name → the Figma components confirmed as it (e.g. from explicit links). */
  confirmed?: Map<string, ComponentDef[]>;
}

/** A stable hash of what a component offers: its design-facing props, slots and events. */
export function signature(c: CodeComponent): string {
  const props = c.props
    .filter((p) => !p.internal)
    .map((p) => [p.name, typeKey(p.type), p.defaultText ?? "", !!p.deprecated])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const slots = c.slots.map((s) => s.name).sort();
  const events = c.events.map((e) => e.name).sort();
  return createHash("sha256").update(JSON.stringify([props, slots, events, !!c.deprecated])).digest("hex").slice(0, 16);
}

export function compareIndexes(before: ComponentIndex, after: ComponentIndex, options: DriftOptions = {}): DriftReport {
  const confirmed = options.confirmed ?? new Map<string, ComponentDef[]>();
  const findings: DriftFinding[] = [];
  const oldByName = new Map(before.components.map((c) => [c.name, c]));
  const newByName = new Map(after.components.map((c) => [c.name, c]));
  const removed = before.components.filter((c) => !newByName.has(c.name));
  const added = after.components.filter((c) => !oldByName.has(c.name));

  // Renames: a removed and an added component from the same source file or export, or with near-identical props.
  const renamed = new Map<string, CodeComponent>();
  for (const r of removed) {
    const match =
      added.find((a) => !isTaken(a, renamed) && ((a.sourcePath && a.sourcePath === r.sourcePath) || (a.exportName && a.exportName === r.exportName))) ??
      added.find((a) => !isTaken(a, renamed) && propNameSimilarity(r, a) >= 0.8 && r.props.length >= 3);
    if (match) renamed.set(r.name, match);
  }

  const prefixOld = commonPrefix(before.components.map((c) => c.name));
  const figmaOf = (name: string) => confirmed.get(name)?.map((d) => d.name);
  const severityFor = (name: string, breaking: boolean): DriftSeverity => (confirmed.has(name) ? (breaking ? "breaks-mapping" : "affects-mapping") : "info");
  const push = (f: Omit<DriftFinding, "figma"> & { figma?: string[] }) => {
    const figma = figmaOf(f.component);
    findings.push({ ...f, ...(figma && { figma }) });
  };

  for (const r of removed) {
    const to = renamed.get(r.name);
    if (to) push({ severity: severityFor(r.name, true), kind: "component-renamed", component: r.name, detail: `renamed to ${to.name}` });
    else push({ severity: severityFor(r.name, true), kind: "component-removed", component: r.name, detail: "no longer in the library" });
  }
  for (const a of added) {
    if ([...renamed.values()].includes(a)) continue;
    push({ severity: "info", kind: "component-added", component: a.name, detail: "new in the library" });
  }

  let unchanged = 0;
  let changed = 0;
  for (const old of before.components) {
    const now = newByName.get(old.name) ?? renamed.get(old.name);
    if (!now) continue;
    if (signature(old) === signature(now)) {
      unchanged++;
      continue;
    }
    changed++;
    // Which Figma properties lean on which code prop or slot, per the matcher's alignment.
    const aligned = new Map<string, string[]>();
    for (const def of confirmed.get(old.name) ?? []) {
      for (const pair of features(def, prepareCode(old, prefixOld)).props) aligned.set(pair.code, [...(aligned.get(pair.code) ?? []), `${def.name} › ${pair.figma}`]);
    }
    for (const f of componentChanges(old, now)) {
      const target = f.slot !== undefined ? `slot "${f.slot}"` : f.prop;
      const alignedFigmaProps = target ? aligned.get(target) : undefined;
      const breaking = !!alignedFigmaProps && (f.kind === "prop-removed" || f.kind === "prop-renamed" || f.kind === "slot-removed");
      push({
        severity: severityFor(old.name, breaking),
        kind: f.kind,
        component: old.name,
        detail: f.detail,
        ...(alignedFigmaProps && { alignedFigmaProps }),
      });
    }
    if (!old.deprecated && now.deprecated) push({ severity: severityFor(old.name, false), kind: "component-deprecated", component: old.name, detail: typeof now.deprecated === "string" ? now.deprecated : "deprecated" });
  }

  const order: DriftSeverity[] = ["breaks-mapping", "affects-mapping", "info"];
  findings.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity) || a.component.localeCompare(b.component));
  const bySeverity = { "breaks-mapping": 0, "affects-mapping": 0, info: 0 } as Record<DriftSeverity, number>;
  for (const f of findings) bySeverity[f.severity]++;
  return {
    from: { ...(before.package && { package: before.package.name, version: before.package.version }) },
    to: { ...(after.package && { package: after.package.name, version: after.package.version }) },
    summary: {
      before: before.components.length,
      after: after.components.length,
      unchanged,
      changed,
      added: added.length - renamed.size,
      removed: removed.length - renamed.size,
      renamed: renamed.size,
    },
    bySeverity,
    findings,
  };
}

interface Change {
  kind: DriftKind;
  detail: string;
  prop?: string;
  slot?: string;
}

function componentChanges(old: CodeComponent, now: CodeComponent): Change[] {
  const out: Change[] = [];
  const design = (c: CodeComponent) => c.props.filter((p) => !p.internal);
  const oldProps = new Map(design(old).map((p) => [p.name, p]));
  const newProps = new Map(design(now).map((p) => [p.name, p]));
  const gone = [...oldProps.values()].filter((p) => !newProps.has(p.name));
  const fresh = [...newProps.values()].filter((p) => !oldProps.has(p.name));

  // A prop that disappeared while a similar one of the same type appeared was most likely renamed.
  const renamedTo = new Map<string, CodeProp>();
  for (const g of gone) {
    const candidate = fresh
      .filter((f) => !renamedTo.has(g.name) && ![...renamedTo.values()].includes(f) && typeKey(f.type) === typeKey(g.type))
      .map((f) => ({ f, sim: Math.max(tokenOverlap(tokens(g.name), tokens(f.name)), g.aliases.some((a) => f.aliases.includes(a)) ? 1 : 0) }))
      .sort((a, b) => b.sim - a.sim)[0];
    if (candidate && candidate.sim >= 0.5) renamedTo.set(g.name, candidate.f);
  }
  for (const g of gone) {
    const to = renamedTo.get(g.name);
    out.push(to ? { kind: "prop-renamed", prop: g.name, detail: `prop ${g.name} → ${to.name}` } : { kind: "prop-removed", prop: g.name, detail: `prop ${g.name} (${describe(g.type)}) removed` });
  }
  for (const f of fresh) if (![...renamedTo.values()].includes(f)) out.push({ kind: "prop-added", prop: f.name, detail: `prop ${f.name} (${describe(f.type)}) added` });

  for (const [name, o] of oldProps) {
    const n = newProps.get(name);
    if (!n) continue;
    if (o.type?.kind === "enum" && n.type?.kind === "enum") {
      const removedValues = o.type.values.filter((v) => !(n.type as { values: unknown[] }).values.includes(v));
      const addedValues = n.type.values.filter((v) => !(o.type as { values: unknown[] }).values.includes(v));
      if (removedValues.length || addedValues.length) {
        const parts = [...(removedValues.length ? [`removed ${removedValues.map((v) => JSON.stringify(v)).join(", ")}`] : []), ...(addedValues.length ? [`added ${addedValues.map((v) => JSON.stringify(v)).join(", ")}`] : [])];
        out.push({ kind: "enum-values-changed", prop: name, detail: `prop ${name}: ${parts.join("; ")}` });
      }
      if (o.type.open !== n.type.open) out.push({ kind: "prop-type-changed", prop: name, detail: `prop ${name}: ${n.type.open ? "now also accepts other values" : "no longer accepts other values"}` });
    } else if (typeKey(o.type) !== typeKey(n.type)) {
      out.push({ kind: "prop-type-changed", prop: name, detail: `prop ${name}: ${describe(o.type)} → ${describe(n.type)}` });
    }
    if ((o.defaultText ?? "") !== (n.defaultText ?? "")) out.push({ kind: "default-changed", prop: name, detail: `prop ${name}: default ${o.defaultText ?? "none"} → ${n.defaultText ?? "none"}` });
    if (!o.deprecated && n.deprecated) out.push({ kind: "prop-deprecated", prop: name, detail: `prop ${name} deprecated` });
  }

  const oldSlots = new Set(old.slots.map((s) => s.name));
  const newSlots = new Set(now.slots.map((s) => s.name));
  for (const s of oldSlots) if (!newSlots.has(s)) out.push({ kind: "slot-removed", slot: s, detail: `slot ${s ? `"${s}"` : "(default)"} removed` });
  for (const s of newSlots) if (!oldSlots.has(s)) out.push({ kind: "slot-added", slot: s, detail: `slot ${s ? `"${s}"` : "(default)"} added` });
  const oldEvents = new Set(old.events.map((e) => e.name));
  const newEvents = new Set(now.events.map((e) => e.name));
  for (const e of oldEvents) if (!newEvents.has(e)) out.push({ kind: "event-removed", detail: `event ${e} removed` });
  for (const e of newEvents) if (!oldEvents.has(e)) out.push({ kind: "event-added", detail: `event ${e} added` });
  return out;
}

function typeKey(t: TypeShape | undefined): string {
  if (!t) return "none";
  return t.kind === "enum" ? `enum:${typeof t.values[0]}` : t.kind === "other" ? `other:${t.text}` : t.kind;
}

function describe(t: TypeShape | undefined): string {
  if (!t) return "untyped";
  if (t.kind === "enum") return `${t.values.length} values${t.open ? ", open" : ""}`;
  return t.kind === "other" ? t.text : t.kind;
}

function propNameSimilarity(a: CodeComponent, b: CodeComponent): number {
  const A = new Set(a.props.map((p) => p.name));
  const B = new Set(b.props.map((p) => p.name));
  const inter = [...A].filter((x) => B.has(x)).length;
  return A.size + B.size - inter ? inter / (A.size + B.size - inter) : 0;
}

function isTaken(c: CodeComponent, renamed: Map<string, CodeComponent>): boolean {
  return [...renamed.values()].includes(c);
}
