import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ProjectCreateMenu } from "../project-create-menu";

describe("ProjectCreateMenu", () => {
  it("scopes both actions and prevents row activation", async () => {
    const user = userEvent.setup();
    const onRowClick = jest.fn();
    const onCreateBoard = jest.fn();
    const onCreateAutomation = jest.fn();
    render(
      <div
        role="button"
        tabIndex={0}
        onClick={onRowClick}
        onKeyDown={() => undefined}
      >
        <ProjectCreateMenu
          project={{ id: "project-1", name: "Research" }}
          onCreateBoard={onCreateBoard}
          onCreateAutomation={onCreateAutomation}
        />
      </div>,
    );

    const trigger = screen.getByTestId("project-create-menu-trigger-project-1");
    expect(trigger).toHaveAccessibleName("Create in Research");
    await user.click(trigger);
    expect(onRowClick).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("project-create-board-item-project-1"));
    expect(onCreateBoard).toHaveBeenCalledWith("project-1", trigger);
    expect(onRowClick).not.toHaveBeenCalled();

    trigger.focus();
    await user.keyboard("{Enter}");
    expect(
      screen.getByTestId("project-create-automation-item-project-1"),
    ).toBeVisible();
    expect(onRowClick).not.toHaveBeenCalled();
  });
});
