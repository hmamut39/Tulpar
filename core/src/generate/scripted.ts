// A stand-in model that returns prepared answers in order. It tests the generate →
// verify → repair loop without an API key or cost, and records what it was asked.

import { LlmError, type Llm, type LlmRequest, type LlmResponse } from "./llm.ts";

export class ScriptedLlm implements Llm {
  readonly name = "scripted";
  readonly requests: LlmRequest[] = [];
  readonly #answers: unknown[];

  constructor(answers: unknown[]) {
    this.#answers = [...answers];
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    this.requests.push(request);
    const json = this.#answers.shift();
    if (json === undefined) throw new LlmError("The scripted model has no more answers.");
    return { json, model: this.name, usage: { inputTokens: 0, outputTokens: 0 } };
  }
}
