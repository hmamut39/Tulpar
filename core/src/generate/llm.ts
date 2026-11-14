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
  /**
   * Requests with the same key share a long identical opening (the rules and the brief: every attempt of one
   * generation). Providers that cache prompt prefixes route them together, so repairs are cheaper and faster.
   */
  cacheKey?: string;
}

export interface LlmResponse {
  /** The parsed JSON answer. */
  json: unknown;
  model: string;
  /** cachedInputTokens: the part of the input the provider served from its prompt cache (billed lower). */
  usage?: { inputTokens: number; outputTokens: number; cachedInputTokens?: number };
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
export function generationCost(attempts: { usage?: { inputTokens: number; outputTokens: number; cachedInputTokens?: number }; draft?: boolean }[], env: Record<string, string | undefined> = process.env): number | undefined {
  const draftPrices = { TULPAR_OPENAI_INPUT_PER_M: env.TULPAR_OPENAI_DRAFT_INPUT_PER_M, TULPAR_OPENAI_OUTPUT_PER_M: env.TULPAR_OPENAI_DRAFT_OUTPUT_PER_M, TULPAR_OPENAI_CACHED_INPUT_PER_M: env.TULPAR_OPENAI_DRAFT_CACHED_INPUT_PER_M };
  let total = 0;
  for (const a of attempts) {
    if (!a.usage) continue;
    const cost = tokenCost(a.usage, a.draft ? draftPrices : env);
    if (cost === undefined) return undefined;
    total += cost;
  }
  return Math.round(total * 10000) / 10000;
}

/** Cached input is priced at TULPAR_OPENAI_CACHED_INPUT_PER_M when set, else as ordinary input (never under-counted). */
export function tokenCost(usage: { inputTokens: number; outputTokens: number; cachedInputTokens?: number }, env: Record<string, string | undefined> = process.env): number | undefined {
  const input = Number(env.TULPAR_OPENAI_INPUT_PER_M || 0);
  const output = Number(env.TULPAR_OPENAI_OUTPUT_PER_M || 0);
  if (!input && !output) return undefined;
  const cachedPrice = Number(env.TULPAR_OPENAI_CACHED_INPUT_PER_M || input);
  const cached = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens);
  return Math.round((((usage.inputTokens - cached) / 1e6) * input + (cached / 1e6) * cachedPrice + (usage.outputTokens / 1e6) * output) * 10000) / 10000;
}
