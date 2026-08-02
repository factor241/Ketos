import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useCanvasReadOnly } from "@/contexts/canvas-read-only-context";
import useFlowStore from "@/stores/flowStore";
import { cn } from "@/utils/utils";
import { useGetReplacementComponents } from "../../hooks/use-get-replacement-components";

export default function NodeLegacyComponent({
  legacy,
  replacement,
  setDismissAll,
}: {
  legacy?: boolean;
  replacement?: string[];
  setDismissAll: (value: boolean) => void;
}) {
  const { t } = useTranslation();
  const isCanvasReadOnly = useCanvasReadOnly();
  const setFilterComponent = useFlowStore((state) => state.setFilterComponent);
  const setFilterType = useFlowStore((state) => state.setFilterType);
  const setFilterEdge = useFlowStore((state) => state.setFilterEdge);

  const handleFilterComponent = (component: string) => {
    if (isCanvasReadOnly) return;
    setFilterComponent(component);
    setFilterType(undefined);
    setFilterEdge([]);
  };

  const foundComponents = useGetReplacementComponents(replacement);

  return (
    <div
      className={cn(
        "flex flex-col w-full items-center gap-3 rounded-t-[0.69rem] border-b bg-muted p-2 px-4 py-2",
      )}
    >
      <div className="flex items-center gap-3 w-full">
        <div className="h-2.5 w-2.5 rounded-full bg-warning" />
        <div className="mb-px flex-1 truncate text-mmd font-medium">
          {t("sidebar.legacyLabel")}
        </div>

        {!isCanvasReadOnly && (
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 !text-mmd"
            onClick={(e) => {
              e.stopPropagation();
              setDismissAll(true);
            }}
            aria-label={t("node.dismissWarning")}
            data-testid="dismiss-warning-bar"
          >
            {t("node.dismiss")}
          </Button>
        )}
      </div>
      <div className="text-mmd text-muted-foreground w-full">
        {replacement &&
        Array.isArray(replacement) &&
        replacement.length > 0 &&
        foundComponents.some((component) => component) ? (
          <span className="block items-center">
            {t("node.useReplacement")}{" "}
            {foundComponents.map((component, index) => (
              <Fragment key={replacement[index]}>
                {component && (
                  <>
                    {index > 0 && ", "}
                    <Button
                      variant="link"
                      className=" !text-accent-pink-foreground !text-mmd !inline-block"
                      size={null}
                      onClick={() => handleFilterComponent(replacement[index])}
                      disabled={isCanvasReadOnly}
                    >
                      <span>{component}</span>
                    </Button>
                  </>
                )}
              </Fragment>
            ))}
            .
          </span>
        ) : (
          t("node.noDirectReplacement")
        )}
      </div>
    </div>
  );
}
