// Figma REST nodes → Tulpar design model.

import type * as F from "./types.ts";
import {
  DESIGN_MODEL_VERSION,
  type Box,
  type Color,
  type CornerRadius,
  type DesignNode,
  type DesignTree,
  type Effect,
  type InstanceProp,
  type Paint,
  type Stack,
  type StackChild,
  type Stroke,
  type TextRun,
  type TextStyle,
  type TokenRef,
} from "../model.ts";

export interface NormalizeContext {
  fileKey: string;
  fileVersion: string;
  components: Record<string, F.ComponentMeta>;
  componentSets: Record<string, F.ComponentSetMeta>;
  styles: Record<string, F.StyleMeta>;
}

const CONTAINER_TYPES = new Set(["FRAME", "GROUP", "SECTION", "COMPONENT", "COMPONENT_SET"]);
const SHAPE_TYPES = new Set([
  "RECTANGLE",
  "ELLIPSE",
  "VECTOR",
  "LINE",
  "STAR",
  "REGULAR_POLYGON",
  "BOOLEAN_OPERATION",
]);

/** Normalise one Figma subtree. Boxes become relative to the subtree's root. */
export function normalizeTree(node: F.FigmaNode, ctx: NormalizeContext): DesignTree {
  const abs = node.absoluteBoundingBox;
  if (!abs) throw new Error(`Node ${node.id} (${node.name}) has no absoluteBoundingBox.`);
  const origin = { x: abs.x, y: abs.y };
  return {
    schemaVersion: DESIGN_MODEL_VERSION,
    source: { fileKey: ctx.fileKey, fileVersion: ctx.fileVersion, nodeId: node.id },
    origin,
    root: normalizeNode(node, undefined, origin, ctx),
  };
}

export function normalizeNode(
  node: F.FigmaNode,
  parent: F.FigmaNode | undefined,
  origin: { x: number; y: number },
  ctx: NormalizeContext,
): DesignNode {
  const unsupported: string[] = [];
  const tokens = variableTokens(node.boundVariables);
  Object.assign(tokens, styleTokens(node.styles, ctx));

  const base = {
    id: node.id,
    name: node.name,
    box: relBox(node.absoluteBoundingBox, origin),
    ...(node.absoluteRenderBounds !== undefined && { renderBox: relBox(node.absoluteRenderBounds, origin) }),
    visible: node.visible !== false,
    opacity: node.opacity ?? 1,
    ...(node.rotation ? { rotation: node.rotation } : {}),
    fills: paints(node.type === "TEXT" ? undefined : node.fills),
    ...(node.strokes?.some(isVisible) && { stroke: stroke(node) }),
    ...(radius(node) !== undefined && { radius: radius(node) }),
    effects: (node.effects ?? []).filter((e) => e.visible).map(effect),
    clips: node.clipsContent ?? false,
    ...(parent && isStack(parent) && { inStack: stackChild(node) }),
    tokens,
  };

  if (node.blendMode && !["PASS_THROUGH", "NORMAL"].includes(node.blendMode)) unsupported.push(`blendMode=${node.blendMode}`);
  if (node.layoutMode === "GRID") unsupported.push("layoutMode=GRID");
  const withUnsupported = <T extends object>(n: T) => (unsupported.length ? { ...n, unsupported } : n);
  const kids = () => (node.children ?? []).map((c) => normalizeNode(c, node, origin, ctx));

  if (node.type === "TEXT") {
    return withUnsupported({
      ...base,
      kind: "text" as const,
      characters: node.characters ?? "",
      style: textStyle(node.style ?? {}, node.boundVariables),
      runs: textRuns(node),
      fills: paints(node.fills),
    });
  }

  if (node.type === "INSTANCE") {
    const meta = node.componentId ? ctx.components[node.componentId] : undefined;
    const setId = meta?.componentSetId;
    const setMeta = setId ? ctx.componentSets[setId] : undefined;
    return withUnsupported({
      ...base,
      kind: "instance" as const,
      component: {
        id: node.componentId ?? "",
        ...(meta && { key: meta.key, name: meta.name }),
        ...(setId && { set: { id: setId, ...(setMeta && { key: setMeta.key, name: setMeta.name }) } }),
      },
      props: instanceProps(node.componentProperties),
      ...(isStack(node) && { stack: stack(node) }),
      children: kids(),
    });
  }

  if (SHAPE_TYPES.has(node.type)) {
    return withUnsupported({ ...base, kind: "shape" as const, figmaType: node.type, children: kids() });
  }

  if (!CONTAINER_TYPES.has(node.type)) unsupported.push(`type=${node.type}`);
  return withUnsupported({
    ...base,
    kind: "container" as const,
    figmaType: node.type,
    ...(isStack(node) && { stack: stack(node) }),
    children: kids(),
  });
}

// ---------------------------------------------------------------------------

function relBox(r: F.Rect | null | undefined, origin: { x: number; y: number }): Box | null {
  if (!r) return null;
  return { x: r.x - origin.x, y: r.y - origin.y, width: r.width, height: r.height };
}

function isVisible(p: { visible?: boolean }): boolean {
  return p.visible !== false;
}

function color(c: F.RGBA): Color {
  return { space: "srgb", r: c.r, g: c.g, b: c.b, a: c.a };
}

function variableRef(alias: F.VariableAlias | undefined): TokenRef | undefined {
  return alias ? { source: "variable", id: alias.id } : undefined;
}

function paints(list: F.Paint[] | undefined): Paint[] {
  return (list ?? []).filter(isVisible).map(paint);
}

function paint(p: F.Paint): Paint {
  const opacity = p.opacity ?? 1;
  switch (p.type) {
    case "SOLID": {
      const token = variableRef(p.boundVariables?.color);
      return { kind: "solid", color: color(p.color!), opacity, ...(token && { token }) };
    }
    case "GRADIENT_LINEAR":
    case "GRADIENT_RADIAL":
    case "GRADIENT_ANGULAR":
    case "GRADIENT_DIAMOND":
      return {
        kind: "gradient",
        shape: p.type.slice("GRADIENT_".length).toLowerCase() as "linear" | "radial" | "angular" | "diamond",
        stops: (p.gradientStops ?? []).map((s) => {
          const token = variableRef(s.boundVariables?.color);
          return { position: s.position, color: color(s.color), ...(token && { token }) };
        }),
        handles: p.gradientHandlePositions ?? [],
        opacity,
      };
    case "IMAGE":
      return { kind: "image", ref: p.imageRef ?? "", scaleMode: (p.scaleMode ?? "FILL").toLowerCase(), opacity };
    default:
      return { kind: "other", figmaType: p.type };
  }
}

function stroke(node: F.FigmaNode): Stroke {
  const w = node.individualStrokeWeights;
  return {
    paints: paints(node.strokes),
    weight: w ? { ...w } : (node.strokeWeight ?? 1),
    align: (node.strokeAlign ?? "CENTER").toLowerCase() as Stroke["align"],
    ...(node.strokeDashes?.length && { dashes: node.strokeDashes }),
  };
}

function radius(node: F.FigmaNode): CornerRadius | undefined {
  const r = node.rectangleCornerRadii;
  if (r && !(r[0] === r[1] && r[1] === r[2] && r[2] === r[3])) {
    return { topLeft: r[0], topRight: r[1], bottomRight: r[2], bottomLeft: r[3] };
  }
  const single = r ? r[0] : node.cornerRadius;
  return single ? single : undefined;
}

function effect(e: F.Effect): Effect {
  switch (e.type) {
    case "DROP_SHADOW":
    case "INNER_SHADOW":
      return {
        kind: e.type === "DROP_SHADOW" ? "drop-shadow" : "inner-shadow",
        color: color(e.color!),
        offset: e.offset ?? { x: 0, y: 0 },
        radius: e.radius,
        spread: e.spread ?? 0,
      };
    case "LAYER_BLUR":
    case "BACKGROUND_BLUR":
      return { kind: e.type === "LAYER_BLUR" ? "layer-blur" : "background-blur", radius: e.radius };
    default:
      return { kind: "other", figmaType: e.type };
  }
}

function isStack(node: F.FigmaNode): boolean {
  return node.layoutMode === "HORIZONTAL" || node.layoutMode === "VERTICAL";
}

const MAIN_ALIGN = { MIN: "start", CENTER: "center", MAX: "end", SPACE_BETWEEN: "space-between" } as const;
const CROSS_ALIGN = { MIN: "start", CENTER: "center", MAX: "end", BASELINE: "baseline" } as const;

function stack(node: F.FigmaNode): Stack {
  const wrap = node.layoutWrap === "WRAP";
  return {
    axis: node.layoutMode === "HORIZONTAL" ? "horizontal" : "vertical",
    gap: node.itemSpacing ?? 0,
    ...(wrap && { crossGap: node.counterAxisSpacing ?? 0 }),
    padding: {
      top: node.paddingTop ?? 0,
      right: node.paddingRight ?? 0,
      bottom: node.paddingBottom ?? 0,
      left: node.paddingLeft ?? 0,
    },
    mainAlign: MAIN_ALIGN[node.primaryAxisAlignItems ?? "MIN"],
    crossAlign: CROSS_ALIGN[node.counterAxisAlignItems ?? "MIN"],
    wrap,
    reverseZ: node.itemReverseZIndex ?? false,
  };
}

function stackChild(node: F.FigmaNode): StackChild {
  const min = { ...(node.minWidth != null && { width: node.minWidth }), ...(node.minHeight != null && { height: node.minHeight }) };
  const max = { ...(node.maxWidth != null && { width: node.maxWidth }), ...(node.maxHeight != null && { height: node.maxHeight }) };
  return {
    ...(node.layoutSizingHorizontal && { horizontal: node.layoutSizingHorizontal.toLowerCase() as StackChild["horizontal"] }),
    ...(node.layoutSizingVertical && { vertical: node.layoutSizingVertical.toLowerCase() as StackChild["vertical"] }),
    absolute: node.layoutPositioning === "ABSOLUTE",
    ...(Object.keys(min).length && { min }),
    ...(Object.keys(max).length && { max }),
  };
}

// Figma boundVariables keys → model paths. Paint and effect variables live on the paints and effects themselves.
const VARIABLE_PATHS: Record<string, string> = {
  itemSpacing: "stack.gap",
  counterAxisSpacing: "stack.crossGap",
  paddingTop: "stack.padding.top",
  paddingRight: "stack.padding.right",
  paddingBottom: "stack.padding.bottom",
  paddingLeft: "stack.padding.left",
  topLeftRadius: "radius.topLeft",
  topRightRadius: "radius.topRight",
  bottomRightRadius: "radius.bottomRight",
  bottomLeftRadius: "radius.bottomLeft",
  strokeWeight: "stroke.weight",
  strokeTopWeight: "stroke.weight.top",
  strokeRightWeight: "stroke.weight.right",
  strokeBottomWeight: "stroke.weight.bottom",
  strokeLeftWeight: "stroke.weight.left",
  minWidth: "inStack.min.width",
  maxWidth: "inStack.max.width",
  minHeight: "inStack.min.height",
  maxHeight: "inStack.max.height",
  width: "box.width",
  height: "box.height",
  opacity: "opacity",
  visible: "visible",
  characters: "characters",
};
const SKIP_VARIABLES = new Set(["fills", "strokes", "effects", "componentProperties", "textRangeFills"]);
// Typography variables on TEXT nodes are recorded on the text style instead.
const TEXT_VARIABLES = new Set(["fontFamily", "fontSize", "fontStyle", "fontWeight", "lineHeight", "letterSpacing", "paragraphSpacing", "paragraphIndent"]);

function variableTokens(bound: F.BoundVariables | undefined): Record<string, TokenRef> {
  const out: Record<string, TokenRef> = {};
  for (const [key, value] of Object.entries(bound ?? {})) {
    if (SKIP_VARIABLES.has(key) || TEXT_VARIABLES.has(key)) continue;
    const path = VARIABLE_PATHS[key] ?? `figma.${key}`;
    if (Array.isArray(value)) value.forEach((v, i) => (out[`${path}[${i}]`] = { source: "variable", id: v.id }));
    else if (isAlias(value)) out[path] = { source: "variable", id: value.id };
    else for (const [sub, v] of Object.entries(value)) out[NESTED_VARIABLE_PATHS[`${key}.${sub}`] ?? `${path}.${sub}`] = { source: "variable", id: v.id };
  }
  return out;
}

const NESTED_VARIABLE_PATHS: Record<string, string> = {
  "rectangleCornerRadii.RECTANGLE_TOP_LEFT_CORNER_RADIUS": "radius.topLeft",
  "rectangleCornerRadii.RECTANGLE_TOP_RIGHT_CORNER_RADIUS": "radius.topRight",
  "rectangleCornerRadii.RECTANGLE_BOTTOM_RIGHT_CORNER_RADIUS": "radius.bottomRight",
  "rectangleCornerRadii.RECTANGLE_BOTTOM_LEFT_CORNER_RADIUS": "radius.bottomLeft",
  "size.x": "box.width",
  "size.y": "box.height",
};

function isAlias(v: unknown): v is F.VariableAlias {
  return typeof v === "object" && v !== null && (v as F.VariableAlias).type === "VARIABLE_ALIAS";
}

// Figma style slots → model paths.
const STYLE_PATHS: Record<string, string> = { fill: "fills", fills: "fills", stroke: "stroke", strokes: "stroke", text: "text", effect: "effects", grid: "grid" };

function styleTokens(styles: Record<string, string> | undefined, ctx: NormalizeContext): Record<string, TokenRef> {
  const out: Record<string, TokenRef> = {};
  for (const [slot, id] of Object.entries(styles ?? {})) {
    const name = ctx.styles[id]?.name;
    out[`style.${STYLE_PATHS[slot] ?? slot}`] = { source: "style", id, ...(name && { name }) };
  }
  return out;
}

const TEXT_ALIGN = { LEFT: "start", CENTER: "center", RIGHT: "end", JUSTIFIED: "justified" } as const;
const TEXT_CASE: Record<string, TextStyle["case"]> = {
  UPPER: "upper",
  LOWER: "lower",
  TITLE: "title",
  SMALL_CAPS: "small-caps",
  SMALL_CAPS_FORCED: "small-caps-forced",
};
const TEXT_DECORATION: Record<string, TextStyle["decoration"]> = { UNDERLINE: "underline", STRIKETHROUGH: "strikethrough" };

function textStyle(s: F.TypeStyle, bound: F.BoundVariables | undefined): TextStyle {
  const tokens: Record<string, TokenRef> = {};
  for (const [key, value] of Object.entries(bound ?? {})) {
    if (!TEXT_VARIABLES.has(key)) continue;
    // Per-range typography variables arrive as arrays; the first range speaks for the node.
    const alias = Array.isArray(value) ? value[0] : value;
    if (isAlias(alias)) tokens[key] = { source: "variable", id: alias.id };
  }
  return {
    ...(s.fontFamily && { fontFamily: s.fontFamily }),
    ...(s.fontWeight && { fontWeight: s.fontWeight }),
    italic: s.italic ?? false,
    ...(s.fontSize && { fontSize: s.fontSize }),
    ...(s.lineHeightPx && { lineHeight: s.lineHeightPx }),
    ...(s.letterSpacing && { letterSpacing: s.letterSpacing }),
    align: TEXT_ALIGN[s.textAlignHorizontal ?? "LEFT"],
    verticalAlign: (s.textAlignVertical ?? "TOP").toLowerCase() as TextStyle["verticalAlign"],
    ...(s.textCase && TEXT_CASE[s.textCase] && { case: TEXT_CASE[s.textCase] }),
    ...(s.textDecoration && TEXT_DECORATION[s.textDecoration] && { decoration: TEXT_DECORATION[s.textDecoration] }),
    ...(s.textAutoResize && { resize: s.textAutoResize.toLowerCase().replace(/_/g, "-") as TextStyle["resize"] }),
    ...(s.maxLines && { maxLines: s.maxLines }),
    truncate: s.textTruncation === "ENDING",
    tokens,
  };
}

/** Group Figma's per-character override ids into runs. Index 0 means "no override". */
function textRuns(node: F.FigmaNode): TextRun[] {
  const ids = node.characterStyleOverrides ?? [];
  const table = node.styleOverrideTable ?? {};
  const runs: TextRun[] = [];
  let start = 0;
  for (let i = 1; i <= ids.length; i++) {
    if (i < ids.length && ids[i] === ids[start]) continue;
    const id = ids[start];
    const override = id ? table[String(id)] : undefined;
    if (override) {
      const { tokens: _tokens, align: _align, verticalAlign: _va, truncate: _t, italic, ...style } = textStyle(override, undefined);
      const fills = override.fills ? paints(override.fills) : undefined;
      runs.push({
        start,
        end: i,
        style: { ...style, ...(override.italic !== undefined && { italic }) },
        ...(fills && { fills }),
      });
    }
    start = i;
  }
  return runs;
}

const PROP_TYPES = {
  VARIANT: "variant",
  BOOLEAN: "boolean",
  TEXT: "text",
  INSTANCE_SWAP: "instance-swap",
} as const;

export function propType(t: F.ComponentProperty["type"]): InstanceProp["type"] {
  return PROP_TYPES[t];
}

/** Strip Figma's "#123:45" suffix from a component property name. Variant names never carry one. */
export function propName(figmaName: string, type: F.ComponentProperty["type"]): string {
  return type === "VARIANT" ? figmaName : figmaName.replace(/#\d+:\d+$/, "");
}

function instanceProps(props: Record<string, F.ComponentProperty> | undefined): InstanceProp[] {
  return Object.entries(props ?? {}).map(([name, p]) => ({ name: propName(name, p.type), type: propType(p.type), value: p.value }));
}
