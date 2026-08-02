import type { FlowType } from "@/types/flow";

export type BoardCreationContinuation = "open-add-automation";

export type BoardStarterChoice =
  | { kind: "clean" }
  | { kind: "simple_agent" }
  | { kind: "vector_store_rag" }
  | { kind: "template"; template: FlowType };

export const cleanBoardStarter: BoardStarterChoice = { kind: "clean" };
