// Component index for a Svelte package, from its TypeScript declarations.
//
// A component is an exported value that is either
// - a class whose instances have `$$prop_def` (SvelteComponentTyped<Props, Events, Slots>, as Carbon
//   for Svelte and most Svelte 4 libraries declare them), or
// - a Svelte 5 `Component<Props>`: callable with (internals, props).
// From the props:
// - the HTML attributes a component passes through (svelte/elements) are inherited, not its own API;
//   they are omitted and counted;
// - `children` is the default slot; other props typed as snippets are named slots;
// - `on…` function props are events (Svelte 5), as are the keys of `$$events_def` (Svelte 4).

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
  const rootTypes = pkgJson.exports?.["."]?.types;
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
  if (!program.getSourceFiles().some((f) => /[\\/]svelte[\\/](types|elements)/.test(f.fileName))) {
    gaps.push("Svelte's types were not found, so component props cannot be resolved. Install svelte in the project.");
  }
  // Declared by Svelte's HTML attribute types, or by TypeScript's own libraries: inherited.
  const isInherited = (p: ts.Symbol) => {
    const decls = p.getDeclarations() ?? [];
    return decls.length > 0 && decls.every((d) => /[\\/]svelte[\\/](elements|types)/.test(d.getSourceFile().fileName) || program.isSourceFileDefaultLibrary(d.getSourceFile()));
  };

  const components: CodeComponent[] = [];
  let inheritedTotal = 0;
  for (const exported of checker.getExportsOfModule(moduleSymbol)) {
    const name = exported.getName();
    if (!/^[A-Z]/.test(name)) continue;
    const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
    if (!(symbol.flags & ts.SymbolFlags.Value)) continue;
    const found = componentTypes(checker.getTypeOfSymbolAtLocation(symbol, sf), checker);
    if (!found) continue;

    const props: CodeProp[] = [];
    const events: CodeEvent[] = [];
    const slots: CodeSlot[] = [];
    for (const prop of checker.getPropertiesOfType(found.props)) {
      const propName = prop.getName();
      if (isInherited(prop)) {
        inheritedTotal++;
        continue;
      }
      const decl = prop.valueDeclaration ?? prop.getDeclarations()?.[0];
      const propType = checker.getTypeOfSymbolAtLocation(prop, sf);
      const typeText = checker.typeToString(propType, undefined, ts.TypeFormatFlags.NoTruncation);
      const doc = ts.displayPartsToString(prop.getDocumentationComment(checker)).trim();
      if (propName === "children" || /\bSnippet\b|\(this: void/.test(typeText)) {
        slots.push({ name: propName === "children" ? "" : propName, ...(doc && { description: doc }), provenance: DTS });
        continue;
      }
      if (/^on[a-z]/.test(propName) && propType.getCallSignatures().length) {
        events.push({ name: propName.slice(2), ...(doc && { description: doc }), provenance: DTS });
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
    // Svelte 4 typings list events and slots separately.
    for (const e of found.events ? checker.getPropertiesOfType(found.events) : []) if (!events.some((x) => x.name === e.getName())) events.push({ name: e.getName(), provenance: DTS });
    for (const s of found.slots ? checker.getPropertiesOfType(found.slots) : []) {
      const slotName = s.getName() === "default" ? "" : s.getName();
      if (!slots.some((x) => x.name === slotName)) slots.push({ name: slotName, provenance: DTS });
    }

    const docs = ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim();
    const declFile = (symbol.valueDeclaration ?? symbol.declarations?.[0])?.getSourceFile().fileName;
    components.push({
      id: `${pkg.name}#${name}`,
      name,
      exportName: name,
      module: pkg.name,
      ...(declFile && { sourcePath: relative(packageDir, declFile).replace(/\\/g, "/") }),
      ...(docs && { description: docs }),
      props,
      slots,
      events,
      provenance: DTS,
    });
  }
  placement(packageDir, components);
  for (const c of components) {
    for (const prop of c.props) {
      if (prop.typeText && prop.typeText.length > 400) prop.typeText = `${prop.typeText.slice(0, 399)}…`;
      if (prop.type?.kind === "enum" && prop.type.values.length > 100) prop.type = { ...prop.type, values: prop.type.values.slice(0, 100), open: true };
    }
  }
  if (inheritedTotal) gaps.push(`${inheritedTotal} HTML attributes components pass through were omitted (on average ${Math.round(inheritedTotal / Math.max(1, components.length))} per component).`);
  return { components, pkg };
}

/** The props (and Svelte 4 events and slots) types, if `type` is a Svelte component. */
function componentTypes(type: ts.Type, checker: ts.TypeChecker): { props: ts.Type; events?: ts.Type; slots?: ts.Type } | undefined {
  // Svelte 4 style: a class extending SvelteComponentTyped<Props, Events, Slots>.
  for (const sig of type.getConstructSignatures()) {
    const instance = sig.getReturnType();
    const propDef = instance.getProperty("$$prop_def");
    if (!propDef) continue;
    const events = instance.getProperty("$$events_def");
    const slots = instance.getProperty("$$slot_def");
    return { props: checker.getTypeOfSymbol(propDef), ...(events && { events: checker.getTypeOfSymbol(events) }), ...(slots && { slots: checker.getTypeOfSymbol(slots) }) };
  }
  // Svelte 5: Component<Props> is a function of (internals, props).
  for (const sig of type.getCallSignatures()) {
    const params = sig.getParameters();
    if (params.length !== 2 || !/internal/i.test(params[0]!.getName())) continue;
    return { props: checker.getTypeOfSymbol(params[1]!) };
  }
  return undefined;
}

/**
 * Components that only work inside another: they read a context with no fallback (const { closeModal }
 * = getContext("carbon:ComposedModal")), and only the components that set that context provide it. Read
 * from each component's .svelte source, next to its declarations; contexts read optionally are skipped.
 */
function placement(packageDir: string, components: CodeComponent[]): void {
  const required = new Map<CodeComponent, string[]>();
  const providers = new Map<string, string[]>();
  for (const c of components) {
    if (!c.sourcePath?.endsWith(".svelte.d.ts")) continue;
    const file = join(packageDir, c.sourcePath.replace(/\.d\.ts$/, ""));
    if (!existsSync(file)) continue;
    const source = readFileSync(file, "utf8");
    const needs = [...source.matchAll(/const\s*\{[^}]*\}\s*=\s*getContext\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]!);
    if (needs.length) required.set(c, needs);
    for (const m of source.matchAll(/setContext\(\s*["']([^"']+)["']/g)) providers.set(m[1]!, [...(providers.get(m[1]!) ?? []), c.name]);
  }
  for (const [c, keys] of required) {
    const inside = [...new Set(keys.flatMap((k) => providers.get(k) ?? []))].filter((n) => n !== c.name);
    if (inside.length) c.insideOf = inside;
  }
}
