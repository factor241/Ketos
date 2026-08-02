import { type FormEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBootstrapBoard } from "@/controllers/API/queries/boards";
import { useGetBasicExamplesQuery } from "@/controllers/API/queries/flows/use-get-basic-examples";
import type { BoardStarter } from "@/types/board-command";
import { BoardTemplateGallery } from "./BoardTemplateGallery";
import { BoardTemplatePicker } from "./BoardTemplatePicker";
import type {
  BoardCreationContinuation,
  BoardStarterChoice,
} from "./board-creation-types";
import { cleanBoardStarter } from "./board-creation-types";

type Attempt = { fingerprint: string; idempotencyKey: string };

function toStarter(
  choice: BoardStarterChoice,
  names: { simpleAgent: string; vectorStoreRag: string },
): BoardStarter {
  switch (choice.kind) {
    case "clean":
      return { kind: "clean" };
    case "simple_agent":
      return { kind: "simple_agent", name: names.simpleAgent };
    case "vector_store_rag":
      return { kind: "vector_store_rag", name: names.vectorStoreRag };
    case "template":
      return {
        kind: "template",
        template_id: choice.template.id,
        name: choice.template.name,
      };
  }
}

export function BoardCreationDialog({
  open,
  projectId,
  continuation,
  returnFocusElement,
  onOpenChange,
}: {
  open: boolean;
  projectId: string;
  continuation?: BoardCreationContinuation;
  returnFocusElement?: HTMLElement | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [choice, setChoice] = useState<BoardStarterChoice>(cleanBoardStarter);
  const [view, setView] = useState<"form" | "gallery">("form");
  const [validationError, setValidationError] = useState(false);
  const [mutationError, setMutationError] = useState(false);
  const inFlight = useRef(false);
  const attempt = useRef<Attempt | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const bootstrap = useBootstrapBoard({ projectId });
  const examples = useGetBasicExamplesQuery({
    enabled: open && view === "gallery",
  });

  useEffect(() => {
    if (open) requestAnimationFrame(() => nameInputRef.current?.focus());
  }, [open]);

  const reset = () => {
    setTitle("");
    setChoice(cleanBoardStarter);
    setView("form");
    setValidationError(false);
    setMutationError(false);
    attempt.current = null;
  };

  const requestClose = () => {
    if (bootstrap.isPending || inFlight.current) return;
    reset();
    onOpenChange(false);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (bootstrap.isPending || inFlight.current) return;
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setValidationError(true);
      nameInputRef.current?.focus();
      return;
    }
    const starter = toStarter(choice, {
      simpleAgent: t("boardCreation.simpleAgent.name"),
      vectorStoreRag: t("boardCreation.vectorStoreRag.name"),
    });
    const fingerprint = JSON.stringify({ title: cleanTitle, starter });
    if (!attempt.current || attempt.current.fingerprint !== fingerprint) {
      attempt.current = {
        fingerprint,
        idempotencyKey: crypto.randomUUID(),
      };
    }
    inFlight.current = true;
    setMutationError(false);
    setValidationError(false);
    try {
      const result = await bootstrap.mutateAsync({
        title: cleanTitle,
        starter,
        idempotencyKey: attempt.current.idempotencyKey,
      });
      attempt.current = null;
      const search = new URLSearchParams();
      if (result.placement) search.set("focusPlacementId", result.placement.id);
      if (continuation === "open-add-automation")
        search.set("open-add-automation", "1");
      onOpenChange(false);
      navigate(
        `/project/${projectId}/board/${result.board.id}${
          search.size ? `?${search.toString()}` : ""
        }`,
      );
      reset();
    } catch {
      setMutationError(true);
    } finally {
      inFlight.current = false;
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) requestClose();
      }}
    >
      <DialogContent
        data-testid="board-create-dialog"
        aria-busy={bootstrap.isPending || inFlight.current}
        className="max-h-[min(90vh,52rem)] max-w-2xl overflow-y-auto"
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          if (!bootstrap.isPending && !inFlight.current) requestClose();
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          nameInputRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          if (!returnFocusElement?.isConnected) return;
          event.preventDefault();
          returnFocusElement.focus();
        }}
      >
        <DialogTitle>{t("boardCreation.title")}</DialogTitle>
        <DialogDescription>
          {view === "form"
            ? t("boardCreation.description")
            : t("boardCreation.gallery.description")}
        </DialogDescription>
        {view === "gallery" ? (
          <BoardTemplateGallery
            templates={examples.data ?? []}
            isLoading={examples.isLoading}
            isError={examples.isError}
            onRetry={() => void examples.refetch()}
            onBack={() => setView("form")}
            onSelect={(template) => {
              setChoice({ kind: "template", template });
              setView("form");
            }}
          />
        ) : (
          <form className="space-y-5" onSubmit={submit}>
            <div className="space-y-2">
              <Label htmlFor="board-name-input">
                {t("boardCreation.nameLabel")}
              </Label>
              <Input
                ref={nameInputRef}
                id="board-name-input"
                data-testid="board-name-input"
                value={title}
                maxLength={120}
                aria-invalid={validationError}
                aria-describedby={
                  validationError ? "board-name-error" : undefined
                }
                onChange={(event) => {
                  setTitle(event.target.value);
                  setValidationError(false);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Escape") return;
                  event.preventDefault();
                  event.stopPropagation();
                  requestClose();
                }}
              />
              {validationError ? (
                <p id="board-name-error" role="alert">
                  {t("boardCreation.nameRequired")}
                </p>
              ) : null}
            </div>
            <BoardTemplatePicker
              value={choice}
              onChange={setChoice}
              onBrowseMore={() => setView("gallery")}
            />
            {choice.kind === "template" ? (
              <p className="text-sm text-muted-foreground">
                {t("boardCreation.selectedTemplate", {
                  name: choice.template.name,
                })}
              </p>
            ) : null}
            {mutationError ? (
              <div role="alert" className="space-y-2 text-destructive">
                <p>{t("boardCreation.createError")}</p>
              </div>
            ) : null}
            <p aria-live="polite" className="sr-only">
              {bootstrap.isPending ? t("boardCreation.creating") : ""}
            </p>
            <DialogFooter>
              <Button
                type="submit"
                data-testid="board-create-submit"
                disabled={bootstrap.isPending}
                loading={bootstrap.isPending}
              >
                {mutationError
                  ? t("boardCreation.retry")
                  : t("boardCreation.submit")}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={bootstrap.isPending}
                onClick={requestClose}
              >
                {t("boardCreation.cancel")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
