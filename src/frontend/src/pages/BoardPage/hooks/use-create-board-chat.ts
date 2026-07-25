import { useRef } from "react";

import { api } from "@/controllers/API/api";
import { getURL } from "@/controllers/API/helpers/constants";
import { chatThreadKeys } from "@/controllers/API/queries/chat-threads";
import {
  type ChatThreadWire,
  mapChatThread,
} from "@/controllers/API/queries/chat-threads/wire";
import { placementKeys } from "@/controllers/API/queries/placements";
import {
  mapPlacement,
  type PlacementWire,
} from "@/controllers/API/queries/placements/wire";
import { UseRequestProcessor } from "@/controllers/API/services/request-processor";
import type { BoardChatCreateInput, BoardChatCreateResult } from "@/types/chat";

type BoardChatCreateWire = {
  chat: ChatThreadWire;
  placement: PlacementWire;
  idempotency_replayed: boolean;
};

type BoardChatCommandVariables = {
  boardId: string;
  projectId: string;
  input: BoardChatCreateInput;
  idempotencyKey: string;
};

type RetryAttempt = {
  fingerprint: string;
  idempotencyKey: string;
};

type InFlightCommand = {
  fingerprint: string;
  promise: Promise<BoardChatCreateResult>;
};

function commandPayload(input: BoardChatCreateInput) {
  return {
    title: input.title,
    provider: input.provider,
    model_name: input.modelName,
    placement: {
      x: input.placement.x,
      y: input.placement.y,
      width: input.placement.width ?? 320,
      height: input.placement.height ?? 240,
      z_index: input.placement.zIndex ?? 0,
    },
  };
}

function fingerprint(boardId: string, input: BoardChatCreateInput) {
  return `board-chat-create:${boardId}:${JSON.stringify(commandPayload(input))}`;
}

export function useCreateBoardChat({
  boardId,
  projectId,
}: {
  boardId: string;
  projectId: string;
}) {
  const { mutate, queryClient } = UseRequestProcessor();
  const retryAttempt = useRef<RetryAttempt | null>(null);
  const inFlight = useRef<InFlightCommand | null>(null);
  const mutation = mutate<
    BoardChatCreateResult,
    Error,
    BoardChatCommandVariables
  >(
    ["board-chat-command", boardId],
    async ({ boardId: commandBoardId, input, idempotencyKey }) => {
      const response = await api.post<BoardChatCreateWire>(
        `${getURL("BOARDS")}/${commandBoardId}/chats`,
        commandPayload(input),
        { headers: { "Idempotency-Key": idempotencyKey } },
      );
      return {
        chat: mapChatThread(response.data.chat),
        placement: mapPlacement(response.data.placement),
        idempotencyReplayed: response.data.idempotency_replayed,
      };
    },
    {
      retry: false,
      onSuccess: async (result, variables) => {
        queryClient.setQueryData(
          chatThreadKeys.detail(result.chat.id),
          result.chat,
        );
        queryClient.setQueryData(
          placementKeys.detail(result.placement.id),
          result.placement,
        );
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: chatThreadKeys.project(variables.projectId),
          }),
          queryClient.invalidateQueries({
            queryKey: placementKeys.scene(variables.boardId),
          }),
        ]);
      },
    },
  );

  const create = (
    input: BoardChatCreateInput,
  ): Promise<BoardChatCreateResult> => {
    const nextFingerprint = fingerprint(boardId, input);
    if (inFlight.current?.fingerprint === nextFingerprint)
      return inFlight.current.promise;
    const attempt =
      retryAttempt.current?.fingerprint === nextFingerprint
        ? retryAttempt.current
        : {
            fingerprint: nextFingerprint,
            idempotencyKey: crypto.randomUUID(),
          };
    retryAttempt.current = attempt;

    const request = mutation
      .mutateAsync({
        boardId,
        projectId,
        input,
        idempotencyKey: attempt.idempotencyKey,
      })
      .then((result) => {
        if (retryAttempt.current === attempt) retryAttempt.current = null;
        return result;
      })
      .finally(() => {
        if (inFlight.current?.promise === request) inFlight.current = null;
      });
    inFlight.current = { fingerprint: nextFingerprint, promise: request };
    return request;
  };

  return {
    create,
    isPending: mutation.isPending || inFlight.current !== null,
  };
}
