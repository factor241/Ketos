import { renderHook } from "@testing-library/react";
import { useChatReconnect } from "../use-chat-reconnect";
import { useGetChat } from "../use-get-chat";

jest.mock("../use-get-chat", () => ({ useGetChat: jest.fn() }));

const CHAT_ID = "11111111-1111-4111-8111-111111111111";
const mockedUseGetChat = jest.mocked(useGetChat);
const chat = {
  id: CHAT_ID,
  projectId: "project-1",
  createdById: "actor-1",
  title: "Server chat",
  provider: "test",
  modelName: "test",
  contextPolicy: "board" as const,
  archived: false,
  revision: 1,
  createdAt: "2026-07-21T00:00:00Z",
  updatedAt: "2026-07-21T00:00:00Z",
};

const query = (overrides: Record<string, unknown> = {}) => ({
  data: undefined,
  isLoading: false,
  isFetching: false,
  isError: false,
  refetch: jest.fn(),
  ...overrides,
});

it("restores only the exact server thread", () => {
  mockedUseGetChat.mockReturnValue(
    query({ data: chat }) as ReturnType<typeof useGetChat>,
  );
  const { result } = renderHook(() => useChatReconnect({ chatId: CHAT_ID }));
  expect(mockedUseGetChat).toHaveBeenCalledWith({ chatId: CHAT_ID });
  expect(result.current).toMatchObject({
    phase: "restored",
    chat,
    announcementKey: "chat.states.restored",
  });
});

it("fails closed for mismatched identity", () => {
  mockedUseGetChat.mockReturnValue(
    query({ data: { ...chat, id: "foreign" } }) as ReturnType<
      typeof useGetChat
    >,
  );
  const { result } = renderHook(() => useChatReconnect({ chatId: CHAT_ID }));
  expect(result.current).toMatchObject({ phase: "unknown", chat: null });
});

it.each([
  [{ isLoading: true }, "reconnecting"],
  [{ isFetching: true, data: chat }, "reconnecting"],
  [{ isError: true }, "failed_recoverable"],
])("maps query state %o to %s", (state, phase) => {
  mockedUseGetChat.mockReturnValue(
    query(state) as ReturnType<typeof useGetChat>,
  );
  const { result } = renderHook(() => useChatReconnect({ chatId: CHAT_ID }));
  expect(result.current.phase).toBe(phase);
});
