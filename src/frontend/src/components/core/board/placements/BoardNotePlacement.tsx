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
  return NOTE_COLOR_PATTERN.test(color);
}

export function BoardNotePlacement(props: BoardNotePlacementProps) {
  const { t } = useTranslation();
  const safeColor = isValidBoardNoteColor(props.note.color)
    ? props.note.color
    : "#fff4cc";
  return (
    <BoardCardFrame
      title={t("board.note.title")}
      selected={props.selected}
      displayState={props.placement.displayState}
      width={props.placement.width}
      height={props.placement.height}
      labels={{
        collapse: t("board.placement.collapse"),
        expand: t("board.placement.expand"),
        maximize: t("board.placement.maximize"),
        restore: t("board.placement.restore"),
        close: t("board.placement.close"),
        deleteEntity: t("board.note.delete"),
      }}
      onDisplayStateChange={props.onDisplayStateChange}
      onClose={props.onClose}
      onDeleteEntity={props.onDeleteEntity}
      onResizeEnd={props.onResizeEnd}
      onKeyboardMove={props.onKeyboardMove}
      onKeyboardResize={props.onKeyboardResize}
    >
      <div
        className="flex h-full min-h-0 flex-col gap-3"
        style={{ backgroundColor: safeColor }}
      >
        <label className="flex min-h-0 flex-1 flex-col gap-1 text-sm">
          <span>{t("board.note.edit")}</span>
          <textarea
            className="min-h-24 flex-1 resize-none rounded-md border border-input bg-background p-2 text-foreground"
            maxLength={10000}
            value={props.draft}
            onChange={(event) => props.onDraftChange(event.target.value)}
          />
        </label>
        <div
          aria-label={t("board.note.preview")}
          className="rounded-md border border-border bg-background p-2"
        >
          <BoardNoteMarkdown content={props.draft} />
        </div>
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
