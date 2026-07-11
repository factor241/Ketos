import { render, screen } from "@testing-library/react";
import { CanvasReadOnlyProvider } from "@/contexts/canvas-read-only-context";
import OutputComponent from "../index";

jest.mock("@/stores/flowStore", () => ({
  __esModule: true,
  default: (selector: (state: { nodes: unknown[] }) => unknown) =>
    selector({ nodes: [] }),
}));

jest.mock("@/components/common/genericIconComponent", () => ({
  ForwardedIconComponent: () => null,
}));

jest.mock("@/components/common/shadTooltipComponent", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    unstyled: _unstyled,
    ...props
  }: React.ComponentProps<"button"> & { unstyled?: boolean }) => (
    <button {...props}>{children}</button>
  ),
}));

jest.mock("@/components/ui/command", () => ({
  Command: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  CommandGroup: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  CommandItem: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  CommandList: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContentWithoutPortal: ({
    children,
  }: {
    children: React.ReactNode;
  }) => <>{children}</>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

describe("OutputComponent canvas read-only contract", () => {
  it("renders a multi-output selector as static text", () => {
    const handleSelectOutput = jest.fn();

    render(
      <CanvasReadOnlyProvider readOnly>
        <OutputComponent
          selected="Message"
          types={["Message"]}
          nodeId="node-1"
          outputs={[
            { name: "message", display_name: "Message", types: ["Message"] },
            { name: "data", display_name: "Data", types: ["Data"] },
          ]}
          idx={0}
          name="Message"
          handleSelectOutput={handleSelectOutput}
          outputName="output"
        />
      </CanvasReadOnlyProvider>,
    );

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByText("Message")).toBeInTheDocument();
    expect(handleSelectOutput).not.toHaveBeenCalled();
  });
});
