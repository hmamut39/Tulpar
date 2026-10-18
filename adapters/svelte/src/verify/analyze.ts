// Static scan of a Svelte component: the components its markup uses, and hard-coded values in its
// <style> block and in static style="…" attributes, read with the project's own Svelte parser.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AnalyzeResult, StyleFact } from "@tulpar/core";
import { classify, declarations } from "@tulpar/web-kit";
import { compilerFor, preprocessStyles } from "../compile.ts";

interface Node {
  type: string;
  name?: string;
  start?: number;
  attributes?: { type: string; name: string; value?: unknown; start: number }[];
  fragment?: { nodes: Node[] };
  children?: Node[];
  [k: string]: unknown;
}

/**
 * Which component each data-figma-id is written on in the source (<Heading data-figma-id="e2">).
 * The render needs it for elements Svelte creates dynamically (<svelte:element>, as Carbon's Heading
 * does): those carry no __svelte_meta to say which component drew them.
 */
export async function componentsWrittenOn(root: string, entry: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  let ast: { fragment?: { nodes: Node[] } };
  try {
    ast = (await compilerFor(root)).parse(readFileSync(join(root, entry), "utf8"), { modern: true }) as typeof ast;
  } catch {
    return out;
  }
  const visit = (n: Node) => {
    if (n.type === "Component" && n.name) {
      const id = (n.attributes ?? []).find((a) => a.type === "Attribute" && a.name === "data-figma-id");
      const text = Array.isArray(id?.value) ? (id!.value as { type: string; data?: string }[]).map((p) => (p.type === "Text" ? p.data ?? "" : "")).join("") : "";
      if (text) out[text] = n.name.split(".").at(-1)!;
    }
    for (const value of Object.values(n)) {
      if (value && typeof value === "object" && "nodes" in (value as object)) for (const c of (value as { nodes: Node[] }).nodes) visit(c);
    }
  };
  for (const n of ast.fragment?.nodes ?? []) visit(n);
  return out;
}

export async function analyzeSvelte(root: string, entry: string, prefix: string): Promise<AnalyzeResult> {
  // SCSS and LESS are read compiled, so a value hidden in a variable is still seen as hard-coded.
  let text = readFileSync(join(root, entry), "utf8");
  try {
    text = preprocessStyles(text, join(root, entry));
  } catch {
    // a stylesheet that does not compile fails the build, which says why
  }
  const svelte = await compilerFor(root);
  const used = new Set<string>();
  const literals: StyleFact[] = [];
  const lineAt = (pos: number) => text.slice(0, pos).split("\n").length;
  let ast: { fragment?: { nodes: Node[] }; css?: { content: { start: number; styles: string } } };
  try {
    ast = svelte.parse(text, { modern: true }) as typeof ast;
  } catch {
    return { componentsUsed: [], literals: [] }; // a component that does not parse fails the build, which says why
  }

  const visit = (n: Node) => {
    if (n.type === "Component" && n.name) used.add(n.name.split(".").at(-1)!);
    for (const a of n.attributes ?? []) {
      if (a.type !== "Attribute" || a.name !== "style" || !Array.isArray(a.value)) continue;
      const parts = a.value as { type: string; data?: string }[];
      if (parts.some((p) => p.type !== "Text")) continue; // dynamic styles: not statically known
      for (const decl of parts.map((p) => p.data ?? "").join("").split(";")) {
        const at = decl.indexOf(":");
        if (at < 0) continue;
        const fact = classify(decl.slice(0, at).trim(), decl.slice(at + 1).trim(), prefix, `${entry}:${lineAt(a.start)}`);
        if (fact?.source === "literal") literals.push(fact);
      }
    }
    // Children live in fragments (elements, components, blocks) and in the branches of {#if}/{#each}.
    for (const value of Object.values(n)) {
      if (value && typeof value === "object" && "nodes" in (value as object)) for (const c of (value as { nodes: Node[] }).nodes) visit(c);
    }
  };
  for (const n of ast.fragment?.nodes ?? []) visit(n);

  if (ast.css) {
    const startLine = lineAt(ast.css.content.start);
    for (const d of declarations(ast.css.content.styles)) {
      const fact = classify(d.property, d.value, prefix, `${entry}:${startLine + d.line - 1}`);
      if (fact?.source === "literal") literals.push(fact);
    }
  }
  return { componentsUsed: [...used], literals };
}
