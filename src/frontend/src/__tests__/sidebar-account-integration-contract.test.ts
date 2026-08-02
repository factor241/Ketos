import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const frontendRoot = resolve(__dirname, "../..");

function source(relativePath: string): string {
  return readFileSync(resolve(frontendRoot, relativePath), "utf8");
}

describe("sidebar account integration contract", () => {
  it("keeps one account entry in the footer without duplicate resource links", () => {
    const sidebar = source(
      "src/components/core/folderSidebarComponent/components/sideBarFolderButtons/index.tsx",
    );

    expect(sidebar).toContain(
      'import CustomSidebarAccount from "@/customization/components/custom-sidebar-account";',
    );
    expect(sidebar).toMatch(
      /<SidebarFooter className="border-t">\s*<div className="p-2">\s*<CustomSidebarAccount \/>\s*<\/div>\s*<\/SidebarFooter>/,
    );
    expect(sidebar).not.toContain("ENABLE_FILE_MANAGEMENT");
    expect(sidebar).not.toContain("sidebar.knowledge");
    expect(sidebar).not.toContain("sidebar.myFiles");
  });

  it("mounts the project sidebar after data loads even for the empty state", () => {
    const mainPage = source("src/pages/MainPage/pages/main-page.tsx");

    expect(mainPage).toMatch(
      /\{flows && examples && folders && \(\s*<SideBarFoldersButtonsComponent/,
    );
    expect(mainPage).not.toMatch(
      /flows && examples && folders && showMainContent/,
    );
  });

  it("initially closes the project sidebar below the 1024px breakpoint", () => {
    const mainPage = source("src/pages/MainPage/pages/main-page.tsx");

    expect(mainPage).toContain("useIsMobile({ maxWidth: 1024 })");
    expect(mainPage).toContain(
      '<SidebarProvider width="280px" defaultOpen={!isMobile}>',
    );
  });
});
