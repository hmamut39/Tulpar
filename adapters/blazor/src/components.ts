// A Blazor design system's components, in Tulpar's component model: [Parameter] properties become props,
// RenderFragment parameters slots (ChildContent is the default slot), and EventCallback parameters events.

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { CodeComponent, CodeProp, ComponentIndex, TypeShape } from "@tulpar/core";
import { indexTool } from "./sdk.ts";

export interface CsParam {
  name: string;
  type: string;
  required: boolean;
  values: string[] | null;
  deprecated: boolean;
  /** The parameter that takes unmatched attributes (UserAttributes): not for setting directly. */
  attributes: boolean;
}

export interface CsComponent {
  name: string;
  ns: string;
  typeParams: string[];
  parameters: CsParam[];
}

const provenance = { source: "dotnet-metadata", confidence: "high" as const };

export async function indexComponents(root: string, packages: string[]): Promise<ComponentIndex> {
  const assets = join(root, "obj", "project.assets.json");
  if (!existsSync(assets)) return { adapter: "blazor", components: [], gaps: ["The project is not restored: run dotnet restore."] };
  const read = await indexTool<{ components: CsComponent[] }>(root, assets, packages);
  const components = read.components.map(toComponent);
  return { adapter: "blazor", ...(packages[0] && { package: { name: packages[0], version: "" } }), components, gaps: components.length ? [] : [`No components found in ${packages.join(", ")}.`] };
}

export function toComponent(c: CsComponent): CodeComponent {
  const isSlot = (p: CsParam) => /^RenderFragment\b/.test(p.type);
  const isEvent = (p: CsParam) => /^EventCallback\b/.test(p.type);
  const generic = c.typeParams.length ? ` ${c.typeParams.map((t) => `${t}="string"`).join(" ")}` : "";
  return {
    id: `${c.ns}.${c.name}`,
    name: c.name,
    exportName: c.name,
    module: c.ns,
    // A generic component must be told its type: Razor cannot always infer it.
    markup: `<${c.name}${generic}>`,
    props: c.parameters.filter((p) => !isSlot(p) && !isEvent(p) && !p.attributes).map(toProp),
    slots: c.parameters.filter(isSlot).map((p) => ({ name: p.name === "ChildContent" ? "" : p.name, description: `${p.name}: ${p.type}`, provenance })),
    events: c.parameters.filter(isEvent).map((p) => ({ name: p.name, description: p.type, provenance })),
    provenance,
  };
}

function toProp(p: CsParam): CodeProp {
  return { name: p.name, aliases: [], typeText: p.type, type: shape(p), required: p.required, ...(p.deprecated && { deprecated: true }), provenance: { name: provenance, type: provenance, required: provenance } };
}

function shape(p: CsParam): TypeShape {
  if (p.values) return { kind: "enum", values: p.values, open: false };
  if (p.type === "Boolean") return { kind: "boolean" };
  if (p.type === "String") return { kind: "string" };
  if (/^(U?Int(16|32|64)|Byte|Single|Double|Decimal)$/.test(p.type)) return { kind: "number" };
  return { kind: "other", text: p.type };
}
