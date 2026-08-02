import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import type {
  BoardNote,
  Placement,
  PlacementDisplayState,
} from "@/types/board";
import { BoardCardFrame } from "../BoardCardFrame";
import { BoardNoteMarkdown } from "../BoardNoteMarkdown";

const NOTE_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const NOTE_COLOR_CLASSES: Record<string, string> = {
  neutral: "bg-note-neutral",
  yellow: "bg-note-amber",
  green: "bg-note-lime",
  blue: "bg-note-blue",
  violet: "bg-accent-purple-muted",
  pink: "bg-note-rose",
};

export interface BoardNotePlacementProps {
  note: BoardNote;
  placement: Placement;
  selected: boolean;
  draft: string;
  onDraftChange: (draft: string) => void;
  onSave: () => void;
  onDisplayStateChange: (state: PlacementDisplayState) => void;
  onClose: () => void;
  onDeleteEntity: () => void;
  onResizeEnd: (size: { width: number; height: number }) => void;
  onKeyboardMove?: (delta: { x: number; y: number }) => void;
  onKeyboardResize?: (delta: { width: number; height: number }) => void;
}

export function isValidBoardNoteColor(color: string) {
  return color in NOTE_COLOR_CLASSES || NOTE_COLOR_PATTERN.test(color);
}

export function normalizeBoardNoteColor(color: string) {
  const className = NOTE_COLOR_CLASSES[color];
  if (className) return { className, backgroundColor: undefined };
  if (NOTE_COLOR_PATTERN.test(color)) {
    return { className: undefined, backgroundColor: color };
  }
  return {
    className: NOTE_COLOR_CLASSES.neutral,
    backgroundColor: undefined,
  };
}

export function BoardNotePlacement(props: BoardNotePlacementProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const color = normalizeBoardNoteColor(props.note.color);
  return (
    <BoardCardFrame
      title={t("board.note.title")}
      selected={props.selected}
      displayState={props.placement.displayState}
      width={props.placement.width}
      height={props.placement.height}
      placementRevision={props.placement.revision}
      labels={{
        collapse: t("board.placement.collapse"),
        expand: t("board.placement.expand"),
        maximize: t("board.placement.maximize"),
        restore: t("board.placement.restore"),
        close: t("board.placement.close"),
        deleteEntity: t("board.note.delete"),
      }}
      onDisplayStateChange={props.onDisplayStateChange}
      onClosePlacement={props.onClose}
      onRequestDeleteEntity={props.onDeleteEntity}
      onResizeEnd={props.onResizeEnd}
      onKeyboardMove={props.onKeyboardMove}
      onKeyboardResize={props.onKeyboardResize}
    >
      <div
        className={`flex h-full min-h-0 flex-col gap-3 ${color.className ?? ""}`}
        style={{ backgroundColor: color.backgroundColor }}
      >
        <div className="flex gap-2">
          <Button
            type="button"
            size="xs"
            variant={mode === "edit" ? "secondary" : "ghost"}
            aria-pressed={mode === "edit"}
            onClick={() => setMode("edit")}
          >
            {t("board.note.edit")}
          </Button>
          <Button
            type="button"
            size="xs"
            variant={mode === "preview" ? "secondary" : "ghost"}
            aria-pressed={mode === "preview"}
            onClick={() => setMode("preview")}
          >
            {t("board.note.preview")}
          </Button>
        </div>
        {mode === "edit" ? (
          <label className="flex min-h-0 flex-1 flex-col gap-1 text-sm">
            <span>{t("board.note.edit")}</span>
            <textarea
              className="min-h-24 flex-1 resize-none rounded-md border border-input bg-background p-2 text-foreground"
              maxLength={10000}
              value={props.draft}
              onChange={(event) => props.onDraftChange(event.target.value)}
            />
          </label>
        ) : (
          <div
            aria-label={t("board.note.preview")}
            className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-background p-2"
          >
            <BoardNoteMarkdown content={props.draft} />
          </div>
        )}
        <Button
          type="button"
          size="sm"
          onClick={props.onSave}
          disabled={props.draft === props.note.content}
        >
          {t("board.note.save")}
        </Button>
      </div>
    </BoardCardFrame>
  );
}

export default BoardNotePlacement;
