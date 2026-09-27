// Generate, verify, repair: the model writes the files, the verifier checks them, and
// failing checks go back to the model, until nothing fails or attempts run out.
// The result always carries the last verification report, never a bare claim.

import type { VerifyReport } from "../verify/verify.ts";
import { buildBrief, type Brief, type BriefInput } from "./brief.ts";
import type { Llm, LlmImage } from "./llm.ts";
import { NAME_PLACEHOLDERS, fillName } from "./names.ts";

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface Attempt {
  files: GeneratedFile[];
  report?: VerifyReport;
  /** Problems with the answer itself (e.g. an unexpected file), before verification. */
  rejected: string[];
  usage?: { inputTokens: number; outputTokens: number };
}

export interface GenerationResult {
  /** "verified": every check that ran passed and nothing is unchecked. "unchecked-remain": no failures, some checks could not run. "failed": failures remain after the last attempt. */
  status: "verified" | "unchecked-remain" | "failed";
  files: GeneratedFile[];
  report?: VerifyReport;
  attempts: Attempt[];
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

export type GenerationEvent =
  | { type: "brief"; brief: Brief }
  | { type: "generating"; attempt: number }
  | { type: "generated"; attempt: number; files: string[] }
  | { type: "verifying"; attempt: number }
  | { type: "verified"; attempt: number; report: VerifyReport };

export interface GenerateOptions extends BriefInput {
  llm: Llm;
  /** Build, render and verify a set of files; supplied by the caller (it knows the adapter). */
  verify: (files: GeneratedFile[]) => Promise<VerifyReport>;
  maxAttempts?: number;
  /** An image of the design (e.g. a screenshot) for the model to look at. */
  image?: LlmImage;
  onEvent?: (e: GenerationEvent) => void;
}

const FILES_SCHEMA = {
  name: "generated_component",
  schema: {
    type: "object",
    properties: {
      files: {
        type: "array",
        items: {
          type: "object",
          properties: { path: { type: "string" }, content: { type: "string" } },
          required: ["path", "content"],
          additionalProperties: false,
        },
      },
      notes: { type: "string" },
    },
    required: ["files", "notes"],
    additionalProperties: false,
  },
};

export async function generate(options: GenerateOptions): Promise<GenerationResult> {
  const brief = buildBrief(options);
  options.onEvent?.({ type: "brief", brief });
  const expected = brief.conventions.files.map((f) => f.path.replace(NAME_PLACEHOLDERS, (p) => fillName(p, brief.name)));
  const maxAttempts = options.maxAttempts ?? 3;
  const attempts: Attempt[] = [];
  const usage = { inputTokens: 0, outputTokens: 0 };
  let model = options.llm.name;

  for (let n = 1; n <= maxAttempts; n++) {
    options.onEvent?.({ type: "generating", attempt: n });
    const previous = attempts.at(-1);
    const response = await options.llm.complete({
      instructions: instructions(brief),
      text: previous ? repairText(brief, previous) : briefText(brief),
      ...(options.image && { images: [options.image] }),
      schema: FILES_SCHEMA,
      maxOutputTokens: 16000,
    });
    model = response.model;
    if (response.usage) {
      usage.inputTokens += response.usage.inputTokens;
      usage.outputTokens += response.usage.outputTokens;
    }
    const answer = response.json as { files: GeneratedFile[]; notes: string };
    const rejected: string[] = [];
    const files: GeneratedFile[] = [];
    for (const f of answer.files ?? []) {
      const path = f.path.replace(/\\/g, "/").replace(/^\.\//, "");
      if (!expected.includes(path)) rejected.push(`Unexpected file "${f.path}"; only ${expected.join(", ")} may be written.`);
      else files.push({ path, content: f.content });
    }
    for (const e of expected) if (!files.some((f) => f.path === e)) rejected.push(`Missing file "${e}".`);
    options.onEvent?.({ type: "generated", attempt: n, files: files.map((f) => f.path) });

    const attempt: Attempt = { files, rejected, ...(response.usage && { usage: response.usage }) };
    attempts.push(attempt);
    if (!files.some((f) => f.path === brief.conventions.entry.replace(NAME_PLACEHOLDERS, (p) => fillName(p, brief.name)))) continue;

    options.onEvent?.({ type: "verifying", attempt: n });
    attempt.report = await options.verify(files);
    options.onEvent?.({ type: "verified", attempt: n, report: attempt.report });
    if (!attempt.rejected.length && !attempt.report.checks.some((c) => c.status === "fail")) break;
  }

  const last = [...attempts].reverse().find((a) => a.report) ?? attempts.at(-1)!;
  const failing = !last.report || last.rejected.length > 0 || last.report.checks.some((c) => c.status === "fail");
  return {
    status: failing ? "failed" : last.report!.verdict === "pass" ? "verified" : "unchecked-remain",
    files: last.files,
    ...(last.report && { report: last.report }),
    attempts,
    model,
    usage,
  };
}

function instructions(b: Brief): string {
  const c = b.conventions;
  return [
    `You write production ${c.framework} code (${c.language}) for a team that has its own design system.`,
    `Your code is built, rendered and checked automatically against the Figma design; unverifiable claims are worthless.`,
    `Rules:`,
    `- Every Figma instance mapped to a design-system component MUST be that component, imported as in: ${c.importExample}`,
    `- Never re-create a design-system component with plain elements, and never copy its CSS class names.`,
    `- Set component props exactly as the mapping gives them. Do not invent props for Figma properties listed as unmapped.`,
    `- Use only tokens listed in this brief. A token name that is not listed does not exist; inventing one is a failure the verifier catches.`,
    `- Colours, typography and spacing come only from design tokens, written as their code reference (e.g. var(--prefix-token, fallback)). No hex, rgb or px literals except 0, and no arithmetic on tokens (calc(var(--x) * 4) is a hard-coded value in disguise).`,
    `- Do not set the component's own width or height from the frame's size: it fills its container, and the host decides the size. Size inner parts with layout (flex, grid, percentages, auto), not fixed numbers.`,
    `- Put data-figma-id="<id>" on the root element and on every element that renders a Figma instance or a text layer, using the ids in the outline.`,
    `- Text must match the design character for character.`,
    `- Write exactly these files and no others: ${c.files.map((f) => f.path.replace(NAME_PLACEHOLDERS, (p) => fillName(p, b.name))).join(", ")}.`,
    ...c.rules.map((r) => `- ${r.replace(NAME_PLACEHOLDERS, (p) => fillName(p, b.name))}`),
    `Answer with JSON: { "files": [{ "path", "content" }], "notes" }.`,
  ].join("\n");
}

function briefText(b: Brief): string {
  const c = b.conventions;
  return [
    `Component name: ${b.name}`,
    ``,
    `FILES TO WRITE`,
    ...c.files.map((f) => `- ${f.path.replace(NAME_PLACEHOLDERS, (p) => fillName(p, b.name))} (${f.role}): ${f.description.replace(NAME_PLACEHOLDERS, (p) => fillName(p, b.name))}`),
    ``,
    `DESIGN OUTLINE (boxes are x,y width×height in points, relative to the root)`,
    b.outline,
    ``,
    `INSTANCES AND THEIR CODE`,
    ...b.instances.map((i) => `- ${i.figmaId} "${i.figmaName}" → ${i.component ?? "no mapped component: compose it from primitives and tokens"}${Object.keys(i.props).length ? ` props ${JSON.stringify(i.props)}` : ""}${i.text ? ` text ${JSON.stringify(i.text)}` : ""}${i.unmapped.length ? ` (unmapped: ${i.unmapped.join(", ")})` : ""}`),
    ``,
    `DESIGN-SYSTEM COMPONENTS (their real API)`,
    b.components || "(none mapped)",
    ``,
    `TOKENS FOR THE DESIGN'S COLOURS (Figma variable → candidate tokens, best first)`,
    ...(b.tokens.length ? b.tokens.map((t) => `- ${t.variable} (used ${t.uses}×): ${t.tokens.slice(0, 4).map((x) => x.codeRef ?? x.name).join(", ") || "no token has this value: report it in notes"}`) : ["(none)"]),
    ``,
    `SPACING AND SIZE TOKENS (the only ones that exist; value in points)`,
    ...(b.dimensions.length ? b.dimensions.map((d) => `- ${d.codeRef ?? d.name} = ${d.points}`) : ["(none)"]),
  ].join("\n");
}

function repairText(b: Brief, previous: Attempt): string {
  const failures = [
    ...previous.rejected,
    ...(previous.report?.checks.filter((c) => c.status === "fail").flatMap((c) => [`${c.title}: ${c.summary}`, ...c.details.filter((d) => d.startsWith("✗")).map((d) => `  ${d}`)]) ?? []),
  ];
  return [
    briefText(b),
    ``,
    `YOUR PREVIOUS ATTEMPT FAILED THESE CHECKS — fix every one, change nothing else:`,
    ...failures.map((f) => `- ${f}`),
    ``,
    `YOUR PREVIOUS FILES`,
    ...previous.files.map((f) => `--- ${f.path}\n${f.content}`),
  ].join("\n");
}
