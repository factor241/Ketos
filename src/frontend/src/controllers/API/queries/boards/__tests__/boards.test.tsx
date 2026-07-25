import { AxiosError } from "axios";
import { automationSummaryKeys } from "../../flows/use-get-automation-summaries";
import { placementKeys } from "../../placements";
import { boardKeys } from "../keys";
import { useBootstrapBoard } from "../use-bootstrap-board";
import { useCreateBoardAutomation } from "../use-create-board-automation";
import { useDeleteBoard } from "../use-delete-board";
import { useGetBoard } from "../use-get-board";
import { useGetBoards } from "../use-get-boards";
import { usePatchBoard } from "../use-patch-board";
import { usePostBoard } from "../use-post-board";
import { usePutBoardViewport } from "../use-put-board-viewport";

const mockApiGet = jest.fn();
const mockApiPost = jest.fn();
const mockApiPatch = jest.fn();
const mockApiPut = jest.fn();
const mockApiDelete = jest.fn();
const mockInvalidateQueries = jest.fn();
const mockSetQueryData = jest.fn();
const mockRemoveQueries = jest.fn();
const mockRefetchQueries = jest.fn();

const mockQuery = jest.fn((_key, queryFn) => ({ queryFn }));
const mockMutate = jest.fn((_key, mutationFn, options = {}) => ({
  mutate: async (payload: unknown) => {
    try {
      const result = await mutationFn(payload);
      await options.onSuccess?.(result, payload);
      await options.onSettled?.(result, null, payload);
      return result;
    } catch (error) {
      await options.onError?.(error, payload);
      await options.onSettled?.(undefined, error, payload);
      throw error;
    }
  },
}));

jest.mock("@/controllers/API/api", () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: (...args: unknown[]) => mockApiPost(...args),
    patch: (...args: unknown[]) => mockApiPatch(...args),
    put: (...args: unknown[]) => mockApiPut(...args),
    delete: (...args: unknown[]) => mockApiDelete(...args),
  },
}));
jest.mock("@/controllers/API/helpers/constants", () => ({
  getURL: (key: string) =>
    key === "PROJECTS" ? "/api/v1/projects" : "/api/v1/boards",
}));
jest.mock("@/controllers/API/services/request-processor", () => ({
  UseRequestProcessor: () => ({
    query: mockQuery,
    mutate: mockMutate,
    queryClient: {
      invalidateQueries: mockInvalidateQueries,
      setQueryData: mockSetQueryData,
      removeQueries: mockRemoveQueries,
      refetchQueries: mockRefetchQueries,
    },
  }),
}));

const projectId = "11111111-1111-4111-8111-111111111111";
const boardId = "22222222-2222-4222-8222-222222222222";
const board = {
  id: boardId,
  project_id: projectId,
  created_by_id: "33333333-3333-4333-8333-333333333333",
  title: "Architecture",
  viewport_x: 10,
  viewport_y: 20,
  viewport_zoom: 1.25,
  revision: 3,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};
const flowId = "44444444-4444-4444-8444-444444444444";
const placementId = "55555555-5555-4555-8555-555555555555";
const placementWire = {
  id: placementId,
  board_id: boardId,
  target_kind: "automation",
  target_id: flowId,
  x: 12,
  y: 34,
  width: 360,
  height: 240,
  z_index: 2,
  display_state: "normal",
  revision: 0,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("board client contract", () => {
  beforeEach(() => jest.clearAllMocks());

  it("builds project-scoped list and detail keys", () => {
    expect(boardKeys.list(projectId)).toEqual(["boards", "list", projectId]);
    expect(boardKeys.detail(projectId, boardId)).toEqual([
      "boards",
      "detail",
      projectId,
      boardId,
    ]);
  });

  it("gets the project list and exact board through the authenticated API seam", async () => {
    mockApiGet
      .mockResolvedValueOnce({ data: [board] })
      .mockResolvedValueOnce({ data: board });
    const list = useGetBoards({ projectId }) as unknown as {
      queryFn: () => Promise<unknown>;
    };
    const detail = useGetBoard({ projectId, boardId }) as unknown as {
      queryFn: () => Promise<unknown>;
    };
    await expect(list.queryFn()).resolves.toEqual([board]);
    await expect(detail.queryFn()).resolves.toEqual(board);
    expect(mockQuery).toHaveBeenCalledWith(
      boardKeys.list(projectId),
      expect.any(Function),
      expect.any(Object),
    );
    expect(mockQuery).toHaveBeenCalledWith(
      boardKeys.detail(projectId, boardId),
      expect.any(Function),
      expect.any(Object),
    );
    expect(mockApiGet).toHaveBeenCalledWith(
      `/api/v1/projects/${projectId}/boards`,
    );
    expect(mockApiGet).toHaveBeenCalledWith(`/api/v1/boards/${boardId}`);
  });

  it("creates without retry and invalidates only its project list", async () => {
    mockApiPost.mockResolvedValueOnce({ data: board });
    const mutation = usePostBoard({ projectId }) as unknown as {
      mutate: (value: { title: string }) => Promise<unknown>;
    };
    await mutation.mutate({ title: board.title });
    expect(mockApiPost).toHaveBeenCalledWith(
      `/api/v1/projects/${projectId}/boards`,
      { title: board.title },
    );
    expect(mockMutate.mock.calls.at(-1)?.[2]).toEqual(
      expect.objectContaining({ retry: false }),
    );
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: boardKeys.list(projectId),
    });
  });

  it("sends one atomic Board automation command with the caller-owned idempotency key", async () => {
    const resultWire = {
      automation: {
        id: flowId,
        name: "Inside Board",
        description: null,
      },
      placement: placementWire,
      idempotency_replayed: false,
    };
    mockApiPost.mockResolvedValueOnce({ data: resultWire });
    const mutation = useCreateBoardAutomation({
      projectId,
      boardId,
    }) as unknown as {
      mutate: (value: unknown) => Promise<unknown>;
    };

    await expect(
      mutation.mutate({
        idempotencyKey: "66666666-6666-4666-8666-666666666666",
        starter: { kind: "blank_automation", name: "Inside Board" },
        placement: { x: 12, y: 34, width: 360, height: 240, zIndex: 2 },
      }),
    ).resolves.toEqual({
      automation: resultWire.automation,
      placement: {
        id: placementId,
        boardId,
        targetKind: "automation",
        targetId: flowId,
        x: 12,
        y: 34,
        width: 360,
        height: 240,
        zIndex: 2,
        displayState: "normal",
        revision: 0,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
      idempotencyReplayed: false,
    });
    expect(mockApiPost).toHaveBeenCalledTimes(1);
    expect(mockApiPost).toHaveBeenCalledWith(
      `/api/v1/boards/${boardId}/automations`,
      {
        starter: { kind: "blank_automation", name: "Inside Board" },
        placement: {
          x: 12,
          y: 34,
          width: 360,
          height: 240,
          z_index: 2,
        },
      },
      {
        headers: {
          "Idempotency-Key": "66666666-6666-4666-8666-666666666666",
        },
      },
    );
    expect(mockMutate.mock.calls.at(-1)?.[2]).toEqual(
      expect.objectContaining({ retry: false }),
    );
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: automationSummaryKeys.project(projectId),
    });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: placementKeys.scene(boardId),
    });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: boardKeys.detail(projectId, boardId),
    });
  });

  it("does not invalidate atomic command queries after a transport failure", async () => {
    const failure = new Error("offline");
    mockApiPost.mockRejectedValueOnce(failure);
    const mutation = useCreateBoardAutomation({
      projectId,
      boardId,
    }) as unknown as {
      mutate: (value: unknown) => Promise<unknown>;
    };

    await expect(
      mutation.mutate({
        idempotencyKey: "77777777-7777-4777-8777-777777777777",
        starter: { kind: "blank_automation", name: "Inside Board" },
        placement: { x: 0, y: 0 },
      }),
    ).rejects.toBe(failure);
    expect(mockInvalidateQueries).not.toHaveBeenCalled();
  });

  it("bootstraps every Board starter through the compound endpoint and preserves replay", async () => {
    const starters = [
      { kind: "clean" },
      { kind: "blank_automation", name: "Blank" },
      { kind: "simple_agent", name: "Simple" },
      { kind: "vector_store_rag", name: "RAG" },
      {
        kind: "template",
        template_id: "88888888-8888-4888-8888-888888888888",
        name: "Template",
      },
    ] as const;
    for (const [index, starter] of starters.entries()) {
      mockApiPost.mockResolvedValueOnce({
        data: {
          board,
          automation:
            starter.kind === "clean"
              ? null
              : { id: flowId, name: "Flow", description: null },
          placement: starter.kind === "clean" ? null : placementWire,
          idempotency_replayed: index === starters.length - 1,
        },
      });
      const mutation = useBootstrapBoard({ projectId }) as unknown as {
        mutate: (value: unknown) => Promise<{
          idempotencyReplayed: boolean;
        }>;
      };
      const idempotencyKey = `99999999-9999-4999-8999-99999999999${index}`;
      const result = await mutation.mutate({
        title: "Board",
        starter,
        idempotencyKey,
      });
      expect(mockApiPost).toHaveBeenLastCalledWith(
        `/api/v1/projects/${projectId}/boards/bootstrap`,
        { title: "Board", starter },
        { headers: { "Idempotency-Key": idempotencyKey } },
      );
      expect(result.idempotencyReplayed).toBe(index === starters.length - 1);
    }
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: boardKeys.list(projectId),
    });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: automationSummaryKeys.project(projectId),
    });
  });

  it("renames and updates viewport with CAS, exact detail cache, and list invalidation", async () => {
    const renamed = { ...board, title: "Renamed", revision: 4 };
    const moved = {
      ...renamed,
      viewport_x: 1,
      viewport_y: 2,
      viewport_zoom: 1.5,
      revision: 5,
    };
    mockApiPatch.mockResolvedValueOnce({ data: renamed });
    mockApiPut.mockResolvedValueOnce({ data: moved });
    const rename = usePatchBoard({ projectId }) as unknown as {
      mutate: (value: unknown) => Promise<unknown>;
    };
    const viewport = usePutBoardViewport({ projectId, boardId }) as unknown as {
      mutate: (value: unknown) => Promise<unknown>;
    };
    await rename.mutate({ boardId, title: "Renamed", expected_revision: 3 });
    await viewport.mutate({ x: 1, y: 2, zoom: 1.5, expected_revision: 4 });
    expect(mockApiPatch).toHaveBeenCalledWith(`/api/v1/boards/${boardId}`, {
      title: "Renamed",
      expected_revision: 3,
    });
    expect(mockApiPut).toHaveBeenCalledWith(
      `/api/v1/boards/${boardId}/viewport`,
      { x: 1, y: 2, zoom: 1.5, expected_revision: 4 },
    );
    expect(mockSetQueryData).toHaveBeenCalledWith(
      boardKeys.detail(projectId, boardId),
      renamed,
    );
    expect(mockSetQueryData).toHaveBeenCalledWith(
      boardKeys.detail(projectId, boardId),
      moved,
    );
  });

  it("removes detail only after delete success and refetches it on typed 409", async () => {
    const mutation = useDeleteBoard({ projectId }) as unknown as {
      mutate: (value: unknown) => Promise<unknown>;
    };
    mockApiDelete.mockResolvedValueOnce({ status: 204 });
    await mutation.mutate({ boardId, expected_revision: 3 });
    expect(mockApiDelete).toHaveBeenCalledWith(`/api/v1/boards/${boardId}`, {
      params: { expected_revision: 3 },
    });
    expect(mockRemoveQueries).toHaveBeenCalledWith({
      queryKey: boardKeys.detail(projectId, boardId),
      exact: true,
    });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: boardKeys.list(projectId),
    });

    jest.clearAllMocks();
    const conflict = new AxiosError(
      "Conflict",
      "ERR_BAD_REQUEST",
      undefined,
      undefined,
      {
        data: { detail: { code: "board_revision_conflict" } },
        status: 409,
        statusText: "Conflict",
        headers: {},
        config: { headers: {} },
      },
    );
    mockApiDelete.mockRejectedValueOnce(conflict);
    const stale = useDeleteBoard({ projectId }) as unknown as {
      mutate: (value: unknown) => Promise<unknown>;
    };
    await expect(stale.mutate({ boardId, expected_revision: 3 })).rejects.toBe(
      conflict,
    );
    expect(mockRemoveQueries).not.toHaveBeenCalled();
    expect(mockRefetchQueries).toHaveBeenCalledWith({
      queryKey: boardKeys.detail(projectId, boardId),
      exact: true,
    });
  });
});
