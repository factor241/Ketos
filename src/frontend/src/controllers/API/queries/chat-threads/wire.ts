import type {
  ChatContextPolicy,
  ChatCreateInput,
  ChatPatchInput,
  ChatThread,
} from "@/types/chat";

export interface ChatThreadWire {
  id: string;
  project_id: string;
  created_by_id: string;
  title: string;
  provider: string;
  model_name: string;
  context_policy: ChatContextPolicy;
  archived: boolean;
  revision: number;
  created_at: string;
  updated_at: string;
}

export const mapChatThread = (wire: ChatThreadWire): ChatThread => ({
  id: wire.id,
  projectId: wire.project_id,
  createdById: wire.created_by_id,
  title: wire.title,
  provider: wire.provider,
  modelName: wire.model_name,
  contextPolicy: wire.context_policy,
  archived: wire.archived,
  revision: wire.revision,
  createdAt: wire.created_at,
  updatedAt: wire.updated_at,
});

export const chatCreatePayload = (input: ChatCreateInput) => ({
  title: input.title,
  provider: input.provider,
  model_name: input.modelName,
  context_policy: input.contextPolicy,
});

export const chatPatchPayload = ({
  expectedRevision,
  title,
  provider,
  modelName,
  contextPolicy,
  archived,
}: ChatPatchInput) => ({
  expected_revision: expectedRevision,
  ...(title === undefined ? {} : { title }),
  ...(provider === undefined ? {} : { provider }),
  ...(modelName === undefined ? {} : { model_name: modelName }),
  ...(contextPolicy === undefined ? {} : { context_policy: contextPolicy }),
  ...(archived === undefined ? {} : { archived }),
});
