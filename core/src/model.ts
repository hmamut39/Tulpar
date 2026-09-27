// Tulpar's design model: what a design says, in design terms.
//
// Rules (docs/00-research-and-plan.md §4):
// - No platform concepts: no CSS, DOM, className, ReactNode or `children` props.
// - Units are design points at 1×. Colours carry their colour space.
// - Every node keeps its Figma node id, so a render can be tied back to it.
// - Anything the model cannot express is recorded in `unsupported`, never dropped silently.

export const DESIGN_MODEL_VERSION = "0.1";

/** A rectangle in design points, relative to the root of the DesignTree. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Color {
  /** Figma's REST API does not report a file's colour profile; sRGB is assumed. */
  space: "srgb";
  r: number;
  g: number;
  b: number;
  a: number;
}

/** A reference to a design token: a Figma variable or a Figma style. */
export type TokenRef =
  | { source: "variable"; id: string }
  | { source: "style"; id: string; name?: string };

export type Paint =
  | { kind: "solid"; color: Color; opacity: number; token?: TokenRef }
  | {
      kind: "gradient";
      shape: "linear" | "radial" | "angular" | "diamond";
      stops: { position: number; color: Color; token?: TokenRef }[];
      handles: { x: number; y: number }[];
      opacity: number;
    }
  | { kind: "image"; ref: string; scaleMode: string; opacity: number }
  /** A paint type the model does not describe yet (video, pattern, emoji). */
  | { kind: "other"; figmaType: string };

export interface Stroke {
  paints: Paint[];
  weight: number | { top: number; right: number; bottom: number; left: number };
  align: "inside" | "outside" | "center";
  dashes?: number[];
}

export type CornerRadius = number | { topLeft: number; topRight: number; bottomRight: number; bottomLeft: number };

export type Effect =
  | {
      kind: "drop-shadow" | "inner-shadow";
      color: Color;
      offset: { x: number; y: number };
      radius: number;
      spread: number;
    }
  | { kind: "layer-blur" | "background-blur"; radius: number }
  | { kind: "other"; figmaType: string };

/** Auto layout: children flow along one axis. */
export interface Stack {
  axis: "horizontal" | "vertical";
  gap: number;
  /** Space between wrapped rows or columns; present only when `wrap` is true. */
  crossGap?: number;
  padding: { top: number; right: number; bottom: number; left: number };
  mainAlign: "start" | "center" | "end" | "space-between";
  crossAlign: "start" | "center" | "end" | "baseline";
  wrap: boolean;
  /** Later children are drawn below earlier ones. */
  reverseZ: boolean;
}

export type Sizing = "fixed" | "hug" | "fill";

/** How a node sits inside its parent's Stack. */
export interface StackChild {
  horizontal?: Sizing;
  vertical?: Sizing;
  /** Taken out of the flow and positioned by its box. */
  absolute: boolean;
  min?: { width?: number; height?: number };
  max?: { width?: number; height?: number };
}

export interface TextStyle {
  fontFamily?: string;
  fontWeight?: number;
  italic: boolean;
  fontSize?: number;
  /** Line height in design points, as Figma computed it. */
  lineHeight?: number;
  letterSpacing?: number;
  align: "start" | "center" | "end" | "justified";
  verticalAlign: "top" | "center" | "bottom";
  case?: "upper" | "lower" | "title" | "small-caps" | "small-caps-forced";
  decoration?: "underline" | "strikethrough";
  resize?: "none" | "height" | "width-and-height" | "truncate";
  maxLines?: number;
  truncate: boolean;
  tokens: Record<string, TokenRef>;
}

export interface TextRun {
  start: number;
  end: number;
  style: Partial<TextStyle>;
  fills?: Paint[];
}

/** An instance property value, with the `#id` suffix stripped from its name. */
export interface InstanceProp {
  name: string;
  type: "variant" | "boolean" | "text" | "instance-swap";
  value: string | boolean;
}

interface NodeBase {
  /** Figma node id, unchanged (instance sublayers keep their `I…;…` form). */
  id: string;
  name: string;
  /** Null when Figma reports no bounds, e.g. for some hidden layers. */
  box: Box | null;
  /** Bounds including strokes and effects such as shadows. */
  renderBox?: Box | null;
  visible: boolean;
  opacity: number;
  rotation?: number;
  fills: Paint[];
  stroke?: Stroke;
  radius?: CornerRadius;
  effects: Effect[];
  clips: boolean;
  /** Present when the parent is a Stack. */
  inStack?: StackChild;
  /** Token references for numeric and effect properties, keyed by model path (e.g. "stack.gap"). */
  tokens: Record<string, TokenRef>;
  /** Figma node properties the model does not express, by name. */
  unsupported?: string[];
}

export interface ContainerNode extends NodeBase {
  kind: "container";
  /** What the node was in Figma (FRAME, GROUP, SECTION, COMPONENT, COMPONENT_SET). */
  figmaType: string;
  stack?: Stack;
  children: DesignNode[];
}

export interface InstanceNode extends NodeBase {
  kind: "instance";
  component: {
    id: string;
    key?: string;
    name?: string;
    set?: { id: string; key?: string; name?: string };
  };
  props: InstanceProp[];
  stack?: Stack;
  /** The instance's own layers, as the design draws them. */
  children: DesignNode[];
  /**
   * Content the design places into the component, as opposed to its own drawing:
   * e.g. buttons inside a button set. Checked like any other layer.
   */
  content?: DesignNode[];
}

export interface TextNode extends NodeBase {
  kind: "text";
  characters: string;
  style: TextStyle;
  runs: TextRun[];
}

export interface ShapeNode extends NodeBase {
  kind: "shape";
  /** RECTANGLE, ELLIPSE, VECTOR, LINE, STAR, REGULAR_POLYGON, BOOLEAN_OPERATION. */
  figmaType: string;
  children: DesignNode[];
}

export type DesignNode = ContainerNode | InstanceNode | TextNode | ShapeNode;

/** A normalised Figma subtree whose boxes are relative to `root`. */
export interface DesignTree {
  schemaVersion: typeof DESIGN_MODEL_VERSION;
  source: { fileKey: string; fileVersion: string; nodeId: string };
  /** The root's absolute position in the Figma canvas. */
  origin: { x: number; y: number };
  root: DesignNode;
}

// ---------------------------------------------------------------------------
// Library: the component definitions a Figma file publishes.

export interface PropDef {
  /** Name with Figma's `#id` suffix stripped. */
  name: string;
  /** Name as Figma stores it, e.g. "Label text#1234:0". */
  figmaName: string;
  type: "variant" | "boolean" | "text" | "instance-swap";
  default: string | boolean;
  options?: string[];
  preferred?: { type: "component" | "component-set"; key: string }[];
}

export interface VariantDef {
  id: string;
  key?: string;
  name: string;
  values: Record<string, string>;
}

export interface ComponentDef {
  kind: "component-set" | "component";
  id: string;
  key?: string;
  name: string;
  description: string;
  links: string[];
  /** The Figma page it lives on. */
  page: string;
  /** Leading "_" or "." marks a building block not meant for direct use. */
  private: boolean;
  props: PropDef[];
  /** Only for component sets. */
  variants: VariantDef[];
  /** Size of the default variant (or the component). */
  size: { width: number; height: number } | null;
}

export interface Library {
  schemaVersion: typeof DESIGN_MODEL_VERSION;
  source: { fileKey: string; fileVersion: string; fileName: string };
  components: ComponentDef[];
  styles: { id: string; key: string; name: string; type: "fill" | "text" | "effect" | "grid"; description: string }[];
}
