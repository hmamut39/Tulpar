// Component index for a React package, from its TypeScript declarations (tier 1).
//
// A component is an exported value callable (or constructible) with one props object
// that returns a React element. Its props come from that props type:
// - props declared by @types/react (the DOM attribute set, `key`, `ref`) are inherited,
//   not the component's own API; they are omitted and counted;
// - `children` is the default slot; other props typed as React nodes or component types are named slots;
// - `on…` function props are events.

import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import type { CodeComponent, CodeEvent, CodeProp, CodeSlot, Provenance } from "@tulpar/core";
import { typeShape } from "@tulpar/web-kit";

const DTS: Provenance = { source: "ts-declarations", confidence: "high" };
const VIA_ARGUMENTS: Provenance = { source: "ts-declarations", confidence: "medium", note: "read from a type argument of the props type" };

/** Props that are React plumbing, not something a design sets. Kept, with the reason. */
const RUNTIME_PROPS: Record<string, string> = {
  as: "polymorphic element override",
  ref: "React ref",
  key: "React key",
};

export interface IndexedPackage {
  components: CodeComponent[];
  pkg: { name: string; version: string };
}

export function indexPackage(packageDir: string, gaps: string[]): IndexedPackage {
  const pkgJson = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  const pkg = { name: pkgJson.name as string, version: pkgJson.version as string };
  const typesEntry = [pkgJson.types, pkgJson.typings, "lib/index.d.ts", "index.d.ts"].find((p) => p && existsSync(join(packageDir, p)));
  if (!typesEntry) {
    gaps.push(`${pkg.name}: no TypeScript declarations found; components not read.`);
    return { components: [], pkg };
  }

  const entry = join(packageDir, typesEntry);
  const program = ts.createProgram([entry], {
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
  });
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(entry)!;
  const moduleSymbol = checker.getSymbolAtLocation(sf);
  if (!moduleSymbol) {
    gaps.push(`${pkg.name}: ${typesEntry} is not a module; components not read.`);
    return { components: [], pkg };
  }
  if (!program.getSourceFiles().some((f) => /[\\/]@types[\\/]react[\\/]/.test(f.fileName))) {
    gaps.push("@types/react was not found, so component and prop types cannot be resolved. Install it in the project.");
  }

  const components: CodeComponent[] = [];
  let inheritedTotal = 0;
  let viaArgumentsCount = 0;
  for (const exported of checker.getExportsOfModule(moduleSymbol)) {
    const name = exported.getName();
    if (!/^[A-Z]/.test(name)) continue;
    const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
    if (!(symbol.flags & ts.SymbolFlags.Value)) continue;
    const type = checker.getTypeOfSymbolAtLocation(symbol, sf);
    const propsType = componentProps(type, checker);
    if (!propsType) continue;

    const props: CodeProp[] = [];
    const slots: CodeSlot[] = [];
    const events: CodeEvent[] = [];
    // Inherited, not the component's own: declared by @types/react or by TypeScript's own libraries (lib.dom.d.ts…).
    const isReactDecl = (p: ts.Symbol) => {
      const decls = p.getDeclarations() ?? [];
      return decls.length > 0 && decls.every((d) => /[\\/]@types[\\/]react(-dom)?[\\/]/.test(d.getSourceFile().fileName) || program.isSourceFileDefaultLibrary(d.getSourceFile()));
    };
    let symbols = propertiesOf(propsType, checker);
    let viaArguments = false;
    if (!symbols.some((p) => !isReactDecl(p))) {
      // e.g. Omit<PolymorphicProps<ElementType<any>, OwnProps>, "ref"> flattens to an index signature;
      // the component's own props survive as a type argument.
      const fallback = propsFromTypeArguments(propsType, checker, isReactDecl);
      if (fallback.length) {
        symbols = fallback;
        viaArguments = true;
        viaArgumentsCount++;
      }
    }
    for (const prop of symbols) {
      const decls = prop.getDeclarations() ?? [];
      const propName = prop.getName();
      if (isReactDecl(prop) && propName !== "children") {
        inheritedTotal++;
        continue;
      }
      const decl = prop.valueDeclaration ?? decls[0];
      const propType = checker.getTypeOfSymbolAtLocation(prop, sf);
      const typeText = checker.typeToString(propType, undefined, ts.TypeFormatFlags.NoTruncation);
      const doc = ts.displayPartsToString(prop.getDocumentationComment(checker)).trim();
      const tags = prop.getJsDocTags(checker);
      if (RUNTIME_PROPS[propName]) {
        props.push({ name: propName, aliases: [], typeText, required: false, internal: RUNTIME_PROPS[propName], provenance: { name: DTS } });
        continue;
      }
      if (propName === "children" || /\b(ReactNode|ReactElement|JSX\.Element|ComponentType|ElementType)\b/.test(typeText)) {
        slots.push({ name: propName === "children" ? "" : propName, ...(doc && { description: doc }), provenance: DTS });
        continue;
      }
      if (/^on[A-Z]/.test(propName) && propType.getCallSignatures().length + unionCallable(propType) > 0) {
        events.push({ name: propName, ...(doc && { description: doc }), provenance: DTS });
        continue;
      }
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
        ...(RUNTIME_PROPS[propName] && { internal: RUNTIME_PROPS[propName] }),
        provenance: {
          name: viaArguments ? VIA_ARGUMENTS : DTS,
          ...(shape.type && { type: viaArguments ? VIA_ARGUMENTS : DTS }),
          required: DTS,
          ...(defaultTag && { default: { source: "jsdoc", confidence: "medium" } }),
        },
      });
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
  if (viaArgumentsCount) gaps.push(`${viaArgumentsCount} components' props were read from a type argument of their props type (polymorphic typing hides them otherwise); medium confidence.`);
  if (inheritedTotal) gaps.push(`${inheritedTotal} props inherited from React's DOM attribute types were omitted (on average ${Math.round(inheritedTotal / Math.max(1, components.length))} per component).`);
  return { components, pkg };
}

/** The props type, if `type` is a React component: callable or constructible with one props object, returning an element. */
function componentProps(type: ts.Type, checker: ts.TypeChecker): ts.Type | undefined {
  const signatures = [...type.getCallSignatures(), ...type.getConstructSignatures()];
  for (const sig of signatures) {
    const param = sig.getParameters()[0];
    if (!param || sig.getParameters().length > 2) continue;
    const ret = checker.typeToString(sig.getReturnType());
    const construct = type.getConstructSignatures().includes(sig);
    // Polymorphic components are often typed `=> React.ReactElement | any`, which reads as `any`.
    if (!construct && !/ReactNode|ReactElement|Element|null|^any$/.test(ret)) continue;
    const props = checker.getTypeOfSymbol(param);
    if (props.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown) || !(props.flags & ts.TypeFlags.Object || props.isUnionOrIntersection())) continue;
    return props;
  }
  return undefined;
}

/**
 * Every prop a caller may pass. For a union of prop shapes (e.g. Tag's plain, dismissible and
 * selectable forms) that is each member's props, not only the ones they share.
 */
function propertiesOf(type: ts.Type, checker: ts.TypeChecker): ts.Symbol[] {
  if (!type.isUnion()) return checker.getPropertiesOfType(type);
  const byName = new Map<string, ts.Symbol>();
  for (const member of type.types) for (const p of checker.getPropertiesOfType(member)) if (!byName.has(p.getName())) byName.set(p.getName(), p);
  return [...byName.values()];
}

/** Object types among a type's alias and reference arguments (a few levels deep) that declare props of their own. */
function propsFromTypeArguments(type: ts.Type, checker: ts.TypeChecker, isReactDecl: (p: ts.Symbol) => boolean): ts.Symbol[] {
  const byName = new Map<string, ts.Symbol>();
  const seen = new Set<ts.Type>();
  const visit = (t: ts.Type, depth: number) => {
    if (depth > 4 || seen.has(t)) return;
    seen.add(t);
    const args = [...(t.aliasTypeArguments ?? []), ...(t.flags & ts.TypeFlags.Object ? checker.getTypeArguments(t as ts.TypeReference) ?? [] : [])];
    const parts = t.isUnionOrIntersection() ? t.types : [];
    for (const a of [...args, ...parts]) {
      const own = a.flags & ts.TypeFlags.Object ? checker.getPropertiesOfType(a).filter((p) => !isReactDecl(p)) : [];
      if (own.length) for (const p of own) byName.has(p.getName()) || byName.set(p.getName(), p);
      else visit(a, depth + 1);
    }
  };
  visit(type, 0);
  return [...byName.values()];
}

function unionCallable(type: ts.Type): number {
  return type.isUnion() ? type.types.filter((t) => t.getCallSignatures().length).length : 0;
}
