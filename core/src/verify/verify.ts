// The verifier: compare what was built and rendered with the Figma frame, check by check.
//
// Every check ends as pass, fail, or not-checked with a reason. The headline is built
// only from checks that ran, and the overall verdict is never "pass" while anything
// was left unchecked (docs/00-research-and-plan.md §3).

import { fontClass, type FontClass } from "./fonts.ts";
import { tokenKind, wrongKind, type TokenKind } from "./token-kind.ts";
import type { ComponentIndex, TokenSet } from "../code-model.ts";
import type { AdapterManifest } from "../adapter/protocol.ts";
import type { Box, DesignNode, DesignTree } from "../model.ts";
import {
  COLOR_PROPERTIES,
  SPACING_PROPERTIES,
  TYPE_PROPERTIES,
  type AnalyzeResult,
  type BuildResult,
  type DesignProperty,
  type RenderResult,
  type RenderedElement,
  type StateFact,
  type StyleFact,
  type TestRunResult,
} from "./types.ts";
import { compareImages, type VisualComparison } from "./visual.ts";
import { nearestColorToken } from "../generate/accent.ts";

export type CheckStatus = "pass" | "fail" | "not-checked";

export interface Check {
  id: "build" | "render" | "components" | "colors" | "type" | "spacing" | "layout" | "text" | "typeface" | "tests" | "visual" | "states";
  title: string;
  status: CheckStatus;
  /** One line, used in the headline when the check ran. */
  summary: string;
  details: string[];
}

export interface VerifyInput {
  design: DesignTree;
  /** Figma component, component set or node id → the code component expected for it. */
  mapping: Map<string, string>;
  index: ComponentIndex;
  capabilities: AdapterManifest["capabilities"];
  build?: BuildResult;
  render?: RenderResult;
  analysis?: AnalyzeResult;
  /** The project's tokens: a token the implementation uses must be one of them, or be defined in the render. */
  tokens?: TokenSet;
  /** The result of running the implementation's own tests, when there are any. */
  tests?: TestRunResult;
  /** An image of the design to compare the render with, pixel by pixel. PNG, base64. */
  baseline?: { png: string; source: "screenshot" | "figma"; maxMismatch?: number };
  /** Tolerances in design points (plan §3: ±1 for boxes, ±2–4 for text). */
  tolerance?: { box: number; text: number };
}

export interface VerifyReport {
  frame: { id: string; name: string; width: number; height: number };
  verdict: "pass" | "fail" | "incomplete";
  headline: string;
  checks: Check[];
  renderer?: { name: string; version: string; os: string };
  warnings: string[];
}

interface Expected {
  node: DesignNode;
  /** The code component expected, when the node is a mapped instance (or the mapped root). */
  component?: string;
  /** Unmapped instance: its component is unknown to the mapping. */
  unmapped?: boolean;
}

export function verify(input: VerifyInput): VerifyReport {
  const { design, mapping, index, capabilities } = input;
  const tol = input.tolerance ?? { box: 1, text: 3 };
  const root = design.root;
  const expected = expectedNodes(root, mapping);
  const checks: Check[] = [];
  const warnings: string[] = [];
  const ok = (id: Check["id"], title: string, summary: string, details: string[] = []): Check => ({ id, title, status: "pass", summary, details });
  const fail = (id: Check["id"], title: string, summary: string, details: string[] = []): Check => ({ id, title, status: "fail", summary, details });
  const skip = (id: Check["id"], title: string, reason: string): Check => ({ id, title, status: "not-checked", summary: reason, details: [] });

  // 1. Build
  if (!capabilities.build) checks.push(skip("build", "Built", "the adapter cannot build"));
  else if (!input.build) checks.push(skip("build", "Built", "no build was run"));
  else if (!input.build.ok) checks.push(fail("build", "Built", "build failed", input.build.log.split("\n").slice(0, 10)));
  else checks.push(ok("build", "Built", "built"));

  // 2. Render
  const render = input.render;
  let elements: RenderedElement[] | undefined;
  if (!capabilities.render.supported) checks.push(skip("render", "Rendered", capabilities.render.reason ?? "the adapter cannot render"));
  else if (!render) checks.push(skip("render", "Rendered", input.build?.ok === false ? "nothing to render: the build failed" : "no render was run"));
  else if (render.status !== "ok") checks.push(render.status === "unsupported" ? skip("render", "Rendered", render.reason) : fail("render", "Rendered", "render failed", [render.reason]));
  else {
    elements = render.elements;
    warnings.push(...render.warnings);
    checks.push(ok("render", "Rendered", `rendered (${render.renderer.name} ${render.renderer.version})`, render.warnings));
  }
  const byId = new Map((elements ?? []).map((e) => [e.figmaId, e]));
  const noRender = "nothing was rendered";

  // 3. Design-system components: used, wrong, invented, missing
  const components = expected.filter((e) => e.component || e.unmapped);
  if (!elements) checks.push(skip("components", "Design-system components", noRender));
  else {
    const mapped = components.filter((e) => e.component);
    const unmapped = components.filter((e) => e.unmapped);
    let used = 0;
    const details: string[] = [];
    const known = new Map(index.components.map((c) => [c.name, c]));
    let invented = 0;
    for (const e of mapped) {
      const el = byId.get(e.node.id);
      const label = `${e.node.name} (${e.node.id})`;
      if (!el) {
        details.push(`✗ ${label}: expected ${e.component}; no rendered element carries this Figma id`);
        continue;
      }
      const code = known.get(el.component);
      if (!el.defined) details.push(`✗ ${label}: <${el.component}> was never loaded (missing import?), so it rendered as an unknown element`);
      else if (el.component === e.component || code?.extends?.includes(e.component!)) used++;
      else if (code) details.push(`✗ ${label}: expected ${e.component}, got ${el.component} (another design-system component)`);
      else {
        invented++;
        details.push(`✗ ${label}: expected ${e.component}, got <${el.component}> — invented instead of the design-system component`);
      }
    }
    for (const e of unmapped) details.push(`– ${e.node.name} (${e.node.id}): not checked, its Figma component has no confirmed mapping`);
    const summary = `${used} of ${mapped.length} design-system components used, ${invented} invented`;
    if (!mapped.length) checks.push(skip("components", "Design-system components", unmapped.length ? `${unmapped.length} instances, none with a confirmed mapping` : "the frame has no component instances"));
    else checks.push(used === mapped.length ? { ...ok("components", "Design-system components", summary, details), ...(unmapped.length && { summary: `${summary} (${unmapped.length} unmapped, not checked)` }) } : fail("components", "Design-system components", summary, details));
  }

  // 4–6. Hard-coded values (runtime provenance on rendered elements, plus the static scan of all code)
  const provenance = capabilities.runtimeStyleProvenance || capabilities.staticProvenance;
  const facts = dedupe([...(elements ?? []).flatMap((e) => e.styles), ...(input.analysis?.literals ?? [])]);
  // Token kinds the design system has, for the wrong-kind rule (a font-size token used as padding).
  const tokenType = new Map((input.tokens?.tokens ?? []).map((t) => [t.name, t.type]));
  const kinds = new Set((input.tokens?.tokens ?? []).map((t) => tokenKind(t.name, t.type)).filter((k): k is TokenKind => !!k));
  const hardCoded = (id: Check["id"], title: string, props: DesignProperty[], noun: string) => {
    if (!provenance) return skip(id, title, "the adapter cannot tell tokens from literals");
    if (!elements && !input.analysis) return skip(id, title, "nothing was rendered or analysed");
    const literal = facts.filter((f) => f.source === "literal" && props.includes(f.property));
    const tokens = facts.filter((f) => f.source === "token" && props.includes(f.property));
    // A token must be real. Undefined in the render is fine only for a known token written with its
    // fallback (how Carbon itself writes spacing); otherwise it is invented, or renders nothing.
    const known = input.tokens ? new Set(input.tokens.tokens.map((t) => t.name)) : undefined;
    const hasFallback = (f: StyleFact) => /var\(\s*--[a-zA-Z0-9-]+\s*,/.test(f.written);
    const undefinedTokens = tokens.filter((f) => f.defined === false && !(known?.has(f.token ?? "") && hasFallback(f)));
    const misused = input.tokens ? tokens.filter((f) => f.defined !== false || known?.has(f.token ?? "")).map((f) => ({ f, why: f.token ? wrongKind(f.property, f.token, tokenType.get(f.token), kinds) : undefined })).filter((m) => m.why) : [];
    const summary = `${literal.length} hard-coded ${noun}${undefinedTokens.length ? `, ${undefinedTokens.length} undefined token${undefinedTokens.length === 1 ? "" : "s"}` : ""}${misused.length ? `, ${misused.length} token${misused.length === 1 ? "" : "s"} of the wrong kind` : ""}`;
    const details = [
      ...literal.map((f) => `✗ ${f.property}: ${f.written}${f.at ? ` at ${f.at}` : ""}`),
      ...undefinedTokens.map((f) =>
        known && !known.has(f.token ?? "")
          ? `✗ ${f.property}: ${f.written} — no such token (misspelt or invented)${f.at ? ` at ${f.at}` : ""}`
          : `✗ ${f.property}: ${f.written} — the token is not defined on the page; write its fallback, e.g. var(--token, value)${f.at ? ` at ${f.at}` : ""}`,
      ),
      ...misused.map(({ f, why }) => `✗ ${f.property}: ${f.written} — ${why}${f.at ? ` at ${f.at}` : ""}`),
      ...tokens.filter((f) => f.defined !== false && !misused.some((m) => m.f === f)).map((f) => `✓ ${f.property}: token ${f.token}`),
    ];
    return literal.length || undefinedTokens.length || misused.length ? fail(id, title, summary, details) : ok(id, title, summary, details);
  };
  checks.push(hardCoded("colors", "Colours from tokens", COLOR_PROPERTIES, "colours"));
  checks.push(hardCoded("type", "Type styles from tokens", TYPE_PROPERTIES, "type styles"));
  checks.push(hardCoded("spacing", "Spacing and sizes from tokens", SPACING_PROPERTIES, "spacing or size values"));

  // 7. Layout
  const placed = expected.filter((e) => e.node.visible && e.node.box);
  if (!elements) checks.push(skip("layout", "Layout", noRender));
  else {
    const details: string[] = [];
    let checked = 0;
    let within = 0;
    const fromScreenshot = input.design.source.fileKey === "screenshot";
    for (const e of placed) {
      const el = byId.get(e.node.id);
      if (!el) continue;
      checked++;
      const t = e.node.kind === "text" ? tol.text : tol.box;
      // A screenshot's text is measured in its own font, which the sandbox may not have: the width of a
      // line follows the font (the typeface check covers that), so it gets a share of slack; its place does not.
      const wt = e.node.kind === "text" && fromScreenshot ? Math.max(t, 0.35 * e.node.box!.width) : t;
      // The element's box, or what it draws: a design box measured from pixels (a screenshot, or
      // auto-width text) matches the drawn extent, while a block-level element fills its row.
      const diffs = boxDiffs(e.node.box!, el.box, t, wt);
      if (diffs.length && el.drawnBox && !boxDiffs(e.node.box!, el.drawnBox, t, wt).length) diffs.length = 0;
      if (!el.visible) details.push(`✗ ${e.node.name} (${e.node.id}): visible in the design, not visible in the render`);
      else if (diffs.length) details.push(`✗ ${e.node.name} (${e.node.id}): ${diffs.join(", ")} (tolerance ±${t})`);
      else within++;
    }
    const untagged = placed.filter((e) => !byId.has(e.node.id)).length;
    if (untagged) details.push(`– ${untagged} expected elements carry no Figma id; their layout is not checked`);
    // Tagged elements for nodes the design hides or doesn't have.
    const designIds = new Map<string, DesignNode>();
    walk(root, (n) => void designIds.set(n.id, n));
    const extra = (elements ?? []).filter((el) => el.visible && (!designIds.has(el.figmaId) || !visibleInDesign(root, el.figmaId)));
    for (const el of extra) details.push(`✗ <${el.component}> tagged ${el.figmaId}: rendered, but ${designIds.has(el.figmaId) ? "hidden" : "absent"} in the design`);
    const failed = checked - within + extra.length;
    const summary = `layout within tolerance on ${within}/${checked} elements`;
    if (!checked) checks.push(skip("layout", "Layout", "no rendered element carries a Figma id"));
    else checks.push(failed ? fail("layout", "Layout", summary, details) : ok("layout", "Layout", summary, details));
  }

  // 8. Text
  const texts = expected.filter((e) => e.node.visible && e.node !== root && (e.node.kind === "text" || e.node.kind === "instance"));
  if (!elements) checks.push(skip("text", "Text", noRender));
  else {
    let checked = 0;
    let exact = 0;
    const details: string[] = [];
    for (const e of texts) {
      const want = visibleText(e.node);
      const el = byId.get(e.node.id);
      if (!el || (!want && e.node.kind === "instance")) continue;
      checked++;
      // Text drawn by a nested component that has no text in the design (an input's placeholder or
      // value inside a form field) is not this element's text: it is set aside before comparing. So is
      // the text of another checked element the code nests inside this one while the design places it
      // beside it (a form field wrapping its input): that text is checked on its own element.
      let got = el.text;
      const below = new Set(descendants(e.node).map((d) => d.id));
      for (const d of descendants(e.node)) {
        const inner = d.kind === "instance" && !visibleText(d) ? byId.get(d.id)?.text : undefined;
        if (inner) got = got.replace(inner, " ");
      }
      for (const o of elements) {
        if (o === el || !o.text || below.has(o.figmaId) || o.figmaId === root.id || !inside(o.box, el.box)) continue;
        const theirs = expected.find((x) => x.node.id === o.figmaId);
        if (theirs && !descendants(theirs.node).some((d) => d.id === e.node.id)) got = got.replace(o.text, " ");
      }
      // Whitespace is layout, not content: compare with runs of whitespace collapsed.
      // An instance's design text may include the content placed into it (a form field's input with its
      // placeholder): either reading matches.
      const seen = got.replace(/\s+/g, " ").trim();
      if (seen === want || (e.node.kind === "instance" && seen === visibleText(e.node, true))) exact++;
      else details.push(`✗ ${e.node.name} (${e.node.id}): design says ${JSON.stringify(want)}, rendered ${JSON.stringify(el.text)}`);
    }
    const summary = checked === exact ? "text matches exactly" : `text differs on ${checked - exact} of ${checked} elements`;
    if (!checked) checks.push(skip("text", "Text", "no tagged element carries design text"));
    else checks.push(exact === checked ? ok("text", "Text", `${summary} (${checked})`, details) : fail("text", "Text", summary, details));
  }

  // 9. Typeface actually used to draw the text
  if (!elements) checks.push(skip("typeface", "Typeface", noRender));
  else {
    const details: string[] = [];
    let checked = 0;
    let right = 0;
    for (const e of texts) {
      const el = byId.get(e.node.id);
      const families = fontFamilies(e.node);
      // Without a named family (a screenshot), the typeface's class (sans-serif, serif, monospace) is checked.
      const classes = families.length ? [] : fontClasses(e.node);
      if (!el || !el.text || (!families.length && !classes.length)) continue;
      if (!el.fonts.length) continue; // the renderer could not say
      checked++;
      if (families.length) {
        if (families.every((f) => el.fonts.includes(f))) right++;
        else details.push(`✗ ${e.node.name} (${e.node.id}): design uses ${families.join(", ")}, drawn with ${el.fonts.join(", ")}`);
      } else {
        const drawn = [...new Set(el.fonts.map(fontClass))];
        if (classes.every((c) => drawn.includes(c))) right++;
        else details.push(`✗ ${e.node.name} (${e.node.id}): design shows ${classes.join(", ")} type, drawn in ${el.fonts.join(", ")} (${drawn.join(", ")})`);
      }
    }
    const byClass = texts.every((e) => !fontFamilies(e.node).length);
    const summary = `typeface${byClass ? " class" : ""} as designed on ${right}/${checked} elements`;
    const designNamesFonts = texts.some((e) => fontFamilies(e.node).length > 0 || fontClasses(e.node).length > 0);
    if (!checked) checks.push(skip("typeface", "Typeface", designNamesFonts ? "the renderer did not report which fonts drew the text" : "the design does not name a font family (e.g. it was read from a screenshot)"));
    else checks.push(right === checked ? ok("typeface", "Typeface", summary, details) : fail("typeface", "Typeface", summary, details));
  }

  // 10–11. Not verifiable here yet; said plainly.
  checks.push(testsCheck(input, skip, ok, fail));
  checks.push(visualCheck(input, elements, skip, ok, fail));
  checks.push(statesCheck(input, elements, skip, ok, fail));

  const ran = checks.filter((c) => c.status !== "not-checked");
  const verdict = checks.some((c) => c.status === "fail") ? "fail" : checks.some((c) => c.status === "not-checked") ? "incomplete" : "pass";
  return {
    frame: { id: root.id, name: root.name, width: root.box?.width ?? 0, height: root.box?.height ?? 0 },
    verdict,
    headline: [root.name, ...ran.map((c) => `${c.status === "fail" ? "✗ " : ""}${c.summary}`)].join(" · "),
    checks,
    ...(render?.status === "ok" && { renderer: render.renderer }),
    warnings,
  };
}

function testsCheck(
  input: VerifyInput,
  skip: (id: Check["id"], title: string, reason: string) => Check,
  ok: (id: Check["id"], title: string, summary: string, details?: string[]) => Check,
  fail: (id: Check["id"], title: string, summary: string, details?: string[]) => Check,
): Check {
  const title = "Generated tests";
  const t = input.tests;
  if (!t) return skip("tests", title, input.capabilities.tests ? "no test file was given" : "the adapter cannot run tests in a sandbox");
  // A runner that could not start says nothing about the tests: not checked, not failed.
  if (t.status !== "ran") return skip("tests", title, t.reason);
  if (t.fileError) return fail("tests", title, "the test file did not run", [`✗ ${t.fileError}`]);
  if (!t.tests.length) return fail("tests", title, "the test file declares no tests");
  const passed = t.tests.filter((x) => x.status === "passed").length;
  const failed = t.tests.filter((x) => x.status === "failed");
  const details = [...failed.map((x) => `✗ ${x.name}: ${x.error ?? "failed"}`), ...t.tests.filter((x) => x.status === "skipped").map((x) => `– ${x.name}: skipped`)];
  const summary = `${passed} of ${t.tests.length} generated tests pass · ${t.runner}`;
  return failed.length || passed === 0 ? fail("tests", title, summary, details) : ok("tests", title, summary, details);
}

/**
 * Interaction states, rendered by hovering, pressing and keyboard-focusing each interactive element.
 * Without a design of each state, what can be checked is that the states work: focus is visible
 * (WCAG 2.4.7), hovering or pressing does not move the layout, and the colours a state paints are
 * the design system's.
 */
function statesCheck(
  input: VerifyInput,
  elements: RenderedElement[] | undefined,
  skip: (id: Check["id"], title: string, reason: string) => Check,
  ok: (id: Check["id"], title: string, summary: string, details?: string[]) => Check,
  fail: (id: Check["id"], title: string, summary: string, details?: string[]) => Check,
): Check {
  const title = "Hover, focus and pressed states";
  const render = input.render;
  if (!input.capabilities.forceStates.length) return skip("states", title, "the adapter cannot render interaction states");
  if (!elements || render?.status !== "ok") return skip("states", title, "nothing was rendered");
  if (!render.states) return skip("states", title, "interaction states were not rendered");
  const byId = new Map<string, StateFact[]>();
  for (const f of render.states) byId.set(f.figmaId, [...(byId.get(f.figmaId) ?? []), f]);
  if (!byId.size) return ok("states", title, "no interactive elements to check");
  const details: string[] = [];
  let failed = 0;
  for (const [id, facts] of byId) {
    const name = elements.find((e) => e.figmaId === id)?.component ?? id;
    const problems: string[] = [];
    const focus = facts.find((f) => f.state === "focus");
    if (focus && (focus.changedPixels ?? focus.changed * 1e4) < VISIBLE_PIXELS) problems.push("no visible focus indicator: keyboard users cannot see where they are");
    for (const f of facts.filter((x) => x.shifted)) problems.push(`its box moves when ${f.state === "pressed" ? "pressed" : f.state === "hover" ? "hovered" : "focused"}`);
    if (input.tokens) {
      for (const f of facts) {
        for (const c of f.colors) {
          const hex = cssHex(c);
          const t = hex && nearestColorToken(hex, input.tokens);
          if (t && t.distance > OFF_SYSTEM) problems.push(`${f.state} paints ${hex}, which is no design-system colour (nearest: ${t.name} ${t.hex})`);
        }
      }
    }
    const pct = (s: string) => `${s} ${Math.round((facts.find((f) => f.state === s)?.changed ?? 0) * 100)}%`;
    if (problems.length) {
      failed++;
      details.push(...[...new Set(problems)].map((p) => `✗ ${name} (${id}): ${p}`));
    } else details.push(`✓ ${name} (${id}): changes on ${pct("hover")}, ${pct("pressed")}, ${pct("focus")}; focus visible, no layout shift`);
  }
  const summary = `${byId.size - failed} of ${byId.size} interactive elements show visible focus, keep their layout and design-system colours in every state`;
  return failed ? fail("states", title, summary, details) : ok("states", title, summary, details);
}

/** "rgb(51, 126, 204)" or "rgba(…, a)" with a ≥ 0.9 → "#337ecc"; translucent colours (shadows, washes) are blends, not tokens. */
function cssHex(c: string): string | undefined {
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)/.exec(c);
  if (!m || (m[4] !== undefined && Number(m[4]) < 0.9)) return undefined;
  return `#${[m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, "0")).join("")}`;
}

/** Fewer changed pixels than this, and a focused element looks the same as at rest (a ring round a 14 px box is ~50). */
const VISIBLE_PIXELS = 16;

function visualCheck(
  input: VerifyInput,
  elements: RenderedElement[] | undefined,
  skip: (id: Check["id"], title: string, reason: string) => Check,
  ok: (id: Check["id"], title: string, summary: string, details?: string[]) => Check,
  fail: (id: Check["id"], title: string, summary: string, details?: string[]) => Check,
): Check {
  const title = "Pixel comparison";
  const render = input.render;
  if (!input.baseline) return skip("visual", title, "no image of the design to compare with (Figma's image endpoint shares the monthly API budget; a screenshot enables this check)");
  if (!elements || render?.status !== "ok") return skip("visual", title, "nothing was rendered");
  let result: VisualComparison;
  try {
    result = compareImages(Buffer.from(render.png, "base64"), Buffer.from(input.baseline.png, "base64"));
  } catch {
    return skip("visual", title, "the design image could not be read (PNG is needed)");
  }
  const limit = input.baseline.maxMismatch ?? 0.08;
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  // A colour the design uses that no token of the design system matches, drawn in the render with the
  // nearest token: the design has drifted from the system. Matching it would take a hard-coded value,
  // so those pixels are reported for the designer, not counted against the code.
  const offSystem = new Map<(typeof result.regions)[number], string>();
  for (const r of result.regions) {
    // Only a region that is mostly one colour drawn as another: anything else differing there still counts.
    if (!input.tokens || !r.design || !r.render || (r.colorShare ?? 0) < MOSTLY_ONE_COLOUR) continue;
    const wanted = nearestColorToken(r.design, input.tokens);
    const used = nearestColorToken(r.render, input.tokens);
    if (wanted && used && wanted.distance > OFF_SYSTEM && used.distance <= ON_TOKEN) {
      offSystem.set(r, `the design's ${r.design} matches no token of the design system (nearest: ${wanted.name} ${wanted.hex}); the render uses ${used.name}. Not counted against the code: check the colour with your designer`);
    } else if (wanted && used && wanted.hex === used.hex && r.design !== r.render && used.distance <= ON_TOKEN) {
      // Drawn with the very token nearest the design's colour: as close as the design system allows.
      offSystem.set(r, `the design's ${r.design} is not exactly a token; the render uses the nearest, ${used.name} ${used.hex}. Not counted against the code`);
    }
  }
  // Only the colour swap itself is excused (the region's share of pixels in that colour pair), never the
  // shapes or text that also differ in the same region.
  const excused = [...offSystem.keys()].reduce((n, r) => n + r.pixels * (r.colorShare ?? 0), 0) / (result.width * result.height);
  const mismatch = Math.max(0, result.mismatch - excused);
  const summary = `${pct(mismatch)} of pixels differ from the ${input.baseline.source} (limit ${pct(limit)})${excused > 0.001 ? `; ${pct(excused)} more is a design colour the design system has no exact token for` : ""}`;
  const details = result.regions.map((r) => {
    // The element the difference is about: the largest one lying mostly inside the region when it fills a
    // good part of it (a region spanning a checkbox and a button is about the button, not their form);
    // otherwise the smallest element holding most of the region.
    const area = (b: Box) => b.width * b.height;
    const inside = elements.filter((e) => e.visible && area(e.box) > 0 && overlap(e.box, r) > 0.5 * area(e.box)).sort((a, b) => area(b.box) - area(a.box))[0];
    const holding = elements.filter((e) => e.visible && overlap(e.box, r) > 0.5 * area(r)).sort((a, b) => area(a.box) - area(b.box))[0];
    const over = inside && area(inside.box) >= 0.4 * area(r) ? inside : holding;
    const where = `differs at (${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}×${Math.round(r.height)})${over ? ` over <${over.component}> ${over.figmaId}` : ""}`;
    if (offSystem.has(r)) return `! ${where}: ${offSystem.get(r)}`;
    // The nearest token for each side, so a repair can reach for the design system's colour by name.
    const named = (c: string) => {
      const t = input.tokens && nearestColorToken(c, input.tokens);
      return t && t.distance <= OFF_SYSTEM ? `${c} (nearest token: ${t.name} ${t.hex})` : c;
    };
    const colors = r.design && r.render && r.design !== r.render ? `: mostly ${named(r.design)} in the design, ${named(r.render)} in the render` : "";
    // Over a design-system component drawn in another token than the design's: say what to do, not only what differs.
    const wanted = r.design && input.tokens ? nearestColorToken(r.design, input.tokens) : undefined;
    const drawn = r.render && input.tokens ? nearestColorToken(r.render, input.tokens) : undefined;
    const component = over && input.index.components.find((c) => c.name === over.component);
    const fix =
      component && wanted && drawn && wanted.distance <= OFF_SYSTEM && wanted.hex !== drawn.hex
        ? ` → give <${component.name}> ${over!.figmaId} var(--${wanted.name}, ${wanted.hex}) through a colour prop that takes it${component.cssProperties?.length ? `, or its theming CSS variables (${component.cssProperties.slice(0, 4).map((p) => p.name).join(", ")}, and their hover and active counterparts)` : ""}`
        : "";
    return `${mismatch > limit ? "✗" : "–"} ${where}${colors}${fix}`;
  });
  return mismatch > limit ? fail("visual", title, summary, details) : ok("visual", title, summary, details);
}

/** OKLab ΔE ×100: beyond OFF_SYSTEM no token is that colour; within ON_TOKEN the render drew a token's colour. */
const OFF_SYSTEM = 10;
/** A region is excused only when its colour pair accounts for this share of its differing pixels. */
const MOSTLY_ONE_COLOUR = 0.6;
const ON_TOKEN = 4;

/** Whether box `a` lies within box `b` (a point of slack for rounding). */
function inside(a: Box, b: Box): boolean {
  return a.x >= b.x - 1 && a.y >= b.y - 1 && a.x + a.width <= b.x + b.width + 1 && a.y + a.height <= b.y + b.height + 1;
}

function overlap(a: Box, b: Box): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Nodes the implementation is expected to tag: the root, top-level instances, and text outside instances. */
function expectedNodes(root: DesignNode, mapping: Map<string, string>): Expected[] {
  const out: Expected[] = [];
  const rootComponent = mapping.get(root.id);
  out.push({ node: root, ...(rootComponent && { component: rootComponent }) });
  const visit = (n: DesignNode, visible: boolean) => {
    const shown = visible && n.visible;
    if (n.kind === "instance") {
      if (!shown) return;
      const component = mapping.get(n.id) ?? mapping.get(n.component.id) ?? (n.component.set && mapping.get(n.component.set.id));
      out.push(component ? { node: n, component } : { node: n, unmapped: true });
      // Its own layers are the component's business; content placed into it is the code's.
      for (const c of n.content ?? []) visit(c, shown);
      return;
    }
    if (n.kind === "text") {
      if (shown) out.push({ node: n });
      return;
    }
    for (const c of n.children) visit(c, shown);
  };
  if (root.kind !== "text") for (const c of root.children) visit(c, root.visible);
  return out;
}

function walk(n: DesignNode, fn: (n: DesignNode) => void): void {
  fn(n);
  if (n.kind !== "text") for (const c of layers(n)) walk(c, fn);
}

/** Every node below `n` (not `n` itself). */
function descendants(n: DesignNode): DesignNode[] {
  const out: DesignNode[] = [];
  walk(n, (x) => x !== n && out.push(x));
  return out;
}

/** A node's children, plus the content placed into it when it is an instance. */
function layers(n: Exclude<DesignNode, { kind: "text" }>): DesignNode[] {
  return n.kind === "instance" && n.content ? [...n.children, ...n.content] : n.children;
}

function visibleInDesign(root: DesignNode, id: string): boolean {
  const find = (n: DesignNode, visible: boolean): boolean | undefined => {
    const shown = visible && n.visible;
    if (n.id === id) return shown;
    if (n.kind === "text") return undefined;
    for (const c of layers(n)) {
      const r = find(c, shown);
      if (r !== undefined) return r;
    }
    return undefined;
  };
  return find(root, true) ?? false;
}

/** The text a node shows: its visible text layers, in order, joined by spaces; with `placed`, also the content placed into instances. */
export function visibleText(n: DesignNode, placed = false): string {
  const parts: string[] = [];
  const visit = (x: DesignNode) => {
    if (!x.visible) return;
    if (x.kind === "text") parts.push(x.characters);
    else (placed ? layers(x) : x.children).forEach(visit);
  };
  visit(n);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function fontClasses(n: DesignNode): FontClass[] {
  const classes = new Set<FontClass>();
  const visit = (x: DesignNode) => {
    if (!x.visible) return;
    if (x.kind === "text") {
      if (x.style.fontClass) classes.add(x.style.fontClass);
    } else x.children.forEach(visit);
  };
  visit(n);
  return [...classes];
}

function fontFamilies(n: DesignNode): string[] {
  const families = new Set<string>();
  const visit = (x: DesignNode) => {
    if (!x.visible) return;
    if (x.kind === "text") {
      if (x.style.fontFamily) families.add(x.style.fontFamily);
    } else x.children.forEach(visit);
  };
  visit(n);
  return [...families];
}

function boxDiffs(want: Box, got: Box, tolerance: number, widthTolerance = tolerance): string[] {
  const out: string[] = [];
  for (const k of ["x", "y", "width", "height"] as const) {
    const d = got[k] - want[k];
    if (Math.abs(d) > (k === "width" ? widthTolerance : tolerance) + 1e-6) out.push(`${k} ${round(want[k])} → ${round(got[k])} (${d > 0 ? "+" : ""}${round(d)})`);
  }
  return out;
}

/**
 * One fact per distinct written value. The render and the static scan often report the
 * same declaration with different locations; keep the one a developer can jump to (file:line).
 */
function dedupe(facts: StyleFact[]): StyleFact[] {
  const byValue = new Map<string, StyleFact>();
  const precise = (f: StyleFact) => !!f.at && /:\d+$/.test(f.at);
  for (const f of facts) {
    const key = `${f.property}|${f.written}`;
    const kept = byValue.get(key);
    // Prefer the precise location, but never lose what the render learnt (an undefined token).
    if (!kept) byValue.set(key, f);
    else if (!precise(kept) && precise(f)) byValue.set(key, { ...f, ...(kept.defined !== undefined && { defined: kept.defined }) });
    else if (kept.defined === undefined && f.defined !== undefined) byValue.set(key, { ...kept, defined: f.defined });
  }
  return [...byValue.values()];
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
