// Build: a small Blazor WebAssembly app around the generated component, published to static files.
// It references the project's own packages at the project's versions. Compiling runs none of the
// generated code; the browser that later opens the result is sandboxed.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, relative } from "node:path";
import type { BuildParams, BuildResult } from "@tulpar/core";
import { FRAME_ID, IMPL_SOURCE_URL } from "@tulpar/web-kit";
import { dotnet } from "./sdk.ts";

export interface HarnessConfig {
  /** Namespaces every generated component gets (@using), e.g. MudBlazor. */
  usings?: string[];
  /** C# lines for Program.cs that register the design system, e.g. builder.Services.AddMudServices(); */
  services?: string[];
  /** Razor that an app has around its pages, e.g. <MudThemeProvider />. */
  host?: string;
  /** Tags for <head>, e.g. the design system's stylesheet. */
  head?: string[];
  /** Tags before </body>, e.g. the design system's script. */
  scripts?: string[];
}

const require = createRequire(import.meta.url);

/** The project's package references, as its .csproj writes them; the SDK's dev server is left out. */
export function packageReferences(csproj: string): { name: string; version: string }[] {
  const out: { name: string; version: string }[] = [];
  for (const m of csproj.matchAll(/<PackageReference\s+Include="([^"]+)"\s+Version="([^"]+)"/g)) {
    if (!/DevServer/.test(m[1]!)) out.push({ name: m[1]!, version: m[2]! });
  }
  return out;
}

/** The compiler's errors, one per line, with file and line relative to the generated folder and no project path. */
export function buildErrors(output: string): string {
  const seen = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    const m = /^\s*(.*?)\((\d+),(\d+)\): error (\w+): (.*?)(?: \[.*\])?\s*$/.exec(line);
    if (m) seen.add(`${m[1]!.split(/[\\/]/).pop()}:${m[2]}:${m[3]}: ${m[4]}: ${m[5]}`);
    else if (/\berror\b/i.test(line) && /: error /.test(line)) seen.add(line.trim().replace(/ \[.*\]\s*$/, ""));
  }
  return [...seen].slice(0, 12).join("\n");
}

/** The Razor class a file defines: Checkout.razor is <Checkout />. */
export const componentName = (entry: string) => basename(entry).replace(/\.razor$/, "");

export async function build(params: BuildParams, config: HarnessConfig): Promise<BuildResult> {
  const { root, entry, frame } = params;
  const csproj = readdirSync(root).find((f) => f.endsWith(".csproj"));
  if (!csproj) return { ok: false, log: "The project has no .csproj." };
  const name = componentName(entry);
  const dir = join(root, ".tulpar", "blazor");
  const generated = join(dir, "Generated");
  rmSync(generated, { recursive: true, force: true });
  mkdirSync(generated, { recursive: true });
  mkdirSync(join(dir, "wwwroot"), { recursive: true });
  const from = dirname(join(root, entry));
  for (const f of readdirSync(from)) if (/\.razor(\.css)?$/.test(f)) cpSync(join(from, f), join(generated, f));

  const packages = packageReferences(readFileSync(join(root, csproj), "utf8"));
  // An element or component Razor does not know (RZ10012) would only warn, and draw as an unknown tag.
  writeFileSync(
    join(dir, "Harness.csproj"),
    `<Project Sdk="Microsoft.NET.Sdk.BlazorWebAssembly">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <RootNamespace>Harness</RootNamespace>
    <WarningsAsErrors>$(WarningsAsErrors);RZ10012;RZ1006</WarningsAsErrors>
    <PublishTrimmed>false</PublishTrimmed>
    <CompressionEnabled>false</CompressionEnabled>
    <BlazorEnableCompression>false</BlazorEnableCompression>
    <InvariantGlobalization>true</InvariantGlobalization>
    <WasmFingerprintAssets>false</WasmFingerprintAssets>
    <SatelliteResourceLanguages>en</SatelliteResourceLanguages>
  </PropertyGroup>
  <ItemGroup>
${packages.map((p) => `    <PackageReference Include="${p.name}" Version="${p.version}" />`).join("\n")}
  </ItemGroup>
</Project>
`,
  );
  writeFileSync(join(dir, "_Imports.razor"), ["Microsoft.AspNetCore.Components.Forms", "Microsoft.AspNetCore.Components.Web", "Harness.Generated", ...(config.usings ?? [])].map((u) => `@using ${u}`).join("\n") + "\n");
  writeFileSync(join(dir, "Host.razor"), `${config.host ?? ""}\n<${name} />\n`);
  writeFileSync(
    join(dir, "Program.cs"),
    `using Harness;
using Microsoft.AspNetCore.Components.WebAssembly.Hosting;
${(config.usings ?? []).filter((u) => !u.includes(".Generated")).map((u) => `using ${u};`).join("\n")}
var builder = WebAssemblyHostBuilder.CreateDefault(args);
builder.RootComponents.Add<Host>("#${FRAME_ID}");
${(config.services ?? []).join("\n")}
await builder.Build().RunAsync();
`,
  );

  // The typeface most design systems' kits assume: the sandbox has no network to fetch it.
  const fonts: string[] = [];
  mkdirSync(join(dir, "wwwroot", "fonts"), { recursive: true });
  for (const weight of [300, 400, 500, 700]) {
    try {
      const file = require.resolve(`@fontsource/roboto/files/roboto-latin-${weight}-normal.woff2`);
      cpSync(file, join(dir, "wwwroot", "fonts", basename(file)));
      fonts.push(`@font-face { font-family: Roboto; font-weight: ${weight}; src: url(fonts/${basename(file)}) format("woff2"); }`);
    } catch {
      // that weight is not installed
    }
  }

  const out = join(dir, "out", name);
  rmSync(out, { recursive: true, force: true });
  const page = (css: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<base href="/">
${(config.head ?? []).join("\n")}
<style>${fonts.join("\n")}
html, body { margin: 0; padding: 0; } #${FRAME_ID} { position: relative; overflow: hidden; width: ${frame.width}px; height: ${frame.height}px; } #blazor-error-ui { display: none; }</style>
<style>${css}
/*# sourceURL=${IMPL_SOURCE_URL} */</style>
</head>
<body>
<div id="${FRAME_ID}"></div>
<div id="blazor-error-ui"></div>
<script src="_framework/blazor.webassembly.js"></script>
${(config.scripts ?? []).join("\n")}
</body>
</html>
`;
  writeFileSync(join(dir, "wwwroot", "index.html"), page(""));
  const run = await dotnet(["publish", "Harness.csproj", "-c", "Release", "-o", join("out", name), "--nologo", "-v", "q"], dir);
  if (run.code !== 0) return { ok: false, log: buildErrors(run.stdout + "\n" + run.stderr) || (run.stderr || run.stdout).slice(-1500) || `dotnet publish failed (exit ${run.code})` };
  const site = join(out, "wwwroot");
  // The component's own stylesheet (Razor's scoped CSS, attributes included) goes into the page as the
  // implementation's style sheet, so the token checks read it.
  const scoped = join(site, "Harness.styles.css");
  writeFileSync(join(site, "index.html"), page(existsSync(scoped) ? readFileSync(scoped, "utf8") : ""));
  return { ok: true, log: `built ${relative(root, site)}`, artifact: site };
}
