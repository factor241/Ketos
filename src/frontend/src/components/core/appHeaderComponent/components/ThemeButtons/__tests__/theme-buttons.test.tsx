import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import useTheme from "@/customization/hooks/use-custom-theme";
import { ThemeButtons } from "../index";

jest.mock("@/customization/hooks/use-custom-theme");
jest.mock("@/components/common/genericIconComponent", () => ({
  __esModule: true,
  default: ({ name }: { name: string }) => <span data-icon-name={name} />,
}));

const mockUseTheme = jest.mocked(useTheme);
const setThemePreference = jest.fn();

describe("ThemeButtons", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseTheme.mockReturnValue({
      systemTheme: false,
      dark: false,
      setThemePreference,
    });
  });

  it("shows translated theme labels in the labeled variant", () => {
    render(<ThemeButtons variant="labeled" />);

    expect(screen.getByText("Light")).toBeVisible();
    expect(screen.getByText("Dark")).toBeVisible();
    expect(screen.getByText("System")).toBeVisible();
  });

  it("omits theme icons from the labeled variant", () => {
    const { container } = render(<ThemeButtons variant="labeled" />);

    expect(container.querySelector("[data-icon-name]")).not.toBeInTheDocument();
  });

  it("keeps the default variant icon-only", () => {
    const { container } = render(<ThemeButtons />);

    expect(screen.queryByText("Use light theme")).not.toBeInTheDocument();
    expect(screen.queryByText("Use dark theme")).not.toBeInTheDocument();
    expect(screen.queryByText("Use system theme")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Use light theme" }),
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-icon-name="Sun"]'),
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-icon-name="Moon"]'),
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-icon-name="Monitor"]'),
    ).toBeInTheDocument();
  });

  it("marks the current labeled theme as selected", () => {
    mockUseTheme.mockReturnValue({
      systemTheme: true,
      dark: true,
      setThemePreference,
    });

    render(<ThemeButtons variant="labeled" />);

    expect(
      screen.getByRole("button", { name: "Use light theme" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getByRole("button", { name: "Use dark theme" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getByRole("button", { name: "Use system theme" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("updates the labeled selection and theme preference when clicked", async () => {
    const user = userEvent.setup();
    render(<ThemeButtons variant="labeled" />);

    const darkButton = screen.getByRole("button", {
      name: "Use dark theme",
    });
    await user.click(darkButton);

    expect(setThemePreference).toHaveBeenCalledWith("dark");
    expect(darkButton).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "Use light theme" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("uses one coordinated sliding background in the menu variant", async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <ThemeButtons variant="menu" />
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    const darkButton = screen.getByRole("menuitemradio", {
      name: "Use dark theme",
    });
    await user.click(darkButton);

    expect(screen.getByTestId("theme-selection-indicator")).toHaveClass(
      "transition-transform",
      "[transition-duration:180ms]",
      "ease-out",
    );
    expect(darkButton.className).not.toMatch(
      /\bbg-(?:indigo-foreground|foreground)\b/,
    );
  });
});
