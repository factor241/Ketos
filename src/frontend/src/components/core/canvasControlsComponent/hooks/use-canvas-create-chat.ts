import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useGetModelProviders } from "@/controllers/API/queries/models/use-get-model-providers";
import { useGetBoardPlacements } from "@/controllers/API/queries/placements";
import { useCustomNavigate } from "@/customization/hooks/use-custom-navigate";
import {
  CHAT_PLACEMENT_HEIGHT,
  CHAT_PLACEMENT_WIDTH,
  findChatPlacementPosition,
} from "@/pages/BoardPage/hooks/use-chat-placement-actions";
import { useCreateBoardChat } from "@/pages/BoardPage/hooks/use-create-board-chat";
import { useBoardReturnContext } from "@/pages/FlowPage/hooks/use-board-return-context";
import useAlertStore from "@/stores/alertStore";
import useFlowStore from "@/stores/flowStore";
import { usePlaygroundStore } from "@/stores/playgroundStore";
import { useUtilityStore } from "@/stores/utilityStore";
import { useSessionManager } from "../../playgroundComponent/hooks/use-session-manager";

const FLOW_RETURN_BOARD_CENTER = { x: 580, y: 460 } as const;

export function useCanvasCreateChat() {
  const { t } = useTranslation();
  const navigate = useCustomNavigate();
  const flowId = useFlowStore((state) => state.currentFlow?.id ?? "");
  const setNewChatOnPlayground = useFlowStore(
    (state) => state.setNewChatOnPlayground,
  );
  const workspaceEnabled = useUtilityStore(
    (state) => state.featureFlags?.mvp_workspace === true,
  );
  const chatEnabled = useUtilityStore(
    (state) => state.featureFlags?.mvp_chat === true,
  );
  const setErrorData = useAlertStore((state) => state.setErrorData);
  const setPlaygroundOpen = usePlaygroundStore((state) => state.setIsOpen);
  const sessions = useSessionManager({ flowId });
  const boardReturn = useBoardReturnContext({ flowId });
  const placements = useGetBoardPlacements(
    { boardId: boardReturn.context?.board_id ?? "" },
    { enabled: boardReturn.status === "valid" },
  );
  const boardChat = useCreateBoardChat({
    boardId: boardReturn.context?.board_id ?? "",
    projectId: boardReturn.context?.project_id ?? "",
  });
  const providers = useGetModelProviders(
    {},
    { enabled: workspaceEnabled && chatEnabled },
  );
  const [providerModalOpen, setProviderModalOpen] = useState(false);
  const provider = providers.data?.find(
    (candidate) => candidate.is_enabled && candidate.models.length > 0,
  );
  const featureDisabled = !workspaceEnabled || !chatEnabled;
  const isBoardContext = boardReturn.hasBoardReturnIntent;
  const isBusy =
    boardReturn.status === "loading" ||
    providers.isLoading ||
    (isBoardContext && placements.isLoading) ||
    boardChat.isPending;

  const create = async () => {
    if (featureDisabled || isBusy || !flowId) return;
    if (isBoardContext && boardReturn.status !== "valid") {
      setErrorData({ title: t("chat.create.invalidBoardContext") });
      return;
    }
    if (providers.isError) {
      setErrorData({ title: t("chat.create.providerLoadError") });
      void providers.refetch();
      return;
    }
    if (!provider) {
      setProviderModalOpen(true);
      return;
    }
    if (!isBoardContext) {
      sessions.createSession();
      setNewChatOnPlayground(true);
      setPlaygroundOpen(true);
      return;
    }
    const context = boardReturn.context;
    if (!context) {
      setErrorData({ title: t("chat.create.invalidBoardContext") });
      return;
    }
    if (placements.isError) {
      setErrorData({ title: t("chat.create.placementLoadError") });
      void placements.refetch();
      return;
    }
    const existingPlacements = placements.data ?? [];
    const position = findChatPlacementPosition(
      existingPlacements,
      FLOW_RETURN_BOARD_CENTER,
    );
    const zIndex =
      existingPlacements.reduce(
        (highest, placement) => Math.max(highest, placement.zIndex),
        -1,
      ) + 1;
    try {
      const result = await boardChat.create({
        title: t("chat.defaultTitle"),
        provider: provider.provider,
        modelName: provider.models[0].model_name,
        placement: {
          ...position,
          width: CHAT_PLACEMENT_WIDTH,
          height: CHAT_PLACEMENT_HEIGHT,
          zIndex,
        },
      });
      navigate(
        `/project/${context.project_id}/board/${context.board_id}?focusPlacementId=${result.placement.id}`,
        { replace: true },
      );
    } catch {
      setErrorData({
        title: t("chat.create.errorTitle"),
        list: [t("errors.generic")],
      });
    }
  };

  return {
    create,
    label: t(
      isBoardContext ? "chat.actions.createInBoard" : "chat.actions.create",
    ),
    disabledDescription: t("chat.create.disabled"),
    featureDisabled,
    isBusy,
    disabled: featureDisabled || isBusy || !flowId,
    nativeDisabled: isBusy || !flowId,
    providerModalOpen,
    closeProviderModal: ({ hasChanges }: { hasChanges?: boolean } = {}) => {
      setProviderModalOpen(false);
      if (hasChanges) void providers.refetch();
    },
  };
}
