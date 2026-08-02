import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MultiselectComponent from "./index";

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = jest.fn();
});

describe("MultiselectComponent localized option labels", () => {
  it("renders labels but keeps raw values in selection updates", async () => {
    const user = userEvent.setup();
    const handleOnNewValue = jest.fn();
    render(
      <MultiselectComponent
        id="mode"
        value={["accurate"]}
        editNode={false}
        disabled={false}
        handleOnNewValue={handleOnNewValue}
        options={["fast", "accurate"]}
        optionsMetaData={[
          { value: "fast", label: "Быстро" },
          { value: "accurate", label: "Точно" },
        ]}
      />,
    );

    expect(screen.getByTestId("value-dropdown-mode")).toHaveTextContent(
      "Точно",
    );
    await user.click(screen.getByRole("combobox"));
    expect(await screen.findByText("Быстро")).toBeInTheDocument();
    await user.click(screen.getByText("Быстро"));
    expect(handleOnNewValue).toHaveBeenCalledWith({
      value: ["accurate", "fast"],
    });
  });
});
