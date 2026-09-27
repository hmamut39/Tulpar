// Component index for an Angular library, from its TypeScript declarations (tier 1).
//
// Compiled Angular libraries declare each component and directive's public API in a
// static field: `static ɵcmp: ɵɵComponentDeclaration<Class, Selector, ExportAs, Inputs,
// Outputs, Queries, NgContentSelectors, …>` (or `ɵdir` for directives). That gives the
// selector, the inputs with their template aliases, the outputs and the content slots;
// the checker resolves the inputs' types from the class.

import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import type { CodeComponent, CodeEvent, CodeProp, CodeSlot, Provenance } from "@tulpar/core";
import { typeShape } from "@tulpar/web-kit";

const DTS: Provenance = { source: "angular-declaration", confidence: "high" };

export interface IndexedPackage {
  components: CodeComponent[];
  pkg: { name: string; version: string };
}

export function indexPackage(packageDir: string, gaps: string[]): IndexedPackage {
  const pkgJson = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  const pkg = { name: pkgJson.name as string, version: pkgJson.version as string };
  const typesEntry = [pkgJson.types, pkgJson.typings, "index.d.ts"].find((p) => p && existsSync(join(packageDir, p)));
  if (!typesEntry) {
    gaps.push(`${pkg.name}: no TypeScript declarations found; components not read.`);
    return { components: [], pkg };
  }
  const entry = join(packageDir, typesEntry);
  const program = ts.createProgram([entry], { noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler });
  const checker = program.getTypeChecker();
  const moduleSymbol = checker.getSymbolAtLocation(program.getSourceFile(entry)!);
  if (!moduleSymbol) {
    gaps.push(`${pkg.name}: ${typesEntry} is not a module.`);
    return { components: [], pkg };
  }

  const components: CodeComponent[] = [];
  const seen = new Set<ts.Symbol>();
  let skippedHosts = 0;
  for (const exported of checker.getExportsOfModule(moduleSymbol)) {
    const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
    if (!(symbol.flags & ts.SymbolFlags.Class) || seen.has(symbol)) continue;
    seen.add(symbol);
    const decl = symbol.declarations?.find(ts.isClassDeclaration);
    if (!decl) continue;
    const meta = angularMeta(decl);
    if (!meta) continue;
    // "ng-component" is Angular's placeholder for components only used as bases or dynamically.
    if (meta.selector === "ng-component") {
      skippedHosts++;
      continue;
    }
    const name = exported.getName();
    const instance = checker.getDeclaredTypeOfSymbol(symbol);
    const props: CodeProp[] = [];
    for (const input of meta.inputs) {
      const member = instance.getProperty(input.property);
      const memberDecl = member?.valueDeclaration ?? member?.declarations?.[0];
      const shape = member ? typeShape(memberDecl, checker.getTypeOfSymbolAtLocation(member, decl), checker) : { typeText: "" };
      const doc = member ? ts.displayPartsToString(member.getDocumentationComment(checker)).trim() : "";
      const tags = member?.getJsDocTags(checker) ?? [];
      props.push({
        name: input.alias,
        aliases: input.alias !== input.property ? [input.property] : [],
        ...(shape.type && { typeText: shape.typeText, type: shape.type }),
        required: input.required,
        ...(doc && { description: doc }),
        ...(tags.some((t) => t.name === "deprecated") && { deprecated: true }),
        provenance: { name: DTS, ...(shape.type && { type: { source: "ts-declarations", confidence: "high" } }), required: DTS },
      });
    }
    const events: CodeEvent[] = meta.outputs.map((o) => ({ name: o, provenance: DTS }));
    const slots: CodeSlot[] = meta.contentSelectors.map((s) => ({ name: s === "*" ? "" : s, provenance: DTS }));
    const file = decl.getSourceFile().fileName;
    const rel = relative(packageDir, file).replace(/\\/g, "/");
    const entryPoint = rel.includes("/") ? `${pkg.name}/${rel.split("/")[0]}` : pkg.name;
    const docs = ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim();
    const deprecated = symbol.getJsDocTags(checker).find((t) => t.name === "deprecated");
    components.push({
      id: `${pkg.name}#${name}`,
      name,
      exportName: name,
      module: entryPoint,
      markup: markupFor(meta.selector),
      sourcePath: rel,
      ...(docs && { description: docs }),
      ...(deprecated && { deprecated: deprecated.text ? ts.displayPartsToString(deprecated.text) : true }),
      props,
      slots,
      events,
      provenance: DTS,
    });
  }
  if (skippedHosts) gaps.push(`${skippedHosts} classes with Angular's placeholder selector "ng-component" (bases, dynamic hosts) are not listed as components.`);
  return { components, pkg };
}

interface AngularMeta {
  selector: string;
  inputs: { property: string; alias: string; required: boolean }[];
  outputs: string[];
  contentSelectors: string[];
}

/** Read `static ɵcmp` / `static ɵdir` declarations. Type arguments: <Class, Selector, ExportAs, Inputs, Outputs, Queries, NgContent, …>. */
function angularMeta(decl: ts.ClassDeclaration): AngularMeta | undefined {
  for (const m of decl.members) {
    if (!ts.isPropertyDeclaration(m) || !m.type || !ts.isTypeReferenceNode(m.type)) continue;
    const field = m.name.getText();
    if (field !== "ɵcmp" && field !== "ɵdir") continue;
    const args = m.type.typeArguments ?? [];
    const str = (n: ts.TypeNode | undefined) => (n && ts.isLiteralTypeNode(n) && ts.isStringLiteral(n.literal) ? n.literal.text : undefined);
    const selector = str(args[1]) ?? "";
    const inputs: AngularMeta["inputs"] = [];
    if (args[3] && ts.isTypeLiteralNode(args[3])) {
      for (const member of args[3].members) {
        if (!ts.isPropertySignature(member) || !member.type) continue;
        const property = member.name.getText().replace(/^["']|["']$/g, "");
        // Older libraries: { "prop": "alias" }. Newer: { "prop": { "alias": "…"; "required": … } }.
        const alias = str(member.type) ?? (ts.isTypeLiteralNode(member.type) ? literalField(member.type, "alias") : undefined) ?? property;
        const required = ts.isTypeLiteralNode(member.type) ? literalField(member.type, "required") === "true" : false;
        inputs.push({ property, alias, required });
      }
    }
    const outputs: string[] = [];
    if (args[4] && ts.isTypeLiteralNode(args[4])) for (const member of args[4].members) if (ts.isPropertySignature(member) && member.type) outputs.push(str(member.type) ?? member.name.getText().replace(/^["']|["']$/g, ""));
    const contentSelectors: string[] = [];
    if (args[6] && ts.isTupleTypeNode(args[6])) for (const e of args[6].elements) { const s = str(e as ts.TypeNode); if (s) contentSelectors.push(s); }
    return { selector, inputs, outputs, contentSelectors };
  }
  return undefined;
}

function literalField(node: ts.TypeLiteralNode, key: string): string | undefined {
  for (const m of node.members) {
    if (!ts.isPropertySignature(m) || m.name.getText().replace(/^["']|["']$/g, "") !== key || !m.type) continue;
    if (ts.isLiteralTypeNode(m.type)) return ts.isStringLiteral(m.type.literal) ? m.type.literal.text : m.type.literal.getText();
  }
  return undefined;
}

/**
 * The first selector, as markup: "cds-modal-footer, ibm-modal-footer" → "<cds-modal-footer>".
 * An attribute directive ("[cdsButton]") is stated as such, without guessing the element it
 * belongs on; "button[cdsButton]" names its element.
 */
export function markupFor(selector: string): string {
  const first = selector.split(",")[0]!.trim();
  const attr = /^([a-z][a-z0-9-]*)?\[([A-Za-z-]+)(?:=[^\]]*)?\]$/.exec(first);
  if (attr) return attr[1] ? `<${attr[1]} ${attr[2]}>` : `attribute directive ${attr[2]}: add it to the native element it enhances (e.g. <button ${attr[2]}>)`;
  return `<${first}>`;
}
