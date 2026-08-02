import { AxiosError, AxiosHeaders } from "axios";
import { placementKeys } from "../../placements/keys";
import { boardNoteKeys } from "../keys";
import { useDeleteBoardNote } from "../use-delete-board-note";
import { useGetBoardNote } from "../use-get-board-note";
import { useGetProjectBoardNotes } from "../use-get-project-board-notes";
import { usePatchBoardNote } from "../use-patch-board-note";
import { usePostBoardNote } from "../use-post-board-note";

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
  getURL: (key: string) => {
    const values: Record<string, string> = {
      BOARDS: "boards",
      PROJECTS: "projects",
      BOARD_NOTES: "board-notes",
    };
    return `/api/v1/${values[key]}`;
  },
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
const noteId = "33333333-3333-4333-8333-333333333333";
const placementId = "44444444-4444-4444-8444-444444444444";
const wireNote = {
  id: noteId,
  project_id: projectId,
  created_by_id: "55555555-5555-4555-8555-555555555555",
  content: "draft",
  color: "yellow",
  revision: 0,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};
const wirePlacement = {
  id: placementId,
  board_id: boardId,
  target_kind: "note",
  target_id: noteId,
  x: 0,
  y: 0,
  width: 320,
  height: 240,
  z_index: 0,
  display_state: "normal",
  revision: 0,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("board note query contract", () => {
  beforeEach(() => jest.clearAllMocks());

  it("keeps project entities and note details in separate caches", () => {
    expect(boardNoteKeys.project(projectId)).toEqual([
      "board-notes",
      "project",
      projectId,
    ]);
    expect(boardNoteKeys.detail(noteId)).toEqual([
      "board-notes",
      "detail",
      noteId,
    ]);
  });

  it("gets and maps project/detail entities", async () => {
    mockApiGet
      .mockResolvedValueOnce({ data: [wireNote] })
      .mockResolvedValueOnce({ data: wireNote });
    const list = useGetProjectBoardNotes({ projectId }) as unknown as {
      queryFn: () => Promise<unknown>;
    };
    const detail = useGetBoardNote({ noteId }) as unknown as {
      queryFn: () => Promise<unknown>;
    };
    await expect(list.queryFn()).resolves.toEqual([
      expect.objectContaining({
        id: noteId,
        projectId,
        createdById: wireNote.created_by_id,
      }),
    ]);
    await expect(detail.queryFn()).resolves.toEqual(
      expect.objectContaining({ id: noteId, projectId }),
    );
    expect(mockApiGet).toHaveBeenCalledWith(
      `/api/v1/projects/${projectId}/board-notes`,
    );
    expect(mockApiGet).toHaveBeenCalledWith(`/api/v1/board-notes/${noteId}`);
  });

  it("creates one entity and one placement without mixing caches", async () => {
    mockApiPost.mockResolvedValueOnce({
      data: { note: wireNote, placement: wirePlacement },
    });
    const create = usePostBoardNote({ projectId, boardId }) as unknown as {
      mutate: (value: unknown) => Promise<unknown>;
    };
    await create.mutate({
      content: "draft",
      color: "yellow",
      placement: { x: 0, y: 0 },
    });
    expect(mockApiPost).toHaveBeenCalledWith(
      `/api/v1/boards/${boardId}/board-notes`,
      {
        content: "draft",
        color: "yellow",
        placement: { x: 0, y: 0, width: 320, height: 240, z_index: 0 },
      },
    );
    expect(mockSetQueryData).toHaveBeenCalledWith(
      boardNoteKeys.detail(noteId),
      expect.objectContaining({ id: noteId, projectId }),
    );
    expect(mockSetQueryData).toHaveBeenCalledWith(
      placementKeys.detail(placementId),
      expect.objectContaining({ id: placementId, targetId: noteId }),
    );
  });

  it("preserves the unsaved draft and refetches server truth on 409", async () => {
    const onConflict = jest.fn();
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
    const patch = usePatchBoardNote({ projectId, onConflict }) as unknown as {
      mutate: (value: unknown) => Promise<unknown>;
    };
    await expect(
      patch.mutate({
        noteId,
        content: "local draft",
        expectedRevision: 0,
        unsavedDraft: "local draft",
      }),
    ).rejects.toBe(conflict);
    expect(mockApiPatch).toHaveBeenCalledWith(`/api/v1/board-notes/${noteId}`, {
      content: "local draft",
      expected_revision: 0,
    });
    expect(onConflict).toHaveBeenCalledWith({
      code: "stale_revision",
      noteId,
      unsavedDraft: "local draft",
    });
    expect(mockRefetchQueries).toHaveBeenCalledWith({
      queryKey: boardNoteKeys.detail(noteId),
      exact: true,
    });
    expect(mockRefetchQueries).toHaveBeenCalledWith({
      queryKey: boardNoteKeys.project(projectId),
    });
    expect(mockMutate.mock.calls.at(-1)?.[2]).toEqual(
      expect.objectContaining({ retry: false }),
    );
  });

  it("deletes explicitly and invalidates all placements", async () => {
    mockApiDelete.mockResolvedValueOnce({ status: 204 });
    const remove = useDeleteBoardNote({ projectId }) as unknown as {
      mutate: (value: unknown) => Promise<unknown>;
    };
    await remove.mutate({ noteId, expectedRevision: 2 });
    expect(mockApiDelete).toHaveBeenCalledWith(
      `/api/v1/board-notes/${noteId}`,
      {
        params: { expected_revision: 2, confirm_entity_delete: true },
      },
    );
    expect(mockRemoveQueries).toHaveBeenCalledWith({
      queryKey: boardNoteKeys.detail(noteId),
      exact: true,
    });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: placementKeys.all,
    });
  });
});
