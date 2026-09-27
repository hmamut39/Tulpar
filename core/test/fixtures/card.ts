// A small hand-written Figma subtree in the REST API shape: a card with a title,
// a tag instance and a button instance, laid out as a vertical stack.

import type { NodesResponseLike } from "./types.ts";

export const card: NodesResponseLike = {
  name: "Fixture",
  version: "1",
  lastModified: "2026-09-27T00:00:00Z",
  nodes: {
    "1:1": {
      components: {
        "10:1": { key: "tagkey", name: "Type=Blue, Size=Small", description: "", componentSetId: "10:0", remote: false },
        "20:1": { key: "btnkey", name: "Style=Primary", description: "", componentSetId: "20:0", remote: false },
      },
      componentSets: {
        "10:0": { key: "tagsetkey", name: "Tag", description: "", remote: false },
        "20:0": { key: "btnsetkey", name: "Button", description: "", remote: false },
      },
      styles: { "S:1": { key: "stylekey", name: "Heading/02", styleType: "TEXT", description: "", remote: false } },
      document: {
        id: "1:1",
        name: "Card",
        type: "FRAME",
        absoluteBoundingBox: { x: 100.5, y: -40.25, width: 320, height: 200 },
        absoluteRenderBounds: { x: 96.5, y: -40.25, width: 328, height: 208 },
        fills: [
          { type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 }, boundVariables: { color: { type: "VARIABLE_ALIAS", id: "VariableID:layer-01" } } },
          { type: "SOLID", visible: false, color: { r: 1, g: 0, b: 0, a: 1 } },
        ],
        effects: [{ type: "DROP_SHADOW", visible: true, radius: 4, color: { r: 0, g: 0, b: 0, a: 0.3 }, offset: { x: 0, y: 4 } }],
        cornerRadius: 4,
        layoutMode: "VERTICAL",
        itemSpacing: 16,
        paddingTop: 16,
        paddingRight: 16,
        paddingBottom: 16,
        paddingLeft: 16,
        primaryAxisAlignItems: "MIN",
        counterAxisAlignItems: "MIN",
        boundVariables: { itemSpacing: { type: "VARIABLE_ALIAS", id: "VariableID:spacing-05" } },
        children: [
          {
            id: "1:2",
            name: "Title",
            type: "TEXT",
            absoluteBoundingBox: { x: 116.5, y: -24.25, width: 288, height: 28 },
            characters: "Order summary",
            style: { fontFamily: "IBM Plex Sans", fontWeight: 400, fontSize: 20, lineHeightPx: 28, textAlignHorizontal: "LEFT", textAlignVertical: "TOP" },
            characterStyleOverrides: [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1],
            styleOverrideTable: { "1": { fontWeight: 600 } },
            styles: { text: "S:1" },
            fills: [{ type: "SOLID", color: { r: 0.09, g: 0.09, b: 0.09, a: 1 } }],
            layoutSizingHorizontal: "FILL",
            layoutSizingVertical: "HUG",
          },
          {
            id: "1:3",
            name: "Tag",
            type: "INSTANCE",
            componentId: "10:1",
            componentProperties: {
              Type: { type: "VARIANT", value: "Blue" },
              "Label#12:0": { type: "TEXT", value: "New" },
            },
            absoluteBoundingBox: { x: 116.5, y: 19.75, width: 48, height: 24 },
            layoutPositioning: "AUTO",
            children: [
              {
                id: "I1:3;5:1",
                name: "Label",
                type: "TEXT",
                absoluteBoundingBox: { x: 124.5, y: 23.75, width: 32, height: 16 },
                characters: "New",
                style: { fontSize: 12, lineHeightPx: 16 },
              },
            ],
          },
          {
            id: "1:4",
            name: "Button",
            type: "INSTANCE",
            componentId: "20:1",
            componentProperties: { "Show icon#3:1": { type: "BOOLEAN", value: false } },
            absoluteBoundingBox: { x: 116.5, y: 59.75, width: 120, height: 48 },
            children: [],
          },
          {
            id: "1:5",
            name: "Hidden note",
            type: "TEXT",
            visible: false,
            absoluteBoundingBox: null,
            characters: "",
            style: {},
          },
        ],
      },
    },
  },
};
