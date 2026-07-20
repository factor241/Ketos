import { useCopilotKit } from "@copilotkit/react-core/v2";
import { useCallback, useEffect, useMemo, useState } from "react";
import { validate as isUuid } from "uuid";

export const CHAT_RUNTIME_AGENT_ID = "ketos-chat";

export type ThreadScopedAgentBinding = {
  localAgentId: string;
  retry: () => void;
} & (
  | { status: "registering"; error: null }
  | { status: "ready"; error: null }
  | { status: "error"; error: Error }
);

type RegistrationState = {
  key: string;
  owner: object | null;
  status: "registering" | "ready" | "error";
  error: Error | null;
};

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export function createThreadScopedAgentId(chatId: string): string {
  if (!isUuid(chatId)) {
    throw new Error("A durable Chat UUID is required for CopilotKit binding");
  }
  return `${CHAT_RUNTIME_AGENT_ID}--${chatId}`;
}

export function useThreadScopedCopilotAgent(
  chatId: string,
): ThreadScopedAgentBinding {
  const { copilotkit } = useCopilotKit();
  const [retryGeneration, setRetryGeneration] = useState(0);
  const retry = useCallback(() => {
    setRetryGeneration((generation) => generation + 1);
  }, []);

  const requested = useMemo(() => {
    const fallbackLocalAgentId = `${CHAT_RUNTIME_AGENT_ID}--${chatId}`;
    try {
      const localAgentId = createThreadScopedAgentId(chatId);
      return {
        key: `${localAgentId}:${retryGeneration}`,
        localAgentId,
        validationError: null,
      };
    } catch (error) {
      return {
        key: `invalid:${chatId}:${retryGeneration}`,
        localAgentId: fallbackLocalAgentId,
        validationError: asError(error),
      };
    }
  }, [chatId, retryGeneration]);
  const { key: requestedKey, localAgentId, validationError } = requested;

  const [registration, setRegistration] = useState<RegistrationState>({
    key: "",
    owner: null,
    status: "registering",
    error: null,
  });

  useEffect(() => {
    if (validationError) {
      setRegistration({
        key: requestedKey,
        owner: copilotkit,
        status: "error",
        error: validationError,
      });
      return;
    }

    setRegistration({
      key: requestedKey,
      owner: copilotkit,
      status: "registering",
      error: null,
    });

    try {
      const { unregister } = copilotkit.registerProxiedAgent({
        agentId: localAgentId,
        runtimeAgentId: CHAT_RUNTIME_AGENT_ID,
      });
      setRegistration({
        key: requestedKey,
        owner: copilotkit,
        status: "ready",
        error: null,
      });
      return unregister;
    } catch (error) {
      setRegistration({
        key: requestedKey,
        owner: copilotkit,
        status: "error",
        error: asError(error),
      });
      return;
    }
  }, [copilotkit, localAgentId, requestedKey, validationError]);

  const visible: RegistrationState =
    registration.key === requestedKey && registration.owner === copilotkit
      ? registration
      : validationError
        ? {
            key: requestedKey,
            owner: copilotkit,
            status: "error",
            error: validationError,
          }
        : {
            key: requestedKey,
            owner: copilotkit,
            status: "registering",
            error: null,
          };

  if (visible.status === "error") {
    return {
      status: "error",
      localAgentId,
      error: visible.error ?? new Error("CopilotKit registration failed"),
      retry,
    };
  }

  return {
    status: visible.status,
    localAgentId,
    error: null,
    retry,
  };
}
