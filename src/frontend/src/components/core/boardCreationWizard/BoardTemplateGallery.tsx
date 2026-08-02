import { useTranslation } from "react-i18next";

import ForwardedIconComponent from "@/components/common/genericIconComponent";
import { Button } from "@/components/ui/button";
import type { FlowType } from "@/types/flow";

export function BoardTemplateGallery({
  templates,
  isLoading,
  isError,
  onRetry,
  onSelect,
  onBack,
}: {
  templates: FlowType[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  onSelect: (template: FlowType) => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  if (isLoading) {
    return <p role="status">{t("boardCreation.gallery.loading")}</p>;
  }
  if (isError) {
    return (
      <div role="alert" className="space-y-3">
        <p>{t("boardCreation.gallery.error")}</p>
        <Button type="button" variant="outline" onClick={onRetry}>
          {t("boardCreation.retry")}
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <Button type="button" variant="ghost" className="gap-2" onClick={onBack}>
        <ForwardedIconComponent name="ArrowLeft" className="h-4 w-4" />
        {t("boardCreation.gallery.back")}
      </Button>
      {templates.length === 0 ? (
        <p>{t("boardCreation.gallery.empty")}</p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {templates.map((template) => (
            <li key={template.id}>
              <button
                type="button"
                className="flex min-h-24 w-full items-start gap-3 rounded-lg border border-border p-3 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onSelect(template)}
              >
                <ForwardedIconComponent
                  name={template.icon || "FileText"}
                  className="mt-1 h-5 w-5 shrink-0"
                />
                <span className="min-w-0">
                  <span className="block font-medium">{template.name}</span>
                  <span className="mt-1 line-clamp-2 block text-sm text-muted-foreground">
                    {template.description}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
