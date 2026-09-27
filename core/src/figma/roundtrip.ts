// Round-trip check: rebuild absolute Figma geometry from a DesignTree and compare
// it with what Figma reported. Proves the normaliser keeps every node, id, box and
// text, and counts anything it could not express.

import type * as F from "./types.ts";
import type { Box, DesignNode, DesignTree } from "../model.ts";

export interface RoundTripReport {
  nodeId: string;
  nodes: number;
  boxesChecked: number;
  /** Nodes Figma reported without bounds; nothing to compare. */
  boxesAbsent: number;
  /** Largest absolute difference in any box coordinate, in design points. */
  maxBoxError: number;
  mismatches: string[];
  /** Counts of Figma properties the model could not express, by reason. */
  unsupported: Record<string, number>;
}

export function roundTrip(tree: DesignTree, figma: F.FigmaNode): RoundTripReport {
  const report: RoundTripReport = {
    nodeId: figma.id,
    nodes: 0,
    boxesChecked: 0,
    boxesAbsent: 0,
    maxBoxError: 0,
    mismatches: [],
    unsupported: {},
  };
  compare(tree.root, figma, tree.origin, report);
  return report;
}

function compare(model: DesignNode, figma: F.FigmaNode, origin: { x: number; y: number }, r: RoundTripReport): void {
  r.nodes++;
  const where = `${figma.id} (${figma.name})`;
  if (model.id !== figma.id) r.mismatches.push(`${where}: model id ${model.id}`);

  checkBox("box", model.box, figma.absoluteBoundingBox, origin, where, r);
  if (model.renderBox !== undefined) checkBox("renderBox", model.renderBox, figma.absoluteRenderBounds, origin, where, r);

  const expectedKind = figma.type === "TEXT" ? "text" : figma.type === "INSTANCE" ? "instance" : undefined;
  if (expectedKind && model.kind !== expectedKind) r.mismatches.push(`${where}: kind ${model.kind}, expected ${expectedKind}`);
  if (model.kind === "text" && model.characters !== (figma.characters ?? "")) r.mismatches.push(`${where}: text differs`);
  if (model.kind === "instance" && model.component.id !== (figma.componentId ?? "")) {
    r.mismatches.push(`${where}: component ${model.component.id}, expected ${figma.componentId}`);
  }
  for (const u of model.unsupported ?? []) r.unsupported[u] = (r.unsupported[u] ?? 0) + 1;

  const modelKids = model.kind === "text" ? [] : model.children;
  const figmaKids = figma.children ?? [];
  if (modelKids.length !== figmaKids.length) {
    r.mismatches.push(`${where}: ${modelKids.length} children, expected ${figmaKids.length}`);
    return;
  }
  figmaKids.forEach((child, i) => compare(modelKids[i]!, child, origin, r));
}

function checkBox(
  label: string,
  box: Box | null,
  expected: F.Rect | null | undefined,
  origin: { x: number; y: number },
  where: string,
  r: RoundTripReport,
): void {
  if (!expected) {
    if (box) r.mismatches.push(`${where}: ${label} present, Figma has none`);
    else if (label === "box") r.boxesAbsent++;
    return;
  }
  if (!box) {
    r.mismatches.push(`${where}: ${label} missing`);
    return;
  }
  if (label === "box") r.boxesChecked++;
  const rebuilt = { x: origin.x + box.x, y: origin.y + box.y, width: box.width, height: box.height };
  for (const k of ["x", "y", "width", "height"] as const) {
    const err = Math.abs(rebuilt[k] - expected[k]);
    r.maxBoxError = Math.max(r.maxBoxError, err);
    if (err !== 0) r.mismatches.push(`${where}: ${label}.${k} ${rebuilt[k]} ≠ ${expected[k]}`);
  }
}
