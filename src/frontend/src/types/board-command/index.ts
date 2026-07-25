import type {
  BoardRead,
  Placement,
  PlacementGeometryInput,
} from "@/types/board";
import type { AutomationSummary } from "@/types/flow/automation";

export type CleanBoardStarter = Readonly<{ kind: "clean" }>;
export type BlankAutomationStarter = Readonly<{
  kind: "blank_automation";
  name: string;
}>;
export type SimpleAgentStarter = Readonly<{
  kind: "simple_agent";
  name: string;
}>;
export type VectorStoreRagStarter = Readonly<{
  kind: "vector_store_rag";
  name: string;
}>;
export type TemplateStarter = Readonly<{
  kind: "template";
  template_id: string;
  name: string;
}>;

export type NonCleanBoardStarter =
  | BlankAutomationStarter
  | SimpleAgentStarter
  | VectorStoreRagStarter
  | TemplateStarter;
export type BoardStarter = CleanBoardStarter | NonCleanBoardStarter;

export type BootstrapBoardInput = Readonly<{
  title: string;
  starter: BoardStarter;
  idempotencyKey: string;
}>;

export type CreateBoardAutomationInput = Readonly<{
  starter: NonCleanBoardStarter;
  placement: PlacementGeometryInput;
  idempotencyKey: string;
}>;

export type BootstrapBoardResult = Readonly<{
  board: BoardRead;
  automation: AutomationSummary | null;
  placement: Placement | null;
  idempotencyReplayed: boolean;
}>;

export type CreateBoardAutomationResult = Readonly<{
  automation: AutomationSummary;
  placement: Placement;
  idempotencyReplayed: boolean;
}>;
