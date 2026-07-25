import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";

import { useBootstrapBoard } from "@/controllers/API/queries/boards";
import { useGetBasicExamplesQuery } from "@/controllers/API/queries/flows/use-get-basic-examples";
import { BoardCreationDialog } from "../BoardCreationDialog";

jest.mock("@/controllers/API/queries/boards", () => ({
  useBootstrapBoard: jest.fn(),
}));
jest.mock("@/controllers/API/queries/flows/use-get-basic-examples", () => ({
  useGetBasicExamplesQuery: jest.fn(),
}));

const mockBootstrap = jest.mocked(useBootstrapBoard);
const mockExamples = jest.mocked(useGetBasicExamplesQuery);
const mutateAsync = jest.fn();

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {location.pathname + location.search}
    </output>
  );
}

function renderDialog(
  overrides: Partial<React.ComponentProps<typeof BoardCreationDialog>> = {},
) {
  return render(
    <MemoryRouter initialEntries={["/project/project-1/boards"]}>
      <BoardCreationDialog
        open
        projectId="project-1"
        onOpenChange={jest.fn()}
        {...overrides}
      />
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe("BoardCreationDialog", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBootstrap.mockReturnValue({
      mutateAsync,
      isPending: false,
      error: null,
    } as never);
    mockExamples.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    } as never);
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      configurable: true,
      value: jest.fn().mockReturnValue("11111111-1111-4111-8111-111111111111"),
    });
  });

  it("starts on the accessible form with Clean Board selected", () => {
    renderDialog();

    expect(screen.getByTestId("board-create-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("board-name-input")).toHaveFocus();
    expect(screen.getByRole("radiogroup")).toBeInTheDocument();
    expect(screen.getByTestId("board-template-clean")).toBeChecked();
    expect(
      screen.getByTestId("board-template-simple-agent"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("board-template-vector-store-rag"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("board-template-browse-more"),
    ).toBeInTheDocument();
  });

  it("validates a trimmed name and submits the exact starter union", async () => {
    const user = userEvent.setup();
    mutateAsync.mockResolvedValue({
      board: { id: "board-1" },
      automation: null,
      placement: null,
      idempotencyReplayed: false,
    });
    renderDialog();

    await user.type(screen.getByTestId("board-name-input"), "  Research  ");
    await user.click(screen.getByTestId("board-template-simple-agent"));
    await user.click(screen.getByTestId("board-create-submit"));

    expect(mutateAsync).toHaveBeenCalledWith({
      title: "Research",
      starter: { kind: "simple_agent", name: "Simple Agent" },
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
    });
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/project/project-1/board/board-1",
      ),
    );
  });

  it("keeps the failed attempt key and form for Retry, then rotates after an edit", async () => {
    const user = userEvent.setup();
    const randomUUID = jest.mocked(globalThis.crypto.randomUUID);
    randomUUID
      .mockReturnValueOnce("11111111-1111-4111-8111-111111111111")
      .mockReturnValueOnce("22222222-2222-4222-8222-222222222222");
    mutateAsync.mockRejectedValue(new Error("offline"));
    renderDialog();

    const input = screen.getByTestId("board-name-input");
    await user.type(input, "Research");
    await user.click(screen.getByTestId("board-create-submit"));
    await user.click(await screen.findByRole("button", { name: /retry/i }));

    expect(mutateAsync).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
      }),
    );
    expect(input).toHaveValue("Research");

    await user.type(input, " 2");
    await user.click(screen.getByRole("button", { name: /retry/i }));
    expect(mutateAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: "Research 2",
        idempotencyKey: "22222222-2222-4222-8222-222222222222",
      }),
    );
  });

  it("prevents duplicate submit and Escape while the mutation is pending", async () => {
    mockBootstrap.mockReturnValue({
      mutateAsync,
      isPending: true,
      error: null,
    } as never);
    const onOpenChange = jest.fn();
    renderDialog({ onOpenChange });

    fireEvent.keyDown(screen.getByTestId("board-create-dialog"), {
      key: "Escape",
    });
    fireEvent.click(screen.getByTestId("board-create-submit"));
    fireEvent.click(screen.getByTestId("board-create-submit"));

    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("returns from Browse more with a selected template and focuses its placement", async () => {
    const user = userEvent.setup();
    mockExamples.mockReturnValue({
      data: [
        {
          id: "template-1",
          name: "Support agent",
          description: "Answers support questions",
          data: { nodes: [], edges: [] },
        },
      ],
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    } as never);
    mutateAsync.mockResolvedValue({
      board: { id: "board-1" },
      automation: { id: "flow-1" },
      placement: { id: "placement-1" },
      idempotencyReplayed: false,
    });
    renderDialog({ continuation: "open-add-automation" });

    await user.type(screen.getByTestId("board-name-input"), "Support");
    await user.click(screen.getByTestId("board-template-browse-more"));
    await user.click(
      await screen.findByRole("button", { name: /support agent/i }),
    );
    expect(screen.getByTestId("board-name-input")).toHaveValue("Support");
    await user.click(screen.getByTestId("board-create-submit"));

    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        starter: {
          kind: "template",
          template_id: "template-1",
          name: "Support agent",
        },
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/project/project-1/board/board-1?focusPlacementId=placement-1&open-add-automation=1",
      ),
    );
  });
});
