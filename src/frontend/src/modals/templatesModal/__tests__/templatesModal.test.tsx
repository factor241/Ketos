import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { useUtilityStore } from "@/stores/utilityStore";
import TemplatesModal from "../index";

const navProps: Array<Record<string, unknown>> = [];
const mockNavigate = jest.fn();
const mockAddFlow = jest.fn(() => Promise.resolve("flow-id"));

jest.mock("react-router-dom", () => ({
  useParams: () => ({}),
}));

jest.mock("@/customization/hooks/use-custom-navigate", () => ({
  useCustomNavigate: () => mockNavigate,
}));

jest.mock("@/customization/utils/analytics", () => ({
  track: jest.fn(),
}));

jest.mock("@/hooks/flows/use-add-flow", () => ({
  __esModule: true,
  default: () => mockAddFlow,
}));

jest.mock("../../baseModal", () => {
  const BaseModal = Object.assign(
    ({ children }: { children: ReactNode }) => <>{children}</>,
    {
      Content: ({ children }: { children: ReactNode }) => <>{children}</>,
      Footer: ({ children }: { children: ReactNode }) => <>{children}</>,
    },
  );

  return {
    __esModule: true,
    default: BaseModal,
  };
});

jest.mock("../components/navComponent", () => ({
  Nav: (props: Record<string, unknown>) => {
    navProps.push(props);
    return <div data-testid="templates-nav" />;
  },
}));

jest.mock("../components/GetStartedComponent", () => ({
  __esModule: true,
  default: () => <div data-testid="get-started-component" />,
}));

jest.mock("../components/TemplateContentComponent", () => ({
  __esModule: true,
  default: () => <div data-testid="template-content-component" />,
}));

jest.mock("@/components/ui/sidebar", () => ({
  SidebarProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

describe("TemplatesModal", () => {
  beforeEach(() => {
    navProps.length = 0;
    mockAddFlow.mockClear();
    mockNavigate.mockClear();
    act(() => {
      useUtilityStore.setState({ hideStarterProjects: false });
    });
  });

  afterEach(() => {
    act(() => {
      useUtilityStore.setState({ hideStarterProjects: false });
    });
  });

  it("passes the effective tab to the nav when starter projects are hidden", () => {
    act(() => {
      useUtilityStore.setState({ hideStarterProjects: true });
    });

    render(<TemplatesModal open setOpen={jest.fn()} />);

    expect(screen.getByTestId("templates-nav")).toBeInTheDocument();
    expect(navProps.at(-1)?.currentTab).toBe("all-templates");

    const categories = navProps.at(-1)?.categories as
      | Array<{ items: Array<{ id: string }> }>
      | undefined;

    const categoryItemIds =
      categories?.flatMap((category) =>
        category.items.map((item) => item.id),
      ) ?? [];

    expect(categoryItemIds).not.toContain("get-started");
  });

  it("keeps get-started selected in the nav when starter projects are visible", () => {
    render(<TemplatesModal open setOpen={jest.fn()} />);

    expect(screen.getByTestId("templates-nav")).toBeInTheDocument();
    expect(navProps.at(-1)?.currentTab).toBe("get-started");
  });

  it("closes the modal before navigating to a blank flow", async () => {
    const setOpen = jest.fn();

    render(<TemplatesModal open setOpen={setOpen} />);

    fireEvent.click(screen.getByTestId("blank-flow"));

    await waitFor(() => {
      expect(setOpen).toHaveBeenCalledWith(false);
      expect(mockNavigate).toHaveBeenCalledWith("/flow/flow-id");
    });
  });

  it("reuses a supplied blank flow instead of creating a second one", () => {
    const onSelectBlank = jest.fn();

    render(
      <TemplatesModal open setOpen={jest.fn()} onSelectBlank={onSelectBlank} />,
    );

    fireEvent.click(screen.getByTestId("blank-flow"));

    expect(onSelectBlank).toHaveBeenCalledTimes(1);
    expect(mockAddFlow).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
