import { AxiosError } from "axios";
import { useDeleteBoard } from "../use-delete-board";
import { useGetBoard } from "../use-get-board";
import { useGetBoards } from "../use-get-boards";
import { usePatchBoard } from "../use-patch-board";
import { usePostBoard } from "../use-post-board";
import { usePutBoardViewport } from "../use-put-board-viewport";
import { boardKeys } from "../keys";

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
  getURL: (key: string) => key === "PROJECTS" ? "/api/v1/projects" : "/api/v1/boards",
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

describe("board client contract", () => {
  beforeEach(() => jest.clearAllMocks());

  it("builds project-scoped list and detail keys", () => {
    expect(boardKeys.list(projectId)).toEqual(["boards", "list", projectId]);
    expect(boardKeys.detail(projectId, boardId)).toEqual(["boards", "detail", projectId, boardId]);
  });

  it("gets the project list and exact board through the authenticated API seam", async () => {
    mockApiGet.mockResolvedValueOnce({ data: [board] }).mockResolvedValueOnce({ data: board });
    const list = useGetBoards({ projectId }) as unknown as { queryFn: () => Promise<unknown> };
    const detail = useGetBoard({ projectId, boardId }) as unknown as { queryFn: () => Promise<unknown> };
    await expect(list.queryFn()).resolves.toEqual([board]);
    await expect(detail.queryFn()).resolves.toEqual(board);
    expect(mockQuery).toHaveBeenCalledWith(boardKeys.list(projectId), expect.any(Function), expect.any(Object));
    expect(mockQuery).toHaveBeenCalledWith(boardKeys.detail(projectId, boardId), expect.any(Function), expect.any(Object));
    expect(mockApiGet).toHaveBeenCalledWith(`/api/v1/projects/${projectId}/boards`);
    expect(mockApiGet).toHaveBeenCalledWith(`/api/v1/boards/${boardId}`);
  });

  it("creates without retry and invalidates only its project list", async () => {
    mockApiPost.mockResolvedValueOnce({ data: board });
    const mutation = usePostBoard({ projectId }) as unknown as { mutate: (value: { title: string }) => Promise<unknown> };
    await mutation.mutate({ title: board.title });
    expect(mockApiPost).toHaveBeenCalledWith(`/api/v1/projects/${projectId}/boards`, { title: board.title });
    expect(mockMutate.mock.calls.at(-1)?.[2]).toEqual(expect.objectContaining({ retry: false }));
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: boardKeys.list(projectId) });
  });

  it("renames and updates viewport with CAS, exact detail cache, and list invalidation", async () => {
    const renamed = { ...board, title: "Renamed", revision: 4 };
    const moved = { ...renamed, viewport_x: 1, viewport_y: 2, viewport_zoom: 1.5, revision: 5 };
    mockApiPatch.mockResolvedValueOnce({ data: renamed });
    mockApiPut.mockResolvedValueOnce({ data: moved });
    const rename = usePatchBoard({ projectId }) as unknown as { mutate: (value: unknown) => Promise<unknown> };
    const viewport = usePutBoardViewport({ projectId, boardId }) as unknown as { mutate: (value: unknown) => Promise<unknown> };
    await rename.mutate({ boardId, title: "Renamed", expected_revision: 3 });
    await viewport.mutate({ x: 1, y: 2, zoom: 1.5, expected_revision: 4 });
    expect(mockApiPatch).toHaveBeenCalledWith(`/api/v1/boards/${boardId}`, { title: "Renamed", expected_revision: 3 });
    expect(mockApiPut).toHaveBeenCalledWith(`/api/v1/boards/${boardId}/viewport`, { x: 1, y: 2, zoom: 1.5, expected_revision: 4 });
    expect(mockSetQueryData).toHaveBeenCalledWith(boardKeys.detail(projectId, boardId), renamed);
    expect(mockSetQueryData).toHaveBeenCalledWith(boardKeys.detail(projectId, boardId), moved);
  });

  it("removes detail only after delete success and refetches it on typed 409", async () => {
    const mutation = useDeleteBoard({ projectId }) as unknown as { mutate: (value: unknown) => Promise<unknown> };
    mockApiDelete.mockResolvedValueOnce({ status: 204 });
    await mutation.mutate({ boardId, expected_revision: 3 });
    expect(mockApiDelete).toHaveBeenCalledWith(`/api/v1/boards/${boardId}`, { params: { expected_revision: 3 } });
    expect(mockRemoveQueries).toHaveBeenCalledWith({ queryKey: boardKeys.detail(projectId, boardId), exact: true });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: boardKeys.list(projectId) });

    jest.clearAllMocks();
    const conflict = new AxiosError("Conflict", "ERR_BAD_REQUEST", undefined, undefined, {
      data: { detail: { code: "board_revision_conflict" } }, status: 409, statusText: "Conflict", headers: {}, config: { headers: {} },
    });
    mockApiDelete.mockRejectedValueOnce(conflict);
    const stale = useDeleteBoard({ projectId }) as unknown as { mutate: (value: unknown) => Promise<unknown> };
    await expect(stale.mutate({ boardId, expected_revision: 3 })).rejects.toBe(conflict);
    expect(mockRemoveQueries).not.toHaveBeenCalled();
    expect(mockRefetchQueries).toHaveBeenCalledWith({ queryKey: boardKeys.detail(projectId, boardId), exact: true });
  });
});
