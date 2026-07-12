jest.mock("@xyflow/react", () => ({
  addEdge: jest.fn(),
  applyEdgeChanges: jest.fn((changes, edges) => edges),
  applyNodeChanges: jest.fn((changes, nodes) => nodes),
}));

jest.mock("lodash", () => ({
  cloneDeep: jest.fn((value) => JSON.parse(JSON.stringify(value))),
  zip: jest.fn(),
}));

jest.mock("@/CustomNodes/helpers/check-code-validity", () => ({
  checkCodeValidity: jest.fn(),
}));

jest.mock("../../i18n", () => ({
  __esModule: true,
  default: { t: jest.fn((key: string) => key) },
}));

jest.mock("@/customization/feature-flags", () => ({
  ENABLE_DATASTAX_KETOS: false,
}));

jest.mock("@/customization/utils/analytics", () => ({
  track: jest.fn(),
  trackDataLoaded: jest.fn(),
  trackFlowBuild: jest.fn(),
}));

jest.mock("../alertStore", () => ({
  __esModule: true,
  default: {
    getState: () => ({
      setErrorData: jest.fn(),
      setSuccessData: jest.fn(),
    }),
  },
}));

jest.mock("../darkStore", () => ({
  useDarkStore: { getState: () => ({}) },
}));

jest.mock("../flowsManagerStore", () => ({
  __esModule: true,
  default: {
    getState: () => ({
      setCurrentFlow: jest.fn(),
      takeSnapshot: jest.fn(),
    }),
  },
}));

jest.mock("../globalVariablesStore/globalVariables", () => ({
  useGlobalVariablesStore: {
    getState: () => ({ globalVariables: {} }),
  },
}));

jest.mock("../tweaksStore", () => ({
  useTweaksStore: {
    getState: () => ({
      tweaks: {},
      initialSetup: jest.fn(),
    }),
  },
}));

const mockTypesStoreState = {
  data: {},
  types: {},
  templates: {},
  componentDisplayNames: {} as import("@/types/api").ComponentDisplayNamesType,
};

jest.mock("../typesStore", () => ({
  useTypesStore: { getState: () => mockTypesStoreState },
}));

jest.mock("@/utils/utils", () => ({ brokenEdgeMessage: jest.fn() }));

import { applyFlowUpdate } from "@/components/core/assistantPanel/helpers/apply-flow-update";
import type { AgenticFlowUpdateEvent } from "@/controllers/API/queries/agentic";
import type { AllNodeType, FlowType } from "@/types/flow";
import assistantModifiedSpec from "../../../../../tests/fixtures/localization/flow-abi/v1/assistant-modified-flow.json";
import customLabelSpec from "../../../../../tests/fixtures/localization/flow-abi/v1/custom-label-flow.json";
import legacySpec from "../../../../../tests/fixtures/localization/flow-abi/v1/legacy-flow.json";
import oldSpec from "../../../../../tests/fixtures/localization/flow-abi/v1/old-flow.json";
import outdatedSpec from "../../../../../tests/fixtures/localization/flow-abi/v1/outdated-flow.json";
import outputReorderedSpec from "../../../../../tests/fixtures/localization/flow-abi/v1/output-reordered-flow.json";
import outdatedFlowFixture from "../../../tests/assets/outdated_flow.json";
import useFlowStore, { syncNodeTranslations } from "../flowStore";

type JsonRecord = Record<string, unknown>;
type FrontendCorpusSpec = {
  schema_version: number;
  case_id: string;
  traits: string[];
  stable_ids: { nodes: string[]; edges: string[] };
  overrides?: {
    component_label?: string;
    field_label?: string;
    output_label?: string;
    prompt_template?: string;
  };
};

const FRONTEND_CORPUS = [
  oldSpec,
  outdatedSpec,
  legacySpec,
  customLabelSpec,
  assistantModifiedSpec,
  outputReorderedSpec,
] as FrontendCorpusSpec[];

const INPUT_PRESENTATION_FIELDS = [
  "display_name",
  "info",
  "placeholder",
  "helper_text",
  "refresh_button_text",
  "list_add_label",
  "auth_tooltip",
  "min_label",
  "max_label",
  "trigger_text",
] as const;

const PRESENTATION_KEYS = new Set([
  ...INPUT_PRESENTATION_FIELDS,
  "description",
  "documentation",
  "icon",
  "label",
  "title",
  "options_metadata",
]);

function cloneJson<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function asRecord(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function localized(locale: "en" | "ru", value: string): string {
  return locale === "ru" ? `Рус: ${value || "пусто"}` : value;
}

function normalizeComponentKey(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

function stripPresentation(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripPresentation);
  const record = asRecord(value);
  if (!record) return value;

  return Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => !PRESENTATION_KEYS.has(key))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stripPresentation(entry)]),
  );
}

function normalizedMachineGraph(nodes: AllNodeType[], edges: unknown[]) {
  return {
    nodes: nodes.map((node) => {
      const data = node.data as unknown as JsonRecord;
      const innerNode = asRecord(data.node) ?? {};
      return {
        id: node.id,
        type: node.type,
        position: cloneJson(node.position),
        data: {
          id: data.id,
          type: data.type,
          selected_output: data.selected_output,
          selected_output_type: data.selected_output_type,
          output_types: cloneJson(data.output_types),
          legacy: innerNode.legacy,
          replacement: cloneJson(innerNode.replacement),
          template: stripPresentation(innerNode.template),
          outputs: stripPresentation(innerNode.outputs),
        },
      };
    }),
    edges: edges.map(stripPresentation),
  };
}

function executionSignature(nodes: AllNodeType[], edges: unknown[]) {
  const graph = normalizedMachineGraph(nodes, edges);
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const connections = graph.edges.map((edge) => {
    const record = edge as JsonRecord;
    const data = asRecord(record.data) ?? {};
    const sourceHandle = asRecord(data.sourceHandle) ?? {};
    const targetHandle = asRecord(data.targetHandle) ?? {};
    expect(nodeIds.has(String(record.source))).toBe(true);
    expect(nodeIds.has(String(record.target))).toBe(true);
    const sourceNode = graph.nodes.find((node) => node.id === record.source);
    const targetNode = graph.nodes.find((node) => node.id === record.target);
    const sourceOutputs = Array.isArray(sourceNode?.data.outputs)
      ? sourceNode.data.outputs
      : [];
    const targetTemplate = asRecord(targetNode?.data.template) ?? {};
    expect(
      sourceOutputs.some(
        (output) => asRecord(output)?.name === sourceHandle.name,
      ),
    ).toBe(true);
    expect(Object.hasOwn(targetTemplate, String(targetHandle.fieldName))).toBe(
      true,
    );
    return {
      source: record.source,
      sourceOutput: sourceHandle.name,
      target: record.target,
      targetField: targetHandle.fieldName,
    };
  });

  return {
    components: graph.nodes.map((node) => ({
      id: node.id,
      type: node.data.type,
      selectedOutput: node.data.selected_output,
      template: node.data.template,
      outputs: node.data.outputs,
    })),
    connections,
  };
}

function makeLocaleDefinitions(
  referenceNodes: AllNodeType[],
  locale: "en" | "ru",
) {
  const types: Record<string, string> = {};
  const definitions: Record<string, JsonRecord> = {};
  const displayNames: import("@/types/api").ComponentDisplayNamesType = {};

  for (const node of referenceNodes) {
    if (node.type === "noteNode") continue;
    const data = node.data as unknown as JsonRecord;
    const componentType = String(data.type);
    const innerNode = asRecord(data.node) ?? {};
    const template = asRecord(innerNode.template) ?? {};
    const freshTemplate: Record<string, unknown> = {};
    const knownFields: NonNullable<
      import("@/types/api").ComponentDisplayNamesType[string]["fields"]
    > = {};

    for (const [fieldName, rawField] of Object.entries(template)) {
      const field = asRecord(rawField);
      if (!field) {
        freshTemplate[fieldName] = cloneJson(rawField);
        continue;
      }

      const freshField = cloneJson(field);
      const presentation: Record<string, string[]> = {};
      for (const presentationField of INPUT_PRESENTATION_FIELDS) {
        const current = field[presentationField];
        if (typeof current !== "string") continue;
        freshField[presentationField] = localized(locale, current);
        if (presentationField !== "display_name") {
          presentation[presentationField] = [current, localized("ru", current)];
        }
      }

      const options = Array.isArray(field.options) ? field.options : [];
      if (options.length > 0) {
        freshField.options_metadata = options.map((option) => ({
          value: cloneJson(option),
          label: localized(locale, String(option)),
        }));
        presentation["options_metadata.label"] = options.flatMap((option) => [
          String(option),
          localized("ru", String(option)),
        ]);
      }

      const displayName =
        typeof field.display_name === "string" ? field.display_name : fieldName;
      knownFields[fieldName] = {
        display_name: [displayName, localized("ru", displayName)],
        presentation,
      };
      freshTemplate[fieldName] = freshField;
    }

    const outputs = Array.isArray(innerNode.outputs)
      ? (innerNode.outputs as JsonRecord[])
      : [];
    const knownOutputs: NonNullable<
      import("@/types/api").ComponentDisplayNamesType[string]["outputs"]
    > = {};
    const freshOutputs = outputs.map((output) => {
      const freshOutput = cloneJson(output);
      const name = String(output.name);
      const displayName = String(output.display_name ?? name);
      const info = String(output.info ?? "");
      freshOutput.display_name = localized(locale, displayName);
      freshOutput.info = localized(locale, info);
      knownOutputs[name] = {
        display_name: [displayName, localized("ru", displayName)],
        info: [info, localized("ru", info)],
      };
      return freshOutput;
    });
    if (locale === "ru") freshOutputs.reverse();

    const displayName = String(innerNode.display_name ?? componentType);
    const description = String(innerNode.description ?? "");
    types[componentType] = "abi-corpus";
    definitions[componentType] = {
      ...cloneJson(innerNode),
      display_name: localized(locale, displayName),
      description: localized(locale, description),
      template: freshTemplate,
      outputs: freshOutputs,
    };
    displayNames[normalizeComponentKey(componentType)] = {
      display_name: [displayName, localized("ru", displayName)],
      description: [description, localized("ru", description)],
      fields: knownFields,
      outputs: knownOutputs,
    };
  }

  return { types, definitions, displayNames };
}

function configureLocale(
  referenceNodes: AllNodeType[],
  locale: "en" | "ru",
): void {
  const { types, definitions, displayNames } = makeLocaleDefinitions(
    referenceNodes,
    locale,
  );
  mockTypesStoreState.types = types;
  mockTypesStoreState.data = { "abi-corpus": definitions };
  mockTypesStoreState.templates = {};
  mockTypesStoreState.componentDisplayNames = displayNames;
}

function makeFrontendCorpusFlow(spec: FrontendCorpusSpec): FlowType {
  const [inputId, transformId, outputId] = spec.stable_ids.nodes;
  const [firstEdgeId, secondEdgeId] = spec.stable_ids.edges;
  const makeNode = (
    id: string,
    componentType: string,
    template: JsonRecord,
    outputs: JsonRecord[],
  ) =>
    ({
      id,
      type: "genericNode",
      position: { x: 0, y: 0 },
      data: {
        id,
        type: componentType,
        node: {
          display_name: componentType,
          description: `${componentType} description`,
          template,
          outputs,
        },
      },
    }) as unknown as AllNodeType;

  const inputNode = makeNode(
    inputId,
    `${spec.case_id}-input`,
    {
      input_value: {
        name: "input_value",
        type: "str",
        display_name: "Input Value",
        info: "Stable input",
        value: "corpus@example.com",
        options: ["raw", "parsed"],
      },
    },
    [
      {
        name: spec.case_id === "assistant-modified-flow" ? "message" : "text",
        display_name: "Text",
        info: "Stable text output",
        method: "text_response",
        types: ["Message"],
        selected: true,
      },
    ],
  );
  const transformNode = makeNode(
    transformId,
    `${spec.case_id}-transform`,
    {
      [spec.case_id === "assistant-modified-flow" ? "var1" : "input_text"]: {
        name:
          spec.case_id === "assistant-modified-flow" ? "var1" : "input_text",
        type: "str",
        display_name: "Transform Input",
        info: "Stable transform input",
        value: "stable-value",
        options: ["stable-value", "alternate-value"],
      },
    },
    [
      {
        name: spec.case_id === "assistant-modified-flow" ? "prompt" : "text",
        display_name: "Primary Output",
        info: "Stable primary output",
        method: "primary_output",
        types: ["Message"],
        selected: true,
      },
      {
        name: "dataframe",
        display_name: "DataFrame Output",
        info: "Stable secondary output",
        method: "dataframe_output",
        types: ["DataFrame"],
        selected: false,
      },
    ],
  );
  const outputNode = makeNode(
    outputId,
    `${spec.case_id}-output`,
    {
      input_value: {
        name: "input_value",
        type: "str",
        display_name: "Output Input",
        info: "Stable output input",
        value: "",
      },
    },
    [
      {
        name: "result",
        display_name: "Result",
        info: "Stable final result",
        method: "result_output",
        types: ["Message"],
        selected: true,
      },
    ],
  );

  const transformInner = transformNode.data.node as unknown as JsonRecord;
  if (spec.traits.includes("outdated")) {
    transformInner.legacy = true;
    transformInner.replacement = [`${spec.case_id}-transform-v2`];
  }
  if (spec.traits.includes("legacy")) {
    transformInner.legacy = true;
    (transformInner.outputs as JsonRecord[]).push({
      name: "removed_legacy_output",
      display_name: "Customer legacy output",
      info: "Customer legacy output help",
      method: "legacy_method",
      types: ["Data"],
      selected: false,
    });
  }
  if (spec.traits.includes("custom-label")) {
    transformInner.display_name = spec.overrides?.component_label;
    const fields = asRecord(transformInner.template)!;
    const inputField = asRecord(fields.input_text)!;
    inputField.display_name = spec.overrides?.field_label;
    const textOutput = (transformInner.outputs as JsonRecord[]).find(
      (output) => output.name === "text",
    )!;
    textOutput.display_name = spec.overrides?.output_label;
  }

  const firstSourceName =
    spec.case_id === "assistant-modified-flow" ? "message" : "text";
  const firstTargetName =
    spec.case_id === "assistant-modified-flow" ? "var1" : "input_text";
  const secondSourceName =
    spec.case_id === "assistant-modified-flow" ? "prompt" : "text";
  const edges = [
    {
      id: firstEdgeId,
      source: inputId,
      target: transformId,
      data: {
        sourceHandle: { name: firstSourceName },
        targetHandle: { fieldName: firstTargetName },
      },
    },
    {
      id: secondEdgeId,
      source: transformId,
      target: outputId,
      data: {
        sourceHandle: { name: secondSourceName },
        targetHandle: { fieldName: "input_value" },
      },
    },
  ];

  return {
    id: `flow-${spec.case_id}`,
    name: spec.case_id,
    data: { nodes: [inputNode, transformNode, outputNode], edges },
  } as unknown as FlowType;
}

function corpusOverrideProjection(nodes: AllNodeType[]) {
  return nodes.map((node) => {
    const inner = node.data.node as unknown as JsonRecord;
    const template = asRecord(inner.template) ?? {};
    return {
      id: node.id,
      display_name: String(inner.display_name).startsWith("Customer ")
        ? inner.display_name
        : undefined,
      fields: Object.fromEntries(
        Object.entries(template)
          .map(([name, rawField]) => {
            const field = asRecord(rawField) ?? {};
            return [
              name,
              String(field.display_name).startsWith("Customer ")
                ? field.display_name
                : undefined,
            ];
          })
          .filter(([, value]) => value !== undefined),
      ),
      outputs: Object.fromEntries(
        ((inner.outputs as JsonRecord[]) ?? [])
          .map((output) => [
            output.name,
            String(output.display_name).startsWith("Customer ")
              ? output.display_name
              : undefined,
          ])
          .filter(([, value]) => value !== undefined),
      ),
    };
  });
}

describe("flow localization ABI regression", () => {
  beforeEach(() => {
    mockTypesStoreState.data = {};
    mockTypesStoreState.types = {};
    mockTypesStoreState.templates = {};
    mockTypesStoreState.componentDisplayNames = {};
    useFlowStore.setState({ nodes: [], edges: [] });
  });

  it.each(FRONTEND_CORPUS)(
    "keeps versioned corpus case $case_id machine-identical through en→ru→save/reload→en",
    (spec) => {
      expect(spec.schema_version).toBe(1);
      const referenceFlow = makeFrontendCorpusFlow({
        ...spec,
        traits: [],
        overrides: undefined,
      });
      const corpusFlow = makeFrontendCorpusFlow(spec);
      const referenceNodes = cloneJson(referenceFlow.data!.nodes);

      configureLocale(referenceNodes, "en");
      useFlowStore.getState().resetFlow(corpusFlow);

      if (spec.traits.includes("assistant-modified")) {
        const transformId = spec.stable_ids.nodes[1];
        const updateNodeInternals = jest.fn() as unknown as Parameters<
          typeof applyFlowUpdate
        >[1];
        applyFlowUpdate(
          {
            event: "flow_update",
            action: "configure",
            component_id: transformId,
            params: { var1: spec.overrides?.prompt_template },
          } as unknown as AgenticFlowUpdateEvent,
          updateNodeInternals,
        );
        applyFlowUpdate(
          {
            event: "flow_update",
            action: "select_output",
            component_id: transformId,
            output_name: "prompt",
          } as unknown as AgenticFlowUpdateEvent,
          updateNodeInternals,
        );
      }

      const initial = useFlowStore.getState();
      const machineBefore = normalizedMachineGraph(
        initial.nodes,
        initial.edges,
      );
      const executionBefore = executionSignature(initial.nodes, initial.edges);
      const overridesBefore = corpusOverrideProjection(initial.nodes);
      const presentationBefore = initial.nodes.map(
        (node) => node.data.node?.display_name,
      );

      configureLocale(referenceNodes, "ru");
      syncNodeTranslations();

      const russian = useFlowStore.getState();
      expect(
        russian.nodes.map((node) => node.data.node?.display_name),
      ).not.toEqual(presentationBefore);
      expect(normalizedMachineGraph(russian.nodes, russian.edges)).toEqual(
        machineBefore,
      );
      expect(executionSignature(russian.nodes, russian.edges)).toEqual(
        executionBefore,
      );
      expect(corpusOverrideProjection(russian.nodes)).toEqual(overridesBefore);

      const reloaded = JSON.parse(
        JSON.stringify({
          ...corpusFlow,
          data: { nodes: russian.nodes, edges: russian.edges },
        }),
      ) as FlowType;
      useFlowStore.getState().resetFlow(reloaded);

      configureLocale(referenceNodes, "en");
      syncNodeTranslations();

      const roundTripped = useFlowStore.getState();
      expect(
        normalizedMachineGraph(roundTripped.nodes, roundTripped.edges),
      ).toEqual(machineBefore);
      expect(
        executionSignature(roundTripped.nodes, roundTripped.edges),
      ).toEqual(executionBefore);
      expect(corpusOverrideProjection(roundTripped.nodes)).toEqual(
        overridesBefore,
      );
      expect(JSON.stringify(machineBefore)).not.toContain("Рус:");
    },
  );

  it("does not overwrite an unrecognized legacy field override when translation metadata is incomplete", () => {
    const node = {
      id: "LegacyComponent-stable-id",
      type: "genericNode",
      position: { x: 40, y: 80 },
      data: {
        id: "LegacyComponent-stable-id",
        type: "LegacyComponent",
        node: {
          display_name: "Legacy Component",
          description: "Legacy description",
          legacy: true,
          template: {
            mode: {
              name: "mode",
              type: "str",
              display_name: "Customer mode label",
              info: "Customer help text",
              value: "stable-mode-id",
              options: ["stable-mode-id"],
            },
          },
          outputs: [],
        },
      },
    } as unknown as AllNodeType;

    mockTypesStoreState.types = { LegacyComponent: "legacy" };
    mockTypesStoreState.data = {
      legacy: {
        LegacyComponent: {
          display_name: "Устаревший компонент",
          description: "Описание",
          template: {
            mode: {
              name: "mode",
              type: "str",
              display_name: "Режим",
              info: "Справка по режиму",
              value: "stable-mode-id",
              options: ["stable-mode-id"],
            },
          },
          outputs: [],
        },
      },
    };
    mockTypesStoreState.componentDisplayNames = {
      legacycomponent: {
        display_name: ["Legacy Component", "Устаревший компонент"],
        description: ["Legacy description", "Описание"],
        fields: {},
        outputs: {},
      },
    };
    useFlowStore.setState({ nodes: [node] });

    syncNodeTranslations();

    expect(
      useFlowStore.getState().nodes[0].data.node?.template.mode,
    ).toMatchObject({
      name: "mode",
      display_name: "Customer mode label",
      info: "Customer help text",
      value: "stable-mode-id",
      options: ["stable-mode-id"],
    });
  });

  it("keeps legacy nested entries that are absent from fresh presentation metadata", () => {
    const node = {
      id: "LegacyComponent-stable-id",
      type: "genericNode",
      position: { x: 40, y: 80 },
      data: {
        id: "LegacyComponent-stable-id",
        type: "LegacyComponent",
        node: {
          display_name: "Legacy Component",
          description: "Legacy description",
          legacy: true,
          template: {
            mode: {
              name: "mode",
              type: "str",
              display_name: "Mode",
              value: "stable-mode-id",
              dialog_inputs: [
                {
                  name: "system_mode",
                  display_name: "System mode",
                  value: "system-mode-id",
                },
                {
                  name: "customer_mode",
                  display_name: "Customer nested label",
                  value: "customer-mode-id",
                },
              ],
            },
          },
          outputs: [],
        },
      },
    } as unknown as AllNodeType;

    mockTypesStoreState.types = { LegacyComponent: "legacy" };
    mockTypesStoreState.data = {
      legacy: {
        LegacyComponent: {
          display_name: "Устаревший компонент",
          description: "Описание",
          template: {
            mode: {
              name: "mode",
              type: "str",
              display_name: "Режим",
              value: "stable-mode-id",
              dialog_inputs: [
                {
                  name: "system_mode",
                  display_name: "Системный режим",
                  value: "system-mode-id",
                },
              ],
            },
          },
          outputs: [],
        },
      },
    };
    mockTypesStoreState.componentDisplayNames = {
      legacycomponent: {
        display_name: ["Legacy Component", "Устаревший компонент"],
        description: ["Legacy description", "Описание"],
        fields: {
          mode: {
            display_name: ["Mode", "Режим"],
            presentation: {
              "dialog_inputs.display_name": ["System mode", "Системный режим"],
            },
          },
        },
        outputs: {},
      },
    };
    useFlowStore.setState({ nodes: [node] });

    syncNodeTranslations();

    expect(
      useFlowStore.getState().nodes[0].data.node?.template.mode.dialog_inputs,
    ).toEqual([
      {
        name: "system_mode",
        display_name: "Системный режим",
        value: "system-mode-id",
      },
      {
        name: "customer_mode",
        display_name: "Customer nested label",
        value: "customer-mode-id",
      },
    ]);
  });

  it("keeps a legacy flow corpus machine-identical through en→ru→save/reload→en", () => {
    const referenceFlow = cloneJson(outdatedFlowFixture) as unknown as FlowType;
    const referenceNodes = cloneJson(referenceFlow.data!.nodes);
    const corpusFlow = cloneJson(referenceFlow);
    const corpusNodes = corpusFlow.data!.nodes;

    const promptNode = corpusNodes.find((node) => node.data.type === "Prompt")!;
    const promptInner = promptNode.data.node as unknown as JsonRecord;
    promptInner.display_name = "Customer prompt component";
    promptInner.description = "Customer prompt description";
    const promptTemplate = asRecord(promptInner.template)!;
    const userMessageField = asRecord(promptTemplate.user_message)!;
    userMessageField.display_name = "Customer prompt field";
    userMessageField.info = "Customer prompt help";

    const modelNode = corpusNodes.find(
      (node) => node.data.type === "OpenAIModel",
    )!;
    const modelInner = modelNode.data.node as unknown as JsonRecord;
    modelInner.legacy = true;
    modelInner.replacement = ["OpenAIModelV2"];
    const modelTemplate = asRecord(modelInner.template)!;
    const modelNameField = asRecord(modelTemplate.model_name)!;
    const rawModelOptions = cloneJson(modelNameField.options as unknown[]);
    modelNameField.options_metadata = rawModelOptions.map((option, index) => ({
      value: cloneJson(option),
      label: index === 0 ? "Customer provider label" : String(option),
    }));
    const modelOutputs = modelInner.outputs as JsonRecord[];
    modelOutputs[0].display_name = "Customer output label";
    modelOutputs[0].info = "Customer output help";
    modelOutputs.splice(1, 0, {
      name: "removed_legacy_output",
      types: ["Data"],
      method: "legacy_method",
      display_name: "Customer legacy output label",
      info: "Customer legacy output help",
    });

    corpusNodes.push({
      id: "note-legacy-user-content",
      type: "noteNode",
      position: { x: 900, y: 120 },
      data: {
        id: "note-legacy-user-content",
        type: "note",
        node: {
          display_name: "Customer note label",
          description: "User-authored note body",
          documentation: "",
          template: {},
        },
      },
    } as unknown as AllNodeType);

    const overrideProjection = (nodes: AllNodeType[]) => {
      const prompt = nodes.find((node) => node.data.type === "Prompt")!;
      const promptNodeData = prompt.data.node as unknown as JsonRecord;
      const promptFields = asRecord(promptNodeData.template)!;
      const promptUserMessage = asRecord(promptFields.user_message)!;
      const model = nodes.find((node) => node.data.type === "OpenAIModel")!;
      const modelNodeData = model.data.node as unknown as JsonRecord;
      const modelFields = asRecord(modelNodeData.template)!;
      const modelName = asRecord(modelFields.model_name)!;
      const outputByName = Object.fromEntries(
        (modelNodeData.outputs as JsonRecord[]).map((output) => [
          output.name,
          { display_name: output.display_name, info: output.info },
        ]),
      );
      const note = nodes.find((node) => node.type === "noteNode")!;
      return {
        component: {
          display_name: promptNodeData.display_name,
          description: promptNodeData.description,
        },
        field: {
          display_name: promptUserMessage.display_name,
          info: promptUserMessage.info,
        },
        customOptionLabel: (modelName.options_metadata as JsonRecord[])[0]
          .label,
        outputs: {
          customized: outputByName.text_output,
          removedLegacy: outputByName.removed_legacy_output,
        },
        note: note.data.node?.description,
      };
    };

    configureLocale(referenceNodes, "en");
    useFlowStore.getState().resetFlow(corpusFlow);

    const updateNodeInternals = jest.fn() as unknown as Parameters<
      typeof applyFlowUpdate
    >[1];
    applyFlowUpdate(
      {
        event: "flow_update",
        action: "configure",
        component_id: modelNode.id,
        params: { model_name: "gpt-4.1" },
      } as unknown as AgenticFlowUpdateEvent,
      updateNodeInternals,
    );
    applyFlowUpdate(
      {
        event: "flow_update",
        action: "select_output",
        component_id: modelNode.id,
        output_name: "model_output",
      } as unknown as AgenticFlowUpdateEvent,
      updateNodeInternals,
    );

    const initialState = useFlowStore.getState();
    const machineBefore = normalizedMachineGraph(
      initialState.nodes,
      initialState.edges,
    );
    const executionBefore = executionSignature(
      initialState.nodes,
      initialState.edges,
    );
    const overridesBefore = overrideProjection(initialState.nodes);
    expect(initialState.nodes).toHaveLength(referenceNodes.length + 1);
    expect(initialState.edges).toHaveLength(referenceFlow.data!.edges.length);
    expect(
      (
        initialState.nodes.find((node) => node.id === modelNode.id)
          ?.data as unknown as JsonRecord
      ).selected_output,
    ).toBe("model_output");

    configureLocale(referenceNodes, "ru");
    syncNodeTranslations();

    let localizedState = useFlowStore.getState();
    expect(
      normalizedMachineGraph(localizedState.nodes, localizedState.edges),
    ).toEqual(machineBefore);
    expect(
      executionSignature(localizedState.nodes, localizedState.edges),
    ).toEqual(executionBefore);
    expect(overrideProjection(localizedState.nodes)).toEqual(overridesBefore);

    const localizedModel = localizedState.nodes.find(
      (node) => node.data.type === "OpenAIModel",
    )!;
    const localizedModelInner = localizedModel.data
      .node as unknown as JsonRecord;
    const localizedModelTemplate = asRecord(localizedModelInner.template)!;
    const localizedModelName = asRecord(localizedModelTemplate.model_name)!;
    expect(localizedModelName.value).toBe("gpt-4.1");
    expect(localizedModelName.options).toEqual(rawModelOptions);
    expect(
      (localizedModelName.options_metadata as JsonRecord[]).map(
        (metadata) => metadata.value,
      ),
    ).toEqual(rawModelOptions);
    expect((localizedModelName.options_metadata as JsonRecord[])[1].label).toBe(
      `Рус: ${String(rawModelOptions[1])}`,
    );
    expect(
      (localizedModelInner.outputs as JsonRecord[]).find(
        (output) => output.name === "model_output",
      )?.display_name,
    ).toBe("Рус: Language Model");

    const savedInRussian = cloneJson({
      ...corpusFlow,
      data: {
        ...corpusFlow.data!,
        nodes: localizedState.nodes,
        edges: localizedState.edges,
      },
    });
    const reloadedFromJson = JSON.parse(
      JSON.stringify(savedInRussian),
    ) as FlowType;
    useFlowStore.getState().resetFlow(reloadedFromJson);

    localizedState = useFlowStore.getState();
    expect(
      normalizedMachineGraph(localizedState.nodes, localizedState.edges),
    ).toEqual(machineBefore);
    expect(
      executionSignature(localizedState.nodes, localizedState.edges),
    ).toEqual(executionBefore);
    expect(overrideProjection(localizedState.nodes)).toEqual(overridesBefore);

    configureLocale(referenceNodes, "en");
    syncNodeTranslations();

    const roundTrippedState = useFlowStore.getState();
    expect(
      normalizedMachineGraph(roundTrippedState.nodes, roundTrippedState.edges),
    ).toEqual(machineBefore);
    expect(
      executionSignature(roundTrippedState.nodes, roundTrippedState.edges),
    ).toEqual(executionBefore);
    expect(overrideProjection(roundTrippedState.nodes)).toEqual(
      overridesBefore,
    );
    expect(
      JSON.parse(
        JSON.stringify({
          nodes: normalizedMachineGraph(
            roundTrippedState.nodes,
            roundTrippedState.edges,
          ).nodes,
          edges: normalizedMachineGraph(
            roundTrippedState.nodes,
            roundTrippedState.edges,
          ).edges,
        }),
      ),
    ).toEqual(machineBefore);
  });
});
