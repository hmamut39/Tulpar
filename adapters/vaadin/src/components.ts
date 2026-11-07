// Vaadin's components, read from their Java source (the runner unpacks the sources jars). A public class with
// @Tag("vaadin-…") is a component: its setters, including those it inherits from interfaces such as HasLabel, are
// props; its add…Listener methods events; HasComponents a slot; HasThemeVariant<XVariant> the variants it takes.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CodeComponent, CodeProp, ComponentIndex, TypeShape } from "@tulpar/core";

export interface JavaType {
  name: string;
  tag?: string;
  abstract: boolean;
  parents: string[];
  setters: { name: string; type: string }[];
  listeners: string[];
  variants?: string;
  enumValues?: string[];
}

const provenance = { source: "java-source", confidence: "high" as const };

const simple = (t: string) => t.replace(/<.*>/s, "").replace(/.*\./, "").trim();

/** Splits "A<B, C>, D" at top-level commas. */
function topLevel(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const c of list) {
    if (c === "<") depth++;
    else if (c === ">") depth--;
    if (c === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** The public type a Java file declares, with what it extends, implements, sets and listens to. */
export function parseType(source: string): JavaType | undefined {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const decl = /public\s+(abstract\s+)?(?:final\s+)?(class|interface|enum)\s+(\w+)(?:<[^{]*?>)?\s*((?:extends|implements)[^{]*)?\{/.exec(text);
  if (!decl) return undefined;
  const heritage = decl[4] ?? "";
  const parents = [...heritage.matchAll(/(?:extends|implements)\s+([^{]*?)(?=\s+implements\b|\s+extends\b|$)/g)].flatMap((m) => topLevel(m[1]!).map(simple));
  const type: JavaType = { name: decl[3]!, abstract: !!decl[1] || decl[2] === "interface", parents, setters: [], listeners: [] };
  // The router's error pages and internal classes carry tags too, but are not components a view uses.
  if (/^package\s+[\w.]*\.(router|internal)\b/m.test(text)) type.abstract = true;
  // @Tag("vaadin-button"), or a constant for plain HTML: @Tag(Tag.DIV).
  const tagged = /@Tag\(\s*(?:"([^"]+)"|Tag\.(\w+))\s*\)\s*(?:@[\w.]+(?:\([^)]*\))?\s*)*public\s+(?:abstract\s+)?class/.exec(text);
  const tag = tagged?.[1] ?? tagged?.[2]?.toLowerCase();
  if (tag) type.tag = tag;
  const variants = /HasThemeVariant<\s*(\w+)\s*>/.exec(heritage)?.[1];
  if (variants) type.variants = variants;
  if (decl[2] === "enum") {
    const body = text.slice(decl.index + decl[0].length);
    const head = body.slice(0, body.indexOf(";") < 0 ? body.length : body.indexOf(";"));
    type.enumValues = [...head.matchAll(/(@Deprecated\s*(?:\([^)]*\))?\s*)?\b([A-Z][A-Z0-9_]*)\s*(?:\(|,|$)/g)].filter((m) => !m[1]).map((m) => m[2]!);
  }
  for (const m of text.matchAll(/(@Deprecated[^\n]*\n\s*)?(?:public|default)\s+(?:default\s+)?void\s+(set[A-Z]\w*)\s*\(\s*(?:final\s+)?([\w.<>?,\s[\]]+?)\s+\w+\s*\)/g)) {
    if (m[1]) continue;
    type.setters.push({ name: m[2]!, type: m[3]!.replace(/\s+/g, " ").trim() });
  }
  for (const m of text.matchAll(/(?:public|default)\s+(?:default\s+)?Registration\s+(add\w+Listener)\s*\(/g)) type.listeners.push(m[1]!);
  return type;
}

function javaFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? javaFiles(join(dir, e.name)) : e.name.endsWith(".java") ? [join(dir, e.name)] : []));
}

function shape(type: string, types: Map<string, JavaType>): TypeShape {
  const t = simple(type);
  if (t === "boolean" || t === "Boolean") return { kind: "boolean" };
  if (t === "String") return { kind: "string" };
  if (["int", "Integer", "double", "Double", "float", "long"].includes(t)) return { kind: "number" };
  const e = types.get(t)?.enumValues;
  if (e?.length) return { kind: "enum", values: e.map((v) => `${t}.${v}`), open: false };
  return { kind: "other", text: type };
}

/** A component with everything it inherits, by simple name. */
function resolved(name: string, types: Map<string, JavaType>, seen = new Set<string>()): { setters: JavaType["setters"]; listeners: string[]; parents: Set<string>; variants?: string } {
  const t = types.get(name);
  seen.add(name);
  const out = { setters: [...(t?.setters ?? [])], listeners: [...(t?.listeners ?? [])], parents: new Set(t?.parents ?? []), variants: t?.variants };
  for (const p of t?.parents ?? []) {
    if (seen.has(p)) continue;
    const r = resolved(p, types, seen);
    out.setters.push(...r.setters);
    out.listeners.push(...r.listeners);
    for (const x of r.parents) out.parents.add(x);
    out.variants ??= r.variants;
  }
  return out;
}

export function toComponents(types: Map<string, JavaType>): CodeComponent[] {
  const out: CodeComponent[] = [];
  for (const t of types.values()) {
    if (!t.tag || t.abstract) continue;
    const r = resolved(t.name, types);
    const props = new Map<string, CodeProp>();
    for (const s of r.setters) {
      const name = s.name.charAt(3).toLowerCase() + s.name.slice(4);
      if (props.has(name)) continue;
      props.set(name, { name, aliases: [s.name], typeText: s.type, type: shape(s.type, types), required: false, description: `${s.name}(${s.type})`, provenance: { name: provenance, type: provenance, required: provenance } });
    }
    // Aura is the theme: Lumo's own variants (LUMO_…) do not apply.
    const variants = r.variants ? types.get(r.variants)?.enumValues?.filter((v) => !v.startsWith("LUMO_")) : undefined;
    if (variants?.length) props.set("themeVariants", { name: "themeVariants", aliases: ["addThemeVariants"], typeText: r.variants!, type: { kind: "enum", values: variants.map((v) => `${r.variants}.${v}`), open: false }, required: false, description: `addThemeVariants(${r.variants}...)`, provenance: { name: provenance, type: provenance, required: provenance } });
    out.push({
      id: `vaadin.${t.name}`,
      name: t.name,
      exportName: t.name,
      module: "com.vaadin.flow.component",
      props: [...props.values()],
      slots: r.parents.has("HasComponents") ? [{ name: "", description: "add(Component...)", provenance }] : [],
      events: [...new Set(r.listeners)].map((l) => ({ name: l, description: `${l}(…)`, provenance })),
      provenance,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function readTypes(dir: string): Map<string, JavaType> {
  const types = new Map<string, JavaType>();
  for (const f of javaFiles(dir)) {
    const t = parseType(readFileSync(f, "utf8"));
    if (t && !types.has(t.name)) types.set(t.name, t);
  }
  return types;
}

/** Element name → component, for naming what the page draws. */
export function tagsOf(components: CodeComponent[], types: Map<string, JavaType>): Record<string, string> {
  // Several components draw a <div> (Div, FlexLayout…): an element is named by the one called after it.
  const out: Record<string, string> = {};
  for (const c of components) {
    const tag = types.get(c.name)?.tag;
    if (tag && (!out[tag] || c.name.toLowerCase() === tag)) out[tag] = c.name;
  }
  return out;
}

export function indexHere(root: string, version: string): ComponentIndex & { tags: Record<string, string> } {
  const dir = join(root, ".tulpar", "sources");
  if (!existsSync(dir)) return { adapter: "vaadin", package: { name: "Vaadin", version }, components: [], gaps: ["The Vaadin sources were not unpacked (mvn dependency:unpack-dependencies -Dclassifier=sources)."], tags: {} };
  const types = readTypes(dir);
  const components = toComponents(types);
  return { adapter: "vaadin", package: { name: "Vaadin", version }, components, gaps: components.length ? [] : ["No Vaadin components found."], tags: tagsOf(components, types) };
}
