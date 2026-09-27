// The subset of the Figma REST API payload that Tulpar reads.
// Source of truth: https://github.com/figma/rest-api-spec
// Fields are optional wherever Figma omits them for some node types.

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface VariableAlias {
  type: "VARIABLE_ALIAS";
  id: string;
}

export type BoundVariables = Record<string, VariableAlias | VariableAlias[] | Record<string, VariableAlias>>;

export interface ColorStop {
  position: number;
  color: RGBA;
  boundVariables?: { color?: VariableAlias };
}

export interface Paint {
  type:
    | "SOLID"
    | "GRADIENT_LINEAR"
    | "GRADIENT_RADIAL"
    | "GRADIENT_ANGULAR"
    | "GRADIENT_DIAMOND"
    | "IMAGE"
    | "EMOJI"
    | "VIDEO"
    | "PATTERN";
  visible?: boolean;
  opacity?: number;
  blendMode?: string;
  color?: RGBA;
  gradientStops?: ColorStop[];
  gradientHandlePositions?: { x: number; y: number }[];
  imageRef?: string;
  scaleMode?: string;
  boundVariables?: { color?: VariableAlias };
}

export interface Effect {
  type: "DROP_SHADOW" | "INNER_SHADOW" | "LAYER_BLUR" | "BACKGROUND_BLUR" | "TEXTURE" | "NOISE";
  visible: boolean;
  radius: number;
  color?: RGBA;
  offset?: { x: number; y: number };
  spread?: number;
  boundVariables?: Record<string, VariableAlias>;
}

export interface TypeStyle {
  fontFamily?: string;
  fontPostScriptName?: string | null;
  fontStyle?: string;
  fontWeight?: number;
  italic?: boolean;
  fontSize?: number;
  textCase?: string;
  textDecoration?: string;
  textAlignHorizontal?: "LEFT" | "RIGHT" | "CENTER" | "JUSTIFIED";
  textAlignVertical?: "TOP" | "CENTER" | "BOTTOM";
  textAutoResize?: "NONE" | "HEIGHT" | "WIDTH_AND_HEIGHT" | "TRUNCATE";
  textTruncation?: "DISABLED" | "ENDING";
  maxLines?: number;
  letterSpacing?: number;
  lineHeightPx?: number;
  lineHeightPercentFontSize?: number;
  lineHeightUnit?: "PIXELS" | "FONT_SIZE_%" | "INTRINSIC_%";
  paragraphSpacing?: number;
  fills?: Paint[];
  boundVariables?: Record<string, VariableAlias>;
}

export interface ComponentProperty {
  type: "BOOLEAN" | "TEXT" | "INSTANCE_SWAP" | "VARIANT";
  value: boolean | string;
  preferredValues?: { type: "COMPONENT" | "COMPONENT_SET"; key: string }[];
  boundVariables?: Record<string, VariableAlias>;
}

export interface ComponentPropertyDefinition {
  type: "BOOLEAN" | "TEXT" | "INSTANCE_SWAP" | "VARIANT";
  defaultValue: boolean | string;
  variantOptions?: string[];
  preferredValues?: { type: "COMPONENT" | "COMPONENT_SET"; key: string }[];
}

export interface FigmaNode {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  children?: FigmaNode[];

  absoluteBoundingBox?: Rect | null;
  absoluteRenderBounds?: Rect | null;
  rotation?: number;
  opacity?: number;
  blendMode?: string;
  clipsContent?: boolean;

  fills?: Paint[];
  strokes?: Paint[];
  strokeWeight?: number;
  individualStrokeWeights?: { top: number; right: number; bottom: number; left: number };
  strokeAlign?: "INSIDE" | "OUTSIDE" | "CENTER";
  strokeDashes?: number[];
  cornerRadius?: number;
  rectangleCornerRadii?: [number, number, number, number];
  effects?: Effect[];
  styles?: Record<string, string>;
  boundVariables?: BoundVariables;

  // Auto layout (container)
  layoutMode?: "NONE" | "HORIZONTAL" | "VERTICAL" | "GRID";
  layoutWrap?: "NO_WRAP" | "WRAP";
  primaryAxisAlignItems?: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
  counterAxisAlignItems?: "MIN" | "CENTER" | "MAX" | "BASELINE";
  counterAxisAlignContent?: "AUTO" | "SPACE_BETWEEN";
  itemSpacing?: number;
  counterAxisSpacing?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  itemReverseZIndex?: boolean;
  strokesIncludedInLayout?: boolean;

  // Auto layout (child)
  layoutSizingHorizontal?: "FIXED" | "HUG" | "FILL";
  layoutSizingVertical?: "FIXED" | "HUG" | "FILL";
  layoutPositioning?: "AUTO" | "ABSOLUTE";
  layoutAlign?: "INHERIT" | "STRETCH" | "MIN" | "CENTER" | "MAX";
  layoutGrow?: number;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;

  // Text
  characters?: string;
  style?: TypeStyle;
  characterStyleOverrides?: number[];
  styleOverrideTable?: Record<string, TypeStyle>;

  // Components
  componentId?: string;
  componentProperties?: Record<string, ComponentProperty>;
  componentPropertyDefinitions?: Record<string, ComponentPropertyDefinition>;
  componentPropertyReferences?: Record<string, string>;
  overrides?: { id: string; overriddenFields: string[] }[];
  isExposedInstance?: boolean;
}

export interface ComponentMeta {
  key: string;
  name: string;
  description: string;
  componentSetId?: string;
  documentationLinks?: { uri: string }[];
  remote: boolean;
}

export interface ComponentSetMeta {
  key: string;
  name: string;
  description: string;
  documentationLinks?: { uri: string }[];
  remote: boolean;
}

export interface StyleMeta {
  key: string;
  name: string;
  styleType: "FILL" | "TEXT" | "EFFECT" | "GRID";
  description: string;
  remote: boolean;
}

export interface FileResponse {
  name: string;
  version: string;
  lastModified: string;
  document: FigmaNode;
  components: Record<string, ComponentMeta>;
  componentSets: Record<string, ComponentSetMeta>;
  styles: Record<string, StyleMeta>;
}

export interface NodeEntry {
  document: FigmaNode;
  components: Record<string, ComponentMeta>;
  componentSets: Record<string, ComponentSetMeta>;
  styles: Record<string, StyleMeta>;
}

export interface FileNodesResponse {
  name: string;
  version: string;
  lastModified: string;
  nodes: Record<string, NodeEntry | null>;
}
