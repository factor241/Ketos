import fs from "node:fs";
import path from "node:path";

const frontendRoot = path.resolve(__dirname, "../../../..");

function source(relativePath: string): string {
  return fs.readFileSync(path.join(frontendRoot, relativePath), "utf8");
}

describe("icon-only control accessible names", () => {
  it("names the project sidebar icon controls", () => {
    expect(
      source(
        "src/components/core/folderSidebarComponent/components/sideBarFolderButtons/components/upload-folder-button.tsx",
      ),
    ).toContain('aria-label={t("folder.uploadFlow")}');
    expect(
      source(
        "src/components/core/folderSidebarComponent/components/sideBarFolderButtons/components/add-folder-button.tsx",
      ),
    ).toContain('aria-label={t("folder.createNewProject")}');
    expect(
      source(
        "src/components/core/folderSidebarComponent/components/sideBarFolderButtons/components/select-options.tsx",
      ),
    ).toContain('aria-label={t("folder.options")}');
  });

  it("names every profile-picture choice and its image", () => {
    const chooser = source(
      "src/pages/SettingsPage/pages/GeneralPage/components/ProfilePictureForm/components/profilePictureChooserComponent/index.tsx",
    );
    expect(chooser).toContain(
      'const optionLabel = t("settings.profilePictureOption"',
    );
    expect(chooser).toContain("aria-label={optionLabel}");
    expect(chooser).toContain('alt=""');
  });
});
