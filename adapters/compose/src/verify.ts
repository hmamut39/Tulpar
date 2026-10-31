// Render and static scan. Compose draws on a canvas, but also keeps a page of positioned elements for
// accessibility: each Modifier.testTag("<figma id>") is an element with that id there, measured like HTML. Which
// component drew it, and every hard-coded value, comes from reading the source.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AnalyzeResult, RenderParams, RenderResult, RenderedElement, StyleFact } from "@tulpar/core";
import { measureComposeStates, withSite, TAGGED } from "./states.ts";

/** Source with comments and the contents of strings blanked, positions kept: code only. */
export function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/"(?:[^"\\\n]|\\.)*"/g, (m) => `"${" ".repeat(m.length - 2)}"`);
}

/** The call a position sits inside: the name before its nearest open parenthesis, and where that call ends. */
function enclosingCall(code: string, at: number): { name: string; start: number; end: number } | undefined {
  let depth = 0;
  for (let i = at - 1; i >= 0; i--) {
    if (code[i] === ")") depth++;
    else if (code[i] === "(") {
      if (depth > 0) {
        depth--;
        continue;
      }
      const name = /([A-Za-z_]\w*)\s*$/.exec(code.slice(Math.max(0, i - 80), i))?.[1];
      if (!name) return undefined;
      let d = 1;
      let j = i + 1;
      for (; j < code.length && d > 0; j++) {
        if (code[j] === "(") d++;
        else if (code[j] === ")") d--;
      }
      // Trailing lambdas belong to the call: Button(onClick = {}) { Text("Go") }.
      while (/^\s*\{/.test(code.slice(j, j + 40))) {
        j = code.indexOf("{", j);
        let braces = 1;
        for (j++; j < code.length && braces > 0; j++) {
          if (code[j] === "{") braces++;
          else if (code[j] === "}") braces--;
        }
      }
      return { name, start: i, end: j };
    }
  }
  return undefined;
}

const TAG = /\.testTag\(\s*"([^"]+)"\s*\)/g;

/** Which component each tag is written on, and the text its call draws: Button(Modifier.testTag("a")) { Text("Go") }. */
export function describeSource(source: string): { written: Record<string, string>; drawn: Record<string, string> } {
  const code = codeOnly(source);
  const written: Record<string, string> = {};
  const drawn: Record<string, string> = {};
  for (const m of source.matchAll(TAG)) {
    const call = enclosingCall(code, m.index);
    if (!call) continue;
    const id = m[1]!;
    written[id] = call.name;
    const inside = source.slice(call.start, call.end);
    const strings = [...inside.matchAll(/\bText\(\s*(?:text\s*=\s*)?"((?:[^"\\]|\\.)*)"/g)].map((t) => t[1]!);
    // An empty field draws on the canvas alone: its placeholder while it has one, as the design shows it, or its label.
    const placeholder = /TextField$/.test(call.name) ? /\bplaceholder\s*=\s*\{\s*Text\(\s*"((?:[^"\\]|\\.)*)"/.exec(inside)?.[1] : undefined;
    const value = call.name === "Text" ? /^\(\s*(?:text\s*=\s*)?"((?:[^"\\]|\\.)*)"/.exec(inside)?.[1] : undefined;
    drawn[id] = placeholder ?? value ?? strings.join(" ");
  }
  return { written, drawn };
}

export async function render(params: RenderParams): Promise<RenderResult> {
  if (!params.entry) return { status: "failed", reason: "no entry file to identify the components from" };
  const { written, drawn } = describeSource(readFileSync(join(params.root, params.entry), "utf8"));
  try {
    const measured = await withSite(params.artifact, { width: params.width, height: params.height, scale: params.scale }, async (page, blocked) => {
      await page.waitForSelector(TAGGED, { state: "attached", timeout: 60_000 }).catch(() => undefined);
      await page.waitForTimeout(400); // one more frame for layout to settle
      const nodes = await page.$$eval(TAGGED, (els) =>
        els.map((e) => {
          const r = e.getBoundingClientRect();
          return { id: e.id, x: r.x, y: r.y, width: r.width, height: r.height, text: (e.textContent ?? "").replace(/\s+/g, " ").trim() };
        }),
      );
      const png = (await page.screenshot({ type: "png" })).toString("base64");
      // After the screenshot: states move the mouse and focus, which must not show in it.
      const states = await measureComposeStates(page).catch(() => undefined);
      return { nodes, png, states, blocked: [...blocked] };
    });
    if (!measured.nodes.length) return { status: "failed", reason: 'the component drew no Modifier.testTag("<id>") elements: it threw on start-up, or tags nothing' };
    const elements: RenderedElement[] = measured.nodes.map((n) => ({
      figmaId: n.id,
      component: written[n.id] ?? "unknown",
      defined: true,
      box: { x: n.x, y: n.y, width: n.width, height: n.height },
      text: n.text || (drawn[n.id] ?? ""),
      fonts: [],
      visible: n.width > 0 && n.height > 0,
      styles: [],
    }));
    return {
      status: "ok",
      png: measured.png,
      elements,
      ...(measured.states && { states: measured.states }),
      renderer: { name: "compose-wasm+chromium", version: "1.12.2", os: process.platform },
      warnings: [
        "Compose draws on a canvas: layout and text are read from its accessibility elements; colours, type and spacing are checked in the code.",
        ...(measured.blocked.length ? [`Blocked network requests to: ${measured.blocked.join(", ")}`] : []),
      ],
    };
  } catch (err) {
    return { status: "failed", reason: (err as Error).message.split("\n")[0]! };
  }
}

const NOT_COMPONENTS = new Set(["Modifier", "Color", "FontWeight", "FontFamily", "TextStyle", "RoundedCornerShape", "CircleShape", "PaddingValues", "BorderStroke", "Alignment", "Arrangement", "KeyboardOptions", "ImeAction", "KeyboardType", "PasswordVisualTransformation", "Composable", "OptIn", "Preview", "Space"]);

/** Hard-coded values and theme uses in the component's code, by the property they set. */
export function scan(source: string, at: string, spacingClass?: string): { literals: StyleFact[]; components: string[] } {
  const code = codeOnly(source);
  const line = (i: number) => `${at}:${code.slice(0, i).split("\n").length}`;
  const facts: StyleFact[] = [];
  const literal = (property: StyleFact["property"], written: string, i: number) => facts.push({ property, written, source: "literal", at: line(i) });
  const token = (property: StyleFact["property"], written: string, name: string, i: number) => facts.push({ property, written, source: "token", token: name, at: line(i) });

  for (const m of code.matchAll(/\bColor\(\s*(0[xX][0-9a-fA-F]+|\d[^)]*)\s*\)|\bColor\.(Black|White|Red|Green|Blue|Gray|LightGray|DarkGray|Cyan|Magenta|Yellow)\b/g)) literal("fill", m[0], m.index);
  for (const m of code.matchAll(/\b(\d+(?:\.\d+)?)\.sp\b/g)) literal("fontSize", m[0], m.index);
  for (const m of code.matchAll(/\bFontWeight\.\w+|\bFontWeight\(\s*\d+\s*\)/g)) literal("fontWeight", m[0], m.index);
  for (const m of code.matchAll(/\bFontFamily\.\w+|\bFontFamily\(/g)) literal("fontFamily", m[0], m.index);
  for (const m of code.matchAll(/\b(\d+(?:\.\d+)?)\.dp\b/g)) {
    if (Number(m[1]) === 0) continue;
    const before = code.slice(Math.max(0, m.index - 40), m.index);
    const property = /(padding|PaddingValues)[^()]*\([^()]*$/.test(before) ? "padding" : /spacedBy\s*\($|Spacer|height\(\s*$|width\(\s*$/.test(before) ? "gap" : /Shape\s*\($/.test(before) ? "radius" : "size";
    literal(property, m[0], m.index);
  }
  for (const m of code.matchAll(/\bMaterialTheme\.colorScheme\.(\w+)/g)) token("fill", m[0], `colorScheme.${m[1]}`, m.index);
  for (const m of code.matchAll(/\bMaterialTheme\.typography\.(\w+)/g)) token("fontSize", m[0], `typography.${m[1]}`, m.index);
  if (spacingClass) for (const m of code.matchAll(new RegExp(`\\b${spacingClass}\\.(\\w+)`, "g"))) token("gap", m[0], `${spacingClass}.${m[1]}`, m.index);

  const components = [...new Set([...code.matchAll(/(?<![.\w])([A-Z]\w*)\s*(?:\(|\{)/g)].map((m) => m[1]!))].filter((c) => !NOT_COMPONENTS.has(c));
  return { literals: facts, components };
}

/** The entry's folder: a page's sections are checked with it. */
export function analyze(root: string, entry: string, spacingClass?: string): AnalyzeResult {
  const literals: StyleFact[] = [];
  const components = new Set<string>();
  const dir = dirname(join(root, entry));
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".kt"))) {
    const found = scan(readFileSync(join(dir, f), "utf8"), f, spacingClass);
    literals.push(...found.literals);
    for (const c of found.components) components.add(c);
  }
  return { componentsUsed: [...components], literals };
}
