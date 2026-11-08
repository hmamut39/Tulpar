// The outline names a container's stroke and where it sits: Figma's inside stroke does not add to the box, a CSS border does.
import { describe, expect, it } from "vitest";
import { strokeNote } from "../src/generate/brief.ts";
import type { DesignNode } from "../src/model.ts";

const card = (stroke?: unknown) => ({ kind: "container", stroke } as unknown as DesignNode);
const solid = { kind: "solid", color: { r: 0.9, g: 0.9, b: 0.9, a: 1 }, opacity: 1 };

describe("a container's stroke in the outline", () => {
  it("says its width, that it sits inside, and its colour", () => {
    expect(strokeNote(card({ paints: [solid], weight: 2, align: "inside" }))).toBe(" stroke=2px inside #e6e6e6");
  });

  it("gives each side when they differ, and nothing without a visible stroke", () => {
    expect(strokeNote(card({ paints: [solid], weight: { top: 0, right: 0, bottom: 1, left: 0 }, align: "center" }))).toBe(" stroke=0/0/1/0px center #e6e6e6");
    expect(strokeNote(card(undefined))).toBe("");
    expect(strokeNote(card({ paints: [], weight: 1, align: "inside" }))).toBe("");
  });
});
