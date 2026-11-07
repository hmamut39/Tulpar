#!/usr/bin/env node
// Tulpar adapter for Vaadin (Java). Speaks the adapter protocol on stdio. A Vaadin view runs on the server, so this
// adapter never runs generated Java: a runner machine compiles it, starts it, draws it and sends back what it drew
// (deploy/java-runner.ts, TULPAR_JAVA_RUNNER). Reading the source for hard-coded values happens here.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { PROTOCOL_VERSION, serve, type ComponentIndex, type ProjectParams, type RenderResult, type TokenSet } from "@tulpar/core";
import { mergeTokens, readTokens, type TokenConfig } from "@tulpar/web-kit";
import { analyze } from "./verify.ts";

interface Config {
  tokens?: TokenConfig;
  rules?: string[];
}

const config = (p: ProjectParams) => p.config as Config;
const runner = process.env.TULPAR_JAVA_RUNNER;
const VERSION = "25.3.5";
const PREFIX = "aura";

/** Asks the runner; its answers are data, and a long check keeps the line open with spaces before the JSON. */
async function ask<T>(path: string, body: unknown, timeoutMs: number): Promise<T> {
  const res = await fetch(`${runner}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  return (await res.json()) as T;
}

let index: Promise<ComponentIndex & { tags: Record<string, string> }> | undefined;
const indexed = () =>
  (index ??= ask<ComponentIndex & { tags: Record<string, string> }>("/index", { version: VERSION }, 180_000).catch((err: Error) => {
    index = undefined;
    return { adapter: "vaadin", package: { name: "Vaadin", version: VERSION }, components: [], gaps: [`The Java runner did not answer: ${err.message}`], tags: {} };
  }));

serve({
  initialize: () => ({
    id: "vaadin",
    protocolVersion: PROTOCOL_VERSION,
    detects: ["pom.xml:com.vaadin"],
    capabilities: {
      index: !!runner,
      tokens: !!runner,
      links: false,
      emit: false,
      build: !!runner,
      render: runner ? { supported: true, hostOS: ["linux", "windows", "macos"] } : { supported: false, hostOS: [], reason: "no Java runner is configured (TULPAR_JAVA_RUNNER)" },
      runtimeStyleProvenance: true,
      staticProvenance: true,
      tests: false,
      forceStates: runner ? ["hover", "pressed", "focus"] : [],
      themes: false,
    },
  }),

  index: async () => {
    const { tags: _tags, ...rest } = await indexed();
    return rest;
  },

  tokens: async (params) => {
    const c = config(params);
    const set: TokenSet = c.tokens ? readTokens(params.root, c.tokens, [], "vaadin") : { adapter: "vaadin", modes: [], tokens: [], gaps: ['No "tokens" configured.'] };
    if (!c.tokens?.runtime) return set;
    const cache = join(params.root, ".tulpar", "cache", `vaadin-tokens-${VERSION}.json`);
    if (existsSync(cache)) return mergeTokens(set, JSON.parse(readFileSync(cache, "utf8")) as TokenSet);
    const answer = await ask<{ ok: boolean; tokens?: TokenSet; log?: string }>("/tokens", { runtime: c.tokens.runtime }, 300_000).catch((err: Error) => ({ ok: false, log: err.message }) as { ok: boolean; log?: string; tokens?: TokenSet });
    if (!answer.ok || !answer.tokens) return { ...set, gaps: [...set.gaps, `Theme tokens not read: ${answer.log ?? "the runner sent none"}`] };
    mkdirSync(dirname(cache), { recursive: true });
    writeFileSync(cache, JSON.stringify(answer.tokens));
    return mergeTokens(set, answer.tokens);
  },

  // The runner compiles, starts and draws in one go: it never keeps generated Java running. What it drew is kept
  // for render, which the protocol asks for next.
  build: async (params) => {
    const { root, entry, frame } = params;
    const from = dirname(join(root, entry));
    if (!existsSync(join(root, entry))) return { ok: false, log: `${entry} was not written.` };
    const sources = readdirSync(from).filter((f) => f.endsWith(".java")).map((f) => ({ name: f, content: readFileSync(join(from, f), "utf8") }));
    const view = basename(entry, ".java");
    const answer = await ask<{ ok: boolean; log: string; render?: RenderResult }>("/check", { sources, view, frame, scale: 1, tags: (await indexed()).tags }, 600_000).catch((err: Error) => ({ ok: false, log: `The Java runner did not answer: ${err.message}` }) as { ok: boolean; log: string; render?: RenderResult });
    if (!answer.ok || !answer.render) return { ok: false, log: answer.log };
    const out = join(root, ".tulpar", "vaadin", "out", view);
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "render.json"), JSON.stringify(answer.render));
    return { ok: true, log: `built ${view}`, artifact: out };
  },

  render: async (params) => {
    const file = join(params.artifact, "render.json");
    if (!existsSync(file)) return { status: "failed", reason: "the view was not drawn: build it first" };
    return JSON.parse(readFileSync(file, "utf8")) as RenderResult;
  },

  analyze: (params) => analyze(params.root, params.entry, PREFIX),

  conventions: (params) => ({
    language: "Java",
    framework: "Vaadin with its Aura theme",
    files: [{ path: "{name}.java", role: "component", description: "The view: public class {name} extends a layout (VerticalLayout, HorizontalLayout or Div), built in its no-argument constructor; it renders the whole design." }],
    entry: "{name}.java",
    rules: [
      "Use Vaadin's components for every mapped instance (Button, TextField, PasswordField, Checkbox, Card, H2, Paragraph, Span…), set by their setters and constructors as the mapping gives. Never rebuild one from Div and click listeners.",
      'Put the Figma id on the root (getElement().setAttribute("data-figma-id", "<id>") in the constructor) and on every component that renders a Figma instance or text layer: component.getElement().setAttribute("data-figma-id", "<id>").',
      "A button's look is a theme variant: button.addThemeVariants(ButtonVariant.PRIMARY). Do not style a component's colours or type yourself.",
      'Colours, type and spacing come from the theme. Where the view sets a style itself (getStyle().set("gap", …), setPadding, setSpacing), use the theme\'s CSS variables, e.g. getStyle().set("gap", "var(--vaadin-gap-m)"). Never a bare colour, px font size or px spacing.',
      "Do not give the root a fixed size from the frame: setWidthFull() and the content's own height.",
      "Import every class you use (com.vaadin.flow.component.button.Button, com.vaadin.flow.component.textfield.TextField, com.vaadin.flow.component.orderedlayout.VerticalLayout, com.vaadin.flow.component.html.H2…). Only Vaadin and java.*: no other libraries, no package line (Tulpar adds it), no @Route, no files, network, threads or reflection.",
      ...(config(params).rules ?? []),
    ],
    importExample: "import com.vaadin.flow.component.button.Button;",
  }),

  links: () => ({ adapter: "vaadin", links: [], gaps: ["Vaadin has no Code Connect files to read yet."] }),

  shutdown: () => null,
});
