// A second opinion from a language model on the matcher's closest candidates.
//
// The scored matcher puts the right code component in its top 3 far more often than first
// (held-out, 2026-10-10: top-3 93–100%, top-1 68–70%). Telling "Accordion item" from
// "Accordion", or "AI popover" from "Popover", is reading, which a model does well. So the
// model sees the Figma component and the top candidates side by side, and either picks one
// or says none fits. It never sees labels, and its pick is reported as a proposal, not a fact.

import type { CodeComponent, ComponentIndex } from "../code-model.ts";
import type { Llm } from "../generate/llm.ts";
import type { ComponentDef } from "../model.ts";
import type { Candidate } from "./match.ts";
import type { LabelledDef } from "./evaluate.ts";

export interface RerankResult {
  /** The candidates, the model's pick first; unchanged when it abstains. */
  ranked: Candidate[];
  /** The code component the model picked, or null when none of the candidates fits. */
  choice: string | null;
  confidence: "high" | "medium" | "low";
  reason: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface RerankOptions {
  /** How many top candidates the model chooses between (default 3). */
  top?: number;
}

const INSTRUCTIONS = `You match a Figma design-system component to the code component that implements it.
You get the Figma component (name, page, description, properties) and a short list of code candidates
from the same design system, found by a scoring matcher. Pick the candidate that implements exactly
this Figma component: not its parent, not a part of it, not a sibling. A Figma "X item" is usually the
code "x-item", not "x". If none of the candidates is this component, answer "none".
confidence: "high" only when name and properties agree; "low" when you are guessing.
reason: one short sentence.`;

export async function rerank(def: ComponentDef, ranked: Candidate[], index: ComponentIndex, llm: Llm, options: RerankOptions = {}): Promise<RerankResult> {
  const top = ranked.slice(0, options.top ?? 3);
  const none = { ranked, choice: null, confidence: "low" as const, usage: { inputTokens: 0, outputTokens: 0 } };
  if (!top.length) return { ...none, reason: "no candidates" };
  const byId = new Map(index.components.map((c) => [c.id, c]));
  const names = top.map((c) => c.component);
  const response = await llm.complete({
    instructions: INSTRUCTIONS,
    text: [`Figma component:\n${describeFigma(def)}`, ...top.map((c, i) => `Candidate ${i + 1}: ${c.component}\n${describeCode(byId.get(c.component))}`)].join("\n\n"),
    schema: {
      name: "rerank",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["choice", "confidence", "reason"],
        properties: {
          choice: { type: "string", enum: [...names, "none"] },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          reason: { type: "string" },
        },
      },
    },
    maxOutputTokens: 300,
  });
  const usage = response.usage ?? { inputTokens: 0, outputTokens: 0 };
  const answer = response.json as { choice?: string; confidence?: RerankResult["confidence"]; reason?: string };
  const confidence = answer.confidence ?? "low";
  const reason = answer.reason ?? "";
  const picked = top.find((c) => c.component === answer.choice);
  if (!picked) return { ...none, confidence, reason, usage };
  return { ranked: [picked, ...ranked.filter((c) => c !== picked)], choice: picked.component, confidence, reason, usage };
}

/** What a reader needs to know about the Figma side, briefly. */
export function describeFigma(def: ComponentDef): string {
  const lines = [`name: ${def.name}`, `page: ${def.page}`];
  if (def.description.trim()) lines.push(`description: ${clip(def.description, 300)}`);
  for (const p of def.props.slice(0, 15)) lines.push(`property ${p.name} (${p.type})${p.options?.length ? `: ${clip(p.options.join(" | "), 160)}` : ""}`);
  if (def.variants.length) lines.push(`${def.variants.length} variants`);
  return lines.join("\n");
}

/** What a reader needs to know about a code candidate, briefly. */
export function describeCode(c: CodeComponent | undefined): string {
  if (!c) return "(not in the index)";
  const lines = [`name: ${c.name}${c.markup ? ` (written ${c.markup})` : ""}`];
  if (c.description?.trim()) lines.push(`description: ${clip(c.description, 300)}`);
  if (c.extends?.length) lines.push(`extends: ${c.extends.join(", ")}`);
  for (const p of c.props.filter((p) => !p.internal && !p.deprecated).slice(0, 15)) {
    const values = p.type?.kind === "enum" ? `: ${clip(p.type.values.join(" | "), 160)}` : p.typeText ? `: ${clip(p.typeText, 80)}` : "";
    lines.push(`prop ${p.name}${values}`);
  }
  const slots = c.slots.map((s) => s.name || "(default)");
  if (slots.length) lines.push(`slots: ${slots.join(", ")}`);
  return lines.join("\n");
}

function clip(s: string, n: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
}

export interface RerankEvaluation {
  labelled: number;
  /** The matcher alone, then with the model's second opinion. */
  before: { top1: number };
  after: {
    top1: number;
    /** Picks the model made (not "none"), and how many were right. */
    picked: number;
    pickedCorrect: number;
    /** Picks made with high confidence, and how many were right. */
    high: number;
    highCorrect: number;
    abstained: number;
  };
  usage: { inputTokens: number; outputTokens: number };
  changes: { figma: string; expected: string[]; matcher: string; model: string | null; confidence: string; right: boolean; reason: string }[];
}

/**
 * Re-ranks each labelled component's prior ranking and scores the result. The model never
 * sees the labels; the prompt was written before looking at any of its answers.
 */
export async function evaluateRerank(items: LabelledDef[], rankings: Map<string, Candidate[]>, index: ComponentIndex, llm: Llm, options: RerankOptions & { concurrency?: number } = {}): Promise<RerankEvaluation> {
  const results: { item: LabelledDef; ranking: Candidate[]; r: RerankResult }[] = [];
  const queue = [...items];
  const worker = async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const ranking = rankings.get(item.def.id) ?? [];
      results.push({ item, ranking, r: await rerank(item.def, ranking, index, llm, options) });
    }
  };
  await Promise.all(Array.from({ length: options.concurrency ?? 4 }, worker));

  const e: RerankEvaluation = {
    labelled: items.length,
    before: { top1: 0 },
    after: { top1: 0, picked: 0, pickedCorrect: 0, high: 0, highCorrect: 0, abstained: 0 },
    usage: { inputTokens: 0, outputTokens: 0 },
    changes: [],
  };
  for (const { item, ranking, r } of results) {
    const right = (c: string | null | undefined) => !!c && item.answers.has(c);
    if (right(ranking[0]?.component)) e.before.top1++;
    if (right(r.ranked[0]?.component)) e.after.top1++;
    if (r.choice) {
      e.after.picked++;
      if (right(r.choice)) e.after.pickedCorrect++;
      if (r.confidence === "high") {
        e.after.high++;
        if (right(r.choice)) e.after.highCorrect++;
      }
    } else e.after.abstained++;
    e.usage.inputTokens += r.usage.inputTokens;
    e.usage.outputTokens += r.usage.outputTokens;
    if (r.choice !== ranking[0]?.component || !right(r.choice)) {
      e.changes.push({ figma: `${item.def.name} (${item.def.id})`, expected: [...item.answers], matcher: ranking[0]?.component ?? "", model: r.choice, confidence: r.confidence, right: right(r.choice), reason: r.reason });
    }
  }
  const n = items.length || 1;
  e.before.top1 /= n;
  e.after.top1 /= n;
  return e;
}
