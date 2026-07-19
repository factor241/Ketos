import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { useUtilityStore } from "@/stores/utilityStore";
import CopilotKitProbePage from "..";

jest.mock("@/components/core/assistantPanel/copilotkit-probe", () => ({
  __esModule: true,
  default: () => <div data-testid="stock-copilotkit-probe" />,
}));

function LocationProbe() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/mvp/copilotkit-probe"]}>
      <Routes>
        <Route path="/mvp/copilotkit-probe" element={<CopilotKitProbePage />} />
        <Route path="/flows" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("CopilotKitProbePage", () => {
  afterEach(() => {
    act(() => {
      useUtilityStore.setState({ featureFlags: {} });
    });
  });

  it("should render the stock probe when both runtime flags are literal true", () => {
    act(() => {
      useUtilityStore.setState({
        featureFlags: { mvp_workspace: true, mvp_chat: true },
      });
    });

    renderPage();

    expect(
      screen.getByRole("heading", { name: "Stage 01 approval probe" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("stock-copilotkit-probe")).toBeInTheDocument();
  });

  it.each([
    {},
    { mvp_workspace: true },
    { mvp_chat: true },
    { mvp_workspace: "true", mvp_chat: true },
    { mvp_workspace: true, mvp_chat: 1 },
  ])(
    "should redirect when flags are missing, partial, or malformed: %p",
    async (featureFlags) => {
      act(() => {
        useUtilityStore.setState({ featureFlags });
      });

      renderPage();

      await waitFor(() =>
        expect(screen.getByTestId("location")).toHaveTextContent("/flows"),
      );
      expect(
        screen.queryByTestId("stock-copilotkit-probe"),
      ).not.toBeInTheDocument();
    },
  );
});
