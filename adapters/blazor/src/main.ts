#!/usr/bin/env node
// Tulpar adapter for Blazor (C#). Speaks the adapter protocol on stdio; uses the .NET SDK as a tool.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PROTOCOL_VERSION, serve, type ProjectParams } from "@tulpar/core";
import { closeBrowser, closeProbeBrowser, mergeTokens, probeTokens, readTokens, serving, tokenPrefix, type RenderConfig, type TokenConfig } from "@tulpar/web-kit";
import { build, type HarnessConfig } from "./build.ts";
import { indexComponents } from "./components.ts";
import { dotnetBin } from "./sdk.ts";
import { analyze, blazorHooks, render } from "./verify.ts";

interface Config {
  /** The NuGet packages that are the design system, e.g. ["MudBlazor"]. */
  packages?: string[];
  tokens?: TokenConfig;
  render?: RenderConfig;
  harness?: HarnessConfig;
  /** CSS selectors of component roots, for controls that pass data-figma-id to an inner element. */
  roots?: string[];
  /** Extra rules for the model, in the design system's own terms. */
  rules?: string[];
}

const config = (p: ProjectParams) => p.config as Config;
const prefix = (p: ProjectParams) => tokenPrefix(config(p).tokens);
const sdkFound = !!dotnetBin();
const notInstalled = "the .NET SDK is not installed (set TULPAR_DOTNET_ROOT)";

serve({
  initialize: () => ({
    id: "blazor",
    protocolVersion: PROTOCOL_VERSION,
    detects: ["*.csproj:Microsoft.AspNetCore.Components"],
    capabilities: {
      index: sdkFound,
      tokens: sdkFound,
      links: false,
      emit: false,
      build: sdkFound,
      render: sdkFound ? { supported: true, hostOS: ["linux", "windows", "macos"] } : { supported: false, hostOS: [], reason: notInstalled },
      runtimeStyleProvenance: true,
      staticProvenance: true,
      // bUnit, the usual test library, runs the component on the host; generated code runs only in the sandbox.
      tests: false,
      forceStates: sdkFound ? ["hover", "pressed", "focus"] : [],
      themes: false,
    },
  }),

  index: (params) => indexComponents(params.root, config(params).packages ?? []),

  // The theme's variables, as the design system writes them when it starts: read from an empty page.
  tokens: async (params) => {
    const c = config(params);
    if (!c.tokens) return { adapter: "blazor", modes: [], tokens: [], gaps: ['No "tokens" configured.'] };
    const set = readTokens(params.root, c.tokens, [], "blazor");
    if (!c.tokens.runtime) return set;
    const dir = join(params.root, ".tulpar", "probe");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "Probe.razor"), "<div></div>\n");
    const built = await build({ ...params, entry: ".tulpar/probe/Probe.razor", frame: { width: 200, height: 200 } }, c.harness ?? {});
    if (!built.ok) return { ...set, gaps: [...set.gaps, `Theme tokens not read: the probe page did not build (${built.log.split("\n")[0]})`] };
    return mergeTokens(set, await serving(built.artifact as string, (url) => probeTokens(url, c.render ?? {}, blazorHooks(), c.tokens!.runtime!)));
  },

  build: (params) => build(params, config(params).harness ?? {}),

  render: (params) => render(params, config(params).render ?? {}, prefix(params), config(params).roots),

  analyze: (params) => analyze(params.root, params.entry, prefix(params)),

  conventions: (params) => {
    const c = config(params);
    const pkg = c.packages?.[0] ?? "the design system";
    const p = prefix(params);
    const token = p ? `var(--${p}-…, <its value>)` : "var(--token-name, <its value>)";
    return {
      language: "C# (Razor)",
      framework: `Blazor with ${pkg}`,
      files: [
        { path: "{name}.razor", role: "component", description: "The component, with no required parameters; it renders the whole design. Any logic goes in an @code block in this file." },
        { path: "{name}.razor.css", role: "styles", description: "Scoped styles for the component's own layout (design-system components style themselves)." },
      ],
      entry: "{name}.razor",
      rules: [
        `Use ${pkg}'s components by their Razor tags; the namespaces are already imported, so write no @using for them. A generic component must be told its type (<MudTextField T="string">), as its markup shows.`,
        `Put data-figma-id="<id>" on the root element and on every element or component that renders a Figma instance or text layer: ${pkg}'s components pass it through to their root element.`,
        `Colours and type come from the theme, through the components' own parameters (Color="Color.<value>", Typo="Typo.h6") or a stylesheet token written with its value as the fallback: ${token}. No hex, rgb or px literals in {name}.razor.css or in style attributes.`,
        `{name}.razor.css is scoped to this file's plain HTML elements: to reach inside a design-system component's markup, use ::deep from a plain parent element. Never override a design-system component's look with it; set its parameters.`,
        `Bind inputs with @bind-Value (and @bind-Checked or the parameter the component's API lists) to fields in @code, so the component stays interactive.`,
        `The instance list gives each component's props by value: Color "Info" is written Color="Color.Info". Set the colour it gives, not Primary out of habit: Primary is only this theme's own default, which may not be the design's colour, and the pixel check compares the colours drawn.`,
        `A Razor attribute value that is C# is written with @ where the API takes an expression (@bind-Value="email"); enums are written Enum.Value (Variant="Variant.Filled").`,
        ...(c.rules ?? []),
      ],
      importExample: `<MudButton Variant="Variant.Filled">Save</MudButton>`,
    };
  },

  links: () => ({ adapter: "blazor", links: [], gaps: ["Blazor has no Code Connect files to read yet."] }),

  shutdown: async () => {
    await closeProbeBrowser();
    await closeBrowser();
    return null;
  },
});
