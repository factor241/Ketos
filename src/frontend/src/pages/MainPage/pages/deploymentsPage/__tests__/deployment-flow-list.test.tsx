jest.unmock("react-i18next");

import { render, screen } from "@testing-library/react";
import type { i18n as I18nInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import type { DeploymentFlowVersionItem } from "@/controllers/API/queries/deployments/use-get-deployment-attachments";
import i18n from "@/i18n";
import { createTestI18n } from "@/test-utils/create-test-i18n";

jest.mock(
  "@/components/common/genericIconComponent",
  () =>
    function MockIcon({ name }: { name: string }) {
      return <span data-testid={`icon-${name}`} />;
    },
);

import DeploymentFlowList from "../components/deployment-details-modal/deployment-flow-list";

function makeFlowVersion(
  overrides: Partial<DeploymentFlowVersionItem> = {},
): DeploymentFlowVersionItem {
  return {
    id: "fv-1",
    flow_id: "f-1",
    flow_name: "My Flow",
    version_number: 1,
    attached_at: null,
    provider_snapshot_id: null,
    provider_data: null,
    ...overrides,
  };
}

function renderList(
  flowVersions: DeploymentFlowVersionItem[] = [],
  getConnectionNames: (fv: DeploymentFlowVersionItem) => string[] = () => [],
  translationInstance?: I18nInstance,
) {
  return render(
    translationInstance ? (
      <I18nextProvider i18n={translationInstance}>
        <DeploymentFlowList
          flowVersions={flowVersions}
          getConnectionNames={getConnectionNames}
        />
      </I18nextProvider>
    ) : (
      <DeploymentFlowList
        flowVersions={flowVersions}
        getConnectionNames={getConnectionNames}
      />
    ),
  );
}

describe("DeploymentFlowList", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("renders the missing-flow presentation fallback in Russian", async () => {
    const russian = await createTestI18n("ru");

    renderList([makeFlowVersion({ flow_name: null })], () => [], russian);

    expect(screen.getByText("Неизвестный сценарий")).toBeInTheDocument();
    expect(screen.queryByText("Unknown flow")).not.toBeInTheDocument();
  });

  it("shows the empty state when there are no attached flows", () => {
    renderList([]);

    expect(screen.getByText("Attached Flows (0)")).toBeInTheDocument();
    expect(screen.getByText("No flows attached")).toBeInTheDocument();
  });

  it("renders real flow details instead of mocked child props", () => {
    const flowVersions = [
      makeFlowVersion({
        id: "fv-1",
        flow_name: "Alpha",
        version_number: 2,
        provider_data: { tool_display_name: "Search Docs" },
      }),
      makeFlowVersion({
        id: "fv-2",
        flow_name: null,
        version_number: 5,
        provider_data: null,
      }),
    ];

    renderList(flowVersions, (flowVersion) =>
      flowVersion.id === "fv-1" ? ["Prod Connection", "Backup Connection"] : [],
    );

    expect(screen.getByText("Attached Flows (2)")).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Unknown flow")).toBeInTheDocument();
    expect(screen.getByText("v2")).toBeInTheDocument();
    expect(screen.getByText("v5")).toBeInTheDocument();
    expect(screen.getByText("Search Docs")).toBeInTheDocument();
    expect(screen.getByText("Prod Connection")).toBeInTheDocument();
    expect(screen.getByText("Backup Connection")).toBeInTheDocument();
  });
});
