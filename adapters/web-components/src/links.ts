// Code Connect links for Web Components: in a figma.connect(url, { example }) call,
// the element is the first custom element in the example.

import type { LinkSet } from "@tulpar/core";
import { parseCodeConnect as parse, readLinkDirs, type ComponentOf } from "@tulpar/web-kit";

export { figmaNode } from "@tulpar/web-kit";

const NOTE = "element = first custom element in the example";
const firstCustomElement: ComponentOf = (call, sf) => /<([a-z][a-z0-9]*-[a-z0-9-]+)/.exec(call.getText(sf))?.[1];

export function readLinks(root: string, dirs: string[]): LinkSet {
  return readLinkDirs(root, dirs, "web-components", firstCustomElement, NOTE);
}

export function parseCodeConnect(text: string, source: string) {
  return parse(text, source, firstCustomElement, NOTE);
}
