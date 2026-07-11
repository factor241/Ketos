import type { IngestionRunInfo } from "@/controllers/API/queries/knowledge-bases/use-get-ingestion-runs";
import {
  formatIngestionFinishedTitle,
  getKnowledgeBaseDeleteDescription,
  getKnowledgeBasesSkippedNote,
  getSelectedKnowledgeBasesDeleteDescription,
} from "../knowledge-copy";

type Params = Record<string, unknown> | undefined;

const interpolate = (template: string, params?: Params) =>
  template.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
    String(params?.[key] ?? `{{${key}}}`),
  );

const messages: Record<string, string> = {
  "knowledge.namedBaseDescription": 'knowledge base "{{name}}"',
  "knowledge.selectedBaseDescription": "selected knowledge base",
  "knowledge.selectedBasesDescription": "selected knowledge bases: {{count}}",
  "knowledge.ingestingBasesSkipped":
    "Ingesting knowledge bases skipped: {{count}}. {{note}}",
  "knowledge.ingestionComplete":
    '"{{name}}" ingestion complete — {{chunks}} chunks ready',
  "knowledge.metricSucceeded": "Succeeded",
  "knowledge.metricSkipped": "Skipped",
  "knowledge.metricFailed": "Failed",
  "knowledge.noItemsProcessed": "no items processed",
  "knowledge.chunksIngested": "Chunks ingested: {{count}}",
  "knowledge.ingestionSucceeded":
    '"{{name}}" ingestion complete — {{chunks}} chunks ingested',
  "knowledge.ingestionFinishedWithIssues":
    '"{{name}}" ingestion finished with issues — {{details}}',
  "knowledge.ingestionFinishedStatus":
    '"{{name}}" ingestion {{status}} — {{details}}',
  "knowledge.ingestionStatus.cancelled": "Cancelled",
  "knowledge.unknown": "Unknown",
};

const translate = jest.fn((key: string, params?: Params) =>
  interpolate(messages[key] ?? key, params),
);

const makeRun = (overrides: Partial<IngestionRunInfo>): IngestionRunInfo => ({
  id: "run-1",
  kb_name: "kb",
  kb_id: "kb-1",
  job_id: "job-1",
  source_type: "file",
  source_name: null,
  status: "succeeded",
  error_message: null,
  total_items: 0,
  succeeded: 0,
  failed: 0,
  skipped: 0,
  total_bytes: 0,
  chunks_created: 0,
  started_at: "2025-01-01T00:00:00Z",
  finished_at: "2025-01-01T00:01:00Z",
  ...overrides,
});

describe("knowledge copy", () => {
  beforeEach(() => translate.mockClear());

  it("localizes single, named, and multiple delete descriptions", () => {
    expect(getKnowledgeBaseDeleteDescription("Product docs", translate)).toBe(
      'knowledge base "Product docs"',
    );
    expect(getSelectedKnowledgeBasesDeleteDescription(1, translate)).toBe(
      "selected knowledge base",
    );
    expect(getSelectedKnowledgeBasesDeleteDescription(3, translate)).toBe(
      "selected knowledge bases: 3",
    );
  });

  it("localizes the skipped-ingestion delete note as one sentence", () => {
    expect(getKnowledgeBasesSkippedNote(2, "Cannot be undone", translate)).toBe(
      "Ingesting knowledge bases skipped: 2. Cannot be undone",
    );
  });

  it("uses a localized fallback when the run lookup returns nothing", () => {
    expect(formatIngestionFinishedTitle("Docs", 12, null, translate)).toEqual({
      kind: "success",
      title: '"Docs" ingestion complete — 12 chunks ready',
    });
  });

  it("localizes successful and partial ingestion summaries", () => {
    expect(
      formatIngestionFinishedTitle(
        "Docs",
        0,
        makeRun({ status: "succeeded", chunks_created: 7 }),
        translate,
      ),
    ).toEqual({
      kind: "success",
      title: '"Docs" ingestion complete — 7 chunks ingested',
    });

    expect(
      formatIngestionFinishedTitle(
        "Docs",
        0,
        makeRun({
          status: "partial",
          succeeded: 2,
          skipped: 1,
          failed: 1,
          chunks_created: 4,
        }),
        translate,
      ),
    ).toEqual({
      kind: "notice",
      title:
        '"Docs" ingestion finished with issues — Succeeded: 2, Skipped: 1, Failed: 1 · Chunks ingested: 4',
    });
  });

  it("localizes known terminal statuses and hides unknown raw status values", () => {
    expect(
      formatIngestionFinishedTitle(
        "Docs",
        0,
        makeRun({ status: "cancelled" }),
        translate,
      ).title,
    ).toContain("ingestion Cancelled");
    expect(
      formatIngestionFinishedTitle(
        "Docs",
        0,
        makeRun({ status: "provider_internal_state" }),
        translate,
      ).title,
    ).toContain("ingestion Unknown");
    expect(
      formatIngestionFinishedTitle(
        "Docs",
        0,
        makeRun({ status: "provider_internal_state" }),
        translate,
      ).title,
    ).not.toContain("provider_internal_state");
  });
});
