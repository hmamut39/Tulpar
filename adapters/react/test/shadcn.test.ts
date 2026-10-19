// shadcn/ui: components kept in the project's source, imported by its "@/" alias, and Tailwind compiled
// with the project's own theme (src/index.css) as the design system.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { indexSources, projectAliases } from "../src/components.ts";
import { build } from "../src/verify/build.ts";

const root = resolve(__dirname, "../../../examples/shadcn");

describe.skipIf(!existsSync(join(root, "node_modules", "radix-ui")))("shadcn/ui", () => {
  it("indexes the components in src/components/ui, imported as the project writes them", () => {
    const gaps: string[] = [];
    const { components } = indexSources(root, "src/components/ui", "@/components/ui/{file}", gaps);
    const button = components.find((c) => c.name === "Button")!;
    expect(button.module).toBe("@/components/ui/button");
    expect(button.props.find((p) => p.name === "variant")?.type).toMatchObject({ kind: "enum" });
    expect(components.find((c) => c.name === "CardTitle")?.module).toBe("@/components/ui/card");
  });

  it("reads the tsconfig paths as aliases", () => {
    expect(projectAliases(root)).toEqual({ "@": join(root, "src") });
  });

  it("builds with the project's theme: the design system's sheet, and the code's own utilities", async () => {
    const dir = join(root, ".tulpar", "test-build");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "Probe.tsx"),
      `import { Button } from "@/components/ui/button";\nexport default function Probe() { return <div className="flex gap-4 bg-card p-6"><Button>Save</Button></div>; }\n`,
    );
    const built = await build({ root, config: {}, entry: ".tulpar/test-build/Probe.tsx", frame: { width: 320, height: 120 } }, {}, [], "", { sources: [{ dir: "src/components/ui" }], tailwind: { css: "src/index.css" } });
    expect(built.ok, built.log).toBe(true);
    const page = readFileSync(built.artifact as string, "utf8");
    expect(page).toMatch(/design-system\.css/);
    expect(page).toMatch(/\.bg-card \{\s*background-color: var\(--card\);/);
    // The project's components' own classes are in the design system's sheet, not the code's.
    expect(page).not.toMatch(/\.bg-primary \{/);
    const sheet = readFileSync(join(root, ".tulpar", "build", "Probe", "design-system.css"), "utf8");
    expect(sheet).toMatch(/\.bg-primary \{/);
    expect(sheet).toMatch(/url\("file:\/\/\/.*geist.*\.woff2"\)/);
    expect(readFileSync(join(root, ".tulpar", "build", "Probe", "bundle.js"), "utf8")).toMatch(/__tulparDesignSystem/);
  });
});
