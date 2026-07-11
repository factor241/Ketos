import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type TaskCandidate = {
  candidate_id: string;
  path: string;
  source_excerpt: string;
};

const frontendRoot = resolve(__dirname, "../..");
const repoRoot = resolve(frontendRoot, "../..");

function source(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
}

// This is the reviewed Task 10 baseline, not the scanner's live inventory.
// Resolved semantic-key debt is intentionally removed from the live scanner
// ledger, while this frozen fixture must continue guarding against regressions.
const task10Candidates: TaskCandidate[] = [
  {
    candidate_id: "40e938fbe271",
    path: "src/frontend/src/components/common/modelProviderCountComponent/index.tsx",
    source_excerpt: '<div className="text-sm">Models</div>',
  },
  {
    candidate_id: "5cc5534911e9",
    path: "src/frontend/src/constants/dbProviderConstants.ts",
    source_excerpt: 'label: "Tenant",',
  },
  {
    candidate_id: "077fb776e5a5",
    path: "src/frontend/src/constants/dbProviderConstants.ts",
    source_excerpt: 'label: "Database",',
  },
  {
    candidate_id: "8bf32d03fca6",
    path: "src/frontend/src/constants/dbProviderConstants.ts",
    source_excerpt: 'label: "Region",',
  },
  {
    candidate_id: "87b8d7b8c9ee",
    path: "src/frontend/src/constants/dbProviderConstants.ts",
    source_excerpt: 'label: "Cluster URL",',
  },
  {
    candidate_id: "b61a97d707ea",
    path: "src/frontend/src/constants/dbProviderConstants.ts",
    source_excerpt: 'label: "Username",',
  },
  {
    candidate_id: "aca81a07c2fd",
    path: "src/frontend/src/constants/dbProviderConstants.ts",
    source_excerpt: 'label: "Password",',
  },
  {
    candidate_id: "ae286696c435",
    path: "src/frontend/src/constants/dbProviderConstants.ts",
    source_excerpt: 'placeholder: "Enter OpenSearch password",',
  },
  {
    candidate_id: "c754e27d4098",
    path: "src/frontend/src/constants/dbProviderConstants.ts",
    source_excerpt: 'label: "Default index name",',
  },
  {
    candidate_id: "586c3606b0e8",
    path: "src/frontend/src/constants/dbProviderConstants.ts",
    source_excerpt: 'label: "Vector field",',
  },
  {
    candidate_id: "d6b953a5f707",
    path: "src/frontend/src/constants/dbProviderConstants.ts",
    source_excerpt: 'label: "Text field",',
  },
  {
    candidate_id: "c587c6324e5b",
    path: "src/frontend/src/constants/dbProviderConstants.ts",
    source_excerpt: 'label: "Use TLS (HTTPS)",',
  },
  {
    candidate_id: "295c2e60f3f0",
    path: "src/frontend/src/constants/dbProviderConstants.ts",
    source_excerpt: 'label: "Verify TLS certificate",',
  },
  {
    candidate_id: "482959f8f52b",
    path: "src/frontend/src/constants/dbProviderConstants.ts",
    source_excerpt: 'description: "Managed Cassandra vector storage.",',
  },
  {
    candidate_id: "e8f9ca562cee",
    path: "src/frontend/src/constants/dbProviderConstants.ts",
    source_excerpt: 'description: "Atlas Vector Search backend.",',
  },
  {
    candidate_id: "369037737d88",
    path: "src/frontend/src/constants/dbProviderConstants.ts",
    source_excerpt: 'description: "Postgres-backed vector storage.",',
  },
  {
    candidate_id: "f4a8be39d838",
    path: "src/frontend/src/constants/dbProviderConstants.ts",
    source_excerpt:
      'description: "Managed Chroma Cloud vector storage via api.trychroma.com.",',
  },
  {
    candidate_id: "581bdf936c2a",
    path: "src/frontend/src/constants/dbProviderConstants.ts",
    source_excerpt: 'label: "API Key",',
  },
  {
    candidate_id: "e462d19a7d96",
    path: "src/frontend/src/modals/fileManagerModal/components/importButtonComponent/index.tsx",
    source_excerpt: 'label: "Drive",',
  },
  {
    candidate_id: "59672f7ef18a",
    path: "src/frontend/src/modals/fileManagerModal/components/importButtonComponent/index.tsx",
    source_excerpt: 'label: "S3 Bucket",',
  },
  {
    candidate_id: "87d832493994",
    path: "src/frontend/src/modals/knowledgeBaseUploadModal/hooks/useKnowledgeBaseForm.ts",
    source_excerpt: 'return "OpenSearch requires an index_name";',
  },
  {
    candidate_id: "0ee612a518ae",
    path: "src/frontend/src/pages/MainPage/components/inputSearchComponent/index.tsx",
    source_excerpt: 'return "Search Flows";',
  },
  {
    candidate_id: "ca574d10a409",
    path: "src/frontend/src/pages/MainPage/components/inputSearchComponent/index.tsx",
    source_excerpt: 'return "Search Components";',
  },
  {
    candidate_id: "49f287bb22b2",
    path: "src/frontend/src/pages/MainPage/components/inputSearchComponent/index.tsx",
    source_excerpt: 'return "Search Flows and Components";',
  },
  {
    candidate_id: "cf21a1dface8",
    path: "src/frontend/src/pages/MainPage/pages/deploymentsPage/components/deployment-stepper.tsx",
    source_excerpt: '{ number: 1, label: "Provider" },',
  },
  {
    candidate_id: "e113fb8f3bcf",
    path: "src/frontend/src/pages/MainPage/pages/deploymentsPage/components/deployment-stepper.tsx",
    source_excerpt: '{ number: 2, label: "Type" },',
  },
  {
    candidate_id: "ffd650c202c8",
    path: "src/frontend/src/pages/MainPage/pages/deploymentsPage/components/deployment-stepper.tsx",
    source_excerpt: '{ number: 3, label: "Flows" },',
  },
  {
    candidate_id: "d20a856c3347",
    path: "src/frontend/src/pages/MainPage/pages/deploymentsPage/components/deployment-stepper.tsx",
    source_excerpt: '{ number: 4, label: "Review" },',
  },
  {
    candidate_id: "f168f9ab0abf",
    path: "src/frontend/src/pages/MainPage/pages/deploymentsPage/components/deployment-stepper.tsx",
    source_excerpt: '{ number: 1, label: "Provider" },',
  },
  {
    candidate_id: "45044fc44c87",
    path: "src/frontend/src/pages/MainPage/pages/deploymentsPage/components/deployment-stepper.tsx",
    source_excerpt: '{ number: 2, label: "Type" },',
  },
  {
    candidate_id: "ca447e7e06cc",
    path: "src/frontend/src/pages/MainPage/pages/deploymentsPage/components/deployment-stepper.tsx",
    source_excerpt: '{ number: 3, label: "Flows" },',
  },
  {
    candidate_id: "fb6f245174c6",
    path: "src/frontend/src/pages/MainPage/pages/deploymentsPage/components/deployment-stepper.tsx",
    source_excerpt: '{ number: 4, label: "Deployed" },',
  },
  {
    candidate_id: "948174e76f06",
    path: "src/frontend/src/pages/MainPage/pages/deploymentsPage/components/deployment-stepper.tsx",
    source_excerpt: '{ number: 1, label: "Type" },',
  },
  {
    candidate_id: "941df51b5e87",
    path: "src/frontend/src/pages/MainPage/pages/deploymentsPage/components/deployment-stepper.tsx",
    source_excerpt: '{ number: 2, label: "Flows" },',
  },
  {
    candidate_id: "8673eb53f60e",
    path: "src/frontend/src/pages/MainPage/pages/deploymentsPage/components/deployment-stepper.tsx",
    source_excerpt: '{ number: 3, label: "Review" },',
  },
  {
    candidate_id: "df399e8e37e4",
    path: "src/frontend/src/pages/MainPage/pages/deploymentsPage/components/provider-card.tsx",
    source_excerpt: '<p className="text-sm text-muted-foreground">Endpoint</p>',
  },
  {
    candidate_id: "74fdb3f45d4d",
    path: "src/frontend/src/pages/MainPage/pages/deploymentsPage/components/provider-card.tsx",
    source_excerpt:
      '<p className="text-sm text-muted-foreground">Last Updated</p>',
  },
  {
    candidate_id: "d910e4e7d813",
    path: "src/frontend/src/pages/MainPage/pages/deploymentsPage/components/provider-card.tsx",
    source_excerpt:
      '<p className="text-sm text-muted-foreground">Deployments</p>',
  },
  {
    candidate_id: "cc89f1bfedfc",
    path: "src/frontend/src/pages/MainPage/pages/deploymentsPage/components/step-type.tsx",
    source_excerpt: 'label: "Agent",',
  },
  {
    candidate_id: "75accfe7f691",
    path: "src/frontend/src/pages/MainPage/pages/deploymentsPage/components/step-type.tsx",
    source_excerpt:
      'description: "Conversational agent with chat interface and tool calling",',
  },
  {
    candidate_id: "b09312a2ed1d",
    path: "src/frontend/src/pages/MainPage/pages/knowledgePage/sourceChunksPage/SourceChunksPage.tsx",
    source_excerpt: '<SelectItem value="folder">Folder</SelectItem>',
  },
  {
    candidate_id: "a10fe02b10f5",
    path: "src/frontend/src/pages/MainPage/pages/knowledgePage/utils/backendMetadata.ts",
    source_excerpt: 'return "Stored locally in Langflow";',
  },
  {
    candidate_id: "4a5bb193f550",
    path: "src/frontend/src/utils/mcpUtils.ts",
    source_excerpt:
      '[AuthMethodId.NONE]: { id: AuthMethodId.NONE, label: "None" },',
  },
  {
    candidate_id: "20ca51c7eb56",
    path: "src/frontend/src/utils/mcpUtils.ts",
    source_excerpt:
      '[AuthMethodId.API_KEY]: { id: AuthMethodId.API_KEY, label: "API Key" },',
  },
];

const additionalWaveBDebt: Record<string, string[]> = {
  "src/frontend/src/modals/fileManagerModal/components/dragFilesComponent/index.tsx":
    ["{formatFileSize(maxFileSizeUpload)} max", "types.slice(3).toSorted()"],
  "src/frontend/src/modals/fileManagerModal/components/filesRendererComponent/components/fileRendererComponent/index.tsx":
    ["Upload failed,", "try again?"],
  "src/frontend/src/modals/fileManagerModal/components/importButtonComponent/index.tsx":
    ['label: "OneDrive"', 'trigger="Import from..."'],
  "src/frontend/src/modals/knowledgeBaseUploadModal/components/ChunkPreviewCard.tsx":
    [">Chunk<"],
  "src/frontend/src/modals/knowledgeBaseUploadModal/components/IngestionHistoryPanel.tsx":
    [
      "Loading history…",
      "Unable to load ingestion history.",
      "No sources ingested yet.",
      " chunks</span>",
    ],
  "src/frontend/src/modals/knowledgeBaseUploadModal/hooks/useKnowledgeBaseForm.ts":
    [
      '|| "Unknown error"',
      "must be configured in DB Providers settings before it can be used.",
      "Fix metadata fields before continuing.",
      "Fix metadata fields for",
      "Some files were skipped. Only supported file types were uploaded.",
      'Knowledge base "${sourceName}" created',
    ],
  "src/frontend/src/pages/MainPage/pages/deploymentsPage/components/provider-card.tsx":
    [">Configure<", ">Delete<"],
  "src/frontend/src/pages/MainPage/pages/deploymentsPage/components/add-provider-modal.tsx":
    [
      "Add a new watsonx Orchestrate environment.",
      "Configure environment ${provider.name}.",
    ],
  "src/frontend/src/pages/MainPage/pages/deploymentsPage/components/deployment-details-modal/deployment-details-modal.tsx":
    [
      ">Deployment Details<",
      "View deployment configuration and attached flows.",
      ">Close<",
    ],
  "src/frontend/src/pages/MainPage/pages/deploymentsPage/components/provider-modal-intro.tsx":
    [
      ">Beta<",
      "Update environment name or rotate API key.",
      "Configure your watsonx Orchestrate credentials below.",
      ">Sign up for watsonx Orchestrate<",
      ">Find your credentials<",
    ],
  "src/frontend/src/pages/MainPage/pages/deploymentsPage/components/test-deployment-modal/chat-message-bubble.tsx":
    [">Input<", ">Output<"],
  "src/frontend/src/pages/MainPage/pages/deploymentsPage/components/test-deployment-modal/test-deployment-modal.tsx":
    ["Chat interface to test the", ">Test Deployment<"],
  "src/frontend/src/pages/MainPage/pages/deploymentsPage/components/test-deployment-modal/use-deployment-chat.ts":
    [
      '"Done."',
      "Run timed out. Please try again.",
      "Run started but no run ID was returned.",
    ],
  "src/frontend/src/pages/MainPage/pages/filesPage/components/dragWrapComponent/index.tsx":
    ["Drop file", "to upload"],
  "src/frontend/src/pages/MainPage/pages/knowledgePage/components/IngestionRunDetailModal.tsx":
    ["Files ({data.items.length})", "{item.chunks_created} chunks"],
  "src/frontend/src/pages/MainPage/pages/knowledgePage/components/IngestionRunsSection.tsx":
    [
      "{data.total} total",
      "Unable to load ingestion runs.",
      "No ingestion runs yet.",
      "{run.chunks_created} chunks",
    ],
  "src/frontend/src/pages/MainPage/pages/knowledgePage/sourceChunksPage/components/MetadataCombobox.tsx":
    ["Use “{trimmedQuery}”"],
  "src/frontend/src/pages/MainPage/pages/knowledgePage/sourceChunksPage/components/hooks/useChunksMetadataFilter.ts":
    ["Object.keys(metadataKeys?.keys ?? {}).sort()"],
  "src/frontend/src/modals/modelProviderModal/components/ModelProvidersContent.tsx":
    ['defaultValue: "Search providers…"'],
  "src/frontend/src/modals/modelProviderModal/components/ModelSelection.tsx": [
    'defaultValue: "embedding"',
    'defaultValue: "tool"',
    'defaultValue: "reasoning"',
    'defaultValue: "vision"',
    'defaultValue: "search"',
    'defaultValue: "preview"',
    'defaultValue: "Show 1 deprecated model"',
    'defaultValue: "Show {{count}} deprecated models"',
    'defaultValue: "Search models…"',
    'defaultValue: "No models match your search."',
  ],
  "src/frontend/src/modals/modelProviderModal/components/ProviderList.tsx": [
    'defaultValue: "No providers match your search."',
  ],
  "src/frontend/src/modals/modelProviderModal/components/ProviderListItem.tsx":
    ['{provider.model_count === 1 ? "model" : "models"}'],
  "src/frontend/src/pages/MainPage/components/header/index.tsx": [">Beta<"],
  "src/frontend/src/pages/MainPage/hooks/use-on-file-drop.ts": [
    'title: "All files uploaded successfully"',
  ],
  "src/frontend/src/pages/SettingsPage/pages/DBProvidersPage/index.tsx": [
    "An unexpected error occurred. Please try again.",
  ],
  "src/frontend/src/pages/SettingsPage/pages/GlobalVariablesPage/index.tsx": [
    'variable.validation_error || "Invalid API key"',
  ],
  "src/frontend/src/utils/mcpUtils.ts": [
    'throw new Error("Invalid JSON format.")',
    'throw new Error("No valid MCP server found in the input.")',
  ],
};

const rawBackendErrorDebt = [
  "src/frontend/src/pages/StorePage/index.tsx",
  "src/frontend/src/pages/MainPage/pages/knowledgePage/hooks/useKnowledgeBaseActions.ts",
  "src/frontend/src/pages/MainPage/pages/knowledgePage/components/KnowledgeBaseSelectionOverlay.tsx",
  "src/frontend/src/pages/SettingsPage/pages/GeneralPage/index.tsx",
  "src/frontend/src/pages/SettingsPage/pages/ApiKeysPage/index.tsx",
  "src/frontend/src/pages/SettingsPage/pages/StoreApiKeyPage/index.tsx",
  "src/frontend/src/pages/MainPage/pages/deploymentsPage/components/step-attach-flows.tsx",
  "src/frontend/src/pages/MainPage/pages/deploymentsPage/hooks/use-error-alert.ts",
  "src/frontend/src/modals/addMcpServerModal/index.tsx",
  "src/frontend/src/modals/modelProviderModal/hooks/useModelToggleQueue.ts",
];

describe("Task 10 frontend localization contract", () => {
  it("keeps the reviewed Wave B inventory at exactly 44 candidates", () => {
    expect(task10Candidates).toHaveLength(44);
  });

  it.each(task10Candidates)(
    "moves $candidate_id in $path from raw UI prose to a semantic key",
    ({ path, source_excerpt }) => {
      expect(source(path)).not.toContain(source_excerpt.trim());
    },
  );

  it.each(Object.entries(additionalWaveBDebt))(
    "removes additional Wave B UI debt from %s",
    (path, forbiddenFragments) => {
      const contents = source(path);
      for (const fragment of forbiddenFragments) {
        expect(contents).not.toContain(fragment);
      }
    },
  );

  it.each(rawBackendErrorDebt)(
    "does not render backend detail or exception messages in %s",
    (path) => {
      const contents = source(path);
      expect(contents).not.toMatch(/response\??\.data\??\.detail/);
      expect(contents).not.toMatch(/err instanceof Error \? err\.message/);
      expect(contents).not.toContain("getAxiosErrorMessage");
    },
  );

  it("keeps deployment, knowledge-filter, and MCP machine values stable", () => {
    const deploymentType = source(
      "src/frontend/src/pages/MainPage/pages/deploymentsPage/components/step-type.tsx",
    );
    expect(deploymentType).toContain('type: "agent" as const');
    expect(deploymentType).toContain("value={option.type}");
    expect(deploymentType).toContain(
      "data-testid={`deployment-type-${option.type}`}",
    );

    const sourceChunks = source(
      "src/frontend/src/pages/MainPage/pages/knowledgePage/sourceChunksPage/SourceChunksPage.tsx",
    );
    expect(sourceChunks).toContain('<SelectItem value="folder">');

    const mcp = source("src/frontend/src/utils/mcpUtils.ts");
    expect(mcp).toContain('NONE = "none"');
    expect(mcp).toContain('API_KEY = "apikey"');
    expect(mcp).toContain('OAUTH = "oauth"');
  });

  it("stores DB-provider presentation text as semantic keys without changing provider IDs", () => {
    const providers = source(
      "src/frontend/src/constants/dbProviderConstants.ts",
    );
    for (const id of [
      "chroma",
      "chroma_cloud",
      "opensearch",
      "astra",
      "mongodb",
      "postgres",
    ]) {
      expect(providers).toContain(`id: "${id}"`);
    }
    expect(providers).toContain("labelKey:");
    expect(providers).toContain("descriptionKey:");
    expect(providers).toContain("placeholderKey:");
  });

  it("resolves finite Wave B registries through literal translation keys", () => {
    const stepper = source(
      "src/frontend/src/pages/MainPage/pages/deploymentsPage/components/deployment-stepper.tsx",
    );
    expect(stepper).not.toContain("t(step.labelKey)");
    expect(stepper).toContain('t("deployments.provider")');

    const deploymentType = source(
      "src/frontend/src/pages/MainPage/pages/deploymentsPage/components/step-type.tsx",
    );
    expect(deploymentType).not.toContain("t(option.labelKey)");
    expect(deploymentType).not.toContain("t(option.descriptionKey)");

    const mcpAuth = source(
      "src/frontend/src/pages/MainPage/pages/homePage/components/McpAuthSection.tsx",
    );
    expect(mcpAuth).not.toContain("t(activeAuthMethod.labelKey)");
    expect(mcpAuth).toContain('t("authModal.authMethod.oauth")');
  });
});
