// Every language and styling an adapter says it writes really works: for each combination, a small
// component written the way the conventions tell the model to write it builds, and its test runs and
// passes, through the real adapter. No model is called. A choice offered but broken fails here.

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { NAME_PLACEHOLDERS, fillName, outputName, type AdapterHost, type Conventions, type OutputChoice } from "@tulpar/core";
import { loadProject, startAdapter } from "../src/project.ts";

const repo = resolve(import.meta.dirname, "../..");
const NAME = "Matrix";

interface Files {
  [path: string]: string;
}

// Each framework's component, style and test, for one combination; paths come from the conventions.
const writers: Record<string, (c: Conventions, o: OutputChoice, path: (role: string) => string | undefined) => Files> = {
  react: (_c, o, path) => {
    const styling = o.styling ?? "css";
    const cssInJs = styling === "styled-components" || styling === "emotion";
    const style = path("styles");
    const head = cssInJs ? `import { Root } from "./${NAME}.styles";` : styling === "css-modules" ? `import styles from "./${NAME}.module.css";` : style ? `import "./${style}";` : "";
    const open = cssInJs ? `<Root data-figma-id="root">` : `<div data-figma-id="root" className=${styling === "tailwind" ? `"flex gap-[var(--cds-spacing-05,16px)]"` : styling === "css-modules" ? "{styles.root}" : `"matrix-root"`}>`;
    const close = cssInJs ? "</Root>" : "</div>";
    const files: Files = {
      [path("component")!]: `import { Button } from "@carbon/react";\n${head}\n\nexport default function ${NAME}() {\n  return (\n    ${open}\n      <Button kind="primary">Save</Button>\n    ${close}\n  );\n}\n`,
      [path("test")!]: `import { render, screen } from "@testing-library/react";\nimport { describe, it, expect } from "vitest";\nimport ${NAME} from "./${NAME}";\n\ndescribe("${NAME}", () => {\n  it("renders the action", () => {\n    render(<${NAME} />);\n    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();\n  });\n});\n`,
    };
    if (style) {
      files[style] = cssInJs
        ? `import styled from "${styling === "emotion" ? "@emotion/styled" : "styled-components"}";\n\nexport const Root = styled.div\`\n  display: flex;\n  gap: var(--cds-spacing-05, 16px);\n\`;\n`
        : styling === "css-modules"
          ? `.root {\n  display: flex;\n  gap: var(--cds-spacing-05, 16px);\n}\n`
          : styling === "scss" || styling === "less"
            ? `.matrix-root {\n  display: flex;\n  & > * {\n    gap: var(--cds-spacing-05, 16px);\n  }\n}\n`
            : `.matrix-root {\n  display: flex;\n  gap: var(--cds-spacing-05, 16px);\n}\n`;
    }
    return files;
  },
  vue: (_c, o, path) => {
    const styling = o.styling ?? "css";
    const ts = o.language !== "javascript";
    const cls = styling === "tailwind" ? `class="flex gap-[var(--el-spacing,16px)]"` : styling === "css-modules" ? `:class="$style.root"` : `class="matrix-root"`;
    const block =
      styling === "tailwind"
        ? ""
        : styling === "css-modules"
          ? `\n<style module>\n.root {\n  display: flex;\n  gap: var(--el-spacing, 16px);\n}\n</style>\n`
          : styling === "scss" || styling === "less"
            ? `\n<style scoped lang="${styling}">\n.matrix-root {\n  display: flex;\n  & > * {\n    margin: 0;\n  }\n}\n</style>\n`
            : `\n<style scoped>\n.matrix-root {\n  display: flex;\n}\n</style>\n`;
    return {
      [path("component")!]: `<script setup${ts ? ' lang="ts"' : ""}>\nimport { ElButton } from "element-plus";\n</script>\n\n<template>\n  <div data-figma-id="root" ${cls}>\n    <ElButton type="primary">Save</ElButton>\n  </div>\n</template>\n${block}`,
      [path("test")!]: `import { createApp } from "vue";\nimport { describe, it, expect } from "vitest";\nimport ${NAME} from "./${NAME}.vue";\n\ndescribe("${NAME}", () => {\n  it("renders the action", () => {\n    const el = document.createElement("div");\n    document.body.appendChild(el);\n    createApp(${NAME}).mount(el);\n    expect(el.querySelector("button")${ts ? "!" : ""}.textContent).toContain("Save");\n  });\n});\n`,
    };
  },
  svelte: (_c, o, path) => {
    const ts = o.language !== "javascript";
    const tailwind = o.styling === "tailwind";
    return {
      [path("component")!]: `<script${ts ? ' lang="ts"' : ""}>\n  import { Button } from "carbon-components-svelte";\n</script>\n\n<div data-figma-id="root" class="${tailwind ? "flex gap-[var(--cds-spacing-05,16px)]" : "matrix-root"}">\n  <Button kind="primary">Save</Button>\n</div>\n${tailwind ? "" : o.styling === "scss" || o.styling === "less" ? `\n<style lang="${o.styling}">\n  .matrix-root {\n    display: flex;\n    & > :global(*) {\n      margin: 0;\n    }\n  }\n</style>\n` : `\n<style>\n  .matrix-root {\n    display: flex;\n  }\n</style>\n`}`,
      [path("test")!]: `import { mount, flushSync } from "svelte";\nimport { describe, it, expect } from "vitest";\nimport ${NAME} from "./${NAME}.svelte";\n\ndescribe("${NAME}", () => {\n  it("renders the action", () => {\n    const el = document.createElement("div");\n    document.body.appendChild(el);\n    mount(${NAME}, { target: el });\n    flushSync();\n    expect(el.querySelector("button")${ts ? "!" : ""}.textContent).toContain("Save");\n  });\n});\n`,
    };
  },
  angular: (_c, o, path) => {
    const style = path("styles")!;
    const styling = o.styling ?? "less";
    return {
      [path("component")!]: `import { Component } from "@angular/core";\n\n@Component({\n  selector: "app-matrix",\n  standalone: true,\n  templateUrl: "./matrix.component.html",\n  styleUrl: "./${style}",\n})\nexport class ${NAME}Component {}\n`,
      [path("template")!]: `<div class="matrix-root" data-figma-id="root"><button type="button">Save</button></div>\n`,
      [style]: styling === "css" ? `.matrix-root {\n  display: flex;\n}\n` : `.matrix-root {\n  display: flex;\n  & > button {\n    margin: 0;\n  }\n}\n`,
      [path("test")!]: `import { TestBed } from "@angular/core/testing";\nimport { ${NAME}Component } from "./matrix.component";\n\ndescribe("${NAME}", () => {\n  it("renders the action", async () => {\n    await TestBed.configureTestingModule({ imports: [${NAME}Component] }).compileComponents();\n    const fixture = TestBed.createComponent(${NAME}Component);\n    fixture.detectChanges();\n    expect(fixture.nativeElement.querySelector("button").textContent).toContain("Save");\n  });\n});\n`,
    };
  },
  "web-components": (_c, _o, path) => ({
    [path("component")!]: `<script type="module">\n  import "@carbon/web-components/es/components/button/index.js";\n</script>\n<style>\n  .matrix-root {\n    display: flex;\n  }\n</style>\n<div class="matrix-root" data-figma-id="root">\n  <cds-button kind="primary">Save</cds-button>\n</div>\n`,
    [path("test")!]: `import { describe, it, expect } from "vitest";\nimport { mount } from "./${NAME}.html";\n\ndescribe("${NAME}", () => {\n  it("renders the action", async () => {\n    const host = mount();\n    await customElements.whenDefined("cds-button");\n    expect(host.querySelector("cds-button").textContent).toContain("Save");\n  });\n});\n`,
  }),
};

const projects = ["examples/carbon-react", "examples/element-plus", "examples/carbon-svelte", "examples/carbon-angular", "examples/carbon"];

for (const dir of projects) {
  const root = join(repo, dir);
  describe.skipIf(!existsSync(join(root, "node_modules/vitest")))(`every output ${dir} offers`, { timeout: 900_000 }, () => {
    it("builds, and its test passes, in each language and styling", async () => {
      const project = await loadProject(root);
      const host: AdapterHost = await startAdapter(project);
      const results: string[] = [];
      try {
        const outputs = host.manifest!.capabilities.outputs ?? [];
        for (const output of outputs.length ? outputs : [undefined]) {
          const params = { ...project.params, ...(output && { output }) };
          const c: Conventions = await host.call("conventions", params);
          const fill = (p: string) => p.replace(NAME_PLACEHOLDERS, (m) => fillName(m, NAME));
          const path = (role: string) => {
            const f = c.files.find((x) => x.role === role);
            return f && fill(f.path);
          };
          const files = writers[project.config.adapter]!(c, output ?? {}, path);
          // Exactly the files the conventions ask for: no more, no fewer.
          expect(Object.keys(files).sort()).toEqual(c.files.map((f) => fill(f.path)).sort());
          const work = join(".tulpar", "matrix", (output ? `${output.language}-${output.styling}` : "default"));
          rmSync(join(root, work), { recursive: true, force: true });
          mkdirSync(join(root, work), { recursive: true });
          for (const [p, content] of Object.entries(files)) writeFileSync(join(root, work, p), content);
          const label = output ? outputName(output) : "default";
          const built = await host.call("build", { ...params, entry: `${work}/${fill(c.entry)}`.replace(/\\/g, "/"), frame: { width: 400, height: 120 } });
          if (!built.ok) {
            results.push(`${label}: build failed: ${built.log.split("\n").slice(0, 3).join(" ")}`);
            continue;
          }
          const ran = await host.call("test", { ...params, entry: `${work}/${path("test")}`.replace(/\\/g, "/") });
          const passed = ran.status === "ran" && !ran.fileError && ran.tests.length > 0 && ran.tests.every((t) => t.status === "passed");
          results.push(`${label}: ${passed ? "ok" : `test ${ran.status === "ran" ? (ran.fileError ?? ran.tests.map((t) => `${t.status} ${t.error ?? ""}`).join("; ")) : ran.reason}`.slice(0, 300)}`);
        }
      } finally {
        await host.stop();
        rmSync(join(root, ".tulpar", "matrix"), { recursive: true, force: true });
      }
      expect(results.filter((r) => !r.endsWith(": ok"))).toEqual([]);
      expect(results.length).toBeGreaterThan(0);
    });
  });
}
