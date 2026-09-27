// The adapter protocol: JSON-RPC 2.0 over stdio, one JSON message per line.
//
// Adapters are separate executables in any language (Swift, Kotlin, Rust, TS…).
// The core never loads adapter code; it only exchanges these messages.
// See docs/00-research-and-plan.md §4.

import type { ComponentIndex, TokenSet } from "../code-model.ts";

export const PROTOCOL_VERSION = "0.1";

export interface AdapterManifest {
  id: string;
  protocolVersion: string;
  /** Hints for auto-detection, e.g. "package.json:@carbon/web-components". */
  detects: string[];
  capabilities: {
    index: boolean;
    tokens: boolean;
    emit: boolean;
    build: boolean;
    render: { supported: boolean; hostOS: ("linux" | "macos" | "windows")[]; reason?: string };
    runtimeStyleProvenance: boolean;
    staticProvenance: boolean;
    forceStates: ("hover" | "focus" | "pressed" | "disabled")[];
    themes: boolean;
  };
}

/** What every request carries: the project root, and the adapter's section of tulpar.json. */
export interface ProjectParams {
  root: string;
  config: Record<string, unknown>;
}

export interface Methods {
  initialize: { params: { protocolVersion: string }; result: AdapterManifest };
  index: { params: ProjectParams; result: ComponentIndex };
  tokens: { params: ProjectParams; result: TokenSet };
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
