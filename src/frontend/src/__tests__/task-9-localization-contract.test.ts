import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const frontendRoot = resolve(__dirname, "../..");

function source(relativePath: string): string {
  return readFileSync(resolve(frontendRoot, relativePath), "utf8");
}

const confirmedTask9Debt: Record<string, string[]> = {
  "src/alerts/alertDropDown/components/singleAlertComponent/index.tsx": [
    ">Dismiss<",
    ">Details<",
  ],
  "src/components/common/pageLayout/index.tsx": [">Beta<"],
  "src/components/core/canvasControlsComponent/CanvasControls.tsx": [
    'aria-label="Dismiss assistant onboarding tooltip"',
    'aria-label="Open Ketos Assistant"',
  ],
  "src/components/core/flowBuilderWelcome/flow-builder-welcome.tsx": [
    'aria-label="Close welcome overlay"',
  ],
  "src/components/ui/dialog.tsx": [">Dialog<", 'content="Close"', ">Close<"],
  "src/controllers/API/queries/agentic/use-post-assist-stream.ts": [
    'message: "Received malformed event from server"',
    'message: "No response body"',
  ],
  "src/hooks/extensions/typed-error-formatting.ts": [
    'title: "Reload diagnostics"',
  ],
  "src/hooks/extensions/use-extension-events.ts": [
    'title: "Extension error"',
    "components in ${bundle}",
    "check server logs for details",
    "Reloaded ${bundle}",
  ],
  "src/modals/apiModal/utils/get-curl-code.tsx": [
    'title: "Upload files to the server"',
    'title: "Execute the flow with uploaded files"',
  ],
  "src/modals/createMemoryModal/index.tsx": [
    'aria-label="Preprocessing instructions help"',
  ],
  "src/modals/createMemoryModal/useCreateMemoryModal.ts": [
    'title: "Validation error"',
  ],
  "src/modals/queryModal/index.tsx": ['label: "Apply"'],
  "src/modals/toolsModal/components/toolsTable/index.tsx": [
    'headerName: "Tags"',
  ],
  "src/utils/utils.ts": ["return `Select ${prefix} ${formattedName}`"],
};

describe("Task 9 frontend localization contract", () => {
  it.each(Object.entries(confirmedTask9Debt))(
    "removes confirmed semantic-key debt from %s",
    (relativePath, forbiddenFragments) => {
      const contents = source(relativePath);
      for (const fragment of forbiddenFragments) {
        expect(contents).not.toContain(fragment);
      }
    },
  );

  it.each([
    "src/pages/LoginPage/index.tsx",
    "src/pages/SignUpPage/index.tsx",
    "src/pages/AdminPage/LoginPage/index.tsx",
    "src/pages/AdminPage/index.tsx",
  ])("does not render raw backend detail in %s", (relativePath) => {
    const contents = source(relativePath);
    expect(contents).not.toMatch(/response[^\n]+data[^\n]+detail/);
  });

  it("removes additional English shell/shared strings found in the Wave A audit", () => {
    expect(source("index.html")).not.toContain(
      "You need to enable JavaScript to run this app.",
    );
    expect(
      source("src/components/common/modelProviderCountComponent/index.tsx"),
    ).not.toContain(">Models<");
    expect(
      source("src/components/common/paginatorComponent/index.tsx"),
    ).not.toContain("of{");
    expect(source("src/alerts/notice/index.tsx")).not.toContain(">Details<");
  });

  it("uses a semantic keyboard-focusable control to clear the admin search", () => {
    const adminPage = source("src/pages/AdminPage/index.tsx");
    expect(adminPage).toContain('aria-label={t("common.clearSearch")}');
    expect(adminPage).not.toMatch(
      /<div[\s\S]{0,120}className="cursor-pointer"[\s\S]{0,240}setInputValue\(""\)/,
    );
  });

  it("labels Wave A icon-only navigation and header controls", () => {
    expect(source("src/components/common/pageLayout/index.tsx")).toContain(
      'aria-label={t("stepper.back")}',
    );
    expect(source("src/pages/AdminPage/index.tsx")).toContain(
      'aria-label={t("stepper.back")}',
    );
    const appHeader = source(
      "src/components/core/appHeaderComponent/index.tsx",
    );
    expect(appHeader).toContain('aria-label={t("header.home")}');
    expect(appHeader).toContain('aria-label={t("header.notificationsLabel")}');
    expect(
      source(
        "src/components/core/appHeaderComponent/components/AccountMenu/index.tsx",
      ),
    ).toContain('ariaLabel={t("account.openMenu")}');

    const imageViewer = source("src/components/common/ImageViewer/index.tsx");
    for (const key of [
      "canvas.zoomIn",
      "canvas.zoomOut",
      "canvas.resetZoomTooltip",
      "playgroundComponent.enterFullscreen",
      "nodeToolbar.download",
    ]) {
      expect(imageViewer).toContain(`aria-label={t("${key}")}`);
    }

    const alertDropdown = source("src/alerts/alertDropDown/index.tsx");
    expect(alertDropdown).toContain(
      'aria-label={t("alerts.clearNotifications")}',
    );
    expect(alertDropdown).toContain('aria-label={t("common.close")}');

    const themeButtons = source(
      "src/components/core/appHeaderComponent/components/ThemeButtons/index.tsx",
    );
    for (const key of ["theme.light", "theme.dark", "theme.system"]) {
      expect(themeButtons).toContain(`aria-label={t("${key}")}`);
    }
  });
});
