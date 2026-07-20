import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Placement } from "@/types/board";
import type { ChatThread } from "@/types/chat";
import { ChatPlacement } from "./ChatPlacement";

const chats: Array<{ agentId?: string; threadId?: string }> = [];
jest.mock("@copilotkit/react-core/v2", () => ({
  CopilotChat: (props: { agentId?: string; threadId?: string }) => {
    chats.push(props);
    return <div data-testid={`chat-${props.threadId}`} />;
  },
}));
jest.mock("../BoardCardFrame", () => ({
  BoardCardFrame: ({
    title,
    children,
    onDisplayStateChange,
    onClosePlacement,
    onRequestDeleteEntity,
    onResizeEnd,
    onKeyboardMove,
    onKeyboardResize,
  }: {
    title: string;
    children: ReactNode;
    onDisplayStateChange: (state: string) => void;
    onClosePlacement: () => void;
    onRequestDeleteEntity: () => void;
    onResizeEnd: (size: { width: number; height: number }) => void;
    onKeyboardMove?: (delta: { x: number; y: number }) => void;
    onKeyboardResize?: (delta: { width: number; height: number }) => void;
  }) => (
    <section aria-label={title}>
      {children}
      <button onClick={() => onDisplayStateChange("collapsed")}>
        collapse
      </button>
      <button onClick={() => onDisplayStateChange("maximized")}>
        maximize
      </button>
      <button onClick={onClosePlacement}>close</button>
      <button onClick={onRequestDeleteEntity}>archive</button>
      <button onClick={() => onResizeEnd({ width: 500, height: 400 })}>
        resize
      </button>
      <button onClick={() => onKeyboardMove?.({ x: 10, y: 0 })}>move</button>
      <button onClick={() => onKeyboardResize?.({ width: 10, height: 0 })}>
        key-resize
      </button>
    </section>
  ),
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const placement = {
  id: "placement-1",
  boardId: "board-1",
  targetKind: "chat",
  targetId: "chat-1",
  x: 1,
  y: 2,
  width: 480,
  height: 360,
  zIndex: 1,
  displayState: "normal",
  revision: 0,
  createdAt: "2026-07-20T00:00:00Z",
  updatedAt: "2026-07-20T00:00:00Z",
} satisfies Placement;

const chat = {
  id: "chat-1",
  projectId: "project-1",
  createdById: "actor-1",
  title: "Incident copilot",
  provider: "OpenAI",
  modelName: "gpt-4o",
  contextPolicy: "board",
  archived: false,
  revision: 0,
  createdAt: "2026-07-20T00:00:00Z",
  updatedAt: "2026-07-20T00:00:00Z",
} satisfies ChatThread;

function callbacks() {
  return {
    onDisplayStateChange: jest.fn(),
    onClose: jest.fn(),
    onArchive: jest.fn(),
    onResizeEnd: jest.fn(),
    onKeyboardMove: jest.fn(),
    onKeyboardResize: jest.fn(),
  };
}

describe("ChatPlacement", () => {
  beforeEach(() => {
    chats.length = 0;
  });

  it("binds stock CopilotChat to stable distinct thread identities", () => {
    const cb = callbacks();
    render(
      <>
        <ChatPlacement chat={chat} placement={placement} selected {...cb} />
        <ChatPlacement
          chat={{ ...chat, id: "chat-2", title: "Review copilot" }}
          placement={{ ...placement, id: "placement-2", targetId: "chat-2" }}
          selected={false}
          {...callbacks()}
        />
      </>,
    );

    expect(chats).toEqual([
      expect.objectContaining({ agentId: "ketos-chat", threadId: "chat-1" }),
      expect.objectContaining({ agentId: "ketos-chat", threadId: "chat-2" }),
    ]);
    expect(
      screen.getByRole("region", { name: "Incident copilot" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Review copilot" }),
    ).toBeInTheDocument();
  });

  it("delegates frame lifecycle and keeps close separate from archive", () => {
    const cb = callbacks();
    render(
      <ChatPlacement chat={chat} placement={placement} selected {...cb} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "collapse" }));
    fireEvent.click(screen.getByRole("button", { name: "maximize" }));
    fireEvent.click(screen.getByRole("button", { name: "resize" }));
    fireEvent.click(screen.getByRole("button", { name: "move" }));
    fireEvent.click(screen.getByRole("button", { name: "key-resize" }));
    fireEvent.click(screen.getByRole("button", { name: "close" }));
    expect(cb.onDisplayStateChange.mock.calls).toEqual([
      ["collapsed"],
      ["maximized"],
    ]);
    expect(cb.onResizeEnd).toHaveBeenCalledWith({ width: 500, height: 400 });
    expect(cb.onKeyboardMove).toHaveBeenCalledWith({ x: 10, y: 0 });
    expect(cb.onKeyboardResize).toHaveBeenCalledWith({ width: 10, height: 0 });
    expect(cb.onClose).toHaveBeenCalledTimes(1);
    expect(cb.onArchive).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "archive" }));
    expect(cb.onArchive).toHaveBeenCalledTimes(1);
  });

  it("contains no replacement chat stack or raw color", () => {
    const source = readFileSync(join(__dirname, "ChatPlacement.tsx"), "utf8");
    expect(source).not.toMatch(
      /assistantPanel|use-post-assist-stream|CopilotChatView|renderTool|renderActivity|messages\s*=|isRunning\s*=|chatView\s*=|#[0-9a-f]{3,8}/i,
    );
  });
});
