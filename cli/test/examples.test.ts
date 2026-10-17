// Repository retrieval: the team's own uses of design-system components, as written.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { codebaseExamples, openingTag } from "../src/examples.ts";

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "tulpar-examples-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

describe("how the codebase uses its components", () => {
  it("reads whole opening tags: props over several lines, braces and quoted '>'", () => {
    const text = 'return <Button\n  kind="primary"\n  onClick={() => (a > b ? go() : stop())}\n  label="a > b"\n>Save</Button>;';
    expect(openingTag(text, "Button")).toBe('<Button kind="primary" onClick={() => (a > b ? go() : stop())} label="a > b" >');
    expect(openingTag("<ButtonGroup />", "Button")).toBeUndefined();
  });

  it("takes one use per file, up to the limit, and never from dependencies or generated code", () => {
    const root = project({
      "src/Checkout.tsx": '<Button kind="primary" size="md">Pay</Button>\n<Button kind="ghost">Back</Button>',
      "src/Settings.tsx": '<Button kind="secondary" size="md">Save</Button>',
      "src/Other.tsx": '<Button kind="tertiary">x</Button>',
      "node_modules/lib/Button.tsx": '<Button internal />',
      ".tulpar/generated/Card/Card.tsx": '<Button generated />',
      "src/Card.test.tsx": '<Button inTest />',
      "src/app.component.html": '<cds-button kind="primary">Go</cds-button>',
    });
    const found = codebaseExamples(root, ["Button", "cds-button", "Modal"]);
    expect(found.Button).toHaveLength(2);
    expect(new Set(found.Button!.map((e) => e.file)).size).toBe(2);
    expect(found.Button!.every((e) => !/internal|generated|inTest/.test(e.code))).toBe(true);
    expect(found["cds-button"]).toEqual([{ file: "src/app.component.html", code: '<cds-button kind="primary">' }]);
    expect(found.Modal).toBeUndefined();
  });
});
