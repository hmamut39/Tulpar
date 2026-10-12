// Component index for a Vue package, from its TypeScript declarations.
//
// A component is an exported value whose instances have `$props` (DefineComponent, PrimeVue's
// ClassComponent, and anything typed like them). From the instance type:
// - `$props` are the props; the ones Vue declares for every component (key, ref, class, style,
//   onVnode… hooks) are inherited, not the component's own API, and are omitted and counted;
// - `on…` props are the component's events, named the way templates write them (@click, @update:modelValue);
// - `$slots` are its slots, `default` being the default slot.

import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import type { CodeComponent, CodeEvent, CodeProp, CodeSlot, Provenance } from "@tulpar/core";
import { typeShape } from "@tulpar/web-kit";

const DTS: Provenance = { source: "ts-declarations", confidence: "high" };

export interface IndexedPackage {
  components: CodeComponent[];
  pkg: { name: string; version: string };
}

export function indexPackage(packageDir: string, gaps: string[]): IndexedPackage {
  const pkgJson = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  const pkg = { name: pkgJson.name as string, version: pkgJson.version as string };
  const rootTypes = pkgJson.exports?.["."]?.types ?? pkgJson.exports?.["."]?.import?.types;
  const typesEntry = [pkgJson.types, pkgJson.typings, typeof rootTypes === "string" ? rootTypes : undefined, "index.d.ts", "dist/index.d.ts"].find((p) => p && existsSync(join(packageDir, p)));
  if (!typesEntry) {
    gaps.push(`${pkg.name}: no TypeScript declarations found; components not read.`);
    return { components: [], pkg };
  }

  const entry = join(packageDir, typesEntry);
  const program = ts.createProgram([entry], { noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler });
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(entry)!;
  const moduleSymbol = checker.getSymbolAtLocation(sf);
  if (!moduleSymbol) {
    gaps.push(`${pkg.name}: ${typesEntry} is not a module; components not read.`);
    return { components: [], pkg };
  }
  if (!program.getSourceFiles().some((f) => /[\\/]@vue[\\/]runtime-core[\\/]/.test(f.fileName))) {
    gaps.push("Vue's types (@vue/runtime-core) were not found, so component props cannot be resolved. Install vue in the project.");
  }
  // Declared by Vue for every component, or by TypeScript's own libraries: inherited.
  const isVueDecl = (p: ts.Symbol) => {
    const decls = p.getDeclarations() ?? [];
    return decls.length > 0 && decls.every((d) => /[\\/]@vue[\\/](runtime-core|runtime-dom|shared)[\\/]/.test(d.getSourceFile().fileName) || program.isSourceFileDefaultLibrary(d.getSourceFile()));
  };

  const components: CodeComponent[] = [];
  const seen = new Map<ts.Node | ts.Symbol, string>();
  let inheritedTotal = 0;
  let duplicates = 0;
  for (const exported of checker.getExportsOfModule(moduleSymbol)) {
    const name = exported.getName();
    if (!/^[A-Z]/.test(name)) continue;
    const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
    if (!(symbol.flags & ts.SymbolFlags.Value)) continue;
    const instance = instanceType(checker.getTypeOfSymbolAtLocation(symbol, sf));
    const $props = instance?.getProperty("$props");
    if (!instance || !$props) continue;
    // One entry per component: libraries export some twice (an alias next to the original).
    const key = symbol.valueDeclaration ?? symbol.declarations?.[0] ?? symbol;
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.set(key, name);

    const props: CodeProp[] = [];
    const events: CodeEvent[] = [];
    const slots: CodeSlot[] = [];
    for (const prop of checker.getPropertiesOfType(checker.getTypeOfSymbol($props))) {
      const propName = prop.getName();
      if (isVueDecl(prop)) {
        inheritedTotal++;
        continue;
      }
      const decl = prop.valueDeclaration ?? prop.getDeclarations()?.[0];
      const propType = checker.getTypeOfSymbolAtLocation(prop, sf);
      const doc = ts.displayPartsToString(prop.getDocumentationComment(checker)).trim();
      if (/^on[A-Z]|^onUpdate:/.test(propName) && callable(propType)) {
        // onClick → click; onUpdate:modelValue → update:modelValue (what v-model listens to).
        const event = propName.slice(2).replace(/^[A-Z]/, (c) => c.toLowerCase());
        events.push({ name: event, ...(doc && { description: doc }), provenance: DTS });
        continue;
      }
      const tags = prop.getJsDocTags(checker);
      const shape = typeShape(decl, propType, checker);
      const defaultTag = tags.find((t) => t.name === "default" || t.name === "defaultValue");
      props.push({
        name: propName,
        aliases: [],
        ...(shape.type && { typeText: shape.typeText, type: shape.type }),
        ...(defaultTag?.text && { defaultText: ts.displayPartsToString(defaultTag.text).trim() }),
        required: !(prop.flags & ts.SymbolFlags.Optional),
        ...(doc && { description: doc }),
        ...(tags.some((t) => t.name === "deprecated") && { deprecated: true }),
        provenance: { name: DTS, ...(shape.type && { type: DTS }), required: DTS, ...(defaultTag && { default: { source: "jsdoc", confidence: "medium" } }) },
      });
    }
    const $slots = instance.getProperty("$slots");
    if ($slots) {
      for (const slot of checker.getPropertiesOfType(checker.getTypeOfSymbol($slots))) {
        const doc = ts.displayPartsToString(slot.getDocumentationComment(checker)).trim();
        slots.push({ name: slot.getName() === "default" ? "" : slot.getName(), ...(doc && { description: doc }), provenance: DTS });
      }
    }

    const docs = ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim();
    const deprecated = symbol.getJsDocTags(checker).find((t) => t.name === "deprecated");
    const declFile = (symbol.valueDeclaration ?? symbol.declarations?.[0])?.getSourceFile().fileName;
    components.push({
      id: `${pkg.name}#${name}`,
      name,
      exportName: name,
      module: pkg.name,
      ...(declFile && { sourcePath: relative(packageDir, declFile).replace(/\\/g, "/") }),
      ...(docs && { description: docs }),
      ...(deprecated && { deprecated: deprecated.text ? ts.displayPartsToString(deprecated.text) : true }),
      props,
      slots,
      events,
      provenance: DTS,
    });
  }
  // Keep the index readable and sendable: some type texts expand to thousands of characters.
  for (const c of components) {
    for (const prop of c.props) {
      if (prop.typeText && prop.typeText.length > 400) prop.typeText = `${prop.typeText.slice(0, 399)}…`;
      if (prop.type?.kind === "enum" && prop.type.values.length > 100) prop.type = { ...prop.type, values: prop.type.values.slice(0, 100), open: true };
    }
  }
  if (duplicates) gaps.push(`${duplicates} components are exported under two names; each is listed once, by the first.`);
  if (inheritedTotal) gaps.push(`${inheritedTotal} props Vue gives every component (key, ref, class, style, vnode hooks) were omitted.`);
  return { components, pkg };
}

/** The instance type, if `type` is a Vue component: constructible into something with `$props`. */
function instanceType(type: ts.Type): ts.Type | undefined {
  for (const sig of type.getConstructSignatures()) {
    const ret = sig.getReturnType();
    if (ret.getProperty("$props")) return ret;
  }
  // Intersections (SFCWithInstall<…> = component & Plugin) keep the construct signature on a member.
  if (type.isIntersection()) for (const t of type.types) {
    const found = instanceType(t);
    if (found) return found;
  }
  return undefined;
}

function callable(type: ts.Type): boolean {
  if (type.getCallSignatures().length) return true;
  return type.isUnion() && type.types.some((t) => t.getCallSignatures().length > 0);
}
