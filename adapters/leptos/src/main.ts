#!/usr/bin/env node
// Tulpar adapter for Leptos (Rust). Speaks the adapter protocol on stdio; uses the Rust toolchain as a tool.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PROTOCOL_VERSION, serve, type ProjectParams } from "@tulpar/core";
import { closeBrowser, closeProbeBrowser, mergeTokens, probeTokens, readTokens, serving, tokenPrefix, type RenderConfig, type TokenConfig } from "@tulpar/web-kit";
import { build, type HarnessConfig } from "./build.ts";
import { indexComponents } from "./components.ts";
import { cargoFound } from "./sdk.ts";
import { analyze, leptosHooks, render } from "./verify.ts";

interface Config {
  /** The crates that are the design system, e.g. ["thaw"]. */
  crates?: string[];
  tokens?: TokenConfig;
  render?: RenderConfig;
  harness?: HarnessConfig;
  /** Extra rules for the model, in the design system's own terms. */
  rules?: string[];
}

const config = (p: ProjectParams) => p.config as Config;
const prefix = (p: ProjectParams) => tokenPrefix(config(p).tokens);
const found = cargoFound();

serve({
  initialize: () => ({
    id: "leptos",
    protocolVersion: PROTOCOL_VERSION,
    detects: ["Cargo.toml:leptos"],
    capabilities: {
      index: found,
      tokens: found,
      links: false,
      emit: false,
      build: found,
      render: found ? { supported: true, hostOS: ["linux", "windows", "macos"] } : { supported: false, hostOS: [], reason: "the Rust toolchain is not installed (set TULPAR_RUST_ROOT)" },
      runtimeStyleProvenance: true,
      staticProvenance: true,
      tests: false,
      forceStates: found ? ["hover", "pressed", "focus"] : [],
      themes: false,
    },
  }),

  index: (params) => indexComponents(params.root, config(params).crates ?? []),

  // The theme's variables, as the design system writes them when it starts: read from an empty page.
  tokens: async (params) => {
    const c = config(params);
    if (!c.tokens) return { adapter: "leptos", modes: [], tokens: [], gaps: ['No "tokens" configured.'] };
    const set = readTokens(params.root, c.tokens, [], "leptos");
    if (!c.tokens.runtime) return set;
    const dir = join(params.root, ".tulpar", "probe");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "probe.rs"), `use leptos::prelude::*;\n\n#[component]\npub fn Probe() -> impl IntoView {\n    view! { <div></div> }\n}\n`);
    const built = await build({ ...params, entry: ".tulpar/probe/probe.rs", frame: { width: 200, height: 200 } }, c.harness ?? {});
    if (!built.ok) return { ...set, gaps: [...set.gaps, `Theme tokens not read: the probe page did not build (${built.log.split("\n")[0]})`] };
    return mergeTokens(set, await serving(built.artifact as string, (url) => probeTokens(url, c.render ?? {}, leptosHooks(), c.tokens!.runtime!)));
  },

  build: (params) => build(params, config(params).harness ?? {}),

  render: (params) => render(params, config(params).render ?? {}, prefix(params)),

  analyze: (params) => analyze(params.root, params.entry, prefix(params)),

  conventions: (params) => {
    const c = config(params);
    const crate = c.crates?.[0] ?? "the design system";
    const uses = (c.harness?.uses ?? []).map((u) => `use ${u}::*;`).join(" ");
    return {
      language: "Rust",
      framework: `Leptos with ${crate}`,
      files: [
        { path: "{snake}.rs", role: "component", description: `The component: #[component] pub fn {name}() -> impl IntoView, with no required props; it renders the whole design. Begin with use leptos::prelude::*; ${uses}` },
        { path: "{snake}.css", role: "styles", description: "Plain CSS for the component's own layout (design-system components style themselves). Prefix class names with the component's name: the stylesheet is global." },
      ],
      entry: "{snake}.rs",
      rules: [
        `Use ${crate}'s components by their tags in view!. Set props by the enum values their API lists (appearance=ButtonAppearance::Primary). Do not invent props: a prop that is not listed does not compile.`,
        `Text in view! is a quoted string: <Button>"Save"</Button>.`,
        `Put the id on a component as attr:data-figma-id="<id>", and on a plain element as data-figma-id="<id>", on the root and every element that renders a Figma instance or text layer.`,
        `State is a signal: let email = RwSignal::new(String::new()); passed as value=email to an input, and checked=remember to a checkbox with a RwSignal<bool>.`,
        `Colours, type and spacing come from the theme: the component's own props, or a stylesheet token written with its value as the fallback, e.g. var(--colorNeutralForeground1, #242424). No hex, rgb or px literals in {snake}.css or style attributes.`,
        `Rust keywords cannot be attribute names on a component: "for" is one, so never write for= on a component. Tie a field to its label with attr:id on the label and attr:aria-labelledby on the field, or use a plain <label for="…"> element.`,
        `Only the component: no include!, include_str!, env!, std::fs, std::net, std::process, unsafe, extern, macro_rules! or mod declarations. They are refused before compiling.`,
        ...(c.rules ?? []),
      ],
      importExample: `use leptos::prelude::*; ${uses}`,
    };
  },

  links: () => ({ adapter: "leptos", links: [], gaps: ["Leptos has no Code Connect files to read yet."] }),

  shutdown: async () => {
    await closeProbeBrowser();
    await closeBrowser();
    return null;
  },
});
