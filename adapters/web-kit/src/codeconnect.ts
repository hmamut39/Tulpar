// Explicit links from Figma Code Connect files (https://developers.figma.com/docs/code-connect/).
//
// Two formats occur in the wild, in every framework:
// - template files, whose header comments name the node and the component:
//     // url=https://www.figma.com/file/<key>/…?node-id=1854-1776
//     // component=Button
// - figma.connect(…) calls. Where the component's name sits in the call differs per
//   framework, so the adapter supplies `componentOf`.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import type { ExplicitLink, LinkSet, Provenance } from "@tulpar/core";

const HEADER: Provenance = { source: "code-connect-header", confidence: "high" };

export type ComponentOf = (call: ts.CallExpression, sf: ts.SourceFile) => string | undefined;

export function readLinkDirs(root: string, dirs: string[], adapter: string, componentOf: ComponentOf, note: string): LinkSet {
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
      const found = parseCodeConnect(readFileSync(path, "utf8"), relative(root, path).replace(/\\/g, "/"), componentOf, note);
      if (!found.length) empty++;
      links.push(...found);
    }
  }
  if (empty) gaps.push(`${empty} of ${files} Code Connect files yielded no link.`);
  return { adapter, links, gaps };
}

export function parseCodeConnect(text: string, source: string, componentOf: ComponentOf, note: string): ExplicitLink[] {
  const links: ExplicitLink[] = [];
  const url = /^\/\/\s*url=(\S+)/m.exec(text)?.[1];
  const component = /^\/\/\s*component=(\S+)/m.exec(text)?.[1];
  const headerNode = url ? figmaNode(url) : undefined;
  if (headerNode && component) links.push({ figma: headerNode, component, source, provenance: HEADER });

  const sf = ts.createSourceFile(source, text, ts.ScriptTarget.Latest, true, source.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(sf) === "figma.connect") {
      const urlArg = node.arguments.find((a) => ts.isStringLiteralLike(a));
      const nodeRef = urlArg && ts.isStringLiteralLike(urlArg) ? figmaNode(urlArg.text) : undefined;
      const name = componentOf(node, sf);
      if (nodeRef && name) {
        const options = node.arguments.find((a) => ts.isObjectLiteralExpression(a));
        const variant = options && ts.isObjectLiteralExpression(options) ? variantOf(options, sf) : undefined;
        links.push({ figma: nodeRef, component: name, ...(variant && { variant }), source, provenance: { source: "code-connect-call", confidence: "high", note } });
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
