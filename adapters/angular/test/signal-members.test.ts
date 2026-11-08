// Signal inputs and outputs, given the decorators Angular's own JIT transform would add, so setInput() reaches them.
import { describe, expect, it } from "vitest";
// @ts-expect-error a plain JavaScript module, without types
import { signalMembers } from "../src/verify/vitest-plugin.mjs";

describe("signal members in JIT", () => {
  it("decorates input(), input.required(), model() and output(), and leaves other fields alone", () => {
    const out: string = signalMembers(`export class Card {
  readonly image = input("a.jpg");
  readonly name = input.required<string>();
  checked = model(false);
  readonly saved = output<void>();
  readonly count = signal(0);
}`);
    expect(out).toContain('import { Input as __TulparInput, Output as __TulparOutput } from "@angular/core";');
    expect(out).toContain('@__TulparInput({ isSignal: true, alias: "image", required: false, transform: undefined }) readonly image = input(');
    expect(out).toContain('@__TulparInput({ isSignal: true, alias: "name", required: true, transform: undefined }) readonly name = input.required<');
    expect(out).toContain('@__TulparOutput("checkedChange") checked = model(');
    expect(out).toContain('@__TulparOutput("saved") readonly saved = output<');
    expect(out).toContain("  readonly count = signal(0);");
  });

  it("changes nothing in a file without them", () => {
    const plain = "export class A { x = 1; }";
    expect(signalMembers(plain)).toBe(plain);
  });
});
