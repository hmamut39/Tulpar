// Mapping instances of a component the library links only by name: a kit's older copy of it.

import { describe, expect, it } from "vitest";
import type { DesignTree, Library } from "@tulpar/core";
import { mapByComponentKeys } from "../src/pipeline.ts";

const instance = (id: string, name: string, componentId: string, key: string) => ({ id, name, kind: "instance", visible: true, component: { id: componentId, key, name }, props: [], children: [] });
const design = (children: unknown[]) => ({ root: { id: "1:1", name: "Form", kind: "container", visible: true, children } }) as unknown as DesignTree;
const library = { components: [{ id: "17422:270657", key: "set-key", name: "Checkbox group", variants: [] }, { id: "1:5", key: "b1", name: "Button", variants: [] }, { id: "1:6", key: "b2", name: "Button", variants: [] }] } as unknown as Library;

describe("mapping by component name", () => {
  it("maps an older copy of a linked component by its exact base name", () => {
    const mapping = new Map([["17422:270657", "CheckboxGroup"]]);
    mapByComponentKeys(mapping, library, design([instance("2:1", "Checkbox group", "9:1", "old-key"), instance("2:2", "Checkbox group helper", "9:2", "k")]));
    expect(mapping.get("9:1")).toBe("CheckboxGroup");
    expect(mapping.has("9:2")).toBe(false);
  });

  it("never guesses between two components that share a name", () => {
    const mapping = new Map([["1:5", "Button"], ["1:6", "IconButton"]]);
    mapByComponentKeys(mapping, library, design([instance("2:3", "Button/Primary", "9:3", "other")]));
    expect(mapping.has("9:3")).toBe(false);
  });
});
