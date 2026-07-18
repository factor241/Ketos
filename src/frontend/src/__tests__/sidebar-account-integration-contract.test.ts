import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const frontendRoot = resolve(__dirname, "../..");

function source(relativePath: string): string {
  return readFileSync(resolve(frontendRoot, relativePath), "utf8");
}

describe("sidebar account integration contract", () => {
  it("keeps account access in an always-mounted footer while file navigation stays flagged", () => {
    const sidebar = source(
      "src/components/core/folderSidebarComponent/components/sideBarFolderButtons/index.tsx",
    );

    expect(sidebar).toContain(
      'import CustomSidebarAccount from "@/customization/components/custom-sidebar-account";',
    );
    expect(sidebar).toMatch(
      /<SidebarFooter className="border-t">\s*\{ENABLE_FILE_MANAGEMENT && \([\s\S]*?sidebar\.knowledge[\s\S]*?sidebar\.myFiles[\s\S]*?\)\}\s*<div\s+className=\{cn\("p-2", ENABLE_FILE_MANAGEMENT && "border-t"\)\}\s*>\s*<CustomSidebarAccount \/>\s*<\/div>\s*<\/SidebarFooter>/,
    );
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
