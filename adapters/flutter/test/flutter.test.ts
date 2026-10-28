// The Flutter adapter: widgets read with the Dart analyzer, the render measured through semantics,
// and every value in the code checked. The end-to-end parts need the Flutter SDK and skip without it.

import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AdapterHost } from "@tulpar/core";
import { toComponent } from "../src/components.ts";
import { parse, stalled } from "../src/tests.ts";
import { flutterBin } from "../src/sdk.ts";
import { widgetClass } from "../src/verify.ts";

const main = resolve(import.meta.dirname, "../src/main.ts");
const example = resolve(import.meta.dirname, "../../../examples/flutter-material");
const sdk = !!flutterBin();

describe("the Flutter component model", () => {
  it("turns a widget's parameters into props, slots and events", () => {
    const c = toComponent(
      {
        name: "FilledButton",
        doc: "A Material Design filled button.",
        params: [
          { name: "onPressed", type: "void Function()?", named: true, required: true },
          { name: "autofocus", type: "bool", named: true, required: false, default: "false" },
          { name: "child", type: "Widget?", named: true, required: true },
          { name: "icon", type: "Widget?", named: true, required: false },
        ],
      },
      "package:flutter/material.dart",
    );
    expect(c).toMatchObject({ id: "package:flutter/material.dart#FilledButton", module: "package:flutter/material.dart", description: "A Material Design filled button." });
    expect(c.props).toMatchObject([{ name: "autofocus", type: { kind: "boolean" }, defaultText: "false", required: false }]);
    expect(c.slots.map((s) => s.name)).toEqual(["", "icon"]);
    expect(c.events.map((e) => e.name)).toEqual(["onPressed"]);
  });

  it("reads flutter test's JSON report: passes, failures with their reason, and a file that did not load", () => {
    const events = [
      { type: "testStart", test: { id: 1, name: "loading test/tulpar_run/a_test.dart", url: null } },
      { type: "testDone", testID: 1, result: "success", hidden: true },
      { type: "testStart", test: { id: 2, name: "shows the actions", url: "file:///a_test.dart" } },
      { type: "testDone", testID: 2, result: "success", hidden: false },
      { type: "testStart", test: { id: 3, name: "fails honestly", url: "file:///a_test.dart" } },
      { type: "error", testID: 3, error: "Expected: exactly one matching candidate\n  Actual: _TextWidgetFinder:<Found 0 widgets>" },
      { type: "testDone", testID: 3, result: "failure", hidden: false },
    ].map((e) => JSON.stringify(e)).join("\n");
    expect(parse(events, 1)).toEqual({ status: "ran", runner: "flutter test in Chromium", tests: [{ name: "shows the actions", status: "passed" }, { name: "fails honestly", status: "failed", error: "Expected: exactly one matching candidate   Actual: _TextWidgetFinder:<Found 0 widgets>" }] });
    const broken = [{ type: "testStart", test: { id: 1, name: "loading test/tulpar_run/a_test.dart", url: null } }, { type: "error", testID: 1, error: "a_test.dart:3:8: Error: Not found: 'x.dart'" }, { type: "testDone", testID: 1, result: "error", hidden: true }].map((e) => JSON.stringify(e)).join("\n");
    expect(parse(broken, 1)).toMatchObject({ status: "ran", tests: [], fileError: "a_test.dart:3:8: Error: Not found: 'x.dart'" });
  });

  it("names a run whose browser never loaded the tests, and marks it worth one more try", () => {
    // Started, then waited on Chromium until it was stopped: no test finished, the file never loaded.
    const hung = [{ type: "start", pid: 1 }, { type: "suite", suite: { id: 0, platform: "chrome" } }, { type: "testStart", test: { id: 1, name: "loading test/tulpar_run/a_test.dart", url: null } }].map((e) => JSON.stringify(e)).join("\n");
    const r = parse(hung, null);
    expect(r).toEqual({ status: "failed", reason: "the test browser did not load the tests in time (flutter test was stopped)" });
    expect(stalled(r)).toBe(true);
    expect(stalled(parse("", null))).toBe(true);
    // A run that finished, even failing, is never run again.
    expect(stalled(parse(hung, 1))).toBe(false);
  });

  it("names the class a Dart file declares", () => {
    expect(widgetClass(".tulpar/generated/CheckoutCard/checkout_card.dart")).toBe("CheckoutCard");
  });
});

describe.skipIf(!sdk || !existsSync(join(example, "pubspec.yaml")))("Flutter adapter on Material 3", { timeout: 900_000 }, () => {
  it("builds, renders and measures the reference widget, and scans its code", async () => {
    const host = await AdapterHost.start(process.execPath, [main]);
    try {
      const config = { spacing: { file: "lib/spacing.dart", class: "Space", import: "package:tulpar_flutter_material/spacing.dart" } };
      const params = { root: example, config };
      const built = await host.call("build", { ...params, entry: "lib/impl/modal_actions.dart", frame: { width: 640, height: 64 } });
      expect(built.ok).toBe(true);
      const r = await host.call("render", { ...params, artifact: built.artifact!, entry: "lib/impl/modal_actions.dart", width: 640, height: 64, scale: 1 });
      expect(r.status).toBe("ok");
      if (r.status !== "ok") return;
      const byId = Object.fromEntries(r.elements.map((e) => [e.figmaId, e]));
      expect(byId["4122:87677"]).toMatchObject({ component: "OutlinedButton", text: "Button" });
      expect(byId["4122:86445"]).toMatchObject({ component: "FilledButton", text: "Button" });
      expect(byId["3906:50588"]!.box).toMatchObject({ x: 0, y: 0, width: 640, height: 64 });
      const a = await host.call("analyze", { ...params, entry: "lib/impl/modal_actions.dart" });
      expect(a.componentsUsed).toEqual(expect.arrayContaining(["OutlinedButton", "FilledButton"]));
      expect(a.literals.filter((f) => f.source === "literal")).toEqual([]);
      expect(a.literals.filter((f) => f.source === "token").map((f) => f.token)).toContain("colorScheme.inverseSurface");
      const tokens = await host.call("tokens", params);
      expect(tokens.tokens.find((t) => t.name === "colorScheme.primary")).toMatchObject({ codeRef: "Theme.of(context).colorScheme.primary", type: "color" });
      expect(tokens.tokens.find((t) => t.name === "Space.sm")).toMatchObject({ values: { default: { kind: "dimension", points: 8 } } });
    } finally {
      await host.stop();
    }
  });

  // flutter test --platform chrome does not connect back to its runner on Windows; it runs on Linux (CI, the image).
  it.skipIf(process.platform === "win32")("runs widget tests in headless Chromium, failures included", async () => {
    const dir = join(example, ".tulpar", "test-widget");
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    copyFileSync(join(example, "lib/impl/modal_actions.dart"), join(dir, "modal_actions.dart"));
    copyFileSync(resolve(import.meta.dirname, "fixtures/modal_actions_test.dart"), join(dir, "modal_actions_test.dart"));
    const host = await AdapterHost.start(process.execPath, [main]);
    try {
      const r = await host.call("test", { root: example, config: {}, entry: ".tulpar/test-widget/modal_actions_test.dart" });
      expect(r.status).toBe("ran");
      if (r.status !== "ran") return;
      expect(r.tests.map((t) => `${t.name} ${t.status}`)).toEqual(["shows both actions as Material buttons passed", "fails honestly failed"]);
      expect(existsSync(join(example, "test", "tulpar_run"))).toBe(false);
    } finally {
      await host.stop();
    }
  });
});

describe.skipIf(!sdk || !existsSync(join(example, "pubspec.yaml")))("dart format", { timeout: 300_000 }, () => {
  it("formats generated Dart and leaves other files and unparsable code alone", async () => {
    const host = await AdapterHost.start(process.execPath, [main]);
    try {
      const messy = "import 'package:flutter/material.dart';\nclass A extends StatelessWidget{const A({super.key});@override Widget build(BuildContext context){return const Text('a');}}\n";
      const broken = "class B { void f( { }\n";
      const r = await host.call("format", { root: example, config: {}, files: [{ path: "a.dart", content: messy }, { path: "notes.md", content: "x" }] });
      expect(r.files[0]!.content).toContain("class A extends StatelessWidget {\n  const A({super.key});");
      expect(r.files[1]!.content).toBe("x");
      const b = await host.call("format", { root: example, config: {}, files: [{ path: "b.dart", content: broken }] });
      expect(b.files[0]!.content).toBe(broken);
    } finally {
      await host.stop();
    }
  });
});
