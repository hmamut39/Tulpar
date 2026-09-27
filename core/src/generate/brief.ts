// The generation brief: everything the model needs to write the component, and nothing
// it would have to guess. Framework-free: the adapter supplies the framework's file
// conventions; the core supplies the design, the mapping and the tokens.

import type { CodeComponent, ComponentIndex, TokenSet } from "../code-model.ts";
import type { ComponentDef, DesignNode, DesignTree, InstanceNode, Library } from "../model.ts";
import { features, prepareCode } from "../match/features.ts";
import { commonPrefix, normValue } from "../match/text.ts";
import { tokenHints, type TokenHint } from "./tokens-hint.ts";

/** What an adapter says about writing code for its framework. */
export interface Conventions {
  language: string;
  framework: string;
  /** Files to produce; `{name}` is replaced by the component name. */
  files: { path: string; role: "component" | "template" | "styles" | "test"; description: string }[];
  /** The file `build` takes as its entry, after `{name}` substitution. */
  entry: string;
  rules: string[];
  /** How design-system components are imported, e.g. `import { Button } from "@carbon/react";`. */
  importExample: string;
}

export interface InstanceHint {
  figmaId: string;
  figmaName: string;
  component?: string;
  /** Figma property values translated to code props, where the mapping allows. */
  props: Record<string, string | boolean>;
  /** Figma properties with no code counterpart found; the model must not invent props for them. */
  unmapped: string[];
  text: string;
}

export interface Brief {
  name: string;
  outline: string;
  instances: InstanceHint[];
  components: string;
  tokens: TokenHint[];
  /** Spacing and size tokens that exist in code, with their values: the only ones the model may use. */
  dimensions: { name: string; codeRef?: string; points: number }[];
  conventions: Conventions;
}

export interface BriefInput {
  name: string;
  design: DesignTree;
  mapping: Map<string, string>;
  index: ComponentIndex;
  tokens?: TokenSet;
  library?: Library;
  conventions: Conventions;
  mode?: string;
}

export function buildBrief(input: BriefInput): Brief {
  const { design, mapping, index } = input;
  const known = new Map(index.components.map((c) => [c.name, c]));
  const defs = new Map<string, ComponentDef>();
  for (const d of input.library?.components ?? []) {
    defs.set(d.id, d);
    for (const v of d.variants) defs.set(v.id, d);
  }
  const prefix = commonPrefix(index.components.map((c) => c.name));

  const instances: InstanceHint[] = [];
  const lines: string[] = [];
  const outline = (n: DesignNode, depth: number, insideInstance: boolean) => {
    if (!n.visible) return;
    const pad = "  ".repeat(depth);
    const box = n.box ? `(${r(n.box.x)},${r(n.box.y)} ${r(n.box.width)}×${r(n.box.height)})` : "";
    if (n.kind === "instance" && !insideInstance) {
      const component = mapping.get(n.id) ?? mapping.get(n.component.id) ?? (n.component.set && mapping.get(n.component.set.id));
      const def = defs.get(n.component.id) ?? (n.component.set && defs.get(n.component.set.id));
      const hint = instanceHint(n, component ? known.get(component) : undefined, def, prefix);
      instances.push(hint);
      const props = Object.entries(hint.props).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ");
      lines.push(`${pad}- INSTANCE id=${n.id} "${n.component.set?.name ?? n.component.name ?? n.name}" → ${component ?? "NO MAPPED COMPONENT"} ${props} ${box}${hint.text ? ` text=${JSON.stringify(hint.text)}` : ""}`);
      // Its own layers are the component's business; content placed into it goes inside it in code.
      if (n.content?.length) {
        lines.push(`${pad}  content (place inside ${component ?? "it"}):`);
        for (const c of n.content) outline(c, depth + 2, false);
      }
      return;
    }
    if (n.kind === "text") {
      const s = n.style;
      lines.push(`${pad}- TEXT id=${n.id} ${JSON.stringify(n.characters)} ${box} ${s.fontFamily ?? ""} ${s.fontSize ?? ""}/${s.lineHeight ?? ""} w${s.fontWeight ?? ""}${tokenNote(n)}`);
      return;
    }
    const stack = n.kind !== "shape" && n.stack ? ` stack=${n.stack.axis} gap=${n.stack.gap} pad=${[n.stack.padding.top, n.stack.padding.right, n.stack.padding.bottom, n.stack.padding.left].join("/")} align=${n.stack.mainAlign}/${n.stack.crossAlign}` : "";
    const label = n.kind === "shape" ? `SHAPE ${n.figmaType}` : n.kind === "container" ? n.figmaType : "INSTANCE";
    lines.push(`${pad}- ${label} id=${n.id} "${n.name}" ${box}${stack}${fillNote(n)}${tokenNote(n)}`);
    for (const c of n.children) outline(c, depth + 1, insideInstance || n.kind === "instance");
  };
  outline(design.root, 0, false);

  const used = [...new Set(instances.map((i) => i.component).filter((c): c is string => !!c))];
  const rootComponent = mapping.get(design.root.id);
  if (rootComponent) used.unshift(rootComponent);
  const components = [...new Set(used)].map((name) => describeComponent(known.get(name))).filter(Boolean).join("\n");

  return {
    name: input.name,
    outline: [`ROOT maps to: ${rootComponent ?? "no design-system component (compose it)"}`, ...lines].join("\n"),
    instances,
    components,
    tokens: input.tokens ? tokenHints(design.root, input.tokens, input.mode ?? input.tokens.modes[0] ?? "default") : [],
    dimensions: (input.tokens?.tokens ?? [])
      .filter((t) => t.type === "dimension" && t.codeRefConfirmed !== false)
      .flatMap((t) => {
        const v = t.values.default ?? Object.values(t.values)[0];
        return v?.kind === "dimension" ? [{ name: t.name, ...(t.codeRef && { codeRef: t.codeRef }), points: v.points }] : [];
      }),
    conventions: input.conventions,
  };
}

function instanceHint(n: InstanceNode, code: CodeComponent | undefined, def: ComponentDef | undefined, prefix: string | undefined): InstanceHint {
  const props: Record<string, string | boolean> = {};
  const unmapped: string[] = [];
  const pairs = code && def ? features(def, prepareCode(code, prefix)).props : [];
  const codeProps = new Map((code?.props ?? []).map((p) => [p.name, p]));
  if (code && !def) {
    // Read from a screenshot: props already use the code's names. Keep only valid ones.
    for (const p of n.props) {
      const target = codeProps.get(p.name);
      const value = String(p.value);
      if (target?.type?.kind === "enum" && target.type.values.map(String).includes(value)) props[p.name] = value;
      else if (target?.type?.kind === "boolean" && (value === "true" || value === "false")) props[p.name] = value === "true";
      else unmapped.push(`${p.name}=${value}`);
    }
    return { figmaId: n.id, figmaName: n.name, component: code.name, props, unmapped, text: visibleText(n) };
  }
  for (const p of n.props) {
    if (p.type === "instance-swap") continue;
    const pair = pairs.find((x) => x.figma === p.name);
    const target = pair && codeProps.get(pair.code);
    if (p.type === "variant" && target?.type?.kind === "enum") {
      const value = target.type.values.find((v) => normValue(v) === normValue(String(p.value)));
      if (value !== undefined) props[target.name] = String(value);
      else unmapped.push(`${p.name}=${p.value}`);
    } else if (p.type === "variant" && target?.type?.kind === "boolean") {
      if (normValue(String(p.value)) === normValue(target.name)) props[target.name] = true;
    } else if (p.type === "boolean" && target?.type?.kind === "boolean") {
      props[target.name] = p.value as boolean;
    } else if (p.type === "text") {
      // A label is content: with a default slot it goes there (the outline shows it as the instance's text).
      // Only a component without one takes it as a string prop; name overlap alone ("Button text" ~
      // "tooltipText") is not enough to route a label into some other prop.
      const hasDefaultSlot = code?.slots.some((s) => s.name === "") ?? false;
      if (!hasDefaultSlot && target?.type?.kind === "string") props[target.name] = String(p.value);
    } else if (p.type === "variant" && !["Enabled", "Default"].includes(String(p.value))) {
      unmapped.push(`${p.name}=${p.value}`);
    }
  }
  return { figmaId: n.id, figmaName: n.name, ...(code && { component: code.name }), props, unmapped, text: visibleText(n) };
}

function describeComponent(c: CodeComponent | undefined): string {
  if (!c) return "";
  const props = c.props
    .filter((p) => !p.internal && !p.deprecated)
    .slice(0, 40)
    .map((p) => `${p.name}${p.type?.kind === "enum" ? `: ${p.type.values.map((v) => JSON.stringify(v)).join(" | ")}${p.type.open ? " | string" : ""}` : p.type ? `: ${p.type.kind === "other" ? p.type.text : p.type.kind}` : ""}`);
  const slots = c.slots.map((s) => (s.name ? s.name : "children/default"));
  return `${c.name} (${c.module})${c.markup ? `\n  written as: ${c.markup}` : ""}\n  props: ${props.join("; ") || "none"}\n  slots: ${slots.join(", ") || "none"}${c.extends?.length ? `\n  extends: ${c.extends.join(", ")}` : ""}`;
}

function visibleText(n: DesignNode): string {
  if (!n.visible) return "";
  if (n.kind === "text") return n.characters;
  return n.children.map(visibleText).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function fillNote(n: DesignNode): string {
  const solid = n.fills.find((f) => f.kind === "solid");
  if (!solid || solid.kind !== "solid") return "";
  const hex = [solid.color.r, solid.color.g, solid.color.b].map((c) => Math.round(c * 255).toString(16).padStart(2, "0")).join("");
  return ` fill=#${hex}${solid.token ? `(var ${solid.token.source === "variable" ? solid.token.id : solid.token.name})` : ""}`;
}

function tokenNote(n: DesignNode): string {
  const styles = Object.values(n.tokens).filter((t) => t.source === "style").map((t) => (t.source === "style" ? t.name : ""));
  return styles.length ? ` styles=[${styles.join(", ")}]` : "";
}

function r(x: number): number {
  return Math.round(x * 10) / 10;
}
