import { render, screen, waitFor } from "@testing-library/react";
import SortableListComponent from "./index";

// Mock ListSelectionComponent to avoid its complexity
jest.mock("@/CustomNodes/GenericNode/components/ListSelectionComponent", () => {
  return function MockListSelectionComponent(props) {
    return (
      <div data-testid="list-selection-component">ListSelectionComponent</div>
    );
  };
});

// Mock genericIconComponent
jest.mock("@/components/common/genericIconComponent", () => {
  return function MockIcon(props) {
    return <div data-testid={`icon-${props.name}`}>Icon</div>;
  };
});

// Mock ui components
jest.mock("@/components/ui/button", () => ({
  Button: (props) => <button {...props}>{props.children}</button>,
}));

describe("SortableListComponent reproduction", () => {
  it("should not trigger handleOnNewValue on initial render", async () => {
    const handleOnNewValue = jest.fn();
    const props = {
      tooltip: "",
      name: "test-list",
      value: [{ name: "item1" }, { name: "item2" }],
      handleOnNewValue: handleOnNewValue,
      disabled: false,
      editNode: false,
      recommended: false,
      placeholder: "Select items",
      isList: true,
      fileTypes: [],
      onDelete: jest.fn(),
      id: "test-id",
      limit: 10,
    };

    render(<SortableListComponent {...props} />);

    // Wait a tick to ensure effects run
    await waitFor(() => {}, { timeout: 0 });

    if (handleOnNewValue.mock.calls.length > 0) {
    }

    expect(handleOnNewValue).not.toHaveBeenCalled();
  });

  it("renders localized object labels without changing selected raw objects", () => {
    const handleOnNewValue = jest.fn();
    const selected = { id: "provider-1", name: "OpenAI", link: "stable" };

    render(
      <SortableListComponent
        id="providers"
        value={[selected]}
        options={[selected]}
        optionsMetaData={[{ label: "OpenAI — провайдер" }]}
        placeholder="Select items"
        handleOnNewValue={handleOnNewValue}
        disabled={false}
        editNode={false}
        limit={10}
      />,
    );

    expect(screen.getByText("OpenAI — провайдер")).toBeInTheDocument();
    expect(selected).toEqual({
      id: "provider-1",
      name: "OpenAI",
      link: "stable",
    });
    expect(handleOnNewValue).not.toHaveBeenCalled();
  });
});
