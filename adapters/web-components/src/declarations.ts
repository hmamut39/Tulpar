// Tier 1: resolve prop types from a package's shipped TypeScript declarations,
// using the TypeScript checker. Uses TypeScript 6, the last line with the stable
// compiler API (TypeScript 7 exposes only an unstable API).

import ts from "typescript";
import type { TypeShape } from "@tulpar/core";
import { typeShape } from "@tulpar/web-kit";

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
          ...typeShape(decl, type, this.#checker),
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

