import { chatThreadKeys } from "../keys";
import { useGetChat } from "../use-get-chat";
import { useGetProjectChats } from "../use-get-project-chats";
import { usePatchChat } from "../use-patch-chat";
import { usePostChat } from "../use-post-chat";

const mockApiGet = jest.fn();
const mockApiPost = jest.fn();
const mockApiPatch = jest.fn();
const mockInvalidateQueries = jest.fn();
const mockSetQueryData = jest.fn();
const mockQuery = jest.fn((_key, queryFn) => ({ queryFn }));
const mockMutate = jest.fn((_key, mutationFn, options = {}) => ({
  mutate: async (payload: unknown) => {
    const result = await mutationFn(payload);
    await options.onSuccess?.(result, payload);
    return result;
  },
}));

jest.mock("@/controllers/API/api", () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: (...args: unknown[]) => mockApiPost(...args),
    patch: (...args: unknown[]) => mockApiPatch(...args),
  },
}));
jest.mock("@/controllers/API/helpers/constants", () => ({
  getURL: (key: string) =>
    `/api/v1/${key === "PROJECTS" ? "projects" : "chats"}`,
}));
jest.mock("@/controllers/API/services/request-processor", () => ({
  UseRequestProcessor: () => ({
    query: mockQuery,
    mutate: mockMutate,
    queryClient: {
      invalidateQueries: mockInvalidateQueries,
      setQueryData: mockSetQueryData,
    },
  }),
}));

const projectId = "11111111-1111-4111-8111-111111111111";
const chatId = "22222222-2222-4222-8222-222222222222";
const wireChat = {
  id: chatId,
  project_id: projectId,
  created_by_id: "33333333-3333-4333-8333-333333333333",
  title: "Incident copilot",
  provider: "OpenAI",
  model_name: "gpt-4o",
  context_policy: "board",
  archived: false,
  revision: 4,
  created_at: "2026-07-20T00:00:00Z",
  updated_at: "2026-07-20T01:00:00Z",
};

describe("chat thread query contract", () => {
  beforeEach(() => jest.clearAllMocks());

  it("isolates project, search, archive and detail cache keys", () => {
    expect(chatThreadKeys.list(projectId, "alpha", false)).not.toEqual(
      chatThreadKeys.list(projectId, "beta", false),
    );
    expect(chatThreadKeys.list(projectId, "alpha", false)).not.toEqual(
      chatThreadKeys.list(projectId, "alpha", true),
    );
    expect(chatThreadKeys.detail(chatId)).not.toEqual(
      chatThreadKeys.detail("different"),
    );
  });

  it("uses server title search and maps complete model/context identity", async () => {
    mockApiGet.mockResolvedValueOnce({ data: [wireChat] });
    const list = useGetProjectChats({
      projectId,
      q: "  Incident  ",
      includeArchived: true,
    }) as unknown as { queryFn: () => Promise<unknown> };

    await expect(list.queryFn()).resolves.toEqual([
      expect.objectContaining({
        id: chatId,
        projectId,
        modelName: "gpt-4o",
        contextPolicy: "board",
      }),
    ]);
    expect(mockApiGet).toHaveBeenCalledWith(
      `/api/v1/projects/${projectId}/chats`,
      { params: { q: "Incident", include_archived: true } },
    );

    mockApiGet.mockResolvedValueOnce({ data: wireChat });
    const detail = useGetChat({ chatId }) as unknown as {
      queryFn: () => Promise<unknown>;
    };
    await expect(detail.queryFn()).resolves.toEqual(
      expect.objectContaining({
        id: chatId,
        createdById: wireChat.created_by_id,
      }),
    );
    expect(mockApiGet).toHaveBeenLastCalledWith(`/api/v1/chats/${chatId}`);
  });

  it("creates and patches with exact snake-case payloads and cache invalidation", async () => {
    mockApiPost.mockResolvedValueOnce({ data: wireChat });
    const create = usePostChat({ projectId }) as unknown as {
      mutate: (value: unknown) => Promise<unknown>;
    };
    await create.mutate({
      title: "Incident copilot",
      provider: "OpenAI",
      modelName: "gpt-4o",
      contextPolicy: "board",
    });
    expect(mockApiPost).toHaveBeenCalledWith(
      `/api/v1/projects/${projectId}/chats`,
      {
        title: "Incident copilot",
        provider: "OpenAI",
        model_name: "gpt-4o",
        context_policy: "board",
      },
    );

    mockApiPatch.mockResolvedValueOnce({
      data: { ...wireChat, title: "Renamed" },
    });
    const patch = usePatchChat() as unknown as {
      mutate: (value: unknown) => Promise<unknown>;
    };
    await patch.mutate({ chatId, expectedRevision: 4, title: "Renamed" });
    expect(mockApiPatch).toHaveBeenCalledWith(`/api/v1/chats/${chatId}`, {
      expected_revision: 4,
      title: "Renamed",
    });
    expect(mockSetQueryData).toHaveBeenCalledWith(
      chatThreadKeys.detail(chatId),
      expect.objectContaining({ title: "Renamed" }),
    );
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: chatThreadKeys.project(projectId),
    });
  });
});
