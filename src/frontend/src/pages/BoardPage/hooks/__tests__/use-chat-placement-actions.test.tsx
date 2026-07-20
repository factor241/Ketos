import { renderHook } from "@testing-library/react";

import { usePatchChat } from "@/controllers/API/queries/chat-threads";
import { usePostPlacement } from "@/controllers/API/queries/placements";
import type { Placement } from "@/types/board";
import type { ChatThread } from "@/types/chat";
import { useChatPlacementActions } from "../use-chat-placement-actions";

jest.mock("@/controllers/API/queries/chat-threads");
jest.mock("@/controllers/API/queries/placements");

const mockPatchChat = jest.mocked(usePatchChat);
const mockPostPlacement = jest.mocked(usePostPlacement);
const chat = {
  id: "chat-1",
  projectId: "project-1",
  createdById: "user-1",
  title: "Incident copilot",
  provider: "OpenAI",
  modelName: "gpt-4o",
  contextPolicy: "board",
  archived: false,
  revision: 4,
  createdAt: "",
  updatedAt: "",
} satisfies ChatThread;
const placement = {
  id: "placement-1",
  boardId: "board-1",
  targetKind: "chat",
  targetId: chat.id,
  x: 10,
  y: 20,
  width: 480,
  height: 360,
  zIndex: 0,
  displayState: "normal",
  revision: 0,
  createdAt: "",
  updatedAt: "",
} satisfies Placement;
const siblingPlacement = {
  ...placement,
  id: "placement-2",
  targetId: "chat-2",
  x: 560,
  y: 40,
} satisfies Placement;

describe("useChatPlacementActions", () => {
  it("reuses an existing placement and creates only an unplaced durable chat", async () => {
    const mutateAsync = jest.fn().mockResolvedValue(placement);
    mockPostPlacement.mockReturnValue({
      mutateAsync,
      isPending: false,
    } as never);
    mockPatchChat.mockReturnValue({
      mutate: jest.fn(),
      isPending: false,
    } as never);
    const { result } = renderHook(() =>
      useChatPlacementActions({ boardId: "board-1" }),
    );

    await expect(
      result.current.open(chat, [placement], { x: 500, y: 400 }),
    ).resolves.toBe(placement);
    expect(mutateAsync).not.toHaveBeenCalled();

    await result.current.open(chat, [], { x: 500, y: 400 });
    expect(mutateAsync).toHaveBeenCalledWith({
      targetKind: "chat",
      targetId: chat.id,
      x: 260,
      y: 220,
      width: 480,
      height: 360,
    });
  });

  it("archives by CAS without deleting the Chat entity", () => {
    const archive = jest.fn();
    mockPostPlacement.mockReturnValue({
      mutateAsync: jest.fn(),
      isPending: false,
    } as never);
    mockPatchChat.mockReturnValue({
      mutate: archive,
      isPending: false,
    } as never);
    const { result } = renderHook(() =>
      useChatPlacementActions({ boardId: "board-1" }),
    );

    result.current.archive(chat);
    expect(archive).toHaveBeenCalledWith({
      chatId: chat.id,
      expectedRevision: 4,
      archived: true,
    });
  });

  it("re-places a closed chat in a collision-free adjacent slot", async () => {
    const mutateAsync = jest.fn().mockResolvedValue(placement);
    mockPostPlacement.mockReturnValue({
      mutateAsync,
      isPending: false,
    } as never);
    mockPatchChat.mockReturnValue({
      mutate: jest.fn(),
      isPending: false,
    } as never);
    const { result } = renderHook(() =>
      useChatPlacementActions({ boardId: "board-1" }),
    );

    await result.current.open(chat, [siblingPlacement], { x: 600, y: 400 });

    expect(mutateAsync).toHaveBeenCalledWith({
      targetKind: "chat",
      targetId: chat.id,
      x: 40,
      y: 40,
      width: 480,
      height: 360,
    });
  });
});
