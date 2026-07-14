import { act, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ViewPage from "../index";

const getFlow = jest.fn();
const navigate = jest.fn();
const setCurrentFlow = jest.fn();
let currentFlowId = "";
let returnUnstableCallbacks = false;

jest.mock("@/controllers/API/queries/flows/use-get-flow", () => ({
  useGetFlow: () => ({
    mutateAsync: returnUnstableCallbacks
      ? (payload: { id: string }) => getFlow(payload)
      : getFlow,
  }),
}));

jest.mock("@/controllers/API/queries/flows/use-get-types", () => ({
  useGetTypes: jest.fn(),
}));

jest.mock("@/customization/hooks/use-custom-navigate", () => ({
  useCustomNavigate: () =>
    returnUnstableCallbacks
      ? (to: unknown, options?: unknown) => navigate(to, options)
      : navigate,
}));

jest.mock("@/customization/components/custom-loader", () => ({
  __esModule: true,
  default: () => <div data-testid="view-loader" />,
}));

jest.mock("@/stores/typesStore", () => ({
  useTypesStore: (selector: (state: { types: object }) => unknown) =>
    selector({ types: { Input: {} } }),
}));

jest.mock("../../../stores/flowsManagerStore", () => ({
  __esModule: true,
  default: (
    selector: (state: {
      currentFlowId: string;
      setCurrentFlow: typeof setCurrentFlow;
    }) => unknown,
  ) => selector({ currentFlowId, setCurrentFlow }),
}));

jest.mock("../../FlowPage/components/PageComponent", () => ({
  __esModule: true,
  default: () => <div data-testid="readonly-canvas" />,
}));

function ViewRoute({ flowId }: { flowId: string }) {
  return (
    <MemoryRouter
      initialEntries={[`/flow/${flowId}/view`]}
      future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
    >
      <Routes>
        <Route path="/flow/:id/view" element={<ViewPage />} />
      </Routes>
    </MemoryRouter>
  );
}

function renderView(flowId: string) {
  return render(<ViewRoute flowId={flowId} />);
}

describe("ViewPage flow loading", () => {
  beforeEach(() => {
    currentFlowId = "";
    getFlow.mockReset();
    navigate.mockReset();
    setCurrentFlow.mockReset();
    returnUnstableCallbacks = false;
  });

  it("replaces a stale current flow when the route id changes", async () => {
    currentFlowId = "old-flow";
    const nextFlow = { id: "next-flow", data: { nodes: [], edges: [] } };
    getFlow.mockResolvedValue(nextFlow);

    renderView("next-flow");

    await waitFor(() =>
      expect(getFlow).toHaveBeenCalledWith({ id: "next-flow" }),
    );
    expect(setCurrentFlow).toHaveBeenCalledWith(nextFlow);
  });

  it("reloads the route flow even when the cached id already matches", async () => {
    currentFlowId = "same-flow";
    const routeFlow = { id: "same-flow", data: { nodes: [], edges: [] } };
    getFlow.mockResolvedValue(routeFlow);

    renderView("same-flow");

    await waitFor(() =>
      expect(getFlow).toHaveBeenCalledWith({ id: "same-flow" }),
    );
    expect(setCurrentFlow).toHaveBeenCalledWith(routeFlow);
  });

  it("does not restart an in-flight route load when hook callbacks change identity", async () => {
    returnUnstableCallbacks = true;
    let resolveFlow: (flow: object) => void = () => undefined;
    getFlow.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFlow = resolve;
        }),
    );

    const view = renderView("stable-flow");
    await waitFor(() => expect(getFlow).toHaveBeenCalledTimes(1));

    view.rerender(<ViewRoute flowId="stable-flow" />);
    expect(getFlow).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFlow({ id: "stable-flow", data: { nodes: [], edges: [] } });
      await Promise.resolve();
    });

    expect(setCurrentFlow).toHaveBeenCalledWith(
      expect.objectContaining({ id: "stable-flow" }),
    );
  });

  it("does not commit a late request after the page unmounts", async () => {
    let resolveFlow: (flow: object) => void = () => undefined;
    getFlow.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFlow = resolve;
        }),
    );

    const view = renderView("slow-flow");
    await waitFor(() =>
      expect(getFlow).toHaveBeenCalledWith({ id: "slow-flow" }),
    );
    view.unmount();

    await act(async () => {
      resolveFlow({ id: "slow-flow", data: { nodes: [], edges: [] } });
      await Promise.resolve();
    });

    expect(setCurrentFlow).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: "slow-flow" }),
    );
  });
});
