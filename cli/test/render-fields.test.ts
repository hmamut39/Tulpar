// A form field is measured as the field the design draws (its label and its input), even when the component hands
// the Figma id to the <input>: Carbon's TextInput and Checkbox pass extra props to the input, not the field. Measured
// as the bare input, a text field lost its label (40 px tall, not 62, and no "Email") and a checkbox was a hidden 1 px
// box, in the live check of a sign-in card on 2026-11-26.

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { orderCard } from "../src/order-card.ts";
import { loadContext, verifyEntry } from "../src/pipeline.ts";
import { loadProject, withAdapter } from "../src/project.ts";

const repo = resolve(import.meta.dirname, "../..");
const root = join(repo, "examples/carbon-react");
const installed = existsSync(join(root, "node_modules/@carbon/react"));
const dir = join(root, ".tulpar", "fields-test");

const code = `import { Checkbox, TextInput } from "@carbon/react";

export default function Fields() {
  return (
    <section data-figma-id="900:1" style={{ padding: "var(--cds-spacing-05)" }}>
      <TextInput data-figma-id="f1" id="email" labelText="Email" placeholder="name@company.com" />
      <Checkbox data-figma-id="f2" id="remember" labelText="Remember me" />
    </section>
  );
}
`;

describe.skipIf(!installed)("form fields that hand the Figma id to their input", { timeout: 240_000 }, () => {
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("are measured as the whole field: label and input, a checkbox's square and label", async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "Fields.tsx"), code);
    const project = await loadProject(root);
    const elements = await withAdapter(project, async (host) => {
      const ctx = await loadContext(host, project, { frame: "900:1", node: orderCard({ font: "IBM Plex Sans", title: [20, 28], body: [14, 20], padding: 16, gap: 8 }) }, join(repo, "out"), join(repo, ".cache/figma"));
      return (await verifyEntry(host, project, ctx, ".tulpar/fields-test/Fields.tsx")).elements ?? [];
    });
    const email = elements.find((e) => e.figmaId === "f1")!;
    const remember = elements.find((e) => e.figmaId === "f2")!;
    // The label sits above the 40 px input: the field is taller than the input alone, and reads as both.
    expect(email.box.height).toBeGreaterThan(55);
    expect(email.text).toBe("Email name@company.com");
    expect(remember.visible).toBe(true);
    expect(remember.text).toBe("Remember me");
    expect(remember.drawnBox!.height).toBeGreaterThanOrEqual(16);
    expect(remember.drawnBox!.width).toBeGreaterThan(60);
  });
});
