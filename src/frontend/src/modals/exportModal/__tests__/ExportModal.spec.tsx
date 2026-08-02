import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { FlowType } from "@/types/flow";

type Selector<TState> = (state: TState) => unknown;

const downloadFlowMock = jest.fn();
const removeApiKeysMock = jest.fn((flow: unknown) => flow);
let currentFlowMock: FlowType | undefined;

// IMPORTANT: ExportModal imports reactflowUtils via a relative path.
// Mock the same underlying module file so the component uses our mock.
jest.mock("../../../utils/reactflowUtils", () => ({
  downloadFlow: (...args: unknown[]) => downloadFlowMock(...args),
  removeApiKeys: (flow: unknown) => removeApiKeysMock(flow),
}));

jest.mock("@/customization/utils/analytics", () => ({
  track: jest.fn(),
}));

jest.mock("@/stores/flowStore", () => {
  return {
    __esModule: true,
    default: (
      selector: Selector<{
        currentFlow: FlowType | undefined;
        isBuilding: boolean;
      }>,
    ) =>
      selector({
        currentFlow: currentFlowMock,
        isBuilding: false,
      }),
  };
});

jest.mock("@/stores/alertStore", () => {
  return {
    __esModule: true,
    default: (
      selector: Selector<{
        setSuccessData: jest.Mock;
        setNoticeData: jest.Mock;
      }>,
    ) =>
      selector({
        setSuccessData: jest.fn(),
        setNoticeData: jest.fn(),
      }),
  };
});

jest.mock("@/stores/darkStore", () => ({
  useDarkStore: (selector: Selector<{ version: string }>) =>
    selector({ version: "0.0.0-test" }),
}));

// Mock BaseModal so clicking the submit button reliably triggers onSubmit in Jest.
jest.mock("../../baseModal", () => {
  const React = require("react");

  type BaseModalProps = React.PropsWithChildren<{
    open: boolean;
    onSubmit?: () => void;
  }>;

  function BaseModal({ children, open, onSubmit }: BaseModalProps) {
    if (!open) return null;
    return React.createElement(
      "div",
      null,
      children,
      React.createElement(
        "button",
        {
          type: "button",
          "data-testid": "modal-export-button",
          onClick: () => onSubmit?.(),
        },
        "Export",
      ),
    );
  }

  BaseModal.Trigger = ({ children }: React.PropsWithChildren) =>
    React.createElement(React.Fragment, null, children);
  BaseModal.Header = ({ children }: React.PropsWithChildren) =>
    React.createElement("div", null, children);
  BaseModal.Content = ({ children }: React.PropsWithChildren) =>
    React.createElement("div", null, children);
  BaseModal.Footer = () => null;

  return {
    __esModule: true,
    default: BaseModal,
  };
});

import ExportModal from "../index";

describe("ExportModal", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("includes locked property when exporting", async () => {
    const user = userEvent.setup();

    const flowData = {
      id: "flow-1",
      name: "My Flow",
      description: "desc",
      locked: true,
      data: { nodes: [], edges: [] },
    } as unknown as FlowType;
    currentFlowMock = flowData;

    render(
      <TooltipProvider>
        <ExportModal open={true} setOpen={jest.fn()} flowData={flowData}>
          <button type="button">Open</button>
        </ExportModal>
      </TooltipProvider>,
    );

    await user.click(screen.getByTestId("modal-export-button"));

    await waitFor(() =>
      expect(downloadFlowMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "flow-1",
          locked: true,
        }),
        "My Flow",
        "desc",
      ),
    );
  });

  it("uses the switch value when toggled before exporting", async () => {
    const user = userEvent.setup();

    const flowData = {
      id: "flow-2",
      name: "Flow 2",
      description: "desc2",
      locked: false,
      data: { nodes: [], edges: [] },
    } as unknown as FlowType;
    currentFlowMock = flowData;

    render(
      <TooltipProvider>
        <ExportModal open={true} setOpen={jest.fn()} flowData={flowData}>
          <button type="button">Open</button>
        </ExportModal>
      </TooltipProvider>,
    );

    // Toggle the "Lock Flow" switch
    await user.click(screen.getByTestId("lock-flow-switch"));
    await waitFor(() =>
      expect(screen.getByTestId("lock-flow-switch")).toHaveAttribute(
        "data-state",
        "checked",
      ),
    );
    await user.click(screen.getByTestId("modal-export-button"));

    await waitFor(() =>
      expect(downloadFlowMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "flow-2",
          locked: true,
        }),
        "Flow 2",
        "desc2",
      ),
    );
  });
});
