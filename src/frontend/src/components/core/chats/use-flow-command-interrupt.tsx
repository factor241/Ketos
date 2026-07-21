import {
  type Interrupt,
  type InterruptEvent,
  useInterrupt,
} from "@copilotkit/react-core/v2";

import type {
  FlowCommandInterrupt,
  FlowCommandMetadata,
  FlowCommandPreviewData,
  FlowCommandSnapshot,
} from "@/types/flow";
import FlowCommandConfirmation from "./FlowCommandConfirmation";

type ApprovalDecision = Readonly<{ approved: boolean }>;
const METADATA_TYPE = "ketos.flow-command-confirmation.v1";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function snapshotOf(value: unknown): FlowCommandSnapshot | null {
  if (!isRecord(value)) return null;
  const revision = value.revision;
  const hash = value.hash;
  const nodeCount = value.nodeCount ?? value.node_count;
  const edgeCount = value.edgeCount ?? value.edge_count;
  if (
    !(revision === null || typeof revision === "number") ||
    !(hash === null || typeof hash === "string") ||
    typeof nodeCount !== "number" ||
    typeof edgeCount !== "number"
  ) {
    return null;
  }
  return { revision, hash, nodeCount, edgeCount };
}

function previewOf(value: unknown): FlowCommandPreviewData | null {
  if (!isRecord(value)) return null;
  const before = snapshotOf(value.before);
  const after = snapshotOf(value.after);
  const operationSummaries = value.operationSummaries;
  const warnings = value.warnings;
  const risk = value.risk;
  const canRestore = value.canRestore;
  if (
    !before ||
    !after ||
    !Array.isArray(operationSummaries) ||
    !Array.isArray(warnings) ||
    !warnings.every((warning) => typeof warning === "string") ||
    (risk !== "low" && risk !== "medium" && risk !== "high") ||
    typeof canRestore !== "boolean"
  ) {
    return null;
  }
  return {
    before,
    after,
    operationSummaries:
      operationSummaries as FlowCommandPreviewData["operationSummaries"],
    warnings,
    risk,
    canRestore,
  };
}

function rawMetadataOf(interrupt: Interrupt): unknown {
  if (!isRecord(interrupt.metadata)) return interrupt.metadata;
  const langgraph = interrupt.metadata.langgraph;
  if (!isRecord(langgraph) || !isRecord(langgraph.raw)) {
    return interrupt.metadata;
  }
  return langgraph.raw.metadata;
}

function metadataOf(interrupt: Interrupt): FlowCommandMetadata | null {
  const metadata = rawMetadataOf(interrupt);
  if (!isRecord(metadata)) return null;
  const preview = previewOf(metadata.preview);
  if (
    metadata.type !== METADATA_TYPE ||
    typeof metadata.proposalId !== "string" ||
    typeof metadata.proposalHash !== "string" ||
    metadata.proposalHash.length !== 64 ||
    !preview
  ) {
    return null;
  }
  return {
    type: METADATA_TYPE,
    proposalId: metadata.proposalId,
    proposalHash: metadata.proposalHash,
    preview,
  };
}

export function isFlowCommandInterrupt(interrupt: Interrupt): boolean {
  return metadataOf(interrupt) !== null;
}

export function useFlowCommandInterrupt(
  agentId: string,
  onResolved?: (proposalId: string) => void,
) {
  useInterrupt<ApprovalDecision, true>({
    agentId,
    renderInChat: true,
    enabled: (event: InterruptEvent<unknown>) => {
      const value = event.value as Interrupt | null;
      return (
        value !== null &&
        typeof value === "object" &&
        isFlowCommandInterrupt(value)
      );
    },
    render: ({ interrupts, resolve }) => {
      const commands = interrupts.flatMap<FlowCommandInterrupt>((interrupt) => {
        const metadata = metadataOf(interrupt);
        return metadata ? [{ interrupt, metadata }] : [];
      });
      return (
        <FlowCommandConfirmation
          commands={commands}
          resolve={resolve}
          onResolved={onResolved}
        />
      );
    },
  });
}
