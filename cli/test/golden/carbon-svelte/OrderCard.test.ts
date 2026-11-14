import { flushSync, mount } from "svelte";
import { describe, expect, it } from "vitest";
import OrderCard from "./OrderCard.svelte";

describe("OrderCard", () => {
  it("shows the title and the summary", () => {
    const target = document.createElement("div");
    document.body.appendChild(target);
    mount(OrderCard, { target });
    flushSync();
    expect(target.querySelector("h2")?.textContent?.trim()).toBe("Order summary");
    expect(target.querySelector("p")?.textContent?.trim()).toBe("Two items, ready to ship.");
  });
});
