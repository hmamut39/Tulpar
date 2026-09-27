// Component definitions from Figma pages → Library.

import type * as F from "./types.ts";
import { DESIGN_MODEL_VERSION, type ComponentDef, type Library, type PropDef, type VariantDef } from "../model.ts";
import { propName, propType } from "./normalize.ts";

export interface PageEntry {
  page: F.FigmaNode;
  components: Record<string, F.ComponentMeta>;
  componentSets: Record<string, F.ComponentSetMeta>;
  styles: Record<string, F.StyleMeta>;
}

export function extractLibrary(
  file: { fileKey: string; fileVersion: string; fileName: string },
  pages: PageEntry[],
): Library {
  const components: ComponentDef[] = [];
  const styles = new Map<string, Library["styles"][number]>();

  for (const { page, components: meta, componentSets: setMeta, styles: styleMeta } of pages) {
    const visit = (node: F.FigmaNode) => {
      if (node.type === "COMPONENT_SET") {
        components.push(componentSet(node, page.name, meta, setMeta[node.id]));
        return; // Variants are described by the set.
      }
      if (node.type === "COMPONENT") {
        components.push(component(node, page.name, meta[node.id]));
        return; // Components nested in components are not separate library entries.
      }
      // INSTANCE subtrees can't define components; skip them for speed.
      if (node.type !== "INSTANCE") node.children?.forEach(visit);
    };
    page.children?.forEach(visit);

    for (const [id, s] of Object.entries(styleMeta)) {
      if (s.remote) continue;
      styles.set(id, {
        id,
        key: s.key,
        name: s.name,
        type: s.styleType.toLowerCase() as Library["styles"][number]["type"],
        description: s.description,
      });
    }
  }

  return {
    schemaVersion: DESIGN_MODEL_VERSION,
    source: file,
    components,
    styles: [...styles.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

function componentSet(
  node: F.FigmaNode,
  page: string,
  meta: Record<string, F.ComponentMeta>,
  setMeta: F.ComponentSetMeta | undefined,
): ComponentDef {
  const variants: VariantDef[] = (node.children ?? [])
    .filter((c) => c.type === "COMPONENT")
    .map((c) => ({ id: c.id, ...(meta[c.id] && { key: meta[c.id]!.key }), name: c.name, values: parseVariantName(c.name) }));
  // Figma's default variant is the first child (top-left in the set).
  const first = node.children?.find((c) => c.type === "COMPONENT");
  return {
    kind: "component-set",
    id: node.id,
    ...(setMeta && { key: setMeta.key }),
    name: node.name,
    description: setMeta?.description ?? "",
    links: (setMeta?.documentationLinks ?? []).map((l) => l.uri),
    page: page.trim(),
    private: isPrivate(node.name),
    props: propDefs(node.componentPropertyDefinitions),
    variants,
    size: first?.absoluteBoundingBox ? { width: first.absoluteBoundingBox.width, height: first.absoluteBoundingBox.height } : null,
  };
}

function component(node: F.FigmaNode, page: string, meta: F.ComponentMeta | undefined): ComponentDef {
  const box = node.absoluteBoundingBox;
  return {
    kind: "component",
    id: node.id,
    ...(meta && { key: meta.key }),
    name: node.name,
    description: meta?.description ?? "",
    links: (meta?.documentationLinks ?? []).map((l) => l.uri),
    page: page.trim(),
    private: isPrivate(node.name),
    props: propDefs(node.componentPropertyDefinitions),
    variants: [],
    size: box ? { width: box.width, height: box.height } : null,
  };
}

function propDefs(defs: Record<string, F.ComponentPropertyDefinition> | undefined): PropDef[] {
  return Object.entries(defs ?? {}).map(([figmaName, d]) => ({
    name: propName(figmaName, d.type),
    figmaName,
    type: propType(d.type),
    default: d.defaultValue,
    ...(d.variantOptions && { options: d.variantOptions }),
    ...(d.preferredValues?.length && {
      preferred: d.preferredValues.map((p) => ({
        type: p.type === "COMPONENT" ? ("component" as const) : ("component-set" as const),
        key: p.key,
      })),
    }),
  }));
}

/** "Size=Large, State=Hover" → { Size: "Large", State: "Hover" }. */
export function parseVariantName(name: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const part of name.split(",")) {
    const eq = part.indexOf("=");
    if (eq > 0) values[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return values;
}

function isPrivate(name: string): boolean {
  return /^[_.]/.test(name.trim());
}
