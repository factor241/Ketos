import { render, screen } from "@testing-library/react";
import ListItem from "./ListItem";

describe("ListItem option presentation", () => {
  it("renders a localized presentation label without changing the raw item", () => {
    const item = { id: "provider-1", name: "OpenAI", link: "stable" };
    render(
      <ListItem
        item={item}
        label="OpenAI — провайдер"
        isSelected={false}
        onClick={jest.fn()}
        onMouseEnter={jest.fn()}
        onMouseLeave={jest.fn()}
        isFocused={false}
        isKeyboardNavActive={false}
        dataTestId="provider-option"
      />,
    );

    expect(screen.getByText("OpenAI — провайдер")).toBeInTheDocument();
    expect(item).toEqual({
      id: "provider-1",
      name: "OpenAI",
      link: "stable",
    });
  });
});
