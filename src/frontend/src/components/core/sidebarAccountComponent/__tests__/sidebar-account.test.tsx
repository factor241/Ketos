import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DATASTAX_DOCS_URL, DOCS_URL } from "@/constants/constants";
import useAuthStore from "@/stores/authStore";
import { useUtilityStore } from "@/stores/utilityStore";
import { SidebarAccountCard } from "../index";

const mockNavigate = jest.fn();
const mockLogout = jest.fn();
const mockSetDark = jest.fn();

let mockEnableDatastaxKetos = false;

const mockDarkState = {
  dark: false,
  version: "1.10.2",
  latestVersion: "1.10.2",
  setDark: mockSetDark,
  refreshVersion: jest.fn(),
  refreshLatestVersion: jest.fn(),
};

jest.mock("@/controllers/API/queries/auth", () => ({
  useLogout: () => ({ mutate: mockLogout }),
}));

jest.mock("@/customization/hooks/use-custom-navigate", () => ({
  useCustomNavigate: () => mockNavigate,
}));

jest.mock("@/customization/feature-flags", () => ({
  get ENABLE_DATASTAX_KETOS() {
    return mockEnableDatastaxKetos;
  },
}));

jest.mock("@/stores/darkStore", () => ({
  useDarkStore: (selector: (state: typeof mockDarkState) => unknown) =>
    selector(mockDarkState),
}));

const userData = {
  id: "user-1",
  username: "Kirill Ustyuzhanin",
  is_active: true,
  is_superuser: false,
  profile_image: "",
  create_at: new Date("2026-01-01T00:00:00.000Z"),
  updated_at: new Date("2026-01-01T00:00:00.000Z"),
};

async function openAccountMenu(user = userEvent.setup()) {
  await user.click(screen.getByTestId("user_menu_button"));

  return screen.findByRole("menu");
}

describe("SidebarAccountCard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEnableDatastaxKetos = false;
    mockDarkState.dark = false;
    mockDarkState.version = "1.10.2";
    mockDarkState.latestVersion = "1.10.2";

    act(() => {
      useAuthStore.setState({
        isAdmin: false,
        autoLogin: false,
        userData,
      });
      useUtilityStore.setState({ hideLogoutButton: false });
    });
  });

  it("should render the account card with its stable test IDs and user details", () => {
    render(<SidebarAccountCard />);

    expect(screen.getByTestId("user_menu_button")).toBeInTheDocument();
    expect(screen.getByTestId("user-profile-settings")).toBeInTheDocument();
    expect(screen.getByText("Kirill Ustyuzhanin")).toBeInTheDocument();
    expect(screen.getByText("Ketos workspace")).toBeInTheDocument();
  });

  it("should render the account header and complete account menu when opened", async () => {
    render(<SidebarAccountCard />);

    const menu = await openAccountMenu();

    expect(within(menu).getAllByText("Kirill Ustyuzhanin")).toHaveLength(2);
    expect(within(menu).getByText("Settings")).toBeInTheDocument();
    expect(within(menu).getByText("Documentation")).toBeInTheDocument();
    expect(within(menu).getByText("Version")).toBeInTheDocument();
    expect(within(menu).getByText("Theme")).toBeInTheDocument();
    expect(within(menu).getByText("Sign out")).toBeInTheDocument();
  });

  it("should display an email username as-is in the account header", async () => {
    act(() => {
      useAuthStore.setState({
        userData: { ...userData, username: "person@example.com" },
      });
    });
    render(<SidebarAccountCard />);

    const menu = await openAccountMenu();

    expect(within(menu).getAllByText("person@example.com")).toHaveLength(2);
    expect(
      within(menu).queryByText("@person@example.com"),
    ).not.toBeInTheDocument();
  });

  it("should open the dropdown above the account card", async () => {
    render(<SidebarAccountCard />);

    const menu = await openAccountMenu();

    expect(menu).toHaveAttribute("data-side", "top");
    expect(screen.getByTestId("user_menu_button")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("should show Admin Page when the user is an admin without auto login", async () => {
    act(() => {
      useAuthStore.setState({ isAdmin: true, autoLogin: false });
    });
    render(<SidebarAccountCard />);

    const menu = await openAccountMenu();

    expect(within(menu).getByText("Admin Page")).toBeInTheDocument();
  });

  it.each([
    { isAdmin: false, autoLogin: false, condition: "the user is not an admin" },
    { isAdmin: true, autoLogin: true, condition: "auto login is enabled" },
  ])(
    "should hide Admin Page when $condition",
    async ({ isAdmin, autoLogin }) => {
      act(() => {
        useAuthStore.setState({ isAdmin, autoLogin });
      });
      render(<SidebarAccountCard />);

      const menu = await openAccountMenu();

      expect(within(menu).queryByText("Admin Page")).not.toBeInTheDocument();
    },
  );

  it.each([
    {
      autoLogin: true,
      hideLogoutButton: false,
      condition: "auto login is enabled",
    },
    {
      autoLogin: false,
      hideLogoutButton: true,
      condition: "logout is disabled by configuration",
    },
  ])(
    "should hide Sign out when $condition",
    async ({ autoLogin, hideLogoutButton }) => {
      act(() => {
        useAuthStore.setState({ autoLogin });
        useUtilityStore.setState({ hideLogoutButton });
      });
      render(<SidebarAccountCard />);

      const menu = await openAccountMenu();

      expect(within(menu).queryByText("Sign out")).not.toBeInTheDocument();
    },
  );

  it.each([
    {
      datastaxEnabled: false,
      expectedHref: DOCS_URL,
      condition: "the DataStax flag is disabled",
    },
    {
      datastaxEnabled: true,
      expectedHref: DATASTAX_DOCS_URL,
      condition: "the DataStax flag is enabled",
    },
  ])(
    "should use the configured documentation URL when $condition",
    async ({ datastaxEnabled, expectedHref }) => {
      mockEnableDatastaxKetos = datastaxEnabled;
      render(<SidebarAccountCard />);

      await openAccountMenu();
      const docsControl = screen.getByTestId("menu_docs_button");
      const docsLink = docsControl.matches("a")
        ? docsControl
        : (docsControl.closest("a") ?? docsControl.querySelector("a"));

      expect(docsLink).toHaveAttribute("href", expectedHref);
    },
  );

  it("should show the latest status when current and latest base versions match", async () => {
    mockDarkState.version = "1.10.2";
    mockDarkState.latestVersion = "1.10.2";
    render(<SidebarAccountCard />);

    const menu = await openAccountMenu();

    expect(within(menu).getByTestId("menu_version_button")).toBeInTheDocument();
    expect(within(menu).getByText(/1\.10\.2/)).toBeInTheDocument();
    expect(within(menu).getByText(/\(latest\)/i)).toBeInTheDocument();
  });

  it("should show the update status when a newer version is available", async () => {
    mockDarkState.version = "1.10.1";
    mockDarkState.latestVersion = "1.10.2";
    render(<SidebarAccountCard />);

    const menu = await openAccountMenu();

    expect(within(menu).getByText(/1\.10\.1/)).toBeInTheDocument();
    expect(within(menu).getByText(/\(update available\)/i)).toBeInTheDocument();
  });

  it("should navigate to settings when Settings is selected", async () => {
    const user = userEvent.setup();
    render(<SidebarAccountCard />);
    await openAccountMenu(user);

    await user.click(screen.getByTestId("menu_settings_button"));

    expect(mockNavigate).toHaveBeenCalledWith("/settings");
  });

  it("should run the logout mutation when Sign out is selected", async () => {
    const user = userEvent.setup();
    render(<SidebarAccountCard />);
    const menu = await openAccountMenu(user);

    await user.click(within(menu).getByText("Sign out"));

    expect(mockLogout).toHaveBeenCalledTimes(1);
  });

  it("should expose labeled Light, Dark, and System theme controls", async () => {
    render(<SidebarAccountCard />);

    const menu = await openAccountMenu();

    expect(within(menu).getByText("Light")).toBeInTheDocument();
    expect(within(menu).getByText("Dark")).toBeInTheDocument();
    expect(within(menu).getByText("System")).toBeInTheDocument();
    expect(
      within(menu).getByRole("menuitemradio", { name: "Use light theme" }),
    ).toBeInTheDocument();
    expect(
      within(menu).getByRole("menuitemradio", { name: "Use dark theme" }),
    ).toBeInTheDocument();
    expect(
      within(menu).getByRole("menuitemradio", { name: "Use system theme" }),
    ).toBeInTheDocument();
  });

  it("should close the account menu when Escape is pressed", async () => {
    const user = userEvent.setup();
    render(<SidebarAccountCard />);
    await openAccountMenu(user);

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByTestId("user_menu_button")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
});
