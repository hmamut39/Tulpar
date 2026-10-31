// The Blazor adapter: components read from compiled metadata, the harness and its errors, and the render
// through a local server. The end-to-end part needs the .NET SDK and a restored example, and skips without.

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AdapterHost } from "@tulpar/core";
import { buildErrors, componentName, packageReferences } from "../src/build.ts";
import { toComponent } from "../src/components.ts";
import { dotnetBin } from "../src/sdk.ts";
import { analyze, componentsWrittenOn } from "../src/verify.ts";

const param = (name: string, type: string, extra = {}) => ({ name, type, required: false, values: null, deprecated: false, attributes: false, ...extra });

describe("Blazor components", () => {
  it("reads [Parameter]s as props, RenderFragments as slots and EventCallbacks as events", () => {
    const c = toComponent({
      name: "MudTextField",
      ns: "MudBlazor",
      typeParams: ["T"],
      parameters: [
        param("Label", "String"),
        param("Disabled", "Boolean"),
        param("Lines", "Int32"),
        param("Variant", "Variant", { values: ["Text", "Filled", "Outlined"] }),
        param("ChildContent", "RenderFragment"),
        param("AdornmentStart", "RenderFragment"),
        param("ValueChanged", "EventCallback<T>"),
        param("UserAttributes", "Dictionary<String, Object>", { attributes: true }),
      ],
    });
    expect(c.markup).toBe('<MudTextField T="string">');
    expect(c.props.map((p) => [p.name, p.type?.kind])).toEqual([["Label", "string"], ["Disabled", "boolean"], ["Lines", "number"], ["Variant", "enum"]]);
    expect(c.slots.map((s) => s.name)).toEqual(["", "AdornmentStart"]);
    expect(c.events.map((e) => e.name)).toEqual(["ValueChanged"]);
  });
});

describe("Blazor harness", () => {
  it("takes the project's packages at their versions, without the dev server", () => {
    const csproj = `<PackageReference Include="Microsoft.AspNetCore.Components.WebAssembly.DevServer" Version="10.0.14" PrivateAssets="all" /><PackageReference Include="MudBlazor" Version="9.12.0" />`;
    expect(packageReferences(csproj)).toEqual([{ name: "MudBlazor", version: "9.12.0" }]);
    expect(componentName(".tulpar/generated/SignInCard/SignInCard.razor")).toBe("SignInCard");
  });

  it("gives a compiler error its file and line, once, without the project path", () => {
    const out = [
      "  Determining projects to restore...",
      "C:\\x\\.tulpar\\blazor\\Generated\\Card.razor(12,5): error RZ10012: Found markup element with unexpected name 'MudButon'. [C:\\x\\.tulpar\\blazor\\Harness.csproj]",
      "C:\\x\\.tulpar\\blazor\\Generated\\Card.razor(12,5): error RZ10012: Found markup element with unexpected name 'MudButon'. [C:\\x\\.tulpar\\blazor\\Harness.csproj]",
      "/app/x/Generated/Card.razor(3,1): error CS0103: The name 'email' does not exist in the current context [/app/x/Harness.csproj]",
    ].join("\n");
    expect(buildErrors(out).split("\n")).toEqual(["Card.razor:12:5: RZ10012: Found markup element with unexpected name 'MudButon'.", "Card.razor:3:1: CS0103: The name 'email' does not exist in the current context"]);
  });
});

describe("Blazor source", () => {
  it("knows which component each Figma id is written on, across lines", () => {
    expect(componentsWrittenOn(`<div data-figma-id="a"><MudTextField T="string"\n  Label="x > y"\n  data-figma-id="b" /><MudButton Color="Color.Info" data-figma-id="c">Go</MudButton></div>`)).toEqual({ a: "div", b: "MudTextField", c: "MudButton" });
  });

  it("finds hard-coded values in the stylesheet and style attributes, and the components used", () => {
    const root = resolve(import.meta.dirname, ".tmp-analyze");
    mkdirSync(root, { recursive: true });
    try {
      writeFileSync(join(root, "C.razor"), `<div style="color: #ff0000; text-transform: none"><MudButton Style="margin: 13px">Go</MudButton></div>`);
      writeFileSync(join(root, "C.razor.css"), `.a { background: #00ff00; color: var(--mud-palette-primary, #594ae2); }`);
      const r = analyze(root, "C.razor", "mud");
      expect(r.componentsUsed).toEqual(["MudButton"]);
      expect(r.literals.map((l) => l.written).sort()).toEqual(["#00ff00", "#ff0000", "13px"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

const example = resolve(import.meta.dirname, "../../../examples/blazor-mud");
const ready = !!dotnetBin() && existsSync(join(example, "obj", "project.assets.json"));

describe.skipIf(!ready)("Blazor end to end, with the .NET SDK", () => {
  it("builds a component, draws it in the sandbox, and measures its controls by their roots", async () => {
    const dir = join(example, ".tulpar", "test-card");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "Card.razor"), `<div data-figma-id="root"><MudTextField data-figma-id="a" T="string" Label="Email" @bind-Value="email" /><MudButton data-figma-id="b" Variant="Variant.Filled" Style="text-transform: none">Save</MudButton></div>\n@code { private string email = ""; }\n`);
    const config = JSON.parse((await import("node:fs")).readFileSync(join(example, "tulpar.json"), "utf8")).blazor;
    const host = await AdapterHost.start(process.execPath, [resolve(import.meta.dirname, "../src/main.ts")]);
    try {
      const params = { root: example, config };
      const entry = ".tulpar/test-card/Card.razor";
      const built = await host.call("build", { ...params, entry, frame: { width: 360, height: 200 } });
      expect(built.ok, built.log).toBe(true);
      const r = await host.call("render", { ...params, artifact: built.artifact as string, entry, width: 360, height: 200, scale: 1 });
      expect(r.status).toBe("ok");
      if (r.status !== "ok") return;
      const byId = new Map(r.elements.map((e) => [e.figmaId, e]));
      expect(byId.get("a")).toMatchObject({ component: "MudTextField", visible: true });
      // Measured by the control's root, which holds the label.
      expect(byId.get("a")!.text).toContain("Email");
      expect(byId.get("b")).toMatchObject({ component: "MudButton", text: "Save" });
      expect(r.states?.some((s) => s.figmaId === "b" && s.state === "focus")).toBe(true);

      const broken = join(example, ".tulpar", "test-broken");
      mkdirSync(broken, { recursive: true });
      writeFileSync(join(broken, "Broken.razor"), `<MudButon>Save</MudButon>\n`);
      const failed = await host.call("build", { ...params, entry: ".tulpar/test-broken/Broken.razor", frame: { width: 100, height: 100 } });
      expect(failed.ok).toBe(false);
      expect(failed.log).toMatch(/Broken\.razor:1:1: RZ10012: .*MudButon/);
    } finally {
      await host.stop();
    }
  }, 300_000);
});
