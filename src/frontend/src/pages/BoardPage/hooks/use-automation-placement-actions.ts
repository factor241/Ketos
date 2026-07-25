import { useRef } from "react";
import { useTranslation } from "react-i18next";

import { useCreateBoardAutomation } from "@/controllers/API/queries/boards";
import { usePostPlacement } from "@/controllers/API/queries/placements";
import useAlertStore from "@/stores/alertStore";
import type { Placement } from "@/types/board";
import type { AutomationSummary } from "@/types/flow/automation";

const AUTOMATION_WIDTH = 360;
const AUTOMATION_HEIGHT = 240;

type Center = { x: number; y: number };

export function useAutomationPlacementActions({
  projectId,
  boardId,
}: {
  projectId: string;
  boardId: string;
}) {
  const { t } = useTranslation();
  const createAutomation = useCreateBoardAutomation({ boardId, projectId });
  const placementMutation = usePostPlacement({ boardId });
  const inFlightFlowIds = useRef(new Set<string>());
  const createInFlight = useRef(false);

  const requireProjectId = () => {
    const normalizedProjectId = projectId.trim();
    if (!normalizedProjectId)
      throw new Error("A project is required to place an automation");
    return normalizedProjectId;
  };

  const place = async (
    flowId: string,
    placements: readonly Placement[],
    center: Center,
  ): Promise<Placement> => {
    requireProjectId();
    const existing = placements.find(
      (placement) =>
        placement.targetKind === "automation" && placement.targetId === flowId,
    );
    if (existing) return existing;
    if (inFlightFlowIds.current.has(flowId))
      throw new Error("Automation placement request already in flight");

    inFlightFlowIds.current.add(flowId);
    try {
      return await placementMutation.mutateAsync({
        targetKind: "automation",
        targetId: flowId,
        x: center.x - AUTOMATION_WIDTH / 2,
        y: center.y - AUTOMATION_HEIGHT / 2,
        width: AUTOMATION_WIDTH,
        height: AUTOMATION_HEIGHT,
      });
    } catch (error) {
      useAlertStore.getState().setErrorData({
        title: t("board.automation.placementError"),
        list: [t("errors.generic")],
      });
      throw error;
    } finally {
      inFlightFlowIds.current.delete(flowId);
    }
  };

  return {
    placeExisting: (
      summary: AutomationSummary,
      placements: readonly Placement[],
      center: Center,
    ) => place(summary.id, placements, center),
    createAndPlace: async (center: Center) => {
      requireProjectId();
      if (createInFlight.current) {
        throw new Error("Automation creation request already in flight");
      }
      createInFlight.current = true;
      try {
        return await createAutomation.mutateAsync({
          idempotencyKey: crypto.randomUUID(),
          starter: {
            kind: "blank_automation",
            name: t("board.automation.defaultName"),
          },
          placement: {
            x: center.x - AUTOMATION_WIDTH / 2,
            y: center.y - AUTOMATION_HEIGHT / 2,
            width: AUTOMATION_WIDTH,
            height: AUTOMATION_HEIGHT,
          },
        });
      } catch (error) {
        useAlertStore.getState().setErrorData({
          title: t("board.automation.placementError"),
          list: [t("errors.generic")],
        });
        throw error;
      } finally {
        createInFlight.current = false;
      }
    },
    isPending: placementMutation.isPending || createAutomation.isPending,
  };
}
