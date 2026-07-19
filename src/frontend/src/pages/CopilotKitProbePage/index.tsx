import { Navigate } from "react-router-dom";
import CopilotKitProbe from "@/components/core/assistantPanel/copilotkit-probe";
import { useUtilityStore } from "@/stores/utilityStore";

export function CopilotKitProbePage() {
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
        <h1 className="text-2xl font-semibold">Stage 01 approval probe</h1>
        <p className="text-sm text-muted-foreground">
          Send one message, then review each open approval request
          independently.
        </p>
      </header>
      <section
        aria-label="CopilotKit approval probe"
        className="min-h-0 flex-1"
      >
        <CopilotKitProbe />
      </section>
    </main>
  );
}

export default CopilotKitProbePage;
