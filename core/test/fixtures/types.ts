import type { Figma } from "../../src/index.ts";

export type NodesResponseLike = Omit<Figma.FileNodesResponse, "nodes"> & {
  nodes: Record<string, Figma.NodeEntry>;
};
