// The model that writes code. The core depends on this interface only; providers
// (OpenAI today) and a scripted stand-in for tests implement it.

export interface LlmImage {
  mime: "image/png" | "image/jpeg" | "image/webp";
  base64: string;
}

export interface LlmRequest {
  /** Standing instructions: role, rules, output format. */
  instructions: string;
  /** The user turn: text, plus optional images (screenshots, renders). */
  text: string;
  images?: LlmImage[];
  /** JSON Schema the answer must follow (strict structured output). */
  schema: { name: string; schema: Record<string, unknown> };
  maxOutputTokens?: number;
}

export interface LlmResponse {
  /** The parsed JSON answer. */
  json: unknown;
  model: string;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface Llm {
  readonly name: string;
  complete(request: LlmRequest): Promise<LlmResponse>;
}

export class LlmError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

/**
 * What tokens cost, from the price per million input and output tokens the owner sets
 * (TULPAR_OPENAI_INPUT_PER_M, TULPAR_OPENAI_OUTPUT_PER_M); undefined when no price is set.
 */
/**
 * What a generation cost: each attempt at its own model's prices, the draft model's
 * (TULPAR_OPENAI_DRAFT_INPUT_PER_M / _OUTPUT_PER_M) for drafts. Undefined when a price is missing:
 * no cost is better than a wrong one.
 */
export function generationCost(attempts: { usage?: { inputTokens: number; outputTokens: number }; draft?: boolean }[], env: Record<string, string | undefined> = process.env): number | undefined {
  const draftPrices = { TULPAR_OPENAI_INPUT_PER_M: env.TULPAR_OPENAI_DRAFT_INPUT_PER_M, TULPAR_OPENAI_OUTPUT_PER_M: env.TULPAR_OPENAI_DRAFT_OUTPUT_PER_M };
  let total = 0;
  for (const a of attempts) {
    if (!a.usage) continue;
    const cost = tokenCost(a.usage, a.draft ? draftPrices : env);
    if (cost === undefined) return undefined;
    total += cost;
  }
  return Math.round(total * 10000) / 10000;
}

export function tokenCost(usage: { inputTokens: number; outputTokens: number }, env: Record<string, string | undefined> = process.env): number | undefined {
  const input = Number(env.TULPAR_OPENAI_INPUT_PER_M || 0);
  const output = Number(env.TULPAR_OPENAI_OUTPUT_PER_M || 0);
  if (!input && !output) return undefined;
  return Math.round(((usage.inputTokens / 1e6) * input + (usage.outputTokens / 1e6) * output) * 10000) / 10000;
}
