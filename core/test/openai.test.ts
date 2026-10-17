// The model provider: OpenAI by default, or any OpenAI-compatible endpoint a company chooses (Azure OpenAI,
// its own gateway), with the key sent the way that endpoint expects.

import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAiLlm } from "../src/index.ts";

const ok = () => new Response(JSON.stringify({ model: "m", output: [{ type: "message", content: [{ type: "output_text", text: "{}" }] }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 });
const request = { instructions: "i", text: "t", schema: { name: "s", schema: { type: "object", properties: {}, additionalProperties: false } } };

describe("model provider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const seen = () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, headers: init.headers as Record<string, string> });
      return ok();
    });
    return calls;
  };

  it("talks to OpenAI with a bearer token by default", async () => {
    const calls = seen();
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("OPENAI_BASE_URL", "");
    await OpenAiLlm.fromEnv()!.complete(request);
    expect(calls[0]!.url).toBe("https://api.openai.com/v1/responses");
    expect(calls[0]!.headers.authorization).toBe("Bearer sk-test");
  });

  it("uses the company's own endpoint and model when configured", async () => {
    const calls = seen();
    vi.stubEnv("OPENAI_API_KEY", "gw-key");
    vi.stubEnv("OPENAI_BASE_URL", "https://llm.example.internal/v1/");
    vi.stubEnv("TULPAR_OPENAI_MODEL", "our-deployment");
    const llm = OpenAiLlm.fromEnv()!;
    await llm.complete(request);
    expect(calls[0]!.url).toBe("https://llm.example.internal/v1/responses");
    expect(llm.name).toBe("openai:our-deployment");
  });

  it("sends Azure OpenAI its key in the api-key header", async () => {
    const calls = seen();
    vi.stubEnv("OPENAI_API_KEY", "az-key");
    vi.stubEnv("OPENAI_BASE_URL", "https://acme.openai.azure.com/openai/v1");
    await OpenAiLlm.fromEnv()!.complete(request);
    expect(calls[0]!.headers["api-key"]).toBe("az-key");
    expect(calls[0]!.headers.authorization).toBeUndefined();
  });
});

describe("token cost", () => {
  it("is priced from the owner's rates per million tokens, and absent without them", async () => {
    const { tokenCost } = await import("../src/index.ts");
    expect(tokenCost({ inputTokens: 1_000_000, outputTokens: 500_000 }, { TULPAR_OPENAI_INPUT_PER_M: "2", TULPAR_OPENAI_OUTPUT_PER_M: "8" })).toBe(6);
    expect(tokenCost({ inputTokens: 13_000, outputTokens: 7_000 }, { TULPAR_OPENAI_INPUT_PER_M: "2", TULPAR_OPENAI_OUTPUT_PER_M: "8" })).toBe(0.082);
    expect(tokenCost({ inputTokens: 13_000, outputTokens: 7_000 }, {})).toBeUndefined();
  });
});
