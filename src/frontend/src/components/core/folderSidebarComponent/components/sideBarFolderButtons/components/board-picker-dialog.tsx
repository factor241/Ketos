import { useTranslation } from "react-i18next";

import ForwardedIconComponent from "@/components/common/genericIconComponent";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useGetBoards } from "@/controllers/API/queries/boards";

type BoardPickerDialogProps = {
  open: boolean;
  projectId: string;
  projectName: string;
  onOpenChange: (open: boolean) => void;
  onSelectBoard: (boardId: string) => void;
  onCreateBoard: () => void;
};

export function BoardPickerDialog({
  open,
  projectId,
  projectName,
  onOpenChange,
  onSelectBoard,
  onCreateBoard,
}: BoardPickerDialogProps) {
  const { t } = useTranslation();
  const boards = useGetBoards({ projectId }, { enabled: open });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="board-picker-dialog">
        <DialogTitle>
          {t("boardPicker.title", { project: projectName })}
        </DialogTitle>
        <DialogDescription>{t("boardPicker.description")}</DialogDescription>
        {boards.isLoading ? (
          <div role="status" aria-label={t("boardPicker.loading")}>
            <Skeleton className="mb-2 h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : boards.isError ? (
          <div role="alert" className="space-y-3">
            <p>{t("boardPicker.error")}</p>
            <Button
              type="button"
              variant="outline"
              onClick={() => void boards.refetch()}
            >
              {t("boardPicker.retry")}
            </Button>
          </div>
        ) : boards.data?.length ? (
          <ul className="max-h-[min(50vh,24rem)] space-y-2 overflow-y-auto">
            {boards.data.map((board) => (
              <li key={board.id}>
                <button
                  type="button"
                  className="flex min-h-10 w-full items-center gap-3 rounded-md border border-border px-3 py-2 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => onSelectBoard(board.id)}
                >
                  <ForwardedIconComponent
                    name="LayoutDashboard"
                    className="h-4 w-4 shrink-0"
                  />
                  <span className="min-w-0 truncate">{board.title}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="space-y-3 text-center">
            <p>{t("boardPicker.empty")}</p>
            <Button type="button" onClick={onCreateBoard}>
              {t("boardPicker.create")}
            </Button>
          </div>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t("boardPicker.cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
