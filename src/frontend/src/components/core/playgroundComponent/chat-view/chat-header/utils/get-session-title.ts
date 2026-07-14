import i18n from "@/i18n";
import { GENERATED_SESSION_ID_PREFIX } from "@/modals/IOModal/components/chatView/chatInput/components/voice-assistant/helpers/create-new-session-name";
import { formatDateTime } from "@/utils/locale-format";

export function getSessionTitle(
  currentSessionId?: string,
  currentFlowId?: string,
): string {
  if (!currentSessionId || currentSessionId === currentFlowId) {
    return i18n.t("playground.defaultSession");
  }

  if (currentSessionId.startsWith(GENERATED_SESSION_ID_PREFIX)) {
    const timestampPart = currentSessionId.slice(
      GENERATED_SESSION_ID_PREFIX.length,
    );
    if (/^\d+$/.test(timestampPart)) {
      const timestamp = Number(timestampPart);
      return `${i18n.t("assistant.newSession")} — ${formatDateTime(timestamp, {
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })}`;
    }
  }

  return currentSessionId;
}
