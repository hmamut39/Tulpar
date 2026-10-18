// The Flutter adapter: widgets read with the Dart analyzer, the render measured through semantics,
// and every value in the code checked. The end-to-end parts need the Flutter SDK and skip without it.

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AdapterHost } from "@tulpar/core";
import { toComponent } from "../src/components.ts";
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
});
