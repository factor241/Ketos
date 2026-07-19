import { useTranslation } from "react-i18next";
import { Navigate } from "react-router-dom";
import CopilotKitProbe from "@/components/core/assistantPanel/copilotkit-probe";
import { useUtilityStore } from "@/stores/utilityStore";

export function CopilotKitProbePage() {
  const { t } = useTranslation();
  const isEnabled = useUtilityStore(
    (state) =>
      state.featureFlags.mvp_workspace === true &&
      state.featureFlags.mvp_chat === true,
  );

  if (!isEnabled) {
    return <Navigate replace to="/flows" />;
  }

  return (
    <main
      className="mx-auto flex h-full w-full max-w-5xl flex-col gap-4 overflow-auto p-6"
      data-testid="mvp-copilotkit-probe-page"
    >
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("mvpApproval.pageTitle")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("mvpApproval.pageDescription")}
        </p>
      </header>
      <section
        aria-label={t("mvpApproval.pageRegionLabel")}
        className="min-h-0 flex-1"
      >
        <CopilotKitProbe />
      </section>
    </main>
  );
}

export default CopilotKitProbePage;
