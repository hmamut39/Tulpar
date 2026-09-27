// Facts an adapter reports about a built and rendered implementation, in design terms.
// Adapters report; the core judges (docs/00-research-and-plan.md §3–4).

import type { Box } from "../model.ts";
import type { ProjectParams } from "../adapter/protocol.ts";

/** A styled property, named in design terms rather than a platform's. */
export type DesignProperty =
  | "fill"
  | "textColor"
  | "strokeColor"
  | "fontFamily"
  | "fontSize"
  | "fontWeight"
  | "lineHeight"
  | "letterSpacing"
  | "gap"
  | "padding"
  | "margin"
  | "radius"
  | "offset";

export const COLOR_PROPERTIES: DesignProperty[] = ["fill", "textColor", "strokeColor"];
export const TYPE_PROPERTIES: DesignProperty[] = ["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing"];
export const SPACING_PROPERTIES: DesignProperty[] = ["gap", "padding", "margin", "radius", "offset"];

/** Where a value in the implementation's own code comes from. */
export interface StyleFact {
  property: DesignProperty;
  /** The value as written, e.g. "var(--cds-layer-01)" or "#0f62fe". */
  written: string;
  /** "token": through a design token. "literal": a hard-coded value. "keyword": inherit, 0, auto, transparent… */
  source: "token" | "literal" | "keyword";
  /** The token's name as the TokenSet names it, when source is "token". */
  token?: string;
  /** Where it was written, e.g. "modal-footer.html:12". */
  at?: string;
}

export interface RenderedElement {
  /** The Figma node id the implementation tagged the element with. */
  figmaId: string;
  /** The component as the ComponentIndex names it (e.g. a tag name), or the platform primitive used. */
  component: string;
  /** False when the element names a component that was never loaded, so it rendered as an unknown element. */
  defined: boolean;
  /** Box relative to the frame's top-left, in design points. */
  box: Box;
  text: string;
  /** Font families actually used to draw the element's text, as the renderer reports them. */
  fonts: string[];
  visible: boolean;
  /** Values the implementation itself sets on this element. Design-system internals are not included. */
  styles: StyleFact[];
}

export interface BuildParams extends ProjectParams {
  /** The implementation to build, relative to the project root. */
  entry: string;
  frame: { width: number; height: number };
}

export interface BuildResult {
  ok: boolean;
  log: string;
  /** An adapter-defined handle to what was built, passed back to `render`. */
  artifact?: string;
}

export interface RenderParams extends ProjectParams {
  artifact: string;
  /** The implementation file, for locations in reports. */
  entry?: string;
  width: number;
  height: number;
  scale: number;
  theme?: string;
}

export type RenderResult =
  | {
      status: "ok";
      /** PNG, base64. */
      png: string;
      elements: RenderedElement[];
      renderer: { name: string; version: string; os: string };
      /** Environment facts that affect trust in the render, e.g. fonts missing. */
      warnings: string[];
    }
  | { status: "unsupported" | "failed"; reason: string };

export interface AnalyzeParams extends ProjectParams {
  entry: string;
}

export interface AnalyzeResult {
  /** Components the code uses, as the ComponentIndex names them. */
  componentsUsed: string[];
  /** Hard-coded values found anywhere in the implementation's own code. */
  literals: StyleFact[];
}
