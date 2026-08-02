import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
  useDeleteBoard,
  useGetBoards,
  usePatchBoard,
} from "@/controllers/API/queries/boards";
import { useGetAutomationSummaries } from "@/controllers/API/queries/flows/use-get-automation-summaries";
import {
  useGetBoardPlacements,
  usePostPlacement,
} from "@/controllers/API/queries/placements";
import BoardsPage from "../index";

const mockNavigate = jest.fn();
const mockRefetch = jest.fn();
const mockPatchMutate = jest.fn();
const mockDeleteMutate = jest.fn();
const mockPlaceMutateAsync = jest.fn();
const mockPlacementsRefetch = jest.fn();

jest.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: jest.fn() },
  useTranslation: () => ({
    t: (key: string, values?: { title?: string; name?: string }) =>
      values?.title
        ? `${key} ${values.title}`
        : values?.name
          ? `${key} ${values.name}`
          : key,
  }),
}));
jest.mock("react-router-dom", () => ({
  ...jest.requireActual("react-router-dom"),
  useNavigate: () => mockNavigate,
}));
jest.mock("@/controllers/API/queries/boards", () => ({
  useGetBoards: jest.fn(),
  usePatchBoard: jest.fn(),
  useDeleteBoard: jest.fn(),
}));
jest.mock("@/components/core/boardCreationWizard/BoardCreationDialog", () => ({
  BoardCreationDialog: ({
    open,
    projectId,
    onOpenChange,
  }: {
    open: boolean;
    projectId: string;
    onOpenChange: (open: boolean) => void;
  }) =>
    open ? (
      <div role="dialog" aria-label="board-wizard">
        <span>{projectId}</span>
        <button type="button" onClick={() => onOpenChange(false)}>
          close-wizard
        </button>
      </div>
    ) : null,
}));
jest.mock(
  "@/controllers/API/queries/flows/use-get-automation-summaries",
  () => ({
    useGetAutomationSummaries: jest.fn(),
  }),
);
jest.mock("@/controllers/API/queries/placements", () => ({
  useGetBoardPlacements: jest.fn(),
  usePostPlacement: jest.fn(),
}));

const projectId = "11111111-1111-4111-8111-111111111111";
const makeBoard = (id: string, title: string, revision: number) => ({
  id,
  project_id: projectId,
  created_by_id: "44444444-4444-4444-8444-444444444444",
  title,
  viewport_x: 0,
  viewport_y: 0,
  viewport_zoom: 1,
  revision,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
});
const boardOne = makeBoard(
  "22222222-2222-4222-8222-222222222222",
  "Discovery",
  2,
);
const boardTwo = makeBoard(
  "33333333-3333-4333-8333-333333333333",
  "Delivery",
  7,
);
const placedFlow = {
  id: "66666666-6666-4666-8666-666666666666",
  name: "Placed automation",
  description: null,
};
const unplacedFlow = {
  id: "77777777-7777-4777-8777-777777777777",
  name: "Unplaced automation",
  description: null,
};
const placement = {
  id: "88888888-8888-4888-8888-888888888888",
  boardId: boardOne.id,
  targetKind: "automation",
  targetId: placedFlow.id,
  x: 0,
  y: 0,
  width: 320,
  height: 240,
  zIndex: 0,
  displayState: "normal",
  revision: 0,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/project/${projectId}/boards`]}>
      <Routes>
        <Route path="/project/:projectId/boards" element={<BoardsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("BoardsPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useGetBoards as jest.Mock).mockReturnValue({
      data: [boardOne, boardTwo],
      isLoading: false,
      isError: false,
      refetch: mockRefetch,
    });
    (usePatchBoard as jest.Mock).mockReturnValue({
      mutate: mockPatchMutate,
      isPending: false,
    });
    (useDeleteBoard as jest.Mock).mockReturnValue({
      mutate: mockDeleteMutate,
      isPending: false,
    });
    (useGetAutomationSummaries as jest.Mock).mockReturnValue({
      data: [placedFlow, unplacedFlow],
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
    (useGetBoardPlacements as jest.Mock).mockReturnValue({
      data: [placement],
      isLoading: false,
      isError: false,
      refetch: mockPlacementsRefetch,
    });
    (usePostPlacement as jest.Mock).mockReturnValue({
      mutateAsync: mockPlaceMutateAsync,
      isPending: false,
    });
  });

  it("shows a distinct localized loading status", () => {
    (useGetBoards as jest.Mock).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: mockRefetch,
    });
    renderPage();
    expect(screen.getByRole("status")).toHaveTextContent("boards.loading");
    expect(screen.queryByText(boardOne.title)).not.toBeInTheDocument();
  });

  it("shows a localized load error and retries", async () => {
    const user = userEvent.setup();
    (useGetBoards as jest.Mock).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: mockRefetch,
    });
    renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent("boards.loadError");
    await user.click(screen.getByRole("button", { name: "boards.retry" }));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it("shows a localized explanatory empty state", () => {
    (useGetBoards as jest.Mock).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: mockRefetch,
    });
    renderPage();
    expect(screen.getByText("boards.empty.title")).toBeInTheDocument();
    expect(screen.getByText("boards.empty.description")).toBeInTheDocument();
  });

  it("opens the reusable creation wizard from the page CTA", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(
      screen.getAllByRole("button", { name: "boards.create.submit" })[0],
    );
    expect(
      screen.getByRole("dialog", { name: "board-wizard" }),
    ).toHaveTextContent(projectId);
  });

  it("opens each listed board with an accessible control", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("link", { name: boardTwo.title }));
    expect(mockNavigate).toHaveBeenCalledWith(
      `/project/${projectId}/board/${boardTwo.id}`,
    );
  });

  it("renames with current revision and cancel does not mutate", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(
      screen.getByRole("button", {
        name: `boards.renameLabel ${boardOne.title}`,
      }),
    );
    expect(
      screen.getByRole("dialog", { name: "boards.rename" }),
    ).toBeInTheDocument();
    const input = screen.getByRole("textbox", { name: "boards.rename.title" });
    await user.clear(input);
    await user.type(input, "Discarded");
    await user.click(
      screen.getByRole("button", { name: "boards.rename.cancel" }),
    );
    expect(mockPatchMutate).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", {
        name: `boards.renameLabel ${boardOne.title}`,
      }),
    );
    const nextInput = screen.getByRole("textbox", {
      name: "boards.rename.title",
    });
    await user.clear(nextInput);
    await user.type(nextInput, "Discovery updated");
    await user.click(
      screen.getByRole("button", { name: "boards.rename.submit" }),
    );
    expect(mockPatchMutate).toHaveBeenCalledWith(
      {
        boardId: boardOne.id,
        title: "Discovery updated",
        expected_revision: boardOne.revision,
      },
      expect.any(Object),
    );
  });

  it("confirms delete with revision and preserves board on 409", async () => {
    const user = userEvent.setup();
    mockDeleteMutate.mockImplementation((_payload, options) =>
      options.onError({ response: { status: 409 } }),
    );
    renderPage();
    await user.click(
      screen.getByRole("button", {
        name: `boards.deleteLabel ${boardOne.title}`,
      }),
    );
    expect(
      screen.getByRole("dialog", { name: "boards.delete.confirm" }),
    ).toHaveTextContent("boards.delete.confirm");
    await user.click(
      screen.getByRole("button", { name: "boards.delete.confirmAction" }),
    );
    expect(mockDeleteMutate).toHaveBeenCalledWith(
      { boardId: boardOne.id, expected_revision: boardOne.revision },
      expect.any(Object),
    );
    await waitFor(() => expect(mockRefetch).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("alert")).toHaveTextContent("boards.conflict");
    expect(
      screen.getByRole("link", { name: boardOne.title }),
    ).toBeInTheDocument();
  });

  it("keeps the board list visible while the creation wizard is open", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(
      screen.getAllByRole("button", { name: "boards.create.submit" })[0],
    );
    expect(screen.getByRole("dialog", { name: "board-wizard" })).toBeVisible();
    expect(
      screen.getByRole("link", { name: boardOne.title }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: boardTwo.title }),
    ).toBeInTheDocument();
  });

  it("lists placed and unplaced project Flows for the selected Board", () => {
    renderPage();

    expect(
      screen.getByRole("complementary", {
        name: "board.automation.inventory.title",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(placedFlow.name)).toBeInTheDocument();
    expect(screen.getByText(unplacedFlow.name)).toBeInTheDocument();
    expect(
      screen.getByText("board.automation.inventory.placed"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("board.automation.inventory.unplaced"),
    ).toBeInTheDocument();
  });

  it("places the original Flow without creating a copy", async () => {
    const user = userEvent.setup();
    mockPlaceMutateAsync.mockResolvedValue({
      ...placement,
      id: "99999999-9999-4999-8999-999999999999",
      targetId: unplacedFlow.id,
    });
    renderPage();

    await user.click(
      screen.getByRole("button", {
        name: `board.automation.inventory.place ${unplacedFlow.name}`,
      }),
    );

    expect(mockPlaceMutateAsync).toHaveBeenCalledWith({
      targetKind: "automation",
      targetId: unplacedFlow.id,
      x: 0,
      y: 0,
    });
  });

  it("opens a placed Flow with server-return context", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(
      screen.getByRole("button", {
        name: `board.automation.inventory.open ${placedFlow.name}`,
      }),
    );

    expect(mockNavigate).toHaveBeenCalledWith(
      `/flow/${placedFlow.id}?returnBoardId=${boardOne.id}&returnPlacementId=${placement.id}`,
    );
  });

  it("reconciles the selected Board after a list refetch removes it", async () => {
    const rendered = renderPage();
    await waitFor(() =>
      expect(useGetBoardPlacements).toHaveBeenLastCalledWith(
        { boardId: boardOne.id },
        { enabled: true },
      ),
    );

    (useGetBoards as jest.Mock).mockReturnValue({
      data: [boardTwo],
      isLoading: false,
      isError: false,
      refetch: mockRefetch,
    });
    rendered.rerender(
      <MemoryRouter initialEntries={[`/project/${projectId}/boards`]}>
        <Routes>
          <Route path="/project/:projectId/boards" element={<BoardsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(useGetBoardPlacements).toHaveBeenLastCalledWith(
        { boardId: boardTwo.id },
        { enabled: true },
      ),
    );
  });
});
