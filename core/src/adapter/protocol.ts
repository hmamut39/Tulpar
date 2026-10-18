// The adapter protocol: JSON-RPC 2.0 over stdio, one JSON message per line.
//
// Adapters are separate executables in any language (Swift, Kotlin, Rust, TS…).
// The core never loads adapter code; it only exchanges these messages.
// See docs/00-research-and-plan.md §4.

import type { ComponentIndex, LinkSet, TokenSet } from "../code-model.ts";
import type { Conventions } from "../generate/brief.ts";
import type { AnalyzeParams, AnalyzeResult, BuildParams, BuildResult, RenderParams, RenderResult, TestParams, TestRunResult } from "../verify/types.ts";

export const PROTOCOL_VERSION = "0.1";

export interface AdapterManifest {
  id: string;
  protocolVersion: string;
  /** Hints for auto-detection, e.g. "package.json:@carbon/web-components". */
  detects: string[];
  capabilities: {
    index: boolean;
    tokens: boolean;
    links: boolean;
    emit: boolean;
    build: boolean;
    render: { supported: boolean; hostOS: ("linux" | "macos" | "windows")[]; reason?: string };
    runtimeStyleProvenance: boolean;
    staticProvenance: boolean;
    /** Can run generated tests in a sandbox. Optional: absent means no. */
    tests?: boolean;
    forceStates: ("hover" | "focus" | "pressed" | "disabled")[];
    themes: boolean;
    /** Formats generated files with the language's own formatter (dart format). Optional: absent means Prettier only. */
    format?: boolean;
    /** The language and styling combinations the adapter writes, its default first. Absent or empty: no choice. */
    outputs?: OutputChoice[];
  };
}

/** Whether an adapter writes this language and styling; unset fields take the default's. */
export function supportsOutput(manifest: AdapterManifest, choice: OutputChoice | undefined): boolean {
  const outputs = manifest.capabilities.outputs ?? [];
  if (!choice || (!choice.language && !choice.styling)) return true;
  if (!outputs.length) return false;
  const language = choice.language ?? outputs[0]!.language;
  const styling = choice.styling ?? outputs.find((o) => o.language === language)?.styling ?? outputs[0]!.styling;
  return outputs.some((o) => o.language === language && o.styling === styling);
}

const LANGUAGE_NAMES = { typescript: "TypeScript", javascript: "JavaScript" } as const;
const STYLING_NAMES = { css: "CSS", "css-modules": "CSS Modules", scss: "SCSS", less: "LESS", tailwind: "Tailwind CSS", "styled-components": "styled-components", emotion: "Emotion" } as const;

/** "TypeScript · CSS Modules". */
export function outputName(o: OutputChoice): string {
  return [o.language && LANGUAGE_NAMES[o.language], o.styling && STYLING_NAMES[o.styling]].filter(Boolean).join(" · ");
}

/** What every request carries: the project root, and the adapter's section of tulpar.json. */
export interface ProjectParams {
  root: string;
  config: Record<string, unknown>;
  /** The language and styling chosen for this generation; the build needs it for Tailwind. */
  output?: OutputChoice;
}

/** The language and styling a team writes in, when the framework allows a choice. */
export interface OutputChoice {
  language?: "typescript" | "javascript";
  styling?: "css" | "css-modules" | "scss" | "less" | "tailwind" | "styled-components" | "emotion";
}

export interface Methods {
  initialize: { params: { protocolVersion: string }; result: AdapterManifest };
  index: { params: ProjectParams; result: ComponentIndex };
  tokens: { params: ProjectParams; result: TokenSet };
  /** Mappings already written in the repository (e.g. Code Connect files). */
  links: { params: ProjectParams; result: LinkSet };
  build: { params: BuildParams; result: BuildResult };
  render: { params: RenderParams; result: RenderResult };
  analyze: { params: AnalyzeParams; result: AnalyzeResult };
  /** Run a test file in a sandbox (never on the host). */
  test: { params: TestParams; result: TestRunResult };
  /** How to write code for this framework: files, entry, rules. */
  conventions: { params: ProjectParams & { output?: OutputChoice }; result: Conventions };
  /** Formats generated files the way the language does (e.g. dart format); files it does not know come back unchanged. */
  format: { params: ProjectParams & { files: { path: string; content: string }[] }; result: { files: { path: string; content: string }[] } };
  shutdown: { params: Record<string, never>; result: null };
}

export type MethodName = keyof Methods;

export interface Request {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

export interface Response {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export const ErrorCodes = {
  ParseError: -32700,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  /** The adapter declared it cannot do this; the core reports "not checked". */
  Unsupported: -32001,
} as const;
