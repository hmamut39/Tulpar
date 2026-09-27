// Static scan of a React implementation: components used, and hard-coded values in
// style={{…}} objects and in the CSS files it imports.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import ts from "typescript";
import type { AnalyzeResult, StyleFact } from "@tulpar/core";
import { classify, declarations } from "@tulpar/web-kit";

export function analyzeReact(root: string, entry: string, prefix: string): AnalyzeResult {
  const file = join(root, entry);
  const text = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(entry, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const used = new Set<string>();
  const literals: StyleFact[] = [];
  const line = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sf);
      if (/^[A-Z]/.test(tag)) used.add(tag.split(".").at(-1)!);
    }
    if (ts.isJsxAttribute(node) && node.name.getText(sf) === "style" && node.initializer && ts.isJsxExpression(node.initializer)) {
      const obj = node.initializer.expression;
      if (obj && ts.isObjectLiteralExpression(obj)) {
        for (const p of obj.properties) {
          if (!ts.isPropertyAssignment(p)) continue;
          const cssName = p.name.getText(sf).replace(/['"]/g, "").replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
          const v = p.initializer;
          // React appends "px" to plain numbers for length properties.
          const value = ts.isStringLiteralLike(v) ? v.text : ts.isNumericLiteral(v) ? (v.text === "0" ? "0" : `${v.text}px`) : undefined;
          if (value === undefined) continue; // computed values: not statically known
          const fact = classify(cssName, value, prefix, `${entry}:${line(p)}`);
          if (fact?.source === "literal") literals.push(fact);
        }
      }
    }
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text.endsWith(".css") && node.moduleSpecifier.text.startsWith(".")) {
      const cssPath = join(dirname(file), node.moduleSpecifier.text);
      if (existsSync(cssPath)) {
        const rel = relative(root, cssPath).replace(/\\/g, "/");
        for (const d of declarations(readFileSync(cssPath, "utf8"))) {
          const fact = classify(d.property, d.value, prefix, `${rel}:${d.line}`);
          if (fact?.source === "literal") literals.push(fact);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { componentsUsed: [...used], literals };
}
