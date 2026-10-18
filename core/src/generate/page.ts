// A whole page, split into the sections a developer would make components of: the large blocks the
// page stacks (header, hero, a form, the footer). Each is generated and verified on its own, then a
// page component places them.

import type { DesignNode } from "../model.ts";

export interface PageSection {
  node: DesignNode;
  /** A PascalCase component name from the layer's name, unique within the page. */
  name: string;
}

/**
 * The page's sections, or [] when the frame is not a page (fewer than two). Wrappers holding a single
 * child are looked through; a section spans at least half the page's width and is at least 40 pt tall.
 */
export function pageSections(root: DesignNode): PageSection[] {
  const kids = (n: DesignNode): DesignNode[] => ("children" in n ? n.children : []);
  let level = root;
  for (;;) {
    const visible = kids(level).filter((c) => c.visible);
    if (visible.length === 1 && visible[0]!.kind === "container") level = visible[0]!;
    else break;
  }
  const width = root.box?.width ?? 0;
  const blocks = kids(level).filter((c) => c.visible && c.kind !== "text" && c.kind !== "shape" && c.box && c.box.width >= width * 0.5 && c.box.height >= 40);
  if (blocks.length < 2) return [];
  const used = new Map<string, number>();
  return blocks.map((node, i) => {
    const base = pascal(node.name) || `Section${i + 1}`;
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    return { node, name: n === 1 ? base : `${base}${n}` };
  });
}

/** "site header / main" → "SiteHeaderMain"; a name starting with a digit gets a "Section" prefix. */
export function pascal(name: string): string {
  const words = name.replace(/[^A-Za-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  const joined = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
  return /^[0-9]/.test(joined) ? `Section${joined}` : joined;
}
