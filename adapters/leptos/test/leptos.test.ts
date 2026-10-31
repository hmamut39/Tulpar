// The Leptos adapter: components read from Rust source, what generated code may not do, the compiler's
// errors, and the render. The end-to-end part needs the Rust toolchain, and skips without it.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AdapterHost } from "@tulpar/core";
import { buildErrors, componentName, dependencies } from "../src/build.ts";
import { crateSource, parseComponents, parseEnums, toComponent } from "../src/components.ts";
import { cargoFound, forbidden } from "../src/sdk.ts";
import { componentsWrittenOn } from "../src/verify.ts";

const source = `
pub enum ButtonSize {
    Small,
    /// The default
    #[default]
    Medium,
    Large,
}

#[component]
pub fn Button(
    #[prop(optional, into)] class: MaybeProp<String>,
    /// How it looks.
    #[prop(optional, into)]
    size: Signal<ButtonSize>,
    #[prop(optional, into)] disabled: Signal<bool>,
    label: String,
    #[prop(optional, into)] on_click: Option<BoxOneCallback<MouseEvent>>,
    #[prop(optional)] children: Option<Children>,
) -> impl IntoView {
    view! { <button /> }
}

fn helper() {}
`;

describe("Leptos components", () => {
  it("reads a #[component] function: props with their enum values, what is required, slots and events", () => {
    const [button] = parseComponents(source);
    const c = toComponent(button!, "thaw", parseEnums(source));
    expect(c.props.map((p) => [p.name, p.required, p.type?.kind])).toEqual([["class", false, "string"], ["size", false, "enum"], ["disabled", false, "boolean"], ["label", true, "string"]]);
    expect(c.props[1]!.type).toMatchObject({ values: ["ButtonSize::Small", "ButtonSize::Medium", "ButtonSize::Large"] });
    expect(c.props[1]!.description).toBe("How it looks.");
    expect(c.slots.map((s) => s.name)).toEqual([""]);
    expect(c.events.map((e) => e.name)).toEqual(["on_click"]);
  });

  it("knows which component each Figma id is written on", () => {
    expect(componentsWrittenOn(`<div data-figma-id="a"><Input\n  attr:data-figma-id="b"\n  placeholder="a > b"\n/><Button attr:data-figma-id="c">"Go"</Button></div>`)).toEqual({ a: "div", b: "Input", c: "Button" });
  });
});

describe("what a generated component may not do", () => {
  it.each([
    [`const K: &str = include_str!("/app/.env");`],
    [`let k = env!("OPENAI_API_KEY");`],
    [`let k = option_env!("OPENAI_API_KEY");`],
    [`#[path = "/etc/x.rs"] mod x;`],
    [`mod secrets;`],
    [`std::fs::read("/etc/passwd");`],
    [`unsafe { x() }`],
    [`extern "C" { fn x(); }`],
    [`macro_rules! m { () => {} }`],
  ])("refuses %s", (code) => {
    expect(forbidden(code)).toBeTruthy();
  });

  it("accepts an ordinary component, and is not fooled by a comment or a word in text", () => {
    expect(forbidden(`use leptos::prelude::*;\n// include_str! is not used here\n#[component]\npub fn Card() -> impl IntoView { view! { <p>"environment module"</p> } }`)).toBeUndefined();
  });
});

describe("Leptos build", () => {
  it("names the function a file defines, and takes the project's dependencies", () => {
    expect(componentName(`#[component]\npub fn SignInCard() -> impl IntoView {}`, "x.rs")).toBe("SignInCard");
    expect(componentName("", "sign_in_card.rs")).toBe("SignInCard");
    expect(dependencies(`[package]\nname = "x"\n\n[dependencies]\nleptos = "0.7"\nthaw = "0.4"\n\n[dev]\na = 1\n`)).toBe(`leptos = "0.7"\nthaw = "0.4"`);
  });

  it("gives a compiler error its line, and leaves out the closing summary", () => {
    const out = ["error[E0425]: cannot find value `email` in this scope", "  --> src\\generated\\card.rs:12:30", "   |", "   = help: a local variable with a similar name exists: `mail`", "", "error: could not compile `harness` (bin) due to 1 previous error"].join("\n");
    expect(buildErrors(out)).toBe("card.rs:12:30: [E0425] cannot find value `email` in this scope (help: a local variable with a similar name exists: `mail`)");
  });
});

const example = resolve(import.meta.dirname, "../../../examples/leptos-thaw");
// A machine may have Rust without the example's crates fetched (GitHub's runners do): a build would fail offline.
const ready = cargoFound() && existsSync(join(example, "Cargo.lock")) && !!crateSource(example, "thaw");

describe.skipIf(!ready)("Leptos end to end, with the Rust toolchain", () => {
  it("builds a component, draws it in the sandbox, and refuses a forbidden one", async () => {
    const dir = join(example, ".tulpar", "test-card");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "card.rs"), `use leptos::prelude::*;\nuse thaw::*;\n\n#[component]\npub fn TestCard() -> impl IntoView {\n    view! { <div data-figma-id="root"><Button attr:data-figma-id="b" appearance=ButtonAppearance::Primary>"Save"</Button></div> }\n}\n`);
    const config = JSON.parse(readFileSync(join(example, "tulpar.json"), "utf8")).leptos;
    const host = await AdapterHost.start(process.execPath, [resolve(import.meta.dirname, "../src/main.ts")]);
    try {
      const params = { root: example, config };
      const entry = ".tulpar/test-card/card.rs";
      const built = await host.call("build", { ...params, entry, frame: { width: 300, height: 100 } });
      expect(built.ok, built.log).toBe(true);
      const r = await host.call("render", { ...params, artifact: built.artifact as string, entry, width: 300, height: 100, scale: 1 });
      expect(r.status).toBe("ok");
      if (r.status !== "ok") return;
      expect(r.elements.find((e) => e.figmaId === "b")).toMatchObject({ component: "Button", text: "Save", visible: true });

      const bad = join(example, ".tulpar", "test-bad");
      mkdirSync(bad, { recursive: true });
      writeFileSync(join(bad, "bad.rs"), `const K: &str = env!("PATH");\n`);
      const refused = await host.call("build", { ...params, entry: ".tulpar/test-bad/bad.rs", frame: { width: 100, height: 100 } });
      expect(refused.ok).toBe(false);
      expect(refused.log).toMatch(/not allowed in a component: reading files or the environment/);
    } finally {
      await host.stop();
    }
  }, 600_000);
});
