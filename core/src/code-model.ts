// What a repository says: its components and its tokens, as adapters report them.
//
// Adapters return facts; the core makes every judgement. Every fact carries its
// provenance (where it was read, and how sure the reader is), so later stages can
// weigh a manifest entry differently from a heuristic guess.

import type { Color } from "./model.ts";

export type Confidence = "high" | "medium" | "low";

export interface Provenance {
  /** The reader that produced the fact, e.g. "wca-manifest", "ts-declarations", "template-scan". */
  source: string;
  confidence: Confidence;
  note?: string;
}

/** A property's type, resolved as far as the reader could. */
export type TypeShape =
  | { kind: "boolean" }
  | { kind: "string" }
  | { kind: "number" }
  /** A fixed set of values. `open` means any other value of the base type is also accepted. */
  | { kind: "enum"; values: (string | number)[]; open: boolean }
  | { kind: "other"; text: string };

export interface CodeProp {
  /** The name as code uses it (e.g. a property or parameter name). */
  name: string;
  /** Other names that set the same prop, e.g. a markup attribute. */
  aliases: string[];
  typeText?: string;
  type?: TypeShape;
  defaultText?: string;
  required: boolean;
  description?: string;
  deprecated?: boolean;
  /**
   * Set when the prop is runtime API rather than something a design would set
   * (e.g. a read-only form handle). Kept, never deleted, with the reason.
   */
  internal?: string;
  provenance: Record<string, Provenance>;
}

export interface CodeSlot {
  /** "" for the default slot. */
  name: string;
  description?: string;
  provenance: Provenance;
}

export interface CodeEvent {
  name: string;
  description?: string;
  provenance: Provenance;
}

export interface CodeComponent {
  /** Stable identity: module + export. */
  id: string;
  /** The name people write, e.g. a tag name or an export name. */
  name: string;
  exportName?: string;
  /** Where code imports it from. */
  module: string;
  sourcePath?: string;
  description?: string;
  deprecated?: string | true;
  props: CodeProp[];
  slots: CodeSlot[];
  events: CodeEvent[];
  provenance: Provenance;
}

export interface ComponentIndex {
  adapter: string;
  package?: { name: string; version: string };
  components: CodeComponent[];
  /** Things the adapter could not read, stated plainly. */
  gaps: string[];
}

export type TokenValue =
  | { kind: "color"; color: Color }
  /** A length in design points (1 pt = 1 px at 1×). */
  | { kind: "dimension"; points: number }
  | { kind: "number"; value: number }
  /** A value that cannot be resolved to a fixed number, e.g. "5vw". Kept as written. */
  | { kind: "unresolved"; text: string; reason: string };

export interface DesignToken {
  /** The token's flat name, e.g. "border-subtle-02". */
  name: string;
  /** DTCG path segments. */
  path: string[];
  type: string;
  description?: string;
  /** Resolved value per mode (theme). Tokens without modes use "default". */
  values: Record<string, TokenValue>;
  /** How code refers to the token. Opaque to the core, e.g. "var(--cds-background)". */
  codeRef?: string;
  /** Whether `codeRef` was found in the project's code. Absent when not checked. */
  codeRefConfirmed?: boolean;
  deprecated?: boolean;
  provenance: Provenance;
}

export interface TokenSet {
  adapter: string;
  modes: string[];
  tokens: DesignToken[];
  gaps: string[];
}

/** A mapping someone wrote down: a Figma node ↔ a code component (e.g. a Code Connect file). */
export interface ExplicitLink {
  figma: { fileKey?: string; nodeId: string };
  /** The code component's `name` as in the ComponentIndex. */
  component: string;
  /** Figma variant values this link is restricted to, if any. */
  variant?: Record<string, string>;
  /** Where the link was written, e.g. a file path. */
  source: string;
  provenance: Provenance;
}

export interface LinkSet {
  adapter: string;
  links: ExplicitLink[];
  gaps: string[];
}
