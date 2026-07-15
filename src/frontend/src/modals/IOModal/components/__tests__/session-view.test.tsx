import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import SessionView from "../session-view";

const setMessages = jest.fn();
let mockCachedMessages: unknown[] = [];
let mockPlaygroundPage = false;
const mockQueryClient = {
  getQueriesData: () => [
    [
      [
        "useGetMessagesQuery",
        { id: "persisted-source-flow", session_id: "session-1" },
      ],
      mockCachedMessages,
    ],
  ],
  getQueryCache: () => ({ subscribe: () => jest.fn() }),
};

jest.mock("@tanstack/react-query", () => ({
  useIsFetching: () => 0,
  useQueryClient: () => mockQueryClient,
}));

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock(
  "@/components/core/playgroundComponent/chat-view/utils/message-utils",
  () => ({
    removeMessages: jest.fn(),
  }),
);

jest.mock("@/components/ui/loading", () => ({
  __esModule: true,
  default: () => <div>loading</div>,
}));

jest.mock("@/controllers/API/queries/messages", () => ({
  useDeleteMessages: () => ({ mutate: jest.fn() }),
  useGetMessagesQuery: () => ({
    data: {
      rows: {
        data: [
          {
            flow_id: "flow-1",
            text: "hello",
            sender: "Machine",
            sender_name: "AI",
            session_id: "session-1",
            timestamp: "2026-07-12T00:00:00Z",
            files: [],
            id: "message-1",
            edit: false,
            properties: {
              background_color: "var(--accent)",
              text_color: "var(--accent-foreground)",
            },
          },
          {
            flow_id: null,
            text: "message without a flow",
            sender: "Machine",
            sender_name: "AI",
            session_id: "session-1",
            timestamp: "2026-07-12T00:00:03Z",
            files: [],
            id: "message-4",
            edit: false,
            properties: {},
          },
          {
            flow_id: "flow-1",
            text: "missing colors",
            sender: "Machine",
            sender_name: "AI",
            session_id: "session-1",
            timestamp: "2026-07-12T00:00:01Z",
            files: [],
            id: "message-2",
            edit: false,
            properties: {},
          },
          {
            flow_id: "flow-1",
            text: "null colors",
            sender: "Machine",
            sender_name: "AI",
            session_id: "session-1",
            timestamp: "2026-07-12T00:00:02Z",
            files: [],
            id: "message-3",
            edit: false,
            background_color: null,
            text_color: null,
            properties: {
              background_color: null,
              text_color: null,
            },
          },
        ],
      },
    },
    isFetching: false,
  }),
  useUpdateMessage: () => ({ mutate: jest.fn() }),
}));

jest.mock("@/stores/flowStore", () => ({
  __esModule: true,
  default: (selector: (state: { playgroundPage: boolean }) => unknown) =>
    selector({ playgroundPage: mockPlaygroundPage }),
}));

jest.mock("@/stores/alertStore", () => ({
  __esModule: true,
  default: (selector: (state: Record<string, jest.Mock>) => unknown) =>
    selector({ setErrorData: jest.fn(), setSuccessData: jest.fn() }),
}));

jest.mock("@/stores/messagesStore", () => ({
  useMessagesStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      messages: [],
      setMessages,
      updateMessage: jest.fn(),
      removeMessages: jest.fn(),
    }),
}));

jest.mock(
  "@/components/core/parameterRenderComponent/components/tableComponent",
  () => ({
    __esModule: true,
    default: ({
      children,
      rowData,
    }: {
      children?: ReactNode;
      rowData?: unknown[];
    }) => (
      <div data-testid="session-rows">
        {children}
        {JSON.stringify(rowData)}
      </div>
    ),
  }),
);

jest.mock("@/utils/utils", () => ({
  extractColumnsFromRows: () => [],
  messagesSorter: () => 0,
}));

describe("SessionView message normalization", () => {
  beforeEach(() => {
    setMessages.mockClear();
    mockCachedMessages = [];
    mockPlaygroundPage = false;
  });

  it("accepts MessageRead colors nested under properties", async () => {
    render(<SessionView id="flow-1" session="session-1" />);

    await waitFor(() =>
      expect(setMessages).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            background_color: "var(--accent)",
            text_color: "var(--accent-foreground)",
          }),
        ]),
      ),
    );
  });

  it("keeps MessageRead rows with missing or null colors using UI fallbacks", async () => {
    render(<SessionView id="flow-1" session="session-1" />);

    await waitFor(() =>
      expect(setMessages).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: "message-2",
            background_color: "",
            text_color: "",
          }),
          expect.objectContaining({
            id: "message-3",
            background_color: "",
            text_color: "",
          }),
        ]),
      ),
    );
  });

  it("keeps valid MessageRead rows whose optional flow id is null", async () => {
    render(<SessionView session="session-1" />);

    await waitFor(() =>
      expect(setMessages).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: "message-4",
            flow_id: null,
            text: "message without a flow",
          }),
        ]),
      ),
    );
  });

  it("reads playground session logs from the session-specific query cache", () => {
    mockCachedMessages = [
      {
        flow_id: "persisted-source-flow",
        text: "cached playground message",
        sender: "Machine",
        sender_name: "AI",
        session_id: "session-1",
        timestamp: "2026-07-12T00:00:00Z",
        files: [],
        id: "message-cached",
        edit: false,
      },
    ];

    render(<SessionView id="flow-1" session="session-1" preferSessionCache />);

    expect(screen.getByTestId("session-rows")).toHaveTextContent(
      "cached playground message",
    );
  });
});
