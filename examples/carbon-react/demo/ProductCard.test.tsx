import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import ProductCard from "./ProductCard";

describe("ProductCard", () => {
  it("renders the design content without props", () => {
    render(<ProductCard />);

    expect(screen.getByRole("article")).toBeTruthy();
    expect(
      screen.getByRole("heading", { level: 2, name: "Heirloom tomato" }),
    ).toBeTruthy();
    expect(screen.getByText("$5.99 / lb")).toBeTruthy();
    expect(screen.getByText("Grown in San Juan Capistrano, CA")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Heirloom tomato" })).toBeTruthy();
  });

  it("renders supplied product details and image instead of the defaults", () => {
    render(
      <ProductCard
        productName="Cherry tomatoes"
        price="$4.25 / basket"
        originDescription="Grown in Davis, CA"
        imageSrc="/images/cherry-tomatoes.jpg"
        imageAlt="A basket of cherry tomatoes"
      />,
    );

    expect(
      screen.getByRole("heading", { level: 2, name: "Cherry tomatoes" }),
    ).toBeTruthy();
    expect(screen.getByText("$4.25 / basket")).toBeTruthy();
    expect(screen.getByText("Grown in Davis, CA")).toBeTruthy();
    expect(
      screen
        .getByRole("img", { name: "A basket of cherry tomatoes" })
        .getAttribute("src"),
    ).toBe("/images/cherry-tomatoes.jpg");
    expect(screen.queryByText("Heirloom tomato")).toBeNull();
    expect(screen.queryByText("$5.99 / lb")).toBeNull();
    expect(screen.queryByText("Grown in San Juan Capistrano, CA")).toBeNull();
  });
});
