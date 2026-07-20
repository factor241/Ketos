export type ChatContextPolicy = "chat_only" | "board";

export interface ChatThread {
  id: string;
  projectId: string;
  createdById: string;
  title: string;
  provider: string;
  modelName: string;
  contextPolicy: ChatContextPolicy;
  archived: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChatCreateInput {
  title: string;
  provider: string;
  modelName: string;
  contextPolicy: ChatContextPolicy;
}

export interface ChatPatchInput {
  chatId: string;
  expectedRevision: number;
  title?: string;
  provider?: string;
  modelName?: string;
  contextPolicy?: ChatContextPolicy;
  archived?: boolean;
}
