import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import ProductCard from "./ProductCard";

describe("ProductCard", () => {
  it("renders", () => {
    render(<ProductCard />);
    expect(screen.getByText("Heirloom tomato")).toBeTruthy();
  });
});
