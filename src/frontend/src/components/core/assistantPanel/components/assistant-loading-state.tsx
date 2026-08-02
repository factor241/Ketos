import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
} from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { KetosAssistantMark } from "@/components/common/ketos-brand-mark";
import type { AgenticProgressState } from "@/controllers/API/queries/agentic";
import { GHOST_PRIMARY_BUTTON } from "../helpers/button-styles";

interface AssistantLoadingStateProps {
  progress: AgenticProgressState;
  streamingContent?: string;
  onValidationComplete?: () => void;
}

// Flow-build steps that have no body content (no streaming code, no card).
// For those, the bordered card looks like an "empty" loading box, so we swap
// it for a minimal pulse animation of the canonical Ketos assistant mark.
const FLOW_BUILD_ICON_STEPS = new Set([
  "searching_components",
  "generating_plan",
  "generating_flow",
  "generating_document",
  "orchestrating",
  "building_flow",
  "flow_built",
]);

function KetosLoadingIcon({ size = 24 }: { size?: number }) {
  const { t } = useTranslation();

  return (
    <span
      className="inline-flex shrink-0 items-center"
      data-testid="assistant-flow-loading-icon"
      role="status"
      aria-label={t("assistant.generatingFlow")}
    >
      <KetosAssistantMark
        decorative
        state="active"
        className="animate-pulse motion-reduce:animate-none"
        style={{ width: size, height: size }}
      />
    </span>
  );
}

function AssistantLoadingStateComponent({
  progress,
  streamingContent,
  onValidationComplete,
}: AssistantLoadingStateProps) {
  const { t } = useTranslation();
  const [codeOpen, setCodeOpen] = useState(true);
  const streamingRef = useRef<HTMLPreElement>(null);

  const isValidated = progress.step === "validated";
  const isReady = isValidated && !!progress.componentCode;
  const finalCode = progress.componentCode;
  const hasStreaming = !!streamingContent && streamingContent.length > 0;
  const showStreamingPreview = !finalCode && hasStreaming;

  // Auto-scroll streaming preview
  useEffect(() => {
    if (streamingRef.current) {
      streamingRef.current.scrollTop = streamingRef.current.scrollHeight;
    }
  }, [streamingContent]);

  // Minimal icon-only mode: flow-build steps with no body content. Swaps the
  // bordered card (which would render essentially empty) for a pulsing Ketos
  // mark. Must come AFTER all hook calls to preserve hook order.
  const isFlowBuildIconMode =
    FLOW_BUILD_ICON_STEPS.has(progress.step) &&
    !hasStreaming &&
    !finalCode &&
    !progress.error;

  if (isFlowBuildIconMode) {
    return (
      <div
        data-testid="assistant-flow-loading-icon-mode"
        className="flex items-center gap-2 text-sm font-medium text-foreground"
      >
        <KetosLoadingIcon size={24} />
        <span>{progress.message || t("assistant.working")}</span>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[600px] py-1">
      {/* Header — status line, flat (no surrounding card). Uses the same
          KetosLoadingIcon (size 24) as the flow-build minimal mode so the
          loading glyph is visually identical across component generation and
          flow building. */}
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        {isReady ? (
          <Check className="h-4 w-4 text-accent-emerald-foreground" />
        ) : (
          <KetosLoadingIcon size={24} />
        )}
        <span
          className={
            isReady ? "text-accent-emerald-foreground" : "text-foreground"
          }
        >
          {isReady
            ? t("assistant.componentReady")
            : progress.message || t("assistant.working")}
        </span>
        {progress.className && (
          <span className="ml-auto font-mono text-[11px] text-muted-foreground/80">
            {progress.className}
          </span>
        )}
      </div>

      {/* Live streaming — the main content while LLM generates */}
      {showStreamingPreview && (
        <pre
          ref={streamingRef}
          className="custom-scroll mb-2 max-h-[300px] overflow-auto rounded-md bg-muted/30 px-3 py-2 text-xs leading-relaxed"
        >
          <code className="whitespace-pre-wrap">{streamingContent}</code>
        </pre>
      )}

      {/* Validation error */}
      {progress.error && (
        <div className="mb-2 w-fit rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
          {progress.error}
        </div>
      )}

      {/* Retry counter */}
      {progress.attempt > 1 && (
        <div className="mb-2 text-xs text-muted-foreground">
          {t("assistant.attempt", {
            attempt: progress.attempt,
            max: progress.maxAttempts,
          })}
        </div>
      )}

      {/* Final extracted code — replaces streaming preview */}
      {finalCode && (
        <div className="mb-2">
          <button
            type="button"
            onClick={() => setCodeOpen((prev) => !prev)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {codeOpen ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            <Code2 className="h-3 w-3" />
            <span>{t("assistant.code")}</span>
          </button>
          {codeOpen && (
            <pre className="custom-scroll mt-2 max-h-[180px] overflow-auto rounded-md bg-muted/30 px-3 py-2 text-xs leading-relaxed">
              <code>{finalCode}</code>
            </pre>
          )}
        </div>
      )}

      {/* Continue — same ghost style as the plan card / component result. */}
      {isReady && (
        <button
          type="button"
          data-testid="assistant-continue-button"
          onClick={() => onValidationComplete?.()}
          className={GHOST_PRIMARY_BUTTON}
        >
          <span>{t("assistant.continue")}</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

export const AssistantLoadingState = memo(AssistantLoadingStateComponent);
export default AssistantLoadingState;
