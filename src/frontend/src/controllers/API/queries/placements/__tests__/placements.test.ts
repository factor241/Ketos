import { AxiosError, AxiosHeaders } from "axios";
import { placementKeys } from "../keys";
import { useDeletePlacement } from "../use-delete-placement";
import { useGetBoardPlacements } from "../use-get-board-placements";
import { usePatchPlacement } from "../use-patch-placement";
import { usePostPlacement } from "../use-post-placement";

const mockApiGet = jest.fn();
const mockApiPost = jest.fn();
const mockApiPatch = jest.fn();
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
      return result;
    } catch (error) {
      await options.onError?.(error, payload);
      throw error;
    }
  },
}));

jest.mock("@/controllers/API/api", () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: (...args: unknown[]) => mockApiPost(...args),
    patch: (...args: unknown[]) => mockApiPatch(...args),
    delete: (...args: unknown[]) => mockApiDelete(...args),
  },
}));
jest.mock("@/controllers/API/helpers/constants", () => ({
  getURL: (key: string) =>
    `/api/v1/${key === "BOARDS" ? "boards" : "placements"}`,
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

const boardId = "11111111-1111-4111-8111-111111111111";
const placementId = "22222222-2222-4222-8222-222222222222";
const noteId = "33333333-3333-4333-8333-333333333333";
const wirePlacement = {
  id: placementId,
  board_id: boardId,
  target_kind: "note",
  target_id: noteId,
  x: 10,
  y: 20,
  width: 320,
  height: 240,
  z_index: 2,
  display_state: "normal",
  revision: 0,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("placement query contract", () => {
  beforeEach(() => jest.clearAllMocks());

  it("keeps scene and detail keys distinct", () => {
    expect(placementKeys.scene(boardId)).toEqual([
      "placements",
      "scene",
      boardId,
    ]);
    expect(placementKeys.detail(placementId)).toEqual([
      "placements",
      "detail",
      placementId,
    ]);
  });

  it("maps the authenticated wire scene to camelCase domain objects", async () => {
    mockApiGet.mockResolvedValueOnce({ data: [wirePlacement] });
    const query = useGetBoardPlacements({ boardId }) as unknown as {
      queryFn: () => Promise<unknown>;
    };
    await expect(query.queryFn()).resolves.toEqual([
      expect.objectContaining({
        id: placementId,
        boardId,
        targetId: noteId,
        targetKind: "note",
        zIndex: 2,
        displayState: "normal",
      }),
    ]);
    expect(mockApiGet).toHaveBeenCalledWith(
      `/api/v1/boards/${boardId}/placements`,
    );
  });

  it("creates, moves and closes with exact snake_case transport", async () => {
    mockApiPost.mockResolvedValueOnce({ data: wirePlacement });
    const create = usePostPlacement({ boardId }) as unknown as {
      mutate: (value: unknown) => Promise<unknown>;
    };
    await create.mutate({
      targetKind: "note",
      targetId: noteId,
      x: 10,
      y: 20,
      zIndex: 2,
    });
    expect(mockApiPost).toHaveBeenCalledWith(
      `/api/v1/boards/${boardId}/placements`,
      {
        target_kind: "note",
        target_id: noteId,
        x: 10,
        y: 20,
        width: 320,
        height: 240,
        z_index: 2,
      },
    );
    expect(mockSetQueryData).toHaveBeenCalledWith(
      placementKeys.detail(placementId),
      expect.objectContaining({ boardId, targetId: noteId }),
    );

    mockApiPatch.mockResolvedValueOnce({
      data: {
        ...wirePlacement,
        x: 99,
        display_state: "collapsed",
        revision: 1,
      },
    });
    const patch = usePatchPlacement({ boardId }) as unknown as {
      mutate: (value: unknown) => Promise<unknown>;
    };
    await patch.mutate({
      placementId,
      x: 99,
      displayState: "collapsed",
      expectedRevision: 0,
    });
    expect(mockApiPatch).toHaveBeenCalledWith(
      `/api/v1/placements/${placementId}`,
      {
        x: 99,
        display_state: "collapsed",
        expected_revision: 0,
      },
    );

    mockApiDelete.mockResolvedValueOnce({ status: 204 });
    const close = useDeletePlacement({ boardId }) as unknown as {
      mutate: (value: unknown) => Promise<unknown>;
    };
    await close.mutate({ placementId, expectedRevision: 1 });
    expect(mockApiDelete).toHaveBeenCalledWith(
      `/api/v1/placements/${placementId}`,
      {
        params: { expected_revision: 1 },
      },
    );
    expect(mockRemoveQueries).toHaveBeenCalledWith({
      queryKey: placementKeys.detail(placementId),
      exact: true,
    });
  });

  it("never retries a mutation and refetches geometry truth on 409", async () => {
    const conflict = new AxiosError(
      "Conflict",
      "ERR_BAD_REQUEST",
      undefined,
      undefined,
      {
        data: { detail: { code: "stale_revision" } },
        status: 409,
        statusText: "Conflict",
        headers: new AxiosHeaders(),
        config: { headers: new AxiosHeaders() },
      },
    );
    mockApiPatch.mockRejectedValueOnce(conflict);
    const patch = usePatchPlacement({ boardId }) as unknown as {
      mutate: (value: unknown) => Promise<unknown>;
    };
    await expect(
      patch.mutate({ placementId, x: 1, expectedRevision: 0 }),
    ).rejects.toBe(conflict);
    expect(mockMutate.mock.calls.at(-1)?.[2]).toEqual(
      expect.objectContaining({ retry: false }),
    );
    expect(mockRefetchQueries).toHaveBeenCalledWith({
      queryKey: placementKeys.detail(placementId),
      exact: true,
    });
    expect(mockRefetchQueries).toHaveBeenCalledWith({
      queryKey: placementKeys.scene(boardId),
    });
  });
});
