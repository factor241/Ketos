import { render, screen } from "@testing-library/react";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => `translated:${key}` }),
}));

jest.mock("@/components/common/genericIconComponent", () => ({
  __esModule: true,
  default: ({ name }: { name: string }) => <span data-icon={name} />,
}));

jest.mock("./components/LanguageForm", () => ({
  __esModule: true,
  default: () => <div data-testid="language-form" />,
}));

import LanguagePage from "./index";

describe("LanguagePage", () => {
  it("exposes a dedicated translated heading, description, and language form", () => {
    render(<LanguagePage />);

    expect(screen.getByTestId("settings-language-page")).toHaveClass("min-w-0");
    expect(
      screen.getByRole("heading", {
        name: "translated:settings.languageTitle",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("translated:settings.languageDescription"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("language-form")).toBeInTheDocument();
    expect(document.querySelector('[data-icon="Languages"]')).not.toBeNull();
  });
});
