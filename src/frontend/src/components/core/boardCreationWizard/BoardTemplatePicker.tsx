import { useTranslation } from "react-i18next";

import { StarterTile } from "@/components/core/flowBuilderWelcome/starter-tile";
import type { BoardStarterChoice } from "./board-creation-types";

export function BoardTemplatePicker({
  value,
  onChange,
  onBrowseMore,
}: {
  value: BoardStarterChoice;
  onChange: (choice: BoardStarterChoice) => void;
  onBrowseMore: () => void;
}) {
  const { t } = useTranslation();
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium">
        {t("boardCreation.starterGroup")}
      </legend>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div role="radiogroup" className="contents">
          <StarterTile
            icon="LayoutDashboard"
            label={t("boardCreation.clean.title")}
            description={t("boardCreation.clean.description")}
            testId="board-template-clean"
            radio={{
              name: "board-starter",
              checked: value.kind === "clean",
              onChange: () => onChange({ kind: "clean" }),
            }}
          />
          <StarterTile
            icon="Bot"
            label={t("boardCreation.simpleAgent.title")}
            description={t("boardCreation.simpleAgent.description")}
            testId="board-template-simple-agent"
            radio={{
              name: "board-starter",
              checked: value.kind === "simple_agent",
              onChange: () => onChange({ kind: "simple_agent" }),
            }}
          />
          <StarterTile
            icon="Database"
            label={t("boardCreation.vectorStoreRag.title")}
            description={t("boardCreation.vectorStoreRag.description")}
            testId="board-template-vector-store-rag"
            radio={{
              name: "board-starter",
              checked: value.kind === "vector_store_rag",
              onChange: () => onChange({ kind: "vector_store_rag" }),
            }}
          />
        </div>
        <StarterTile
          icon="LayoutGrid"
          label={t("boardCreation.browseMore.title")}
          description={t("boardCreation.browseMore.description")}
          testId="board-template-browse-more"
          onClick={onBrowseMore}
        />
      </div>
    </fieldset>
  );
}
