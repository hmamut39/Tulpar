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

describe("prompt cache", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const capture = (usage: Record<string, unknown>) => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string));
      return new Response(JSON.stringify({ model: "m", output: [{ type: "message", content: [{ type: "output_text", text: "{}" }] }], usage }), { status: 200 });
    });
    return bodies;
  };

  it("sends the cache key to OpenAI and reads back what was served from the cache", async () => {
    const bodies = capture({ input_tokens: 10_000, output_tokens: 100, input_tokens_details: { cached_tokens: 8_192 } });
    const r = await new OpenAiLlm({ apiKey: "k" }).complete({ ...request, cacheKey: "tulpar-abc" });
    expect(bodies[0]!.prompt_cache_key).toBe("tulpar-abc");
    expect(r.usage).toEqual({ inputTokens: 10_000, outputTokens: 100, cachedInputTokens: 8_192 });
  });

  it("leaves the key out for a company's own endpoint, which may not know it", async () => {
    const bodies = capture({ input_tokens: 1, output_tokens: 1 });
    const r = await new OpenAiLlm({ apiKey: "k", baseUrl: "https://x.openai.azure.com/openai/v1" }).complete({ ...request, cacheKey: "tulpar-abc" });
    expect(bodies[0]!.prompt_cache_key).toBeUndefined();
    expect(r.usage).toEqual({ inputTokens: 1, outputTokens: 1 });
  });

  it("prices cached input at its own rate, and as ordinary input when none is set", async () => {
    const { tokenCost } = await import("../src/index.ts");
    const usage = { inputTokens: 1_000_000, outputTokens: 0, cachedInputTokens: 800_000 };
    expect(tokenCost(usage, { TULPAR_OPENAI_INPUT_PER_M: "2", TULPAR_OPENAI_OUTPUT_PER_M: "8", TULPAR_OPENAI_CACHED_INPUT_PER_M: "0.2" })).toBe(0.56);
    expect(tokenCost(usage, { TULPAR_OPENAI_INPUT_PER_M: "2", TULPAR_OPENAI_OUTPUT_PER_M: "8" })).toBe(2);
  });
});
