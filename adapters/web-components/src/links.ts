// Explicit links from Figma Code Connect files (https://developers.figma.com/docs/code-connect/).
//
// Two formats occur in the wild:
// - template files, whose header comments name the node and the element:
//     // url=https://www.figma.com/file/<key>/…?node-id=1854-1776
//     // component=cds-button
// - figma.connect(url, { variant?, example: html`<cds-…>` }) calls; the element is
//   the first custom element in the example.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import type { ExplicitLink, LinkSet, Provenance } from "@tulpar/core";

const HEADER: Provenance = { source: "code-connect-header", confidence: "high" };
const CONNECT: Provenance = { source: "code-connect-call", confidence: "high", note: "element = first custom element in the example" };

export function readLinks(root: string, dirs: string[]): LinkSet {
  const gaps: string[] = [];
  const links: ExplicitLink[] = [];
  let files = 0;
  let empty = 0;
  for (const dir of dirs) {
    const abs = join(root, dir);
    if (!existsSync(abs)) {
      gaps.push(`Code Connect directory not found: ${dir}`);
      continue;
    }
    for (const e of readdirSync(abs, { recursive: true, withFileTypes: true })) {
      if (!e.isFile() || !/\.figma\.(t|j)sx?$/.test(e.name)) continue;
      files++;
      const path = join(e.parentPath, e.name);
      const found = parseCodeConnect(readFileSync(path, "utf8"), relative(root, path).replace(/\\/g, "/"));
      if (!found.length) empty++;
      links.push(...found);
    }
  }
  if (empty) gaps.push(`${empty} of ${files} Code Connect files yielded no link.`);
  return { adapter: "web-components", links, gaps };
}

export function parseCodeConnect(text: string, source: string): ExplicitLink[] {
  const links: ExplicitLink[] = [];

  const url = /^\/\/\s*url=(\S+)/m.exec(text)?.[1];
  const component = /^\/\/\s*component=(\S+)/m.exec(text)?.[1];
  const headerNode = url ? figmaNode(url) : undefined;
  if (headerNode && component) links.push({ figma: headerNode, component, source, provenance: HEADER });

  const sf = ts.createSourceFile(source, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(sf) === "figma.connect") {
      const [first, second] = node.arguments;
      const nodeRef = first && ts.isStringLiteralLike(first) ? figmaNode(first.text) : undefined;
      const element = /<([a-z][a-z0-9]*-[a-z0-9-]+)/.exec(node.getText(sf))?.[1];
      if (nodeRef && element) {
        const variant = second && ts.isObjectLiteralExpression(second) ? variantOf(second, sf) : undefined;
        links.push({ figma: nodeRef, component: element, ...(variant && { variant }), source, provenance: CONNECT });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return links;
}

/** "https://www.figma.com/design/KEY/Name?node-id=12-34" → { fileKey: "KEY", nodeId: "12:34" } */
export function figmaNode(url: string): ExplicitLink["figma"] | undefined {
  const id = /[?&]node-id=([0-9]+)[-:]([0-9]+)/.exec(url);
  if (!id) return undefined;
  const key = /figma\.com\/(?:file|design)\/([A-Za-z0-9]+)/.exec(url)?.[1];
  return { ...(key && { fileKey: key }), nodeId: `${id[1]}:${id[2]}` };
}

function variantOf(options: ts.ObjectLiteralExpression, sf: ts.SourceFile): Record<string, string> | undefined {
  const prop = options.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText(sf).replace(/['"]/g, "") === "variant");
  if (!prop || !ts.isPropertyAssignment(prop) || !ts.isObjectLiteralExpression(prop.initializer)) return undefined;
  const out: Record<string, string> = {};
  for (const p of prop.initializer.properties) {
    if (!ts.isPropertyAssignment(p)) continue;
    const value = p.initializer;
    out[p.name.getText(sf).replace(/^['"]|['"]$/g, "")] = ts.isStringLiteralLike(value) ? value.text : value.getText(sf);
  }
  return out;
}
