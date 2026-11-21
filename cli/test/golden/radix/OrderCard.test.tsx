import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import OrderCard from "./OrderCard";

describe("OrderCard", () => {
  it("shows the design's title and summary by default", () => {
    render(<OrderCard />);
    expect(screen.getByRole("heading", { name: "Order summary" })).toBeTruthy();
    expect(screen.getByText("Two items, ready to ship.")).toBeTruthy();
  });

  it("shows the order it is given", () => {
    render(<OrderCard title="Your order" summary="Three items, on their way." />);
    expect(screen.getByRole("heading", { name: "Your order" })).toBeTruthy();
    expect(screen.getByText("Three items, on their way.")).toBeTruthy();
  });
});
