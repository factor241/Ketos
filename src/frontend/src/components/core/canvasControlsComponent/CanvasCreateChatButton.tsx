import ForwardedIconComponent from "@/components/common/genericIconComponent";
import ShadTooltip from "@/components/common/shadTooltipComponent";
import { Button } from "@/components/ui/button";
import ModelProviderModal from "@/modals/modelProviderModal";
import { useCanvasCreateChat } from "./hooks/use-canvas-create-chat";

const DISABLED_DESCRIPTION_ID = "canvas-create-chat-disabled-description";

export function CanvasCreateChatButton() {
  const action = useCanvasCreateChat();

  return (
    <>
      <ShadTooltip content={action.label} side="top">
        <span>
          <Button
            unstyled
            size="icon"
            type="button"
            data-testid="canvas-create-chat-button"
            className="group flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted"
            aria-label={action.label}
            aria-busy={action.isBusy}
            aria-describedby={
              action.featureDisabled ? DISABLED_DESCRIPTION_ID : undefined
            }
            aria-disabled={action.featureDisabled || undefined}
            disabled={action.nativeDisabled}
            onClick={() => void action.create()}
          >
            <ForwardedIconComponent
              name="MessageSquarePlus"
              className="h-[18px] w-[18px] text-muted-foreground transition-colors group-hover:text-foreground"
              skipFallback
            />
          </Button>
        </span>
      </ShadTooltip>
      {action.featureDisabled ? (
        <span id={DISABLED_DESCRIPTION_ID} className="sr-only">
          {action.disabledDescription}
        </span>
      ) : null}
      {action.providerModalOpen ? (
        <ModelProviderModal
          open={action.providerModalOpen}
          modelType="llm"
          onClose={action.closeProviderModal}
        />
      ) : null}
    </>
  );
}
