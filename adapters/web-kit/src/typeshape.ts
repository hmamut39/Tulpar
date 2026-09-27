// Prop types from the TypeScript checker, as the core's TypeShape.
// Uses TypeScript 6, the last line with the stable compiler API.

import ts from "typescript";
import type { TypeShape } from "@tulpar/core";

/** Resolve a declared property's type, keeping each member of a union as written. */
export function typeShape(decl: ts.Declaration | undefined, type: ts.Type, checker: ts.TypeChecker): { type?: TypeShape; typeText: string } {
  return shape(declaredParts(decl, checker) ?? unionParts(type), type, checker);
}

function unionParts(type: ts.Type): ts.Type[] {
  return type.isUnion() ? type.types : [type];
}

/**
 * The members of a union as written, each resolved on its own. The checker reduces
 * `BUTTON_SIZE | string` to `string`, which would lose the enum's suggested values.
 */
function declaredParts(decl: ts.Declaration | undefined, checker: ts.TypeChecker): ts.Type[] | undefined {
  const node = decl && (ts.isPropertyDeclaration(decl) || ts.isPropertySignature(decl) || ts.isGetAccessorDeclaration(decl)) ? decl.type : undefined;
  if (!node || !ts.isUnionTypeNode(node)) return undefined;
  return node.types.flatMap((t) => unionParts(checker.getTypeFromTypeNode(t)));
}

function shape(rawParts: ts.Type[], type: ts.Type, checker: ts.TypeChecker): { type?: TypeShape; typeText: string } {
  const typeText = checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation);
  const parts = rawParts.filter((t) => !(t.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Void)));
  if (parts.length === 0) return { typeText };
  // `any` and `unknown` say nothing about the prop; report no type rather than a vague one.
  if (parts.some((t) => t.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown))) return { typeText };
  if (parts.every((t) => t.flags & ts.TypeFlags.BooleanLike)) return { type: { kind: "boolean" }, typeText };

  const literals: (string | number)[] = [];
  let openString = false;
  let openNumber = false;
  for (const t of parts) {
    if (t.isStringLiteral() || t.isNumberLiteral()) literals.push(t.value);
    else if (t.flags & ts.TypeFlags.String) openString = true;
    else if (t.flags & ts.TypeFlags.Number) openNumber = true;
    else return { type: { kind: "other", text: typeText }, typeText };
  }
  if (literals.length) return { type: { kind: "enum", values: [...new Set(literals)], open: openString || openNumber }, typeText };
  if (openString && !openNumber) return { type: { kind: "string" }, typeText };
  if (openNumber && !openString) return { type: { kind: "number" }, typeText };
  return { type: { kind: "other", text: typeText }, typeText };
}
