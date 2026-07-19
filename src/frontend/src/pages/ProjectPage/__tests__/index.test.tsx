import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import {
  Link,
  MemoryRouter,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import ProjectPage from "..";

let mockFeatureEnabled = true;
const mockFolderQuery = jest.fn();

jest.mock("@/controllers/API/queries/folders/use-get-folder", () => ({
  useGetFolderQuery: (...args: unknown[]) => mockFolderQuery(...args),
}));

jest.mock("@/stores/utilityStore", () => ({
  useUtilityStore: (
    selector: (state: { featureFlags: { mvp_workspace: boolean } }) => unknown,
  ) => selector({ featureFlags: { mvp_workspace: mockFeatureEnabled } }),
}));

jest.mock("@/customization/components/custom-link", () => ({
  CustomLink: ({ children, to, ...props }: ComponentProps<typeof Link>) => (
    <Link to={to} {...props}>
      {children}
    </Link>
  ),
}));

jest.mock("@/components/ui/skeleton", () => ({
  Skeleton: (props: ComponentProps<"div">) => <div {...props} />,
}));

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { name?: string }) =>
      values?.name ? `${key}:${values.name}` : key,
  }),
}));

function LocationProbe() {
  return <span data-testid="location">{useLocation().pathname}</span>;
}

function renderProject(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/project/:projectId/*" element={<ProjectPage />} />
        <Route path="/flows" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ProjectPage", () => {
  beforeEach(() => {
    mockFeatureEnabled = true;
    mockFolderQuery.mockReset();
  });

  it("renders loading without stale project metadata", () => {
    mockFolderQuery.mockReturnValue({
      data: {
        folder: { id: "alpha-id", name: "Hidden title", components: [] },
      },
      isLoading: true,
      isError: false,
    });

    renderProject("/project/alpha-id/boards");

    expect(screen.getByRole("status")).toHaveTextContent(
      "projectShell.loading",
    );
    expect(screen.queryByTestId("project-title")).not.toBeInTheDocument();
    expect(screen.queryByText("Hidden title")).not.toBeInTheDocument();
  });

  it("renders a generic error without leaking route or folder metadata", () => {
    mockFolderQuery.mockReturnValue({
      data: {
        folder: {
          id: "foreign-secret",
          name: "Confidential name",
          components: [],
        },
      },
      isLoading: false,
      isError: true,
    });

    renderProject("/project/foreign-secret/boards");

    expect(screen.getByRole("alert")).toHaveTextContent("projectShell.error");
    expect(document.body).not.toHaveTextContent("foreign-secret");
    expect(document.body).not.toHaveTextContent("Confidential name");
  });

  it("renders metadata, canonical navigation, and the empty Boards state", () => {
    mockFolderQuery.mockReturnValue({
      data: {
        folder: {
          id: "alpha-id",
          name: "Internal Alpha",
          display_name: "Alpha",
          description: "",
          parent_id: null,
          components: [],
        },
        flows: { items: [], total: 0, page: 1, size: 1, pages: 0 },
      },
      isLoading: false,
      isError: false,
    });

    renderProject("/project/alpha-id/boards");

    expect(screen.getByTestId("project-title")).toHaveTextContent(
      "projectShell.heading:Alpha",
    );
    expect(screen.getByTestId("project-boards-link")).toHaveAttribute(
      "href",
      "/project/alpha-id/boards",
    );
    expect(screen.getByTestId("project-flows-link")).toHaveAttribute(
      "href",
      "/all/folder/alpha-id",
    );
    expect(screen.getByTestId("project-boards-empty")).toHaveTextContent(
      "projectShell.emptyBoards",
    );
    expect(mockFolderQuery).toHaveBeenCalledWith(
      { id: "alpha-id", page: 1, size: 1 },
      { enabled: true },
    );
  });

  it("redirects to flows and disables the detail query when the flag is off", () => {
    mockFeatureEnabled = false;
    mockFolderQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
    });

    renderProject("/project/alpha-id/boards");

    expect(screen.getByTestId("location")).toHaveTextContent("/flows");
    expect(mockFolderQuery).toHaveBeenCalledWith(
      { id: "alpha-id", page: 1, size: 1 },
      { enabled: false },
    );
  });
});
