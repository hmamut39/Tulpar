import { describe, expect, it } from "vitest";
import { themingProperties } from "../src/index.ts";

describe("theming CSS variables", () => {
  it("are the component's own custom properties, on its class and modifiers, colours first", () => {
    const css = ".el-button{--el-button-font-weight:500;--el-button-bg-color:#fff}.el-button--primary{--el-button-hover-bg-color:red}.el-button-group{--el-button-group-gap:0}.el-card{--el-card-bg-color:#fff}.x .el-button{--el-button-nested:1}";
    expect(themingProperties(css, "el-button")).toEqual(["--el-button-bg-color", "--el-button-hover-bg-color", "--el-button-font-weight"]);
  });
});
