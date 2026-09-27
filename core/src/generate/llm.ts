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
