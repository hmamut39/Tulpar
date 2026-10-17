// Generated specs for Web Components run in Vitest browser mode: Name.html imports as a module with mount().

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AdapterHost, type TestRunResult } from "@tulpar/core";

const main = resolve(import.meta.dirname, "../src/main.ts");
const example = resolve(import.meta.dirname, "../../../examples/carbon");
const ready = existsSync(join(example, "node_modules/@carbon/web-components")) && existsSync(join(example, "node_modules/@vitest/browser-playwright"));

describe.skipIf(!ready)("web-components adapter runs specs", { timeout: 180_000 }, () => {
  it("mounts the HTML file and runs its tests in the browser, failures included", async () => {
    const dir = join(example, ".tulpar", "test-wc");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "Footer.html"),
      `<script type="module">\n  import "@carbon/web-components/es/components/modal/index.js";\n</script>\n<style>.wrap { display: block; }</style>\n<cds-modal-footer class="wrap" data-figma-id="1:1">\n  <cds-modal-footer-button kind="secondary" data-figma-id="1:2">Cancel</cds-modal-footer-button>\n  <cds-modal-footer-button kind="primary" data-figma-id="1:3">Save</cds-modal-footer-button>\n</cds-modal-footer>\n`,
    );
    writeFileSync(
      join(dir, "Footer.test.js"),
      `import { describe, it, expect } from "vitest";\nimport { mount } from "./Footer.html";\n\ndescribe("Footer", () => {\n  it("shows both actions as Carbon buttons", async () => {\n    const host = mount();\n    await customElements.whenDefined("cds-modal-footer-button");\n    const buttons = host.querySelectorAll("cds-modal-footer-button");\n    expect([...buttons].map((b) => b.textContent.trim())).toEqual(["Cancel", "Save"]);\n    expect(buttons[1].shadowRoot).not.toBeNull();\n    expect(host.querySelector("style").textContent).toContain(".wrap");\n  });\n  it("fails honestly", () => {\n    expect(mount().textContent).toContain("Delete");\n  });\n});\n`,
    );
    const host = await AdapterHost.start(process.execPath, [main]);
    try {
      expect(host.manifest?.capabilities.tests).toBe(true);
      const r: TestRunResult = await host.call("test", { root: example, config: {}, entry: ".tulpar/test-wc/Footer.test.js" });
      expect(r.status).toBe("ran");
      if (r.status !== "ran") return;
      expect(r.tests.map((t) => `${t.name} ${t.status}`)).toEqual(["Footer shows both actions as Carbon buttons passed", "Footer fails honestly failed"]);
    } finally {
      await host.stop();
    }
  });
});
