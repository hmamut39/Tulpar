// Generated files come out formatted, in the project's own style when it has one.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatFiles } from "../src/format.ts";

const fresh = () => mkdtempSync(join(tmpdir(), "tulpar-format-"));
const one = async (dir: string, path: string, content: string) => (await formatFiles(dir, [{ path, content }]))[0]!.content;

describe("formatting generated files", () => {
  it("formats every kind of file Tulpar writes", async () => {
    const dir = fresh();
    expect(await one(dir, "A.tsx", `import {Button} from '@carbon/react'\nexport default function A(){return <Button kind='primary'   size="md">Go</Button>}`)).toBe(
      `import { Button } from "@carbon/react";\nexport default function A() {\n  return (\n    <Button kind="primary" size="md">\n      Go\n    </Button>\n  );\n}\n`,
    );
    expect(await one(dir, "a.css", `.a{gap:var(--x,8px);padding:0}`)).toBe(`.a {\n  gap: var(--x, 8px);\n  padding: 0;\n}\n`);
    expect(await one(dir, "a.scss", `.a{.b{gap:0}}`)).toBe(`.a {\n  .b {\n    gap: 0;\n  }\n}\n`);
    expect(await one(dir, "a.less", `.a{.b{gap:0}}`)).toBe(`.a {\n  .b {\n    gap: 0;\n  }\n}\n`);
    expect(await one(dir, "A.vue", `<script setup lang="ts">\nimport {ElButton} from 'element-plus'\n</script>\n<template><ElButton type="primary">Go</ElButton></template>`)).toBe(
      `<script setup lang="ts">\nimport { ElButton } from "element-plus";\n</script>\n<template><ElButton type="primary">Go</ElButton></template>\n`,
    );
    expect(await one(dir, "A.svelte", `<script lang="ts">\nimport {Button} from 'carbon-components-svelte'\n</script>\n<Button kind="primary">Go</Button>\n<style>.a{gap:0}</style>`)).toBe(
      `<script lang="ts">\n  import { Button } from "carbon-components-svelte";\n</script>\n\n<Button kind="primary">Go</Button>\n\n<style>\n  .a {\n    gap: 0;\n  }\n</style>\n`,
    );
    expect(await one(dir, "A.html", `<script type="module">import '@carbon/web-components/es/components/button/index.js'</script>\n<cds-button kind="primary">Go</cds-button>`)).toBe(
      `<script type="module">\n  import "@carbon/web-components/es/components/button/index.js";\n</script>\n<cds-button kind="primary">Go</cds-button>\n`,
    );
  });

  it("follows the project's own Prettier configuration", async () => {
    const dir = fresh();
    writeFileSync(join(dir, ".prettierrc"), JSON.stringify({ singleQuote: true, semi: false, tabWidth: 4 }));
    mkdirSync(join(dir, "gen"));
    expect(await one(join(dir, "gen"), "a.ts", `import {x} from "y";\nif (x) {\nx()\n}`)).toBe(`import { x } from 'y'\nif (x) {\n    x()\n}\n`);
  });

  it("leaves code it cannot parse as written, for the build to report", async () => {
    const broken = `export default function A( { return <div> }`;
    expect(await one(fresh(), "A.tsx", broken)).toBe(broken);
  });
});
