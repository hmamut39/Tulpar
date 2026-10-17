import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeReact } from "../src/verify/analyze.ts";

describe("CSS-in-JS static scan", () => {
  it("finds hard-coded values in styled-components and Emotion, in the component and its styles file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tulpar-cssinjs-"));
    await writeFile(
      join(dir, "Card.styles.ts"),
      [
        'import styled, { css } from "styled-components";',
        'import { Button } from "@acme/ui";',
        "export const Root = styled.div`",
        "  display: grid;",
        "  gap: var(--cds-spacing-05, 16px);",
        "  padding: 24px;",
        "  color: ${(p) => (p.$muted ? \"gray\" : \"black\")};",
        "`;",
        "export const Action = styled(Button)`margin-top: 12px;`;",
        "export const ring = css`outline: 2px solid #ff00ff;`;",
        "export const Box = styled.section({ display: \"flex\", rowGap: 8, \"&:hover\": { background: \"#e0e0e0\" } });",
      ].join("\n"),
    );
    await writeFile(join(dir, "Card.tsx"), 'import { Root, Action } from "./Card.styles";\nexport default function Card() { return <Root><Action>Go</Action></Root>; }\n');
    const a = analyzeReact(dir, "Card.tsx", "cds");
    expect(a.literals.map((l) => `${l.property} ${l.written} ${l.at}`)).toEqual([
      "padding 24px Card.styles.ts:6",
      "margin 12px Card.styles.ts:9",
      "strokeColor 2px solid #ff00ff Card.styles.ts:10",
      "gap 8px Card.styles.ts:11",
      "fill #e0e0e0 Card.styles.ts:11",
    ]);
  });
});
