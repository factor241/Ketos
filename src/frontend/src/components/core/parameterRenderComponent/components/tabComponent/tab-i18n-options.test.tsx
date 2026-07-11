import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TabComponent from "./index";

describe("TabComponent localized option labels", () => {
  it("renders localized labels but submits the stable raw value", async () => {
    const user = userEvent.setup();
    const handleOnNewValue = jest.fn();
    render(
      <TabComponent
        id="mode"
        value="fast"
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

    expect(screen.getByText("Быстро")).toBeInTheDocument();
    await user.click(screen.getByText("Точно"));
    expect(handleOnNewValue).toHaveBeenCalledWith({ value: "accurate" }, {});
  });

  it("never truncates a long machine value when rendering its label", async () => {
    const user = userEvent.setup();
    const rawValue = "stable-machine-value-longer-than-twenty-characters";
    const handleOnNewValue = jest.fn();
    render(
      <TabComponent
        id="mode"
        value=""
        editNode={false}
        disabled={false}
        handleOnNewValue={handleOnNewValue}
        options={[rawValue]}
        optionsMetaData={[{ value: rawValue, label: "Стабильный режим" }]}
      />,
    );

    await user.click(screen.getByText("Стабильный режим"));
    expect(handleOnNewValue).toHaveBeenCalledWith({ value: rawValue }, {});
  });
});
