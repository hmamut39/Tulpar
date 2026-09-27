// OpenAI provider, over the Responses API with strict structured output.
// https://developers.openai.com/api/reference/resources/responses/methods/create
// https://developers.openai.com/api/docs/guides/structured-outputs

import { LlmError, type Llm, type LlmRequest, type LlmResponse } from "./llm.ts";

/** OpenAI's current recommendation for new projects (structured-outputs guide, 2026-09). */
export const DEFAULT_OPENAI_MODEL = "gpt-6-astra";

export interface OpenAiOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

export class OpenAiLlm implements Llm {
  readonly name: string;
  readonly #apiKey: string;
  readonly #model: string;
  readonly #baseUrl: string;

  constructor(options: OpenAiOptions) {
    this.#apiKey = options.apiKey;
    this.#model = options.model ?? DEFAULT_OPENAI_MODEL;
    this.#baseUrl = options.baseUrl ?? "https://api.openai.com/v1";
    this.name = `openai:${this.#model}`;
  }

  /** From OPENAI_API_KEY (and optionally TULPAR_OPENAI_MODEL), or undefined when no key is set. */
  static fromEnv(): OpenAiLlm | undefined {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return undefined;
    return new OpenAiLlm({ apiKey, ...(process.env.TULPAR_OPENAI_MODEL && { model: process.env.TULPAR_OPENAI_MODEL }) });
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const body = {
      model: this.#model,
      instructions: request.instructions,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: request.text },
            ...(request.images ?? []).map((img) => ({ type: "input_image", image_url: `data:${img.mime};base64,${img.base64}`, detail: "high" })),
          ],
        },
      ],
      text: { format: { type: "json_schema", name: request.schema.name, schema: request.schema.schema, strict: true } },
      ...(request.maxOutputTokens && { max_output_tokens: request.maxOutputTokens }),
      // Designs and code are the user's; don't keep them on OpenAI's side longer than needed.
      store: false,
    };
    const res = await fetch(`${this.#baseUrl}/responses`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.#apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as OpenAiResponse;
    if (!res.ok) throw new LlmError(`OpenAI ${res.status}: ${data.error?.message ?? res.statusText}`, res.status);
    if (data.status === "incomplete") throw new LlmError(`OpenAI response incomplete: ${data.incomplete_details?.reason ?? "unknown reason"}`);

    const parts = (data.output ?? []).flatMap((o) => o.content ?? []);
    const refusal = parts.find((p) => p.type === "refusal");
    if (refusal) throw new LlmError(`The model refused: ${refusal.refusal}`);
    const text = parts.filter((p) => p.type === "output_text").map((p) => p.text).join("");
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new LlmError("The model's answer was not valid JSON.");
    }
    return {
      json,
      model: data.model ?? this.#model,
      ...(data.usage && { usage: { inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens } }),
    };
  }
}

interface OpenAiResponse {
  model?: string;
  status?: "completed" | "incomplete" | "in_progress" | "failed";
  incomplete_details?: { reason?: string };
  error?: { message?: string };
  output?: { type: string; content?: { type: string; text?: string; refusal?: string }[] }[];
  usage?: { input_tokens: number; output_tokens: number };
}
