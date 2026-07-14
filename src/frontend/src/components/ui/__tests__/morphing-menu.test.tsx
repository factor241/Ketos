import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MorphingMenu } from "../morphing-menu";

jest.mock("@/components/common/genericIconComponent", () => ({
  __esModule: true,
  default: ({ name }: { name: string }) => <span>{name}</span>,
}));

describe("MorphingMenu", () => {
  it("exposes expanded state and closes on Escape while restoring focus", async () => {
    const user = userEvent.setup();
    render(
      <MorphingMenu
        trigger="Import from"
        items={[{ label: "Google Drive" }]}
      />,
    );

    const trigger = screen.getByRole("button", { name: /import from/i });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menu")).toBeVisible();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("closes when focus moves outside", async () => {
    const user = userEvent.setup();
    render(
      <>
        <MorphingMenu
          trigger="Import from"
          items={[{ label: "Google Drive" }]}
        />
        <button type="button">Outside</button>
      </>,
    );

    await user.click(screen.getByRole("button", { name: /import from/i }));
    fireEvent.pointerDown(document.body);

    await waitFor(() =>
      expect(screen.queryByRole("menu")).not.toBeInTheDocument(),
    );
  });
});
