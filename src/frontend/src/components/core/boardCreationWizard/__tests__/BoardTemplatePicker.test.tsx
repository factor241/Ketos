import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { BoardTemplateGallery } from "../BoardTemplateGallery";

describe("BoardTemplateGallery", () => {
  it("renders loading, error Retry, and a selectable template", async () => {
    const retry = jest.fn();
    const { rerender } = render(
      <BoardTemplateGallery
        templates={[]}
        isLoading
        isError={false}
        onRetry={retry}
        onSelect={jest.fn()}
        onBack={jest.fn()}
      />,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();

    rerender(
      <BoardTemplateGallery
        templates={[]}
        isLoading={false}
        isError
        onRetry={retry}
        onSelect={jest.fn()}
        onBack={jest.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(retry).toHaveBeenCalledTimes(1);

    const onSelect = jest.fn();
    rerender(
      <BoardTemplateGallery
        templates={[
          {
            id: "template-1",
            name: "Support agent",
            description: "Answers support questions",
            data: { nodes: [], edges: [] },
          } as never,
        ]}
        isLoading={false}
        isError={false}
        onRetry={retry}
        onSelect={onSelect}
        onBack={jest.fn()}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /support agent/i }),
    );
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "template-1" }),
    );
  });
});
