import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import OrderCard from "./OrderCard";

describe("OrderCard", () => {
  it("shows the title and the summary", () => {
    render(<OrderCard />);
    expect(screen.getByRole("heading", { name: "Order summary" })).toBeTruthy();
    expect(screen.getByText("Two items, ready to ship.")).toBeTruthy();
  });
});
