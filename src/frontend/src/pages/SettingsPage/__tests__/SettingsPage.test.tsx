import { render, screen } from "@testing-library/react";

let mockAutoLogin = true;
let mockHasStore = false;

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => `translated:${key}` }),
}));

jest.mock("react-router-dom", () => ({
  Outlet: () => <div data-testid="settings-outlet" />,
  useLocation: () => ({ pathname: "/settings/language" }),
}));

jest.mock("@/customization/components/custom-link", () => ({
  CustomLink: ({ children, to }: React.PropsWithChildren<{ to: string }>) => (
    <a href={to}>{children}</a>
  ),
}));

jest.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));

jest.mock("@/components/ui/sidebar", () => {
  const Wrapper = ({ children }: React.PropsWithChildren) => (
    <div>{children}</div>
  );
  return {
    SidebarProvider: Wrapper,
    Sidebar: Wrapper,
    SidebarContent: ({
      children,
      className,
    }: React.PropsWithChildren<{ className?: string }>) => (
      <div className={className} data-testid="mock-sidebar-content">
        {children}
      </div>
    ),
    SidebarGroup: Wrapper,
    SidebarGroupContent: Wrapper,
    SidebarMenu: Wrapper,
    SidebarMenuItem: Wrapper,
    SidebarMenuButton: ({
      children,
      isActive: _isActive,
      tooltip: _tooltip,
      ...props
    }: React.PropsWithChildren<
      React.ButtonHTMLAttributes<HTMLButtonElement> & {
        isActive?: boolean;
        tooltip?: string;
      }
    >) => <button {...props}>{children}</button>,
  };
});

jest.mock("@/components/common/pageLayout", () => ({
  __esModule: true,
  default: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));

jest.mock("@/components/common/genericIconComponent", () => ({
  __esModule: true,
  default: ({ name }: { name: string }) => <span data-icon={name} />,
}));

jest.mock("@/customization/components/custom-store-sidebar", () => ({
  CustomStoreSidebar: () => [],
}));

jest.mock("@/customization/feature-flags", () => ({
  ENABLE_DATASTAX_LANGFLOW: true,
  ENABLE_LANGFLOW_STORE: false,
  ENABLE_PROFILE_ICONS: false,
}));

jest.mock("@/stores/authStore", () => ({
  __esModule: true,
  default: (selector: (state: { autoLogin: boolean }) => unknown) =>
    selector({ autoLogin: mockAutoLogin }),
}));

jest.mock("@/stores/storeStore", () => ({
  useStoreStore: (selector: (state: { hasStore: boolean }) => unknown) =>
    selector({ hasStore: mockHasStore }),
}));

import SideBarButtonsComponent from "@/components/core/sidebarComponent";
import SettingsPage from "../index";

describe("SettingsPage language navigation", () => {
  beforeEach(() => {
    mockAutoLogin = true;
    mockHasStore = false;
  });

  it("shows Language independently when General is hidden by feature state", () => {
    render(<SettingsPage />);

    expect(
      screen.queryByText("translated:settings.nav.general"),
    ).not.toBeInTheDocument();
    const languageItem = screen.getByTestId("sidebar-nav-language");
    expect(languageItem.closest("a")).toHaveAttribute(
      "href",
      "/settings/language",
    );
    expect(languageItem).toHaveTextContent("translated:settings.languageTitle");
    expect(
      languageItem.querySelector('[data-icon="Languages"]'),
    ).toBeInTheDocument();
  });

  it("keeps Language when General is visible", () => {
    mockAutoLogin = false;
    mockHasStore = true;

    render(<SettingsPage />);

    expect(
      screen.getByText("translated:settings.nav.general"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-nav-language")).toBeInTheDocument();
  });

  it("wraps localized Settings labels instead of clipping them", () => {
    render(<SettingsPage />);

    const globalVariablesLabel = screen.getByText(
      "translated:settings.nav.globalVariables",
    );
    expect(globalVariablesLabel).toHaveClass(
      "!overflow-visible",
      "!text-clip",
      "!whitespace-normal",
      "break-words",
      "group-data-[collapsible=icon]:hidden",
    );
    expect(globalVariablesLabel).not.toHaveClass("truncate");
    expect(globalVariablesLabel.closest("button")).toHaveClass(
      "h-auto",
      "min-h-9",
      "group-data-[collapsible=icon]:!min-h-8",
      "group-data-[collapsible=icon]:items-center",
    );
    expect(screen.getByTestId("mock-sidebar-content")).toHaveClass(
      "group-data-[collapsible=icon]:pr-0",
    );
  });

  it("keeps truncation as the default for other shared sidebar consumers", () => {
    render(
      <SideBarButtonsComponent
        items={[
          {
            href: "/settings/example",
            title: "A deliberately long non-settings sidebar label",
            icon: <span />,
          },
        ]}
      />,
    );

    const defaultLabel = screen.getByText(
      "A deliberately long non-settings sidebar label",
    );
    expect(defaultLabel).toHaveClass("truncate");
    expect(defaultLabel).not.toHaveClass(
      "!overflow-visible",
      "!text-clip",
      "!whitespace-normal",
      "break-words",
    );
    expect(defaultLabel.closest("button")).not.toHaveClass("h-auto", "min-h-9");
  });
});
