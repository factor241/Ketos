import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import ProjectPage from "..";

const mockFolderQuery = jest.fn();

jest.mock("@/controllers/API/queries/folders/use-get-folder", () => ({
  useGetFolderQuery: (...args: unknown[]) => mockFolderQuery(...args),
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

function renderProject(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/project/:projectId/*" element={<ProjectPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ProjectPage", () => {
  beforeEach(() => {
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

  it("renders metadata and canonical navigation without a stale Boards empty state", () => {
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
    expect(screen.queryByTestId("project-flows-link")).not.toBeInTheDocument();
    expect(screen.getByRole("navigation").querySelectorAll("a")).toHaveLength(
      1,
    );
    expect(
      screen.queryByText("projectShell.emptyBoards"),
    ).not.toBeInTheDocument();
    expect(mockFolderQuery).toHaveBeenCalledWith(
      { id: "alpha-id", page: 1, size: 1 },
      { enabled: true },
    );
  });

  it("does not couple canonical project routing to the workspace feature flag", () => {
    mockFolderQuery.mockReturnValue({
      data: {
        folder: {
          id: "alpha-id",
          name: "Alpha",
          components: [],
        },
      },
      isLoading: false,
      isError: false,
    });

    renderProject("/project/alpha-id/boards");

    expect(screen.getByTestId("project-boards-link")).toHaveAttribute(
      "href",
      "/project/alpha-id/boards",
    );
    expect(mockFolderQuery).toHaveBeenCalledWith(
      { id: "alpha-id", page: 1, size: 1 },
      { enabled: true },
    );
  });
});
