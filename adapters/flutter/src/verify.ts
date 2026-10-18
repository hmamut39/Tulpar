// Build, render and analyze a generated Flutter widget.
//
// Build: a harness app that shows the widget at the frame's size with semantics on, compiled with
// `flutter build web` (compiling runs nothing). Render: the build in the sandboxed browser; each
// Semantics(identifier: '<figma id>') is a positioned element there, measured like an HTML element.
// Which widget drew it, and every hard-coded value, comes from the analyzer reading the source.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import type { AnalyzeResult, BuildParams, BuildResult, RenderParams, RenderResult, RenderedElement, StyleFact } from "@tulpar/core";
import { dartTool, flutterVersion, sdk } from "./sdk.ts";
import type { ThemeConfig } from "./tokens.ts";
import { withBuild } from "./web.ts";

/**
 * A web build for checking, not shipping: the engine bundled (the render has no network), and none of the
 * release extras. The WebAssembly dry run Flutter does by default made a build take 50 s instead of 6.
 */
export const WEB_BUILD = ["--release", "--no-web-resources-cdn", "--no-wasm-dry-run", "-O1", "--no-source-maps", "--no-tree-shake-icons"];

/** checkout_card.dart → CheckoutCard: the class the conventions ask the file to declare. */
export function widgetClass(entry: string): string {
  return basename(entry, ".dart").split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
}

export async function build(params: BuildParams, theme: ThemeConfig = {}): Promise<BuildResult> {
  const { root, entry, frame } = params;
  const dir = join(root, ".tulpar", "flutter");
  mkdirSync(dir, { recursive: true });
  const name = basename(entry, ".dart");
  const importPath = relative(dir, join(root, entry)).replace(/\\/g, "/");
  writeFileSync(
    join(dir, `harness_${name}.dart`),
    `// Written by Tulpar: shows one widget at the Figma frame's size, with semantics on.
import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
${theme.import ? `import '${theme.import}';\n` : ""}
import '${importPath}';

void main() {
  runApp(MaterialApp(
    debugShowCheckedModeBanner: false,
    theme: ${theme.expression ?? "ThemeData(useMaterial3: true)"},
    home: const Scaffold(body: Align(alignment: Alignment.topLeft, child: SizedBox(width: ${frame.width}, height: ${frame.height}, child: ${widgetClass(entry)}()))),
  ));
  SemanticsBinding.instance.ensureSemantics();
}
`,
  );
  const out = `.tulpar/flutter/build/${name}`;
  const run = await sdk("flutter", ["build", "web", ...WEB_BUILD, "-t", `.tulpar/flutter/harness_${name}.dart`, "-o", out], root);
  if (run.code !== 0) {
    const lines = (run.stdout + "\n" + run.stderr).split("\n").filter((l) => /error/i.test(l) && !/^\s*#\d/.test(l) && !/Failed to compile application|Compilation failed|ProcessException/.test(l));
    return { ok: false, log: lines.slice(0, 12).join("\n") || run.stderr.slice(-1500) || `flutter build web failed (exit ${run.code})` };
  }
  return { ok: true, log: `built ${out}`, artifact: join(root, out) };
}

interface Described {
  written: Record<string, string>;
  drawn: Record<string, string>;
  widgets: string[];
  literals: { property: string; written: string; at: string }[];
  tokens: { property: string; written: string; token: string; at: string }[];
  errors: string[];
}

/** The analyzer's reading of a widget file: placements, widgets, literals and tokens. */
export function describe(root: string, entry: string, spacingClass?: string): Promise<Described> {
  // Cached by the file's content: the render and the static checks read the same attempt.
  const key = createHash("sha256").update(readFileSync(join(root, entry))).update(`${entry}\n${spacingClass ?? ""}`).digest("hex");
  return dartTool<Described>("describe", [root, join(root, entry), ...(spacingClass ? [spacingClass] : [])], root, key);
}

export async function render(params: RenderParams, spacingClass?: string): Promise<RenderResult> {
  if (!params.entry) return { status: "failed", reason: "no entry file to identify the widgets from" };
  const described = await describe(params.root, params.entry, spacingClass);
  try {
    const measured = await withBuild(params.artifact, { width: params.width, height: params.height, scale: params.scale }, async (page, blocked) => {
      await page.waitForSelector("[flt-semantics-identifier]", { state: "attached", timeout: 30_000 }).catch(() => undefined);
      await page.waitForTimeout(300); // one more frame for layout to settle
      const nodes = await page.$$eval("[flt-semantics-identifier]", (els) =>
        els.map((e) => {
          const r = e.getBoundingClientRect();
          // A text field's node holds an <input> whose aria-label is its label, not what it draws.
          const field = e.querySelector(":scope > input, :scope > textarea");
          return { id: e.getAttribute("flt-semantics-identifier") ?? "", x: r.x, y: r.y, width: r.width, height: r.height, text: field ? ((field as HTMLInputElement).value ?? "") : (e.getAttribute("aria-label") ?? e.textContent ?? "").replace(/\s+/g, " ").trim() };
        }),
      );
      const png = (await page.screenshot({ type: "png" })).toString("base64");
      return { nodes, png, blocked: [...blocked] };
    });
    if (!measured.nodes.length) return { status: "failed", reason: "the widget drew no Semantics(identifier:) nodes: it threw on start-up, or tags nothing" };
    const elements: RenderedElement[] = measured.nodes.map((n) => ({
      figmaId: n.id,
      component: described.written[n.id] ?? "unknown",
      defined: true,
      box: { x: n.x, y: n.y, width: n.width, height: n.height },
      // An empty text field draws its hint on the canvas; the page carries only its label.
      text: n.text || (described.drawn?.[n.id] ?? ""),
      fonts: [],
      visible: n.width > 0 && n.height > 0,
      styles: [],
    }));
    return {
      status: "ok",
      png: measured.png,
      elements,
      renderer: { name: "flutter-web+chromium", version: flutterVersion() ?? "unknown", os: process.platform },
      warnings: [
        "Flutter draws on a canvas: layout and text are read from its semantics tree; colours, type and spacing are checked in the code.",
        ...(measured.blocked.length ? [`Blocked network requests to: ${measured.blocked.join(", ")}`] : []),
      ],
    };
  } catch (err) {
    return { status: "failed", reason: (err as Error).message.split("\n")[0]! };
  }
}

export async function analyze(root: string, entry: string, spacingClass?: string): Promise<AnalyzeResult> {
  const d = await describe(root, entry, spacingClass);
  const facts: StyleFact[] = [
    ...d.literals.map((l) => ({ property: l.property as StyleFact["property"], written: l.written, source: "literal" as const, at: l.at })),
    ...d.tokens.map((t) => ({ property: t.property as StyleFact["property"], written: t.written, source: "token" as const, token: t.token, at: t.at })),
  ];
  return { componentsUsed: d.widgets.filter((w) => w !== "Semantics"), literals: facts };
}

