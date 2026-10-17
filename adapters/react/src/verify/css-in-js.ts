// Hard-coded values in CSS-in-JS: styled-components and Emotion. Their styles are injected at runtime
// next to the design system's own (Chakra and MUI use Emotion too), so the render cannot tell them
// apart; the source can. Read here:
// - tagged templates: styled.div`…`, styled(Button)`…`, styled.a.attrs(…)`…`, css`…`, keyframes`…`
// - object styles: styled.div({ … }), css({ … })
// An interpolation ${…} is computed at runtime: it is read as unknown, never as a literal.

import { readFileSync } from "node:fs";
import { relative } from "node:path";
import ts from "typescript";
import type { StyleFact } from "@tulpar/core";
import { classify, declarations } from "@tulpar/web-kit";

/** The CSS-in-JS literals in one source file. */
export function cssInJsLiterals(root: string, file: string, prefix: string): StyleFact[] {
  const text = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const rel = relative(root, file).replace(/\\/g, "/");
  const out: StyleFact[] = [];
  const lineOf = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1;

  const visit = (node: ts.Node) => {
    if (ts.isTaggedTemplateExpression(node) && isStyleTag(node.tag)) {
      // Interpolations become a variable reference: dynamic, so not a literal.
      const t = node.template;
      const css = ts.isNoSubstitutionTemplateLiteral(t) ? t.text : t.head.text + t.templateSpans.map((s) => `var(--tulpar-interpolation)${s.literal.text}`).join("");
      const start = lineOf(t.getStart(sf));
      for (const d of declarations(`.x{${css}}`)) {
        const fact = classify(d.property, d.value, prefix, `${rel}:${start + d.line - 1}`);
        if (fact?.source === "literal") out.push(fact);
      }
    }
    if (ts.isCallExpression(node) && isStyleTag(node.expression)) {
      for (const arg of node.arguments) if (ts.isObjectLiteralExpression(arg)) objectLiterals(arg);
    }
    ts.forEachChild(node, visit);
  };

  const objectLiterals = (obj: ts.ObjectLiteralExpression) => {
    for (const p of obj.properties) {
      if (!ts.isPropertyAssignment(p)) continue;
      const v = p.initializer;
      // Nested selectors ("&:hover": { … }) hold more declarations.
      if (ts.isObjectLiteralExpression(v)) {
        objectLiterals(v);
        continue;
      }
      const name = p.name.getText(sf).replace(/['"]/g, "").replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
      // Emotion and styled-components append "px" to plain numbers, as React does.
      const value = ts.isStringLiteralLike(v) ? v.text : ts.isNumericLiteral(v) ? (v.text === "0" ? "0" : `${v.text}px`) : undefined;
      if (value === undefined) continue;
      const fact = classify(name, value, prefix, `${rel}:${lineOf(p.getStart(sf))}`);
      if (fact?.source === "literal") out.push(fact);
    }
  };

  visit(sf);
  return out;
}

/** styled.div, styled(Button), styled.a.attrs(…), css, keyframes, injectGlobal, createGlobalStyle. */
function isStyleTag(e: ts.Expression): boolean {
  if (ts.isIdentifier(e)) return /^(css|keyframes|injectGlobal|createGlobalStyle)$/.test(e.text);
  if (ts.isPropertyAccessExpression(e)) return isStyled(e.expression) || isStyleTag(e.expression);
  if (ts.isCallExpression(e)) return isStyled(e.expression) || (ts.isPropertyAccessExpression(e.expression) && isStyleTag(e.expression.expression));
  return false;
}

function isStyled(e: ts.Expression): boolean {
  return ts.isIdentifier(e) && e.text === "styled";
}
