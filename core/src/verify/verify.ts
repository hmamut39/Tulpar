// The verifier: compare what was built and rendered with the Figma frame, check by check.
//
// Every check ends as pass, fail, or not-checked with a reason. The headline is built
// only from checks that ran, and the overall verdict is never "pass" while anything
// was left unchecked (docs/00-research-and-plan.md §3).

import type { ComponentIndex } from "../code-model.ts";
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
  type StyleFact,
} from "./types.ts";

export type CheckStatus = "pass" | "fail" | "not-checked";

export interface Check {
  id: "build" | "render" | "components" | "colors" | "type" | "spacing" | "layout" | "text" | "typeface" | "visual" | "states";
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
  const hardCoded = (id: Check["id"], title: string, props: DesignProperty[], noun: string) => {
    if (!provenance) return skip(id, title, "the adapter cannot tell tokens from literals");
    if (!elements && !input.analysis) return skip(id, title, "nothing was rendered or analysed");
    const literal = facts.filter((f) => f.source === "literal" && props.includes(f.property));
    const tokens = facts.filter((f) => f.source === "token" && props.includes(f.property));
    const summary = `${literal.length} hard-coded ${noun}`;
    const details = [...literal.map((f) => `✗ ${f.property}: ${f.written}${f.at ? ` at ${f.at}` : ""}`), ...tokens.map((f) => `✓ ${f.property}: token ${f.token}`)];
    return literal.length ? fail(id, title, summary, details) : ok(id, title, summary, details);
  };
  checks.push(hardCoded("colors", "Colours from tokens", COLOR_PROPERTIES, "colours"));
  checks.push(hardCoded("type", "Type styles from tokens", TYPE_PROPERTIES, "type styles"));
  checks.push(hardCoded("spacing", "Spacing from tokens", SPACING_PROPERTIES, "spacing values"));

  // 7. Layout
  const placed = expected.filter((e) => e.node.visible && e.node.box);
  if (!elements) checks.push(skip("layout", "Layout", noRender));
  else {
    const details: string[] = [];
    let checked = 0;
    let within = 0;
    for (const e of placed) {
      const el = byId.get(e.node.id);
      if (!el) continue;
      checked++;
      const t = e.node.kind === "text" ? tol.text : tol.box;
      const diffs = boxDiffs(e.node.box!, el.box, t);
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
      // Whitespace is layout, not content: compare with runs of whitespace collapsed.
      if (el.text.replace(/\s+/g, " ").trim() === want) exact++;
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
      if (!el || !el.text || !families.length) continue;
      if (!el.fonts.length) continue; // the renderer could not say
      checked++;
      if (families.every((f) => el.fonts.includes(f))) right++;
      else details.push(`✗ ${e.node.name} (${e.node.id}): design uses ${families.join(", ")}, drawn with ${el.fonts.join(", ")}`);
    }
    const summary = `typeface as designed on ${right}/${checked} elements`;
    if (!checked) checks.push(skip("typeface", "Typeface", "the renderer did not report which fonts drew the text"));
    else checks.push(right === checked ? ok("typeface", "Typeface", summary, details) : fail("typeface", "Typeface", summary, details));
  }

  // 10–11. Not verifiable here yet; said plainly.
  checks.push(skip("visual", "Pixel comparison", "no Figma image of the frame (the images endpoint shares the monthly API budget)"));
  checks.push(skip("states", "Hover, focus and pressed states", "interaction states are not rendered"));

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
      return; // An instance's layers are its component's own business.
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
  if (n.kind !== "text") for (const c of n.children) walk(c, fn);
}

function visibleInDesign(root: DesignNode, id: string): boolean {
  const find = (n: DesignNode, visible: boolean): boolean | undefined => {
    const shown = visible && n.visible;
    if (n.id === id) return shown;
    if (n.kind === "text") return undefined;
    for (const c of n.children) {
      const r = find(c, shown);
      if (r !== undefined) return r;
    }
    return undefined;
  };
  return find(root, true) ?? false;
}

/** The text a node shows: its visible text layers, in order, joined by spaces. */
export function visibleText(n: DesignNode): string {
  const parts: string[] = [];
  const visit = (x: DesignNode) => {
    if (!x.visible) return;
    if (x.kind === "text") parts.push(x.characters);
    else x.children.forEach(visit);
  };
  visit(n);
  return parts.join(" ").replace(/\s+/g, " ").trim();
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

function boxDiffs(want: Box, got: Box, tolerance: number): string[] {
  const out: string[] = [];
  for (const k of ["x", "y", "width", "height"] as const) {
    const d = got[k] - want[k];
    if (Math.abs(d) > tolerance + 1e-6) out.push(`${k} ${round(want[k])} → ${round(got[k])} (${d > 0 ? "+" : ""}${round(d)})`);
  }
  return out;
}

function dedupe(facts: StyleFact[]): StyleFact[] {
  const seen = new Set<string>();
  return facts.filter((f) => {
    const key = `${f.property}|${f.written}|${f.at?.replace(/ style attribute.*$/, "") ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
