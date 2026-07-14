import { recoverModelOption } from "@/components/core/parameterRenderComponent/components/modelInputComponent/helpers/recover-model-option";
import {
  ACTIVE_DB_PROVIDER_VARIABLE,
  DB_PROVIDER_OPTIONS,
} from "@/constants/dbProviderConstants";
import { customDefaultShortcuts } from "@/customization/constants";
import i18n from "@/i18n";
import {
  DEFAULT_FLOW_NAME,
  WXO_PROVIDER_KEY,
} from "@/pages/MainPage/pages/deploymentsPage/types";
import {
  AUTH_METHODS_ARRAY,
  extractMcpServersFromJson,
} from "@/utils/mcpUtils";

function machineProjection() {
  const importedServer = extractMcpServersFromJson({
    mcpServers: {
      "stable-server-id": {
        command: "stable-command",
        args: ["--stable-arg"],
      },
    },
  })[0];
  const recoveredModel = recoverModelOption({
    id: "stable-model-id",
    name: "stable-model-name",
    icon: "Bot",
    provider: "stable-provider-id",
  });

  return {
    deployment: {
      providerKey: WXO_PROVIDER_KEY,
      payloadDefaultToolName: DEFAULT_FLOW_NAME,
    },
    db: {
      preferenceKey: ACTIVE_DB_PROVIDER_VARIABLE,
      providers: DB_PROVIDER_OPTIONS.map((provider) => ({
        id: provider.id,
        defaults: provider.configFields.map((field) => field.defaultValue),
      })),
    },
    mcp: {
      authIds: AUTH_METHODS_ARRAY.map((method) => method.id),
      server: importedServer,
    },
    model: recoveredModel,
    shortcuts: customDefaultShortcuts.map(({ name, shortcut }) => ({
      name,
      shortcut,
    })),
  };
}

describe("Task 10 machine-value locale round trip", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("keeps provider, DB, MCP, model, and shortcut values byte-identical", async () => {
    await i18n.changeLanguage("en");
    const english = machineProjection();

    await i18n.changeLanguage("ru");
    const russian = machineProjection();

    await i18n.changeLanguage("en");
    const englishAgain = machineProjection();

    expect(JSON.stringify(russian)).toBe(JSON.stringify(english));
    expect(JSON.stringify(englishAgain)).toBe(JSON.stringify(english));
    expect(english.mcp.server?.command).toBe("stable-command");
    expect(english.model?.id).toBe("stable-model-id");
  });
});
