import { useTranslation } from "react-i18next";
import { SanitizedMarkdown } from "@/components/core/sanitizedMarkdown";

type MarkdownFieldProps = {
  chat: unknown;
  isEmpty: boolean;
  chatMessage: string;
  editedFlag: React.ReactNode;
  isAudioMessage?: boolean;
};

export const MarkdownField = ({
  chat,
  isEmpty,
  chatMessage,
  editedFlag,
  isAudioMessage,
}: MarkdownFieldProps) => {
  const { t } = useTranslation();
  const hasStreamUrl =
    typeof chat === "object" &&
    chat !== null &&
    "stream_url" in chat &&
    typeof chat.stream_url === "string" &&
    chat.stream_url.length > 0;

  return (
    <div className="w-full items-baseline gap-2">
      <SanitizedMarkdown
        chatMessage={chatMessage}
        isEmpty={isEmpty}
        emptyMessage={
          isEmpty && !hasStreamUrl
            ? t("chat.emptyOutputSendMessage")
            : undefined
        }
      />
      {editedFlag}
    </div>
  );
};
