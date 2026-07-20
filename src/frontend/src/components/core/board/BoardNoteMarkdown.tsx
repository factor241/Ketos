import { SanitizedMarkdown } from "@/components/core/sanitizedMarkdown";

export function BoardNoteMarkdown({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  return (
    <SanitizedMarkdown
      profile="board-note"
      chatMessage={content}
      isEmpty={!content.trim()}
      emptyMessage=""
      className={className}
    />
  );
}
