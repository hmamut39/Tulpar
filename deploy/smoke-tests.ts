// Image smoke test: generated tests really run here. For each framework, a small component and its spec
// (written the way the model is told to write them) go through the adapter's `test` method, in the
// image, as the server's user, in the sandboxed browser. No model is called. Run: node deploy/smoke-tests.ts
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { formatFiles } from "../cli/src/format.ts";
import { loadProject, withAdapter } from "../cli/src/project.ts";
import type { TestRunResult } from "@tulpar/core";

const repo = resolve(import.meta.dirname, "..");

const cases: { project: string; files: Record<string, string>; spec: string }[] = [
  {
    project: "examples/carbon",
    files: {
      "Smoke.html": `<script type="module">\n  import "@carbon/web-components/es/components/button/index.js";\n</script>\n<cds-button kind="primary" data-figma-id="1:1">Save</cds-button>\n`,
      "Smoke.test.js": `import { describe, it, expect } from "vitest";\nimport { mount } from "./Smoke.html";\ndescribe("Smoke", () => { it("shows the button", async () => { const host = mount(); await customElements.whenDefined("cds-button"); expect(host.querySelector("cds-button").textContent).toContain("Save"); }); });\n`,
    },
    spec: "Smoke.test.js",
  },
  {
    project: "examples/carbon-react",
    files: {
      "Smoke.tsx": `import { Button } from "@carbon/react";\nexport default function Smoke() { return <Button kind="primary">Save</Button>; }\n`,
      "Smoke.test.tsx": `import { render, screen } from "@testing-library/react";\nimport { describe, it, expect } from "vitest";\nimport Smoke from "./Smoke";\ndescribe("Smoke", () => { it("shows the button", () => { render(<Smoke />); expect(screen.getByRole("button", { name: "Save" })).toBeTruthy(); }); });\n`,
    },
    spec: "Smoke.test.tsx",
  },
  {
    project: "examples/element-plus",
    files: {
      "Smoke.vue": `<script setup lang="ts">\nimport { ElButton } from "element-plus";\n</script>\n<template><ElButton type="primary">Save</ElButton></template>\n`,
      "Smoke.test.ts": `import { createApp } from "vue";\nimport { describe, it, expect } from "vitest";\nimport Smoke from "./Smoke.vue";\ndescribe("Smoke", () => { it("shows the button", () => { const el = document.createElement("div"); document.body.appendChild(el); createApp(Smoke).mount(el); expect(el.querySelector("button")!.textContent).toContain("Save"); }); });\n`,
    },
    spec: "Smoke.test.ts",
  },
  {
    project: "examples/carbon-svelte",
    files: {
      "Smoke.svelte": `<script lang="ts">\n  import { Button } from "carbon-components-svelte";\n</script>\n<Button kind="primary">Save</Button>\n`,
      "Smoke.test.ts": `import { mount, flushSync } from "svelte";\nimport { describe, it, expect } from "vitest";\nimport Smoke from "./Smoke.svelte";\ndescribe("Smoke", () => { it("shows the button", () => { const el = document.createElement("div"); document.body.appendChild(el); mount(Smoke, { target: el }); flushSync(); expect(el.querySelector("button")!.textContent).toContain("Save"); }); });\n`,
    },
    spec: "Smoke.test.ts",
  },
  {
    project: "examples/carbon-angular",
    files: {
      "smoke.component.ts": `import { Component } from "@angular/core";\n@Component({ selector: "app-smoke", standalone: true, template: "<button type=\\"button\\">Save</button>" })\nexport class SmokeComponent {}\n`,
      "smoke.component.spec.ts": `import { TestBed } from "@angular/core/testing";\nimport { SmokeComponent } from "./smoke.component";\ndescribe("Smoke", () => { it("shows the button", async () => { await TestBed.configureTestingModule({ imports: [SmokeComponent] }).compileComponents(); const f = TestBed.createComponent(SmokeComponent); f.detectChanges(); expect(f.nativeElement.querySelector("button").textContent).toContain("Save"); }); });\n`,
    },
    spec: "smoke.component.spec.ts",
  },
  {
    project: "examples/flutter-material",
    files: {
      "smoke.dart": `import 'package:flutter/material.dart';

class Smoke extends StatelessWidget {
  const Smoke({super.key});

  @override
  Widget build(BuildContext context) => FilledButton(onPressed: () {}, child: const Text('Save'));
}
`,
      "smoke_test.dart": `import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'smoke.dart';

void main() {
  testWidgets('shows the button', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: Scaffold(body: Smoke())));
    expect(find.widgetWithText(FilledButton, 'Save'), findsOneWidget);
  });
}
`,
    },
    spec: "smoke_test.dart",
  },
];

let failed = 0;
for (const c of cases) {
  const project = await loadProject(join(repo, c.project));
  const dir = join(project.root, ".tulpar", "smoke");
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(c.files)) writeFileSync(join(dir, name), content);
  try {
    const r: TestRunResult = await withAdapter(project, (host) => host.call("test", { ...project.params, entry: `.tulpar/smoke/${c.spec}` }));
    const ok = r.status === "ran" && !r.fileError && r.tests.length > 0 && r.tests.every((t) => t.status === "passed");
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} ${project.config.adapter}: ${r.status === "ran" ? (r.fileError ?? r.tests.map((t) => `${t.name} ${t.status}${t.error ? ` (${t.error.split("\n")[0]})` : ""}`).join("; ")) : r.reason}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
// Blazor and Leptos have no generated tests yet: each must build and draw in the sandbox.
for (const c of [
  { name: "blazor", project: "examples/blazor-mud", file: "Smoke.razor", component: "MudButton", source: `<MudButton data-figma-id="b" Variant="Variant.Filled" Style="text-transform: none">Smoke shows the button</MudButton>\n` },
  { name: "leptos", project: "examples/leptos-thaw", file: "smoke.rs", component: "Button", source: `use leptos::prelude::*;\nuse thaw::*;\n\n#[component]\npub fn Smoke() -> impl IntoView {\n    view! { <Button attr:data-figma-id="b">"Smoke shows the button"</Button> }\n}\n` },
]) {
  const project = await loadProject(join(repo, c.project));
  const dir = join(project.root, ".tulpar", "smoke");
  const entry = `.tulpar/smoke/${c.file}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, c.file), c.source);
  try {
    const problem = await withAdapter(project, async (host) => {
      const built = await host.call("build", { ...project.params, entry, frame: { width: 300, height: 80 } });
      if (!built.ok) return built.log;
      const r = await host.call("render", { ...project.params, artifact: built.artifact as string, entry, width: 300, height: 80, scale: 1 });
      return r.status === "ok" && r.elements.some((e) => e.component === c.component && e.text === "Smoke shows the button") ? "" : r.status === "ok" ? "the button was not drawn" : r.reason;
    });
    if (problem) failed++;
    console.log(`${problem ? "FAIL" : "ok  "} ${c.name}: ${problem || `built and drew ${c.component}`}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
// Generated files are formatted in the image too (Prettier, and its Svelte plugin).
const formatted = await formatFiles(repo, [
  { path: "A.tsx", content: "export default function A(){return <b>Go</b>}" },
  { path: "A.svelte", content: "<script>let a=1</script>\n<b>{a}</b>" },
]);
const formatOk = formatted[0]!.content === "export default function A() {\n  return <b>Go</b>;\n}\n" && formatted[1]!.content.includes("  let a = 1;");
if (!formatOk) failed++;
console.log(`${formatOk ? "ok  " : "FAIL"} formatting: ${formatOk ? "TSX and Svelte formatted" : JSON.stringify(formatted.map((f) => f.content))}`);
process.exit(failed ? 1 : 0);
