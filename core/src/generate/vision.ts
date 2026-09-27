// Screenshot → design model. A vision model reads the image into elements (design-system
// components with props, text, containers) with estimated boxes; Tulpar turns that into
// the same DesignTree a Figma frame produces, so generation and verification are shared.
// What comes from a picture is an estimate, and everything downstream says so.

import type { CodeComponent, ComponentIndex } from "../code-model.ts";
import { DESIGN_MODEL_VERSION, type Color, type ContainerNode, type DesignNode, type DesignTree, type InstanceNode, type TextNode } from "../model.ts";
import type { Llm, LlmImage } from "./llm.ts";

export interface ScreenshotReading {
  design: DesignTree;
  /** Component ids in the tree → code component names (all read from the screenshot). */
  mapping: Map<string, string>;
  /** Things the reader was unsure of, or components it named that do not exist. */
  notes: string[];
  usage?: { inputTokens: number; outputTokens: number };
}

export interface ReadScreenshotOptions {
  llm: Llm;
  image: LlmImage;
  index: ComponentIndex;
  /** Image pixels per design point: 2 for a typical retina screenshot. */
  scale: number;
  /** Image size in pixels, when known (the model's own estimate is used otherwise). */
  size?: { width: number; height: number };
}

interface Element {
  id: string;
  parent: string;
  kind: "container" | "component" | "text";
  component: string;
  props: { name: string; value: string }[];
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  confidence: number;
}

const SCHEMA = {
  name: "screenshot_reading",
  schema: {
    type: "object",
    properties: {
      width: { type: "number" },
      height: { type: "number" },
      elements: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            parent: { type: "string" },
            kind: { type: "string", enum: ["container", "component", "text"] },
            component: { type: "string" },
            props: { type: "array", items: { type: "object", properties: { name: { type: "string" }, value: { type: "string" } }, required: ["name", "value"], additionalProperties: false } },
            text: { type: "string" },
            x: { type: "number" },
            y: { type: "number" },
            width: { type: "number" },
            height: { type: "number" },
            fill: { type: "string" },
            confidence: { type: "number" },
          },
          required: ["id", "parent", "kind", "component", "props", "text", "x", "y", "width", "height", "fill", "confidence"],
          additionalProperties: false,
        },
      },
      notes: { type: "array", items: { type: "string" } },
    },
    required: ["width", "height", "elements", "notes"],
    additionalProperties: false,
  },
};

export async function readScreenshot(options: ReadScreenshotOptions): Promise<ScreenshotReading> {
  const known = new Map(options.index.components.filter((c) => !c.deprecated).map((c) => [c.name, c]));
  const response = await options.llm.complete({
    instructions: [
      "You read a screenshot of a user interface into a structured list of its elements, for a code generator that must rebuild it with a specific design system.",
      "Rules:",
      "- Identify each design-system component you see and name it exactly as in the catalogue; set its props only to values the catalogue lists.",
      "- A thing that is not in the catalogue is a container (with its children) or text; never invent a component name.",
      "- Text: copy it exactly, character for character, as shown.",
      "- Boxes (x, y, width, height) are in image pixels, measured from the image's top-left corner. Be as precise as you can.",
      "- parent is the id of the containing element, or \"\" for top-level elements. Give ids e1, e2, …",
      "- fill: the element's own background colour as #rrggbb when it clearly has one, else \"\".",
      "- confidence: 0–1, how sure you are of the element's identity.",
      "- Do not describe a design-system component's internal parts (its label, icon, border) as separate elements: its text goes in `text`.",
      "- notes: anything ambiguous (e.g. two components that look alike).",
    ].join("\n"),
    text: [
      `The screenshot is ${options.size ? `${options.size.width}×${options.size.height} pixels` : "attached"}.`,
      "",
      "DESIGN-SYSTEM CATALOGUE (component: props with allowed values; slots)",
      ...[...known.values()].map(catalogueLine),
    ].join("\n"),
    images: [options.image],
    schema: SCHEMA,
    maxOutputTokens: 12000,
  });
  const reading = response.json as { width: number; height: number; elements: Element[]; notes: string[] };
  return { ...toDesign(reading, known, options.scale, options.size), ...(response.usage && { usage: response.usage }) };
}

function catalogueLine(c: CodeComponent): string {
  const props = c.props
    .filter((p) => !p.internal && !p.deprecated && (p.type?.kind === "enum" || p.type?.kind === "boolean"))
    .slice(0, 8)
    .map((p) => (p.type?.kind === "enum" ? `${p.name}=${p.type.values.slice(0, 12).join("|")}` : `${p.name}=true|false`));
  const slots = c.slots.map((s) => s.name || "content");
  return `- ${c.name}${props.length ? `: ${props.join("; ")}` : ""}${slots.length ? ` [slots: ${slots.join(", ")}]` : ""}`;
}

/** The model's elements → a DesignTree in design points. Exported for tests. */
export function toDesign(
  reading: { width: number; height: number; elements: Element[]; notes: string[] },
  known: Map<string, CodeComponent>,
  scale: number,
  size?: { width: number; height: number },
): Omit<ScreenshotReading, "usage"> {
  const notes = [...reading.notes];
  const mapping = new Map<string, string>();
  const pt = (v: number) => Math.round((v / scale) * 100) / 100;
  const width = pt(size?.width ?? reading.width);
  const height = pt(size?.height ?? reading.height);
  const base = { visible: true, opacity: 1, effects: [], clips: false, tokens: {} };

  const byId = new Map(reading.elements.map((e) => [e.id, e]));
  const nodes = new Map<string, DesignNode>();
  for (const e of reading.elements) {
    const box = { x: pt(e.x), y: pt(e.y), width: pt(e.width), height: pt(e.height) };
    const fills = hex(e.fill) ? [{ kind: "solid" as const, color: hex(e.fill)!, opacity: 1 }] : [];
    const common = { ...base, id: e.id, name: e.component || e.kind, box, fills };
    if (e.kind === "text") {
      nodes.set(e.id, { ...common, kind: "text", characters: e.text, style: { italic: false, align: "start", verticalAlign: "top", truncate: false, tokens: {} }, runs: [] } satisfies TextNode);
    } else if (e.kind === "component" && known.has(e.component)) {
      const componentId = `screenshot:${e.component}`;
      mapping.set(componentId, e.component);
      const textChild: TextNode[] = e.text ? [{ ...base, id: `${e.id}:text`, name: "text", kind: "text", box, fills: [], characters: e.text, style: { italic: false, align: "start", verticalAlign: "top", truncate: false, tokens: {} }, runs: [] }] : [];
      nodes.set(e.id, {
        ...common,
        kind: "instance",
        component: { id: componentId, name: e.component },
        props: e.props.map((p) => ({ name: p.name, type: "variant" as const, value: p.value })),
        children: textChild,
      } satisfies InstanceNode);
      if (e.confidence < 0.6) notes.push(`${e.id} read as ${e.component} with low confidence (${e.confidence}).`);
    } else {
      if (e.kind === "component") notes.push(`${e.id}: "${e.component}" is not a component of this design system; treated as a container.`);
      nodes.set(e.id, { ...common, kind: "container", figmaType: "FRAME", children: [] } satisfies ContainerNode);
    }
  }
  const root: ContainerNode = { ...base, id: "screenshot", name: "Screenshot", kind: "container", figmaType: "FRAME", box: { x: 0, y: 0, width, height }, fills: [], children: [] };
  for (const e of reading.elements) {
    const node = nodes.get(e.id)!;
    const parent = e.parent && byId.has(e.parent) && e.parent !== e.id ? nodes.get(e.parent)! : root;
    if (parent.kind === "container") parent.children.push(node);
    // Inside a design-system component, other elements are content placed into it, which the code must build.
    else if (parent.kind === "instance") (parent.content ??= []).push(node);
    else root.children.push(node);
  }
  return {
    design: { schemaVersion: DESIGN_MODEL_VERSION, source: { fileKey: "screenshot", fileVersion: "1", nodeId: "screenshot" }, origin: { x: 0, y: 0 }, root },
    mapping,
    notes,
  };
}

function hex(value: string): Color | undefined {
  const m = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (!m) return undefined;
  const n = (i: number) => parseInt(m[1]!.slice(i, i + 2), 16) / 255;
  return { space: "srgb", r: n(0), g: n(2), b: n(4), a: 1 };
}
