import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { ChatThread } from "@/types/chat";
import { ChatList } from "../ChatList";

const mockGetChats = jest.fn();
const mockPatchChat = jest.fn();
jest.mock("@/controllers/API/queries/chat-threads", () => ({
  useGetProjectChats: (...args: unknown[]) => mockGetChats(...args),
  usePatchChat: (...args: unknown[]) => mockPatchChat(...args),
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => undefined },
}));

const chat: ChatThread = {
  id: "chat-1",
  projectId: "project-1",
  createdById: "actor-1",
  title: "Saved copilot",
  provider: "OpenAI",
  modelName: "gpt-4o",
  contextPolicy: "board",
  archived: false,
  revision: 7,
  createdAt: "2026-07-20T00:00:00Z",
  updatedAt: "2026-07-20T01:00:00Z",
};
const refetch = jest.fn();

function renderList(
  props: Partial<React.ComponentProps<typeof ChatList>> = {},
) {
  return render(
    <ChatList
      projectId="project-1"
      isCreatePending={false}
      onCreate={jest.fn()}
      onOpen={jest.fn()}
      {...props}
    />,
  );
}

describe("ChatList", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: true,
    });
    mockGetChats.mockReturnValue({
      data: [chat],
      isLoading: false,
      isError: false,
      refetch,
    });
    mockPatchChat.mockReturnValue({ isPending: false, mutate: jest.fn() });
  });

  it.each([
    [
      "loading",
      { data: undefined, isLoading: true, isError: false },
      "chat.states.loading",
    ],
    [
      "empty",
      { data: [], isLoading: false, isError: false },
      "chat.states.empty",
    ],
  ])("renders the %s shell state", (_name, values, expected) => {
    mockGetChats.mockReturnValue({ ...values, refetch });
    renderList();
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("forwards search to the server and distinguishes no results", () => {
    mockGetChats.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch,
    });
    renderList();
    fireEvent.change(
      screen.getByRole("searchbox", { name: "chat.search.label" }),
      {
        target: { value: "contract" },
      },
    );
    expect(mockGetChats).toHaveBeenLastCalledWith(
      { projectId: "project-1", q: "contract" },
      { enabled: true },
    );
    expect(screen.getByText("chat.states.noResults")).toBeInTheDocument();
  });

  it("renders API error/retry and reconnect status", () => {
    mockGetChats.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    });
    renderList();
    fireEvent.click(
      screen.getByRole("button", { name: /chat\.actions\.retry/i }),
    );
    expect(refetch).toHaveBeenCalledTimes(1);

    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: false,
    });
    fireEvent(window, new Event("offline"));
    expect(screen.getByRole("status")).toHaveTextContent(
      "chat.states.reconnect",
    );
    expect(mockGetChats).toHaveBeenLastCalledWith(
      { projectId: "project-1", q: "" },
      { enabled: false },
    );
  });

  it("suppresses duplicate open while preserving the complete entity", () => {
    const onOpen = jest.fn();
    renderList({ onOpen });
    const button = screen.getByRole("button", { name: /saved copilot/i });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "chat-1",
        provider: "OpenAI",
        modelName: "gpt-4o",
        contextPolicy: "board",
      }),
    );
  });

  it("delegates create to the Board command owner and suppresses duplicate activation", () => {
    const onCreate = jest.fn();
    renderList({ onCreate });
    const button = screen.getByRole("button", {
      name: /chat\.actions\.create/i,
    });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("keeps Create disabled while the shared atomic command is pending", () => {
    const onCreate = jest.fn();
    renderList({ onCreate, isCreatePending: true });
    const button = screen.getByRole("button", {
      name: /chat\.actions\.create/i,
    });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("consumes a rejected Board command event and re-enables activation", async () => {
    const onCreate = jest.fn().mockRejectedValue(new Error("network"));
    renderList({ onCreate });
    const button = screen.getByRole("button", {
      name: /chat\.actions\.create/i,
    });

    fireEvent.click(button);
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    fireEvent.click(button);
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(2));
  });
});
