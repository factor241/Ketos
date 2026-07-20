import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import BoardCanvas from "@/components/core/board";
import { useGetBoard } from "@/controllers/API/queries/boards";
import BoardPage from "..";
import { useBoardScene } from "../hooks/use-board-scene";
import { useBoardViewport } from "../hooks/use-board-viewport";
import { useNotePlacementActions } from "../hooks/use-note-placement-actions";
import { usePlacementPersistence } from "../hooks/use-placement-persistence";

let mockFeatureEnabled = true;
jest.mock("@/stores/utilityStore", () => ({
  useUtilityStore: (
    selector: (state: { featureFlags: { mvp_workspace: boolean } }) => unknown,
  ) => selector({ featureFlags: { mvp_workspace: mockFeatureEnabled } }),
}));
jest.mock("@/controllers/API/queries/boards", () => ({
  useGetBoard: jest.fn(),
}));
jest.mock("../hooks/use-board-viewport", () => ({
  useBoardViewport: jest.fn(),
}));
jest.mock("../hooks/use-board-scene", () => ({ useBoardScene: jest.fn() }));
jest.mock("../hooks/use-placement-persistence", () => ({
  usePlacementPersistence: jest.fn(),
}));
jest.mock("../hooks/use-note-placement-actions", () => ({
  useNotePlacementActions: jest.fn(),
}));
jest.mock("@/components/core/board", () => ({
  __esModule: true,
  default: jest.fn(() => <div data-testid="board-canvas" />),
}));
jest.mock("@/components/core/board/placements/BoardNotePlacement", () => ({
  BoardNotePlacement: () => <div data-testid="board-note-placement" />,
}));
jest.mock("@/components/core/board/BoardNoteDeleteDialog", () => ({
  BoardNoteDeleteDialog: () => null,
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => undefined },
}));

const PROJECT_ID = "123e4567-e89b-12d3-a456-426614174000";
const BOARD_ID = "550e8400-e29b-41d4-a716-446655440000";
const FOREIGN_PROJECT_ID = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
const mockUseGetBoard = useGetBoard as jest.Mock;
const mockUseBoardViewport = useBoardViewport as jest.Mock;
const mockUseBoardScene = useBoardScene as jest.Mock;
const mockUsePlacementPersistence = usePlacementPersistence as jest.Mock;
const mockUseBoardNoteActions = useNotePlacementActions as jest.Mock;
const mockBoardCanvas = BoardCanvas as jest.Mock;
let mockRefetch: jest.Mock;

function renderBoard(path = `/project/${PROJECT_ID}/board/${BOARD_ID}`) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/project/:projectId/board/:boardId"
          element={<BoardPage />}
        />
        <Route path="/flows" element={<div data-testid="flows-page" />} />
      </Routes>
    </MemoryRouter>,
  );
}

function successfulQuery(projectId = PROJECT_ID) {
  mockUseGetBoard.mockReturnValue({
    data: { id: BOARD_ID, title: "Incident response", project_id: projectId },
    isLoading: false,
    isError: false,
    refetch: mockRefetch,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFeatureEnabled = true;
  mockRefetch = jest.fn().mockResolvedValue({});
  successfulQuery();
  mockUseBoardViewport.mockReturnValue({
    initialViewport: { x: 12, y: 24, zoom: 1.25 },
    onMoveStart: jest.fn(),
    onMoveEnd: jest.fn(),
    onInstanceReady: jest.fn(),
    conflict: true,
  });
  mockUseBoardScene.mockReturnValue({
    nodes: [],
    notes: [],
    placements: [],
    isLoading: false,
    isError: false,
  });
  mockUsePlacementPersistence.mockReturnValue({
    move: jest.fn(),
    queueMove: jest.fn(),
    resize: jest.fn(),
    queueResize: jest.fn(),
    setDisplayState: jest.fn(),
    close: jest.fn(),
    isPending: false,
  });
  mockUseBoardNoteActions.mockReturnValue({
    createAt: jest.fn(),
    save: jest.fn(),
    replace: jest.fn(),
    deleteEntity: jest.fn(),
    isPending: false,
  });
});

it("composes a valid direct URL and bridges exact viewport props", () => {
  renderBoard();
  expect(mockUseGetBoard).toHaveBeenCalledWith(
    { projectId: PROJECT_ID, boardId: BOARD_ID },
    { enabled: true },
  );
  expect(
    screen.getByRole("heading", { name: "Incident response" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "board.backToBoards" }),
  ).toHaveAttribute("href", `/project/${PROJECT_ID}/boards`);
  expect(screen.getByRole("alert")).toHaveTextContent(
    "board.conflict.serverWins",
  );
  expect(mockBoardCanvas).toHaveBeenCalledWith(
    expect.objectContaining({ initialViewport: { x: 12, y: 24, zoom: 1.25 } }),
    undefined,
  );
});

it("creates at the center of the board canvas bounds", () => {
  const createAt = jest.fn();
  mockUseBoardNoteActions.mockReturnValue({
    createAt,
    save: jest.fn(),
    replace: jest.fn(),
    deleteEntity: jest.fn(),
    isPending: false,
  });
  renderBoard();
  const props = mockBoardCanvas.mock.calls.at(-1)?.[0] as {
    onInstanceReady: (
      instance: {
        screenToFlowPosition: (point: { x: number; y: number }) => {
          x: number;
          y: number;
        };
      },
      element: HTMLDivElement,
    ) => void;
  };
  const element = document.createElement("div");
  element.getBoundingClientRect = () =>
    ({ left: 100, top: 200, width: 600, height: 400 }) as DOMRect;
  const screenToFlowPosition = jest.fn(() => ({ x: 250, y: 300 }));
  act(() => props.onInstanceReady({ screenToFlowPosition }, element));

  fireEvent.click(screen.getByRole("button", { name: "Board.note.add" }));
  expect(screenToFlowPosition).toHaveBeenCalledWith({ x: 400, y: 400 });
  expect(createAt).toHaveBeenCalledWith({ x: 250, y: 300 });
});

it.each([
  [`/project/not-a-uuid/board/${BOARD_ID}`, "not-a-uuid", BOARD_ID],
  [`/project/${PROJECT_ID}/board/not-a-uuid`, PROJECT_ID, "not-a-uuid"],
  [
    `/project/${PROJECT_ID}/board/550e8400-e29b-01d4-a716-446655440000`,
    PROJECT_ID,
    "550e8400-e29b-01d4-a716-446655440000",
  ],
])(
  "rejects invalid ids before enabling the query",
  (path, projectId, boardId) => {
    renderBoard(path);
    expect(mockUseGetBoard).toHaveBeenCalledWith(
      { projectId, boardId },
      { enabled: false },
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/^board\.notFound$/);
    expect(mockUseBoardViewport).not.toHaveBeenCalled();
  },
);

it("denies a board belonging to another project without metadata", () => {
  successfulQuery(FOREIGN_PROJECT_ID);
  renderBoard();
  expect(screen.getByRole("alert")).toHaveTextContent(/^board\.notFound$/);
  expect(screen.queryByText("Incident response")).not.toBeInTheDocument();
  expect(screen.queryByText(FOREIGN_PROJECT_ID)).not.toBeInTheDocument();
});

it("hides board UI when the feature flag is off", () => {
  mockFeatureEnabled = false;
  renderBoard();
  expect(mockUseGetBoard).toHaveBeenCalledWith(
    { projectId: PROJECT_ID, boardId: BOARD_ID },
    { enabled: false },
  );
  expect(screen.getByTestId("flows-page")).toBeInTheDocument();
  expect(screen.queryByTestId("board-canvas")).not.toBeInTheDocument();
});

it("renders loading without hydrating the canvas", () => {
  mockUseGetBoard.mockReturnValue({
    data: undefined,
    isLoading: true,
    isError: false,
    refetch: mockRefetch,
  });
  renderBoard();
  expect(screen.getByRole("status")).toHaveTextContent("board.loading");
  expect(mockUseBoardViewport).not.toHaveBeenCalled();
});

it("renders a query error and retries", () => {
  mockUseGetBoard.mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: true,
    refetch: mockRefetch,
  });
  renderBoard();
  expect(screen.getByRole("alert")).toHaveTextContent("board.error");
  fireEvent.click(screen.getByRole("button", { name: "board.retry" }));
  expect(mockRefetch).toHaveBeenCalledTimes(1);
});
