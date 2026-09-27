// Tier 1: resolve prop types from a package's shipped TypeScript declarations,
// using the TypeScript checker. Uses TypeScript 6, the last line with the stable
// compiler API (TypeScript 7 exposes only an unstable API).

import ts from "typescript";
import type { TypeShape } from "@tulpar/core";

export interface ResolvedProp {
  type?: TypeShape;
  typeText: string;
  /** "static": a class-level member (e.g. Lit's `styles`), not an element prop. */
  member: "instance" | "static";
  readonly: boolean;
  optional: boolean;
}

export interface ClassInfo {
  name: string;
  /** Names of every class this one inherits from, nearest first. */
  bases: string[];
  resolve(prop: string): ResolvedProp | undefined;
}

export class Declarations {
  readonly #program: ts.Program;
  readonly #checker: ts.TypeChecker;

  constructor(files: string[]) {
    this.#program = ts.createProgram(files, {
      noEmit: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2022,
      // Component packages are written for bundlers: extensionless relative imports are common.
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
    });
    this.#checker = this.#program.getTypeChecker();
  }

  /**
   * The class in `file` that declares the element. A declaration file can hold several
   * classes, so the one that knows the most of `propNames` wins.
   */
  findClass(file: string, propNames: string[]): ClassInfo | undefined {
    const source = this.#program.getSourceFile(file);
    if (!source) return undefined;
    let best: { node: ts.ClassDeclaration; score: number } | undefined;
    for (const stmt of source.statements) {
      if (!ts.isClassDeclaration(stmt) || !stmt.name) continue;
      const type = this.#checker.getTypeAtLocation(stmt.name);
      const statics = this.#checker.getTypeOfSymbolAtLocation(this.#checker.getSymbolAtLocation(stmt.name)!, stmt.name);
      const score = propNames.filter((p) => type.getProperty(p) || statics.getProperty(p)).length;
      if (!best || score > best.score) best = { node: stmt, score };
    }
    if (!best) return undefined;
    const node = best.node;
    const instance = this.#checker.getTypeAtLocation(node.name!);
    const statics = this.#checker.getTypeOfSymbolAtLocation(this.#checker.getSymbolAtLocation(node.name!)!, node.name!);
    return {
      name: node.name!.text,
      bases: baseNames(instance),
      resolve: (prop) => {
        const own = instance.getProperty(prop);
        const sym = own ?? statics.getProperty(prop);
        if (!sym) return undefined;
        const type = this.#checker.getTypeOfSymbolAtLocation(sym, node);
        const decl = sym.valueDeclaration ?? sym.declarations?.[0];
        return {
          ...shape(declaredParts(decl, this.#checker) ?? unionParts(type), type, this.#checker),
          member: own ? "instance" : "static",
          readonly: isReadonly(sym, decl),
          optional: (sym.flags & ts.SymbolFlags.Optional) !== 0,
        };
      },
    };
  }
}

function baseNames(type: ts.Type): string[] {
  const names: string[] = [];
  const seen = new Set<ts.Type>();
  const walk = (t: ts.Type) => {
    for (const base of t.getBaseTypes?.() ?? []) {
      if (seen.has(base)) continue;
      seen.add(base);
      // Mixins produce intersections; each named class in them counts.
      for (const part of base.isIntersection() ? base.types : [base]) {
        const name = part.getSymbol()?.getName();
        if (name && !name.startsWith("__")) names.push(name);
        walk(part);
      }
    }
  };
  walk(type);
  return names;
}

function isReadonly(sym: ts.Symbol, decl: ts.Declaration | undefined): boolean {
  if (decl && ts.getCombinedModifierFlags(decl) & ts.ModifierFlags.Readonly) return true;
  // A getter without a setter.
  const decls = sym.declarations ?? [];
  return decls.some(ts.isGetAccessorDeclaration) && !decls.some(ts.isSetAccessorDeclaration);
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
