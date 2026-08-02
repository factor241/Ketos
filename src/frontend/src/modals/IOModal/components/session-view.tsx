import {
  type QueryClient,
  useIsFetching,
  useQueryClient,
} from "@tanstack/react-query";
import type { NewValueParams, SelectionChangedEvent } from "ag-grid-community";
import cloneDeep from "lodash/cloneDeep";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { removeMessages } from "@/components/core/playgroundComponent/chat-view/utils/message-utils";
import Loading from "@/components/ui/loading";
import {
  useDeleteMessages,
  useGetMessagesQuery,
  useUpdateMessage,
} from "@/controllers/API/queries/messages";
import useFlowStore from "@/stores/flowStore";
import type { Message } from "@/types/messages";
import TableComponent from "../../../components/core/parameterRenderComponent/components/tableComponent";
import useAlertStore from "../../../stores/alertStore";
import { useMessagesStore } from "../../../stores/messagesStore";
import { extractColumnsFromRows, messagesSorter } from "../../../utils/utils";

type MessageRead = Omit<Message, "background_color" | "text_color"> & {
  background_color?: string | null;
  text_color?: string | null;
};

function normalizeMessage(value: unknown): Message | null {
  if (typeof value !== "object" || value === null) return null;
  const isMessageRead =
    "flow_id" in value &&
    (value.flow_id === null || typeof value.flow_id === "string") &&
    "text" in value &&
    typeof value.text === "string" &&
    "sender" in value &&
    typeof value.sender === "string" &&
    "sender_name" in value &&
    typeof value.sender_name === "string" &&
    "session_id" in value &&
    typeof value.session_id === "string" &&
    "timestamp" in value &&
    typeof value.timestamp === "string" &&
    "files" in value &&
    Array.isArray(value.files) &&
    "id" in value &&
    (value.id === null || typeof value.id === "string") &&
    "edit" in value &&
    typeof value.edit === "boolean";

  if (!isMessageRead) return null;

  const message = value as MessageRead;
  const nestedBackgroundColor = message.properties?.background_color;
  const nestedTextColor = message.properties?.text_color;
  const backgroundColor =
    typeof message.background_color === "string"
      ? message.background_color
      : typeof nestedBackgroundColor === "string"
        ? nestedBackgroundColor
        : "";
  const textColor =
    typeof message.text_color === "string"
      ? message.text_color
      : typeof nestedTextColor === "string"
        ? nestedTextColor
        : "";

  return {
    ...message,
    background_color: backgroundColor,
    text_color: textColor,
  };
}

function getCachedPlaygroundMessages(
  queryClient: QueryClient,
  session?: string,
): Message[] {
  if (!session) return [];

  const messagesByIdentity = new Map<string, Message>();
  for (const [queryKey, data] of queryClient.getQueriesData<Message[]>({
    queryKey: ["useGetMessagesQuery"],
  })) {
    const params = queryKey[1];
    if (
      typeof params !== "object" ||
      params === null ||
      !("session_id" in params) ||
      params.session_id !== session ||
      !Array.isArray(data)
    ) {
      continue;
    }

    for (const message of data) {
      const identity =
        message.id ??
        `${message.sender}:${message.timestamp}:${message.text}:${message.session_id}`;
      messagesByIdentity.set(identity, message);
    }
  }
  return [...messagesByIdentity.values()];
}

export default function SessionView({
  session,
  id,
  preferSessionCache = false,
}: {
  session?: string;
  id?: string;
  preferSessionCache?: boolean;
}) {
  const { t } = useTranslation();
  const messages = useMessagesStore((state) => state.messages);
  const setMessages = useMessagesStore((state) => state.setMessages);
  const setErrorData = useAlertStore((state) => state.setErrorData);
  const setSuccessData = useAlertStore((state) => state.setSuccessData);
  const updateMessage = useMessagesStore((state) => state.updateMessage);
  const deleteMessagesStore = useMessagesStore((state) => state.removeMessages);
  const playgroundPage = useFlowStore((state) => state.playgroundPage);
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const queryClient = useQueryClient();
  const [playgroundMessages, setPlaygroundMessages] = useState<Message[]>([]);

  useEffect(() => {
    if (!preferSessionCache) {
      setPlaygroundMessages([]);
      return;
    }

    const syncMessages = () => {
      const nextMessages = getCachedPlaygroundMessages(queryClient, session);
      setPlaygroundMessages((currentMessages) =>
        currentMessages.length === nextMessages.length &&
        currentMessages.every(
          (message, index) => message === nextMessages[index],
        )
          ? currentMessages
          : nextMessages,
      );
    };
    syncMessages();
    return queryClient.getQueryCache().subscribe(syncMessages);
  }, [preferSessionCache, queryClient, session]);

  // Fetch messages for the specific session
  const messageQueryParams = useMemo(() => {
    const params: Record<string, string> = {};
    if (session) {
      params.session_id = session;
    }
    return {
      id: id,
      mode: "union" as const,
      params: params,
    };
  }, [session, id]);

  const { data: queryData, isFetching: isQueryFetching } = useGetMessagesQuery(
    messageQueryParams,
    {
      enabled: !preferSessionCache,
    },
  );

  // Update messages store when data is fetched
  useEffect(() => {
    if (queryData && typeof queryData === "object" && "rows" in queryData) {
      const rowsData = queryData.rows as { data?: unknown[] } | undefined;
      if (rowsData && typeof rowsData === "object" && "data" in rowsData) {
        const fetchedMessages = (rowsData.data || [])
          .map(normalizeMessage)
          .filter((message): message is Message => message !== null);
        setMessages(fetchedMessages);
      }
    }
  }, [queryData, setMessages]);

  const columnHeaderMap: Record<string, string> = {
    timestamp: t("messages.column.timestamp"),
    text: t("messages.column.text"),
    sender: t("messages.column.sender"),
    sender_name: t("messages.column.senderName"),
    session_id: t("messages.column.sessionId"),
    files: t("messages.column.files"),
  };

  const sourceMessages = preferSessionCache ? playgroundMessages : messages;
  const columns = extractColumnsFromRows(sourceMessages, "intersection").map(
    (col) =>
      col.field && columnHeaderMap[col.field]
        ? { ...col, headerName: columnHeaderMap[col.field] }
        : col,
  );
  const isFetchingCount = useIsFetching({
    queryKey: ["useGetMessagesQuery"],
    exact: false,
  });
  const isFetching = isFetchingCount > 0 || isQueryFetching;

  const { mutate: deleteMessages } = useDeleteMessages({
    onSuccess: () => {
      deleteMessagesStore(selectedRows);
      if (session && id) {
        removeMessages(selectedRows, session, id);
      }
      setSelectedRows([]);
      setSuccessData({
        title: t("success.messagesDeleted"),
      });
    },
    onError: () => {
      setErrorData({
        title: t("errors.deletingMessages"),
      });
    },
  });

  const { mutate: updateMessageMutation } = useUpdateMessage();

  function handleUpdateMessage(
    event: NewValueParams<Record<string, unknown>, string>,
  ) {
    const newValue = event.newValue;
    const field = event.column.getColId();
    const row = cloneDeep(event.data);
    const data = {
      ...row,
      [field]: newValue,
    };
    updateMessageMutation(
      { message: data },
      {
        onSuccess: () => {
          const normalizedMessage = normalizeMessage(data);
          if (normalizedMessage) {
            updateMessage(normalizedMessage);
          }
          // Set success message
          setSuccessData({
            title: t("success.messagesUpdated"),
          });
        },
        onError: () => {
          setErrorData({
            title: t("errors.updatingMessages"),
          });
          event.data[field] = event.oldValue;
          event.api.refreshCells();
        },
      },
    );
  }

  const filteredMessages = useMemo(() => {
    let filteredMessages = session
      ? sourceMessages.filter((message) => message.session_id === session)
      : sourceMessages;
    filteredMessages =
      id && !preferSessionCache
        ? filteredMessages.filter((message) => message.flow_id === id)
        : filteredMessages;
    return filteredMessages;
  }, [session, id, preferSessionCache, sourceMessages]);

  function handleRemoveMessages() {
    deleteMessages({ ids: selectedRows });
  }

  const editable = useMemo(() => {
    return playgroundPage
      ? false
      : [{ field: "text", onUpdate: handleUpdateMessage, editableCell: false }];
  }, [handleUpdateMessage]);

  return isFetching ? (
    <div className="flex h-full w-full items-center justify-center align-middle">
      <Loading></Loading>
    </div>
  ) : (
    <TableComponent
      key={"sessionView"}
      onDelete={playgroundPage ? undefined : handleRemoveMessages}
      readOnlyEdit
      editable={editable}
      overlayNoRowsTemplate={t("table.noRowsToShow")}
      onSelectionChanged={(event: SelectionChangedEvent) => {
        setSelectedRows(event.api.getSelectedRows().map((row) => row.id));
      }}
      rowSelection={playgroundPage ? undefined : "multiple"}
      suppressRowClickSelection={true}
      pagination={true}
      columnDefs={columns.sort(messagesSorter)}
      rowData={filteredMessages}
    />
  );
}
