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
  | "offset"
  /** Width and height, including min and max. */
  | "size";

export const COLOR_PROPERTIES: DesignProperty[] = ["fill", "textColor", "strokeColor"];
export const TYPE_PROPERTIES: DesignProperty[] = ["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing"];
export const SPACING_PROPERTIES: DesignProperty[] = ["gap", "padding", "margin", "radius", "offset", "size"];

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
  /** For tokens, from a render: whether the token is actually defined. False means it is misspelt or invented. */
  defined?: boolean;
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
  /**
   * The extent of what the element draws (its text, and descendants with a background, border,
   * image or form control), through shadow roots. Can be smaller than `box`: a full-width
   * checkbox host draws a 16 px box and a label. Absent when the renderer cannot tell.
   */
  drawnBox?: Box;
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
  /** @font-face rules for the design's typefaces (files inlined): the sandbox cannot download them itself. */
  fontFaces?: string;
  /** The families the design's text uses: a project's required font is only missed if the design asks for it. */
  designFamilies?: string[];
}

/** One interactive element in one state, compared with itself at rest. */
export interface StateFact {
  figmaId: string;
  state: "hover" | "pressed" | "focus";
  /** Share of its pixels (with a margin for rings) that changed, 0–1. */
  changed: number;
  /** How many pixels changed: a focus ring around a small checkbox is few pixels of a wide element. */
  changedPixels?: number;
  /** Whether its box moved or resized: a layout shift. */
  shifted: boolean;
  /** Colours painted in this state that were not painted at rest (CSS colour strings). */
  colors: string[];
}

export type RenderResult =
  | {
      status: "ok";
      /** PNG, base64. */
      png: string;
      elements: RenderedElement[];
      /** Interaction states of the interactive elements, when the renderer can produce them. */
      states?: StateFact[];
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

export interface TestParams extends ProjectParams {
  /** The test file to run, relative to the project root. */
  entry: string;
}

export type TestRunResult =
  | {
      status: "ran";
      runner: string;
      tests: { name: string; status: "passed" | "failed" | "skipped"; error?: string }[];
      /** A file-level failure (e.g. it didn't compile, or declared no tests). */
      fileError?: string;
    }
  | { status: "unsupported" | "failed"; reason: string };
