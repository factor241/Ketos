import { act, renderHook } from "@testing-library/react";

import { api } from "@/controllers/API/api";
import { placementKeys } from "@/controllers/API/queries/placements";
import { UseRequestProcessor } from "@/controllers/API/services/request-processor";
import type { BoardChatCreateInput, BoardChatCreateResult } from "@/types/chat";
import { useCreateBoardChat } from "../use-create-board-chat";

jest.mock("@/controllers/API/api", () => ({
  api: { post: jest.fn() },
}));
jest.mock("@/controllers/API/services/request-processor", () => ({
  UseRequestProcessor: jest.fn(),
}));

const BOARD_ID = "550e8400-e29b-41d4-a716-446655440000";
const SECOND_BOARD_ID = "650e8400-e29b-41d4-a716-446655440000";
const PROJECT_ID = "123e4567-e89b-12d3-a456-426614174000";
const CHAT_ID = "a55d0df7-d7d8-48ca-9f3d-7552a04fca21";
const PLACEMENT_ID = "bc180f8b-0fac-4d26-93c4-901d95c3c487";
const FIRST_KEY = "11111111-1111-4111-8111-111111111111";
const SECOND_KEY = "22222222-2222-4222-8222-222222222222";

const input: BoardChatCreateInput = {
  title: "New chat",
  provider: "OpenAI",
  modelName: "gpt-4o",
  placement: { x: 12, y: 34, width: 480, height: 360, zIndex: 3 },
};

const wire = {
  chat: {
    id: CHAT_ID,
    project_id: PROJECT_ID,
    created_by_id: "2eef2e8e-28d0-4afe-9447-1d45f3f09c67",
    title: "New chat",
    provider: "OpenAI",
    model_name: "gpt-4o",
    context_policy: "board" as const,
    archived: false,
    revision: 0,
    created_at: "2026-07-25T00:00:00Z",
    updated_at: "2026-07-25T00:00:00Z",
  },
  placement: {
    id: PLACEMENT_ID,
    board_id: BOARD_ID,
    target_kind: "chat" as const,
    target_id: CHAT_ID,
    x: 12,
    y: 34,
    width: 480,
    height: 360,
    z_index: 3,
    display_state: "normal" as const,
    revision: 0,
    created_at: "2026-07-25T00:00:00Z",
    updated_at: "2026-07-25T00:00:00Z",
  },
  idempotency_replayed: false,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("useCreateBoardChat", () => {
  const invalidateQueries = jest.fn();
  const setQueryData = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (UseRequestProcessor as jest.Mock).mockImplementation(() => ({
      mutate: (
        _key: unknown,
        mutationFn: (variables: unknown) => Promise<BoardChatCreateResult>,
        options: {
          onSuccess?: (
            result: BoardChatCreateResult,
            variables: unknown,
            context: unknown,
          ) => Promise<void>;
        },
      ) => ({
        isPending: false,
        mutateAsync: async (variables: unknown) => {
          const result = await mutationFn(variables);
          await options.onSuccess?.(result, variables, undefined);
          return result;
        },
      }),
      queryClient: { invalidateQueries, setQueryData },
    }));
    jest.spyOn(crypto, "randomUUID").mockReturnValueOnce(FIRST_KEY);
  });

  it("posts the atomic Board command and maps both durable entities", async () => {
    (api.post as jest.Mock).mockResolvedValueOnce({ data: wire });
    const { result } = renderHook(() =>
      useCreateBoardChat({ boardId: BOARD_ID, projectId: PROJECT_ID }),
    );

    let created!: BoardChatCreateResult | undefined;
    await act(async () => {
      created = await result.current.create(input);
    });

    expect(api.post).toHaveBeenCalledWith(
      `/api/v1/boards/${BOARD_ID}/chats`,
      {
        title: "New chat",
        provider: "OpenAI",
        model_name: "gpt-4o",
        placement: {
          x: 12,
          y: 34,
          width: 480,
          height: 360,
          z_index: 3,
        },
      },
      { headers: { "Idempotency-Key": FIRST_KEY } },
    );
    expect(created).toEqual({
      chat: expect.objectContaining({
        id: CHAT_ID,
        projectId: PROJECT_ID,
        contextPolicy: "board",
      }),
      placement: expect.objectContaining({
        id: PLACEMENT_ID,
        boardId: BOARD_ID,
        targetKind: "chat",
        targetId: CHAT_ID,
      }),
      idempotencyReplayed: false,
    });
    expect(setQueryData).toHaveBeenCalledTimes(2);
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
  });

  it("coalesces repeat activation into one request and one intent key", async () => {
    const request = deferred<{ data: typeof wire }>();
    (api.post as jest.Mock).mockReturnValueOnce(request.promise);
    const { result } = renderHook(() =>
      useCreateBoardChat({ boardId: BOARD_ID, projectId: PROJECT_ID }),
    );

    let first!: Promise<BoardChatCreateResult | undefined>;
    let second!: Promise<BoardChatCreateResult | undefined>;
    act(() => {
      first = result.current.create(input);
      second = result.current.create(input);
    });

    expect(first).toBe(second);
    expect(api.post).toHaveBeenCalledTimes(1);
    request.resolve({ data: wire });
    await act(async () => {
      await Promise.all([first, second]);
    });
    expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
  });

  it("reuses the key for an exact retry and rotates it after payload edits", async () => {
    const failure = new Error("connection lost");
    (api.post as jest.Mock)
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce({ data: wire })
      .mockResolvedValueOnce({
        data: {
          ...wire,
          chat: { ...wire.chat, title: "Edited title" },
        },
      });
    (crypto.randomUUID as jest.Mock).mockReturnValueOnce(SECOND_KEY);
    const { result } = renderHook(() =>
      useCreateBoardChat({ boardId: BOARD_ID, projectId: PROJECT_ID }),
    );

    await act(async () => {
      await expect(result.current.create(input)).rejects.toBe(failure);
      await expect(result.current.create(input)).resolves.toBeDefined();
      await expect(
        result.current.create({ ...input, title: "Edited title" }),
      ).resolves.toBeDefined();
    });

    expect(
      (api.post as jest.Mock).mock.calls.map((call) => call[2].headers),
    ).toEqual([
      { "Idempotency-Key": FIRST_KEY },
      { "Idempotency-Key": FIRST_KEY },
      { "Idempotency-Key": SECOND_KEY },
    ]);
  });

  it("rotates the retry key when the Board route scope changes", async () => {
    (api.post as jest.Mock)
      .mockRejectedValueOnce(new Error("connection lost"))
      .mockResolvedValueOnce({
        data: {
          ...wire,
          placement: { ...wire.placement, board_id: SECOND_BOARD_ID },
        },
      });
    (crypto.randomUUID as jest.Mock).mockReturnValueOnce(SECOND_KEY);
    const { result, rerender } = renderHook(
      ({ boardId }) => useCreateBoardChat({ boardId, projectId: PROJECT_ID }),
      { initialProps: { boardId: BOARD_ID } },
    );

    await act(async () => {
      await expect(result.current.create(input)).rejects.toThrow(
        "connection lost",
      );
    });
    rerender({ boardId: SECOND_BOARD_ID });
    await act(async () => {
      await expect(result.current.create(input)).resolves.toBeDefined();
    });

    expect(api.post).toHaveBeenNthCalledWith(
      2,
      `/api/v1/boards/${SECOND_BOARD_ID}/chats`,
      expect.any(Object),
      { headers: { "Idempotency-Key": SECOND_KEY } },
    );
  });

  it("does not coalesce commands across a Board route change", async () => {
    const firstRequest = deferred<{ data: typeof wire }>();
    const secondRequest = deferred<{ data: typeof wire }>();
    (api.post as jest.Mock)
      .mockReturnValueOnce(firstRequest.promise)
      .mockReturnValueOnce(secondRequest.promise);
    (crypto.randomUUID as jest.Mock).mockReturnValueOnce(SECOND_KEY);
    const { result, rerender } = renderHook(
      ({ boardId }) => useCreateBoardChat({ boardId, projectId: PROJECT_ID }),
      { initialProps: { boardId: BOARD_ID } },
    );

    let first!: Promise<BoardChatCreateResult>;
    let second!: Promise<BoardChatCreateResult>;
    act(() => {
      first = result.current.create(input);
    });
    rerender({ boardId: SECOND_BOARD_ID });
    act(() => {
      second = result.current.create(input);
    });

    expect(first).not.toBe(second);
    expect(api.post).toHaveBeenCalledTimes(2);
    firstRequest.resolve({ data: wire });
    secondRequest.resolve({
      data: {
        ...wire,
        placement: { ...wire.placement, board_id: SECOND_BOARD_ID },
      },
    });
    await act(async () => {
      await Promise.all([first, second]);
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: placementKeys.scene(BOARD_ID),
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: placementKeys.scene(SECOND_BOARD_ID),
    });
  });
});
