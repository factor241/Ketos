import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { useGetAutomationSummaries } from "@/controllers/API/queries/flows/use-get-automation-summaries";
import type { Placement } from "@/types/board";
import type { AutomationSummary } from "@/types/flow/automation";

export type AutomationInventoryPanelProps = {
  projectId: string;
  placements: readonly Placement[];
  onPlace: (summary: AutomationSummary) => void | Promise<unknown>;
  onOpen: (
    summary: AutomationSummary,
    placement: Placement | undefined,
  ) => void | Promise<unknown>;
  onCreate?: () => void;
  onCreateAndEdit?: () => void;
  disabled?: boolean;
};

export function AutomationInventoryPanel({
  projectId,
  placements,
  onPlace,
  onOpen,
  onCreate,
  onCreateAndEdit,
  disabled = false,
}: AutomationInventoryPanelProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const pendingFlowIdsRef = useRef(new Set<string>());
  const [pendingFlowIds, setPendingFlowIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [announcement, setAnnouncement] = useState("");
  const summariesQuery = useGetAutomationSummaries({ projectId });
  const placementByFlowId = useMemo(
    () =>
      new Map(
        placements
          .filter((placement) => placement.targetKind === "automation")
          .map((placement) => [placement.targetId, placement]),
      ),
    [placements],
  );
  const filtered = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase();
    const summaries = summariesQuery.data ?? [];
    return normalized
      ? summaries.filter((summary) =>
          summary.name.toLocaleLowerCase().includes(normalized),
        )
      : summaries;
  }, [search, summariesQuery.data]);

  const runFlowAction = async (
    summary: AutomationSummary,
    action: () => void | Promise<unknown>,
    announcePlacement = false,
  ) => {
    if (disabled || pendingFlowIdsRef.current.has(summary.id)) return;
    pendingFlowIdsRef.current.add(summary.id);
    setPendingFlowIds(new Set(pendingFlowIdsRef.current));
    setAnnouncement("");
    try {
      await action();
      if (announcePlacement) {
        setAnnouncement(
          t("board.automation.inventory.placedAnnouncement", {
            name: summary.name,
          }),
        );
      }
    } catch {
      setAnnouncement(
        t("board.automation.inventory.placeError", { name: summary.name }),
      );
    } finally {
      pendingFlowIdsRef.current.delete(summary.id);
      setPendingFlowIds(new Set(pendingFlowIdsRef.current));
    }
  };

  return (
    <aside
      className="flex flex-col gap-3"
      aria-labelledby="automation-inventory-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="automation-inventory-title" className="text-lg font-semibold">
          {t("board.automation.inventory.title")}
        </h2>
        {onCreate || onCreateAndEdit ? (
          <div className="flex flex-wrap gap-2">
            {onCreate ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={disabled}
                ignoreTitleCase
                onClick={onCreate}
              >
                {t("board.automation.create")}
              </Button>
            ) : null}
            {onCreateAndEdit ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={disabled}
                ignoreTitleCase
                onClick={onCreateAndEdit}
              >
                {t("board.automation.createAndEdit")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <label htmlFor="automation-inventory-search">
        {t("board.automation.inventory.search")}
      </label>
      <input
        id="automation-inventory-search"
        type="search"
        value={search}
        disabled={disabled}
        className="rounded-md border border-input bg-background px-3 py-2 text-foreground"
        onChange={(event) => setSearch(event.target.value)}
      />

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>

      {summariesQuery.isLoading ? (
        <p role="status">{t("board.automation.selector.loading")}</p>
      ) : summariesQuery.isError ? (
        <div role="alert" className="flex items-center gap-2">
          <span>{t("board.automation.selector.loadError")}</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            ignoreTitleCase
            onClick={() => void summariesQuery.refetch()}
          >
            {t("board.automation.selector.retry")}
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <p>{t("board.automation.selector.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map((summary) => {
            const placement = placementByFlowId.get(summary.id);
            const isPending = pendingFlowIds.has(summary.id);
            return (
              <li
                key={summary.id}
                className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{summary.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {placement
                      ? t("board.automation.inventory.placed")
                      : t("board.automation.inventory.unplaced")}
                  </p>
                </div>
                {!placement ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={disabled || isPending}
                    loading={isPending}
                    ignoreTitleCase
                    aria-label={t("board.automation.inventory.place", {
                      name: summary.name,
                    })}
                    onClick={() =>
                      void runFlowAction(summary, () => onPlace(summary), true)
                    }
                  >
                    {t("board.automation.inventory.placeAction")}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={disabled || isPending}
                  loading={isPending}
                  ignoreTitleCase
                  aria-label={t("board.automation.inventory.open", {
                    name: summary.name,
                  })}
                  onClick={() =>
                    void runFlowAction(summary, () =>
                      onOpen(summary, placement),
                    )
                  }
                >
                  {t("board.automation.inventory.openAction")}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}

export default AutomationInventoryPanel;
