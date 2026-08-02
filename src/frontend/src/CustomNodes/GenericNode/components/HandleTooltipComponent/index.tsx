import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { convertTestName } from "@/utils/convert-test-name";
import { nodeColorsName } from "@/utils/styleUtils";

export default function HandleTooltipComponent({
  isInput,
  tooltipTitle,
  isConnecting,
  isCompatible,
  isSameNode,
  left,
}: {
  isInput: boolean;
  tooltipTitle: string;
  isConnecting: boolean;
  isCompatible: boolean;
  isSameNode: boolean;
  left: boolean;
}) {
  const { t } = useTranslation();
  const tooltips = tooltipTitle.split("\n");
  const direction = isInput ? t("node.input") : t("node.output");
  const compatibleDirection = isInput ? t("node.outputs") : t("node.inputs");

  return (
    <div className="font-medium">
      {isSameNode ? (
        t("node.cannotConnectSameNode")
      ) : (
        <div className="flex items-center gap-1.5">
          {isConnecting ? (
            isCompatible ? (
              <span>
                <span className="font-semibold">{t("node.connect")}</span>{" "}
                {t("node.to")}
              </span>
            ) : (
              <span>{t("node.incompatibleWith")}</span>
            )
          ) : (
            <span className="text-xs">
              {isInput
                ? t("node.inputType", { count: tooltips.length })
                : t("node.outputType", { count: tooltips.length })}
              :{" "}
            </span>
          )}
          {tooltips.map((word, index) => (
            <Badge
              className="h-6 rounded-md p-1"
              key={`${index}-${word.toLowerCase()}`}
              style={{
                backgroundColor: left
                  ? `hsl(var(--datatype-${nodeColorsName[word]}))`
                  : `hsl(var(--datatype-${nodeColorsName[word]}-foreground))`,
                color: left
                  ? `hsl(var(--datatype-${nodeColorsName[word]}-foreground))`
                  : `hsl(var(--datatype-${nodeColorsName[word]}))`,
              }}
              data-testid={`${isInput ? "input" : "output"}-tooltip-${convertTestName(word)}`}
            >
              {word}
            </Badge>
          ))}
          {isConnecting && <span>{direction}</span>}
        </div>
      )}
      {!isConnecting && (
        <div className="mt-2 flex flex-col gap-0.5 text-xs leading-6">
          <div>
            <b>{t("node.drag")}</b>{" "}
            {t("node.connectCompatible", {
              direction: compatibleDirection,
            })}
          </div>
          <div>
            <b>{t("node.click")}</b>{" "}
            {t("node.filterCompatible", {
              direction: compatibleDirection,
            })}
          </div>
        </div>
      )}
    </div>
  );
}
