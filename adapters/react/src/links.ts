// Code Connect links for React: in figma.connect(Component, url, …) the component is the first argument.

import ts from "typescript";
import type { LinkSet } from "@tulpar/core";
import { parseCodeConnect as parse, readLinkDirs, type ComponentOf } from "@tulpar/web-kit";

const NOTE = "component = first argument of figma.connect";

const firstArgument: ComponentOf = (call, sf) => {
  const first = call.arguments[0];
  if (!first || ts.isStringLiteralLike(first)) return undefined;
  // `Tabs.Tab` → "Tab"? No: keep what code writes; the index names exports, so take the last segment.
  return first.getText(sf).split(".").at(-1);
};

export function readLinks(root: string, dirs: string[]): LinkSet {
  return readLinkDirs(root, dirs, "react", firstArgument, NOTE);
}

export function parseCodeConnect(text: string, source: string) {
  return parse(text, source, firstArgument, NOTE);
}
