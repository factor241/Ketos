import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { useDeleteBoard, useGetBoards, usePatchBoard, usePostBoard } from "@/controllers/API/queries/boards";
import BoardsPage from "../index";

const mockNavigate = jest.fn();
const mockRefetch = jest.fn();
const mockCreateMutate = jest.fn();
const mockPatchMutate = jest.fn();
const mockDeleteMutate = jest.fn();

jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock("react-router-dom", () => ({
  ...jest.requireActual("react-router-dom"),
  useNavigate: () => mockNavigate,
}));
jest.mock("@/controllers/API/queries/boards", () => ({
  useGetBoards: jest.fn(),
  usePostBoard: jest.fn(),
  usePatchBoard: jest.fn(),
  useDeleteBoard: jest.fn(),
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
const boardOne = makeBoard("22222222-2222-4222-8222-222222222222", "Discovery", 2);
const boardTwo = makeBoard("33333333-3333-4333-8333-333333333333", "Delivery", 7);

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/project/${projectId}/boards`]}>
      <Routes><Route path="/project/:projectId/boards" element={<BoardsPage />} /></Routes>
    </MemoryRouter>,
  );
}

describe("BoardsPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useGetBoards as jest.Mock).mockReturnValue({ data: [boardOne, boardTwo], isLoading: false, isError: false, refetch: mockRefetch });
    (usePostBoard as jest.Mock).mockReturnValue({ mutate: mockCreateMutate, isPending: false });
    (usePatchBoard as jest.Mock).mockReturnValue({ mutate: mockPatchMutate, isPending: false });
    (useDeleteBoard as jest.Mock).mockReturnValue({ mutate: mockDeleteMutate, isPending: false });
  });

  it("shows a distinct localized loading status", () => {
    (useGetBoards as jest.Mock).mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: mockRefetch });
    renderPage();
    expect(screen.getByRole("status")).toHaveTextContent("boards.loading");
    expect(screen.queryByText(boardOne.title)).not.toBeInTheDocument();
  });

  it("shows a localized load error and retries", async () => {
    const user = userEvent.setup();
    (useGetBoards as jest.Mock).mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: mockRefetch });
    renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent("boards.loadError");
    await user.click(screen.getByRole("button", { name: "boards.retry" }));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it("shows a localized explanatory empty state", () => {
    (useGetBoards as jest.Mock).mockReturnValue({ data: [], isLoading: false, isError: false, refetch: mockRefetch });
    renderPage();
    expect(screen.getByText("boards.empty.title")).toBeInTheDocument();
    expect(screen.getByText("boards.empty.description")).toBeInTheDocument();
  });

  it("creates by title and opens the server-issued id", async () => {
    const user = userEvent.setup();
    const serverBoard = makeBoard("55555555-5555-4555-8555-555555555555", "Research", 0);
    mockCreateMutate.mockImplementation((_payload, options) => options.onSuccess(serverBoard));
    renderPage();
    await user.type(screen.getByRole("textbox", { name: "boards.create.title" }), serverBoard.title);
    await user.click(screen.getByRole("button", { name: "boards.create.submit" }));
    expect(mockCreateMutate).toHaveBeenCalledWith({ title: serverBoard.title }, expect.any(Object));
    expect(mockNavigate).toHaveBeenCalledWith(`/project/${projectId}/board/${serverBoard.id}`);
  });

  it("opens each listed board with an accessible control", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("link", { name: boardTwo.title }));
    expect(mockNavigate).toHaveBeenCalledWith(`/project/${projectId}/board/${boardTwo.id}`);
  });

  it("renames with current revision and cancel does not mutate", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: `boards.rename ${boardOne.title}` }));
    const input = screen.getByRole("textbox", { name: "boards.rename.title" });
    await user.clear(input);
    await user.type(input, "Discarded");
    await user.click(screen.getByRole("button", { name: "boards.rename.cancel" }));
    expect(mockPatchMutate).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: `boards.rename ${boardOne.title}` }));
    const nextInput = screen.getByRole("textbox", { name: "boards.rename.title" });
    await user.clear(nextInput);
    await user.type(nextInput, "Discovery updated");
    await user.click(screen.getByRole("button", { name: "boards.rename.submit" }));
    expect(mockPatchMutate).toHaveBeenCalledWith(
      { boardId: boardOne.id, title: "Discovery updated", expected_revision: boardOne.revision },
      expect.any(Object),
    );
  });

  it("confirms delete with revision and preserves board on 409", async () => {
    const user = userEvent.setup();
    mockDeleteMutate.mockImplementation((_payload, options) => options.onError({ response: { status: 409 } }));
    renderPage();
    await user.click(screen.getByRole("button", { name: `boards.delete ${boardOne.title}` }));
    expect(screen.getByRole("dialog")).toHaveTextContent("boards.delete.confirm");
    await user.click(screen.getByRole("button", { name: "boards.delete.confirmAction" }));
    expect(mockDeleteMutate).toHaveBeenCalledWith(
      { boardId: boardOne.id, expected_revision: boardOne.revision }, expect.any(Object),
    );
    await waitFor(() => expect(mockRefetch).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("alert")).toHaveTextContent("boards.conflict");
    expect(screen.getByText(boardOne.title)).toBeInTheDocument();
  });

  it("blocks duplicate create while pending without hiding the list", async () => {
    (usePostBoard as jest.Mock).mockReturnValue({ mutate: mockCreateMutate, isPending: true });
    renderPage();
    expect(screen.getByRole("button", { name: "boards.create.submit" })).toBeDisabled();
    expect(screen.getByText(boardOne.title)).toBeInTheDocument();
    expect(screen.getByText(boardTwo.title)).toBeInTheDocument();
  });
});
