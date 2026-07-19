import { type KeyboardEvent, useCallback, useRef, useState } from "react";

export type InlineProjectRenameTarget = {
  id: string;
  name: string;
};

type UseInlineProjectRenameOptions = {
  renameProject: (
    projectId: string,
    newName: string,
  ) => Promise<InlineProjectRenameTarget>;
  onError: (error: unknown) => void;
};

export function useInlineProjectRename({
  renameProject,
  onError,
}: UseInlineProjectRenameOptions) {
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const originalNameRef = useRef("");
  const triggerElementRef = useRef<HTMLElement | null>(null);
  const isCommittingRef = useRef(false);
  const ignoreNextBlurRef = useRef(false);
  const focusRequestRef = useRef(0);

  const focusInput = useCallback(() => {
    const request = ++focusRequestRef.current;
    void Promise.resolve().then(() => {
      if (focusRequestRef.current === request) inputRef.current?.focus();
    });
  }, []);

  const restoreTriggerFocus = useCallback(() => {
    focusRequestRef.current += 1;
    triggerElementRef.current?.focus();
  }, []);

  const beginRename = useCallback(
    (
      project: InlineProjectRenameTarget,
      triggerElement?: HTMLElement | null,
    ) => {
      if (isCommittingRef.current) return;
      originalNameRef.current = project.name;
      triggerElementRef.current = triggerElement ?? null;
      ignoreNextBlurRef.current = false;
      setDraftName(project.name);
      setEditingProjectId(project.id);
      focusInput();
    },
    [focusInput],
  );

  const cancelRename = useCallback(() => {
    ignoreNextBlurRef.current = true;
    setDraftName(originalNameRef.current);
    setEditingProjectId(null);
    restoreTriggerFocus();
  }, [restoreTriggerFocus]);

  const commitRename = useCallback(async (): Promise<boolean> => {
    if (ignoreNextBlurRef.current) {
      ignoreNextBlurRef.current = false;
      return false;
    }
    if (editingProjectId === null || isCommittingRef.current) return false;

    const nextName = draftName.trim();
    if (!nextName || nextName === originalNameRef.current) {
      cancelRename();
      return false;
    }

    isCommittingRef.current = true;
    try {
      const renamedProject = await renameProject(editingProjectId, nextName);
      originalNameRef.current = renamedProject.name;
      setDraftName(renamedProject.name);
      setEditingProjectId(null);
      restoreTriggerFocus();
      return true;
    } catch (error: unknown) {
      setDraftName(originalNameRef.current);
      onError(error);
      focusInput();
      return false;
    } finally {
      isCommittingRef.current = false;
    }
  }, [
    cancelRename,
    draftName,
    editingProjectId,
    focusInput,
    onError,
    renameProject,
    restoreTriggerFocus,
  ]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        inputRef.current?.blur();
      } else if (event.key === "Escape") {
        event.preventDefault();
        cancelRename();
      }
    },
    [cancelRename],
  );

  return {
    editingProjectId,
    draftName,
    inputRef,
    beginRename,
    setDraftName,
    commitRename,
    cancelRename,
    handleKeyDown,
  };
}
