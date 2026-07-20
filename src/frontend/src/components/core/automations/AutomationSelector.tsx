import { type KeyboardEvent, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { useGetAutomationSummaries } from "@/controllers/API/queries/flows/use-get-automation-summaries";
import type { AutomationSummary } from "@/types/flow/automation";

export interface AutomationSelectorProps {
  projectId: string;
  onSelect: (summary: AutomationSummary) => void;
  disabled?: boolean;
}

export function AutomationSelector({
  projectId,
  onSelect,
  disabled = false,
}: AutomationSelectorProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const { data, isLoading, isError, refetch } = useGetAutomationSummaries({
    projectId,
  });
  const filtered = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    const summaries = data ?? [];
    return normalizedSearch
      ? summaries.filter((summary) =>
          summary.name.toLocaleLowerCase().includes(normalizedSearch),
        )
      : summaries;
  }, [data, search]);
  const effectiveActiveIndex =
    filtered.length === 0 ? 0 : Math.min(activeIndex, filtered.length - 1);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (disabled || filtered.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => Math.min(current + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      onSelect(filtered[effectiveActiveIndex]);
    }
  };

  if (isLoading)
    return <div role="status">{t("board.automation.selector.loading")}</div>;
  if (isError)
    return (
      <div role="alert" className="flex items-center gap-2">
        <span>{t("board.automation.selector.loadError")}</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          ignoreTitleCase
          onClick={() => void refetch()}
        >
          {t("board.automation.selector.retry")}
        </Button>
      </div>
    );

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="automation-selector-search">
        {t("board.automation.selector.search")}
      </label>
      <input
        id="automation-selector-search"
        type="search"
        value={search}
        disabled={disabled}
        aria-controls="automation-selector-options"
        aria-activedescendant={
          filtered.length > 0
            ? `automation-selector-option-${filtered[effectiveActiveIndex].id}`
            : undefined
        }
        onChange={(event) => {
          setSearch(event.target.value);
          setActiveIndex(0);
        }}
        onKeyDown={handleKeyDown}
        className="rounded-md border border-input bg-background px-3 py-2 text-foreground"
      />
      {filtered.length === 0 ? (
        <div>{t("board.automation.selector.empty")}</div>
      ) : (
        <ul
          id="automation-selector-options"
          role="listbox"
          className="flex flex-col gap-1"
        >
          {filtered.map((summary, index) => (
            <li
              id={`automation-selector-option-${summary.id}`}
              key={summary.id}
              role="option"
              aria-selected={index === effectiveActiveIndex}
            >
              <Button
                type="button"
                variant={index === effectiveActiveIndex ? "secondary" : "ghost"}
                disabled={disabled}
                tabIndex={-1}
                className="w-full justify-start"
                ignoreTitleCase
                onClick={() => onSelect(summary)}
              >
                {summary.name}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default AutomationSelector;
