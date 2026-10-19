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
  /** The model that wrote it, and whether it was the cheaper draft model (model routing). */
  model?: string;
  draft?: boolean;
}

export interface GenerationResult {
  /** "verified": every check that ran passed and nothing is unchecked. "unchecked-remain": no failures, some checks could not run. "failed": failures remain after the last attempt. */
  status: "verified" | "unchecked-remain" | "failed";
  files: GeneratedFile[];
  report?: VerifyReport;
  attempts: Attempt[];
  model: string;
  usage: { inputTokens: number; outputTokens: number };
  /** After a change: the design comparisons that fail, where the result now differs from the design (as asked). */
  departures?: string[];
}

/** Checks that compare the result with the design, rather than the code with the design system. */
export const DESIGN_MATCH = new Set(["layout", "visual", "text", "typeface"]);

export type GenerationEvent =
  | { type: "brief"; brief: Brief }
  | { type: "generating"; attempt: number; /** false for a first draft */ repair: boolean }
  | { type: "generated"; attempt: number; files: string[] }
  | { type: "verifying"; attempt: number }
  | { type: "verified"; attempt: number; report: VerifyReport }
  /** A whole page: which section (or, last, the page itself) is being generated. */
  | { type: "section"; name: string; index: number; total: number; page?: boolean };

export interface GenerateOptions extends BriefInput {
  llm: Llm;
  /** A cheaper model for the first drafts (model routing); repairs use `llm`. */
  draftLlm?: Llm;
  /** Build, render and verify a set of files; supplied by the caller (it knows the adapter). */
  verify: (files: GeneratedFile[]) => Promise<VerifyReport>;
  /** Formats accepted files the way the project does, before they are verified and delivered. */
  format?: (files: GeneratedFile[]) => Promise<GeneratedFile[]>;
  maxAttempts?: number;
  /** Independent first drafts, each verified; repairs (maxAttempts - 1 of them) start from the best. Default 1. */
  candidates?: number;
  /** An image of the design (e.g. a screenshot) for the model to look at. */
  image?: LlmImage;
  /**
   * A change the team asked for on delivered files ("make the button full width"). The first attempt
   * applies it to those files; repairs fix what the change broke. The request outranks the design, so
   * checks that compare with the design (layout, pixels, text, typeface) neither trigger repairs nor fail
   * the result: they are reported, and listed in `departures` when they fail.
   */
  change?: { files: GeneratedFile[]; request: string };
  /** The render a verification produced, so a repair after visual failures can look at what it drew. */
  renderOf?: (report: VerifyReport) => LlmImage | undefined;
  onEvent?: (e: GenerationEvent) => void;
}

/** Failures a picture of the render helps fix: what it looks like, not what the code says. */
const VISUAL = new Set(["layout", "visual", "text", "typeface", "states"]);

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

  const change = options.change;
  // A failure that counts: after a change, differences from the design are what was asked for.
  const counts = (c: VerifyReport["checks"][number]) => c.status === "fail" && !(change && DESIGN_MATCH.has(c.id));
  const candidates = change ? 1 : Math.max(1, Math.floor(options.candidates ?? 1));
  // The first `candidates` attempts are independent drafts (or, for a change, the change); the rest repair.
  for (let n = 1; n <= candidates + maxAttempts - 1; n++) {
    options.onEvent?.({ type: "generating", attempt: n, repair: n > candidates });
    // Repair from the best attempt so far, not the latest: a repair that made things worse is set aside, as a developer would.
    const previous = n > candidates ? bestAttempt(attempts, counts) : undefined;
    // After visual failures, the model looks at its own render next to the design, as a developer would.
    const looked = previous?.report && previous.report.checks.some((c) => counts(c) && VISUAL.has(c.id)) ? options.renderOf?.(previous.report) : undefined;
    const images = [...(options.image ? [options.image] : []), ...(looked ? [looked] : [])];
    const drafting = n <= candidates && !!options.draftLlm && !change;
    const response = await (drafting ? options.draftLlm! : options.llm).complete({
      instructions: instructions(brief),
      text: previous
        ? repairText(brief, previous, looked ? (options.image ? "The second image is your previous attempt as it rendered; the first is the design. Compare them." : "The image is your previous attempt as it rendered.") : undefined, counts, change?.request)
        : change
          ? changeText(brief, change)
          : briefText(brief),
      ...(images.length && { images }),
      schema: FILES_SCHEMA,
      maxOutputTokens: 16000,
    });
    if (!drafting) model = response.model;
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
    if (options.format && files.length) files.splice(0, files.length, ...(await options.format(files)));
    options.onEvent?.({ type: "generated", attempt: n, files: files.map((f) => f.path) });

    const attempt: Attempt = { files, rejected, ...(response.usage && { usage: response.usage }), model: response.model, ...(drafting && { draft: true }) };
    attempts.push(attempt);
    if (!files.some((f) => f.path === brief.conventions.entry.replace(NAME_PLACEHOLDERS, (p) => fillName(p, brief.name)))) continue;

    options.onEvent?.({ type: "verifying", attempt: n });
    attempt.report = await options.verify(files);
    options.onEvent?.({ type: "verified", attempt: n, report: attempt.report });
    if (!attempt.rejected.length && !attempt.report.checks.some(counts)) break;
  }

  const last = bestAttempt(attempts, counts);
  const failing = !last.report || last.rejected.length > 0 || last.report.checks.some(counts);
  const departures = change ? (last.report?.checks ?? []).filter((c) => c.status === "fail" && DESIGN_MATCH.has(c.id)).map((c) => c.id) : [];
  return {
    status: failing ? "failed" : last.report!.verdict === "pass" || departures.length ? "verified" : "unchecked-remain",
    ...(departures.length && { departures }),
    files: last.files,
    ...(last.report && { report: last.report }),
    attempts,
    // The model that wrote what is delivered (a draft that passed came from the draft model).
    model: last.model ?? model,
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
    `- Each TEXT in the outline gives its size/line-height and weight (e.g. 20/28 w400): set all three, through the design system's type styles or tokens for that size (its heading or body styles), so a 20/28 title is 28 tall. The layout check measures each text's box, so a missing line-height fails it.`,
    `- Colours, typography and spacing come only from design tokens, written as their code reference (e.g. var(--prefix-token, fallback)). No hex, rgb or px literals except 0, and no arithmetic on tokens (calc(var(--x) * 4) is a hard-coded value in disguise). The one exception is a scale-unit token, made to be multiplied (a name ending in -spacing or -unit with no step, e.g. --mui-spacing): whole multiples like calc(var(--mui-spacing) * 3) are how that design system spaces things.`,
    `- Do not set the component's own width or height from the frame's size: it fills its container, and the host decides the size. Size inner parts with layout (flex, grid, percentages, auto), not fixed numbers.`,
    `- Lay out with natural flow and spacing tokens (gap, padding), the way a developer would. Never copy the design's measurements into ratios (grid tracks like 25fr 310fr 25fr, odd percentages): that is a hard-coded layout in disguise, and the verifier reports it as one.`,
    `- Put data-figma-id="<id>" on the root element and on every element that renders a Figma instance or a text layer, using the ids in the outline.`,
    `- Text must match the design character for character.`,
    `- Express what the design shows with the component's own API: a label as its label, a placeholder as its placeholder, a value as its value. Never imitate one with another (e.g. placeholder text in a slot, hidden with script) to get past a check; a reviewer rejects that even when every check passes.`,
    `- Pick tokens by meaning as well as value: a spacing token for spacing, a font-size token for font size, a text colour token for text, a background or layer token for fills, a border token for borders (a border colour on text is wrong even when the value matches). When no token of the right kind has the value, use the nearest token of the right kind.`,
    `- Write code a senior developer would merge as it is: no unused imports, variables or dead code; accessible markup (every field has a label tied to it, buttons have a type, images have alt text); names that say what things are; comments only where the code cannot say it.`,
    ...(c.files.some((f) => f.role === "test")
      ? [
          `- The tests are kept and run by the team, so they test what a person sees and does: find things by role, label and visible text (the heading, a field by its label, a button by its name), check each design-system component is there (by its data-figma-id), type and click as a user would, and assert what changes on screen. Never assert a design-system component's internal markup, class names or default attribute values (a checkbox's value, an inner wrapper): they change between library versions and the test then fails for no reason.`,
        ]
      : []),
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
    ...(b.built.length
      ? [``, `SECTIONS ALREADY BUILT (each is its own verified component next to this file: import each and place it where the outline shows it; lay out only what is between them; do not copy or rewrite them, and do not write their files. The page sets no font, line-height, colour or typography on its container: sections inherit it, and would no longer render as they were verified)`, ...b.built.map((s) => `- ${s.figmaId} → ${s.name}, imported from '${s.importPath}'`)]
      : []),
    ``,
    `INSTANCES AND THEIR CODE`,
    ...b.instances.map((i) => `- ${i.figmaId} "${i.figmaName}" → ${i.component ?? "no mapped component: compose it from primitives and tokens"}${Object.keys(i.props).length ? ` props ${JSON.stringify(i.props)}` : ""}${i.text ? ` text ${JSON.stringify(i.text)}` : ""}${i.unmapped.length ? ` (unmapped: ${i.unmapped.join(", ")})` : ""}`),
    ``,
    `DESIGN-SYSTEM COMPONENTS (their real API)`,
    b.components || "(none mapped)",
    ...(b.examples.length
      ? [``, `HOW THIS CODEBASE ALREADY USES THEM (follow its conventions: the props it sets, how it lays them out; the design still decides what to build)`, ...b.examples.map((e) => `- ${e.component}, in ${e.file}:
    ${e.code}`)]
      : []),
    ``,
    ...(b.type.length
      ? [`TYPE STYLES (each text size in the outline → the design system's type tokens that draw it; set every property listed, rather than a class named after the style)`, ...b.type.map((t) => `- ${t.text} → ${t.style}: ${Object.entries(t.refs).map(([k, v]) => `${k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}: ${v}`).join("; ")}`), ``]
      : []),
    `TOKENS FOR THE DESIGN'S COLOURS (Figma variable → candidate tokens, best first)`,
    ...(b.tokens.length ? b.tokens.map((t) => `- ${t.variable} (used ${t.uses}×): ${t.tokens.slice(0, 4).map((x) => x.codeRef ?? x.name).join(", ") || "no token has this value: report it in notes"}`) : ["(none)"]),
    ``,
    `ACCENT COLOUR (the design's main action colour, e.g. its primary button)`,
    ...(b.accent
      ? [
          `- The design's accent is ${b.accent.color}. The design system's nearest accent palettes: ${b.accent.options.map((o) => `${o.family} (${o.codeRef ?? o.token} = ${o.hex})`).join(", ")}.`,
          `- Set the accent the design system's own way, to the nearest palette: a theme or provider setting (e.g. an accent colour on the theme), or the component's colour, palette or severity prop. If the nearest is a shade those props don't offer (e.g. a darker step of primary), set it through the component's own theming CSS variables (listed with its API), on that component only (e.g. --el-button-bg-color: var(--el-color-primary-dark-2, #337ecc) and its border and hover counterparts): that is the design system's theming API. Never override the component's real CSS properties (background, color, border) directly.`,
          `- If the design system names colours by role instead of palette, pick the role whose colour is nearest: info is usually blue or sky, success green, warn or warning amber or orange, help purple, danger or error red; "primary" is the theme's default, which may not be the design's colour.`,
        ]
      : ["(none found)"]),
    ``,
    `SPACING AND SIZE TOKENS (the only ones that exist; value in points)`,
    ...(b.dimensions.length ? b.dimensions.map((d) => `- ${d.codeRef ?? d.name} = ${d.points}`) : ["(none)"]),
  ].join("\n");
}

/** A change to delivered files: the brief, the files, and what the team asked for. */
function changeText(b: Brief, change: { files: GeneratedFile[]; request: string }): string {
  return [
    briefText(b),
    ``,
    `THE TEAM'S FILES (written from this design and verified; they may have edited them since)`,
    ...change.files.map((f) => `--- ${f.path}\n${f.content}`),
    ``,
    `THE CHANGE THEY ASK FOR — make it, and change nothing else. It outranks the design where the two differ; every rule above still holds (design-system components, tokens, data-figma-id, the tests kept in step with the code):`,
    change.request,
  ].join("\n");
}

function repairText(b: Brief, previous: Attempt, picture?: string, counts: (c: VerifyReport["checks"][number]) => boolean = (c) => c.status === "fail", request?: string): string {
  const failures = [
    ...previous.rejected,
    ...(previous.report?.checks.filter(counts).flatMap((c) => [`${c.title}: ${c.summary}`, ...c.details.filter((d) => d.startsWith("✗")).map((d) => `  ${d}`)]) ?? []),
  ];
  return [
    briefText(b),
    ``,
    ...(request ? [`THE TEAM ASKED FOR THIS CHANGE, which your previous files make; keep it, it outranks the design:`, request, ``] : []),
    `YOUR PREVIOUS ATTEMPT FAILED THESE CHECKS — fix every one, change nothing else:`,
    ...failures.map((f) => `- ${f}`),
    ...(picture ? [``, picture] : []),
    ``,
    `YOUR PREVIOUS FILES`,
    ...previous.files.map((f) => `--- ${f.path}\n${f.content}`),
  ].join("\n");
}

/**
 * The attempt to deliver, not always the last: a repair can make things worse. Fewest failing checks
 * wins; on a tie, the later attempt (it saw more feedback). One that didn't build or render ranks below
 * any that did: its other checks were skipped, not passed.
 */
export function bestAttempt<A extends Pick<Attempt, "rejected" | "report">>(attempts: A[], counts: (c: VerifyReport["checks"][number]) => boolean = (c) => c.status === "fail"): A {
  const failures = (a: A) =>
    a.report ? a.rejected.length + a.report.checks.filter(counts).length + (a.report.checks.some((c) => c.status === "fail" && (c.id === "build" || c.id === "render")) ? 1000 : 0) : Infinity;
  return attempts.reduce<A | undefined>((best, a) => (!best || failures(a) <= failures(best) ? a : best), undefined) ?? attempts.at(-1)!;
}
