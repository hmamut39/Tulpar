import { describe, expect, it } from "vitest";
import { mount } from "./OrderCard.html";

describe("OrderCard", () => {
  it("shows the title and the summary", async () => {
    document.body.replaceChildren();
    await mount();
    expect(document.body.querySelector("h2")?.textContent).toBe("Order summary");
    expect(document.body.querySelector("p")?.textContent).toBe("Two items, ready to ship.");
  });
});
