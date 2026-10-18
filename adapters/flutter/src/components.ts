// A Flutter design system's widgets, as the Dart analyzer reads them (tool/bin/index_widgets.dart),
// in Tulpar's component model: widget parameters become props, Widget-typed parameters slots
// (child, title, leading…), and on… callbacks events.

import type { CodeComponent, CodeProp, ComponentIndex, TypeShape } from "@tulpar/core";
import { dartTool, fingerprint } from "./sdk.ts";

interface DartParam {
  name: string;
  type: string;
  named: boolean;
  required: boolean;
  default?: string;
}

export interface DartWidget {
  name: string;
  constructorName?: string;
  doc?: string | null;
  deprecated?: boolean;
  params: DartParam[];
}

const provenance = { source: "dart-analyzer", confidence: "high" as const };

export async function indexWidgets(root: string, library: string): Promise<ComponentIndex> {
  const gaps: string[] = [];
  const read = await dartTool<{ widgets: DartWidget[] }>("index_widgets", [root, library], root, `${library}\n${fingerprint(root, "pubspec.lock", "pubspec.yaml")}`);
  const components = read.widgets.map((w) => toComponent(w, library));
  if (!components.length) gaps.push(`No widgets found in ${library}.`);
  return { adapter: "flutter", package: { name: library, version: "" }, components, gaps };
}

export function toComponent(w: DartWidget, library: string): CodeComponent {
  const isSlot = (p: DartParam) => /^(Widget\??|List<Widget>\??|PreferredSizeWidget\??)$/.test(p.type);
  const isEvent = (p: DartParam) => /^on[A-Z]/.test(p.name) && /Function/.test(p.type);
  return {
    id: `${library}#${w.name}`,
    name: w.name,
    exportName: w.name,
    module: library,
    ...(w.constructorName && { markup: `${w.name}.${w.constructorName}(…)` }),
    ...(w.doc && { description: w.doc }),
    ...(w.deprecated && { deprecated: true as const }),
    props: w.params.filter((p) => !isSlot(p) && !isEvent(p)).map(toProp),
    slots: w.params.filter(isSlot).map((p) => ({ name: p.name === "child" || p.name === "children" ? "" : p.name, description: `${p.name}: ${p.type}${p.required ? " (required)" : ""}`, provenance })),
    events: w.params.filter(isEvent).map((p) => ({ name: p.name, description: `${p.type}${p.required ? " (required: pass null to disable)" : ""}`, provenance })),
    provenance,
  };
}

function toProp(p: DartParam): CodeProp {
  return {
    name: p.name,
    aliases: [],
    typeText: p.type,
    type: shape(p.type),
    ...(p.default !== undefined && { defaultText: p.default }),
    required: p.required,
    provenance: { name: provenance, type: provenance, required: provenance, ...(p.default !== undefined && { default: provenance }) },
  };
}

function shape(type: string): TypeShape {
  const base = type.replace(/\?$/, "");
  if (base === "bool") return { kind: "boolean" };
  if (base === "String") return { kind: "string" };
  if (base === "int" || base === "double" || base === "num") return { kind: "number" };
  return { kind: "other", text: type };
}
