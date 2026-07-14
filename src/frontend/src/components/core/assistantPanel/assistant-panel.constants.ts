import type { TFunction } from "i18next";
import i18n from "@/i18n";
import type {
  AssistantSuggestion,
  AssistantSuggestionId,
} from "./assistant-panel.types";

export const ASSISTANT_TITLE = "Ketos Assistant";

export const ASSISTANT_SESSION_STORAGE_KEY_PREFIX = "ketos-assistant-session-";

export function getAssistantPlaceholders(): string[] {
  return [
    i18n.t("assistant.placeholder.0"),
    i18n.t("assistant.placeholder.1"),
    i18n.t("assistant.placeholder.2"),
    i18n.t("assistant.placeholder.3"),
    i18n.t("assistant.placeholder.4"),
  ];
}

/** Kept for source compatibility; runtime consumers use the locale-live getter. */
export const ASSISTANT_PLACEHOLDERS: string[] = getAssistantPlaceholders();

export function getAssistantPlaceholder(): string {
  const placeholders = getAssistantPlaceholders();
  return placeholders[Math.floor(Math.random() * placeholders.length)];
}

export const ASSISTANT_SESSIONS_STORAGE_KEY = "ketos-assistant-sessions";
export const ASSISTANT_MAX_SESSIONS = 10;
export const ASSISTANT_SESSION_PREVIEW_LENGTH = 80;

export const ASSISTANT_WELCOME_TEXT = "assistant.welcomeText";

export const ASSISTANT_SUGGESTIONS: AssistantSuggestion[] = [
  {
    id: "build-agents",
    icon: "Sparkles",
  },
  {
    id: "answer-questions",
    icon: "Sparkles",
  },
];

export function getAssistantSuggestionText(
  id: AssistantSuggestionId,
  t: TFunction,
): string {
  switch (id) {
    case "build-agents":
      return t("assistant.suggestion.build-agents");
    case "answer-questions":
      return t("assistant.suggestion.answer-questions");
  }
}
