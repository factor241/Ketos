import { type SyntheticEvent, useRef } from "react";
import { useTranslation } from "react-i18next";

import ForwardedIconComponent from "@/components/common/genericIconComponent";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type ProjectCreateMenuProps = {
  project: { id: string; name: string };
  onCreateBoard: (projectId: string, trigger: HTMLButtonElement) => void;
  onCreateAutomation: (projectId: string, trigger: HTMLButtonElement) => void;
};

export function ProjectCreateMenu({
  project,
  onCreateBoard,
  onCreateAutomation,
}: ProjectCreateMenuProps) {
  const { t } = useTranslation();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const stopRowActivation = (event: SyntheticEvent) => {
    event.stopPropagation();
  };
  const withTrigger = (
    action: (projectId: string, trigger: HTMLButtonElement) => void,
  ) => {
    if (triggerRef.current) action(project.id, triggerRef.current);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          aria-label={t("projectCreate.label", { project: project.name })}
          data-testid={`project-create-menu-trigger-${project.id}`}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          onPointerDown={stopRowActivation}
          onClick={stopRowActivation}
        >
          <ForwardedIconComponent name="Plus" className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onPointerDown={stopRowActivation}
        onClick={stopRowActivation}
      >
        <DropdownMenuItem
          data-testid={`project-create-board-item-${project.id}`}
          className="gap-2"
          onSelect={() => withTrigger(onCreateBoard)}
        >
          <ForwardedIconComponent name="LayoutDashboard" className="h-4 w-4" />
          {t("projectCreate.board")}
        </DropdownMenuItem>
        <DropdownMenuItem
          data-testid={`project-create-automation-item-${project.id}`}
          className="gap-2"
          onSelect={() => withTrigger(onCreateAutomation)}
        >
          <ForwardedIconComponent name="Workflow" className="h-4 w-4" />
          {t("projectCreate.automation")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
