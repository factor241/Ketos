import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SUPPORTED_LANGUAGES } from "@/constants/languages";

const mockChangeLanguage = jest.fn<Promise<void>, [string]>();

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

jest.mock("@/hooks/use-language-preference", () => ({
  useLanguagePreference: () => ({
    language: "en",
    changeLanguage: mockChangeLanguage,
  }),
}));

jest.mock("@/components/ui/select", () => ({
  Select: ({
    children,
    value,
    onValueChange,
  }: {
    children: React.ReactElement[];
    value?: string;
    onValueChange?: (value: string) => void;
  }) => {
    const items = Array.isArray(children) ? children : [children];
    const trigger = items[0];
    const content = items[1];
    return (
      <select
        value={value}
        aria-label={trigger.props["aria-label"]}
        data-testid={trigger.props["data-testid"]}
        onChange={(event) => onValueChange?.(event.target.value)}
      >
        {content.props.children}
      </select>
    );
  },
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: () => null,
  SelectItem: ({
    children,
    value,
  }: React.PropsWithChildren<{ value: string }>) => (
    <option value={value}>{children}</option>
  ),
}));

jest.mock("@/components/ui/card", () => ({
  Card: ({ children }: React.PropsWithChildren) => (
    <section>{children}</section>
  ),
  CardContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));

import LanguageFormComponent from "./index";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("LanguageFormComponent", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockChangeLanguage.mockResolvedValue(undefined);
  });

  it("renders native self-names for every visible language, including Russian", () => {
    render(<LanguageFormComponent />);

    const visibleLanguages = SUPPORTED_LANGUAGES.filter(
      (language) => language.shipped && !language.hidden,
    );
    const options = screen.getByRole("combobox").querySelectorAll("option");
    expect(options).toHaveLength(visibleLanguages.length);

    for (const language of visibleLanguages) {
      expect(
        screen.getByRole("option", { name: new RegExp(language.label) }),
      ).toBeInTheDocument();
    }
    expect(screen.getByRole("option", { name: /Русский/ })).toHaveValue("ru");
  });

  it("marks only English as recommended", () => {
    render(<LanguageFormComponent />);

    expect(screen.getByRole("option", { name: /English/ })).toHaveTextContent(
      "settings.languageRecommended",
    );
    for (const language of SUPPORTED_LANGUAGES.filter(
      ({ code, hidden, shipped }) => code !== "en" && shipped && !hidden,
    )) {
      expect(
        screen.getByRole("option", { name: new RegExp(language.label) }),
      ).not.toHaveTextContent("settings.languageRecommended");
    }
  });

  it("exposes a stable selector test id and translated accessible name", () => {
    render(<LanguageFormComponent />);

    expect(screen.getByTestId("language-preference-select")).toHaveAttribute(
      "aria-label",
      "settings.languageSelectAriaLabel",
    );
  });

  it("applies a selection without reloading and announces the saved state", async () => {
    const user = userEvent.setup();
    const transition = deferred<void>();
    mockChangeLanguage.mockReturnValueOnce(transition.promise);
    const locationBeforeSelection = window.location.href;
    render(<LanguageFormComponent />);

    await user.selectOptions(screen.getByRole("combobox"), "ru");

    expect(mockChangeLanguage).toHaveBeenCalledWith("ru");
    expect(screen.getByRole("status")).toHaveTextContent("loading.loading");
    expect(window.location.href).toBe(locationBeforeSelection);

    await act(async () => transition.resolve());
    expect(screen.getByRole("status")).toHaveTextContent(
      "success.changesSaved",
    );
  });

  it("announces a translated error when changing language fails", async () => {
    const user = userEvent.setup();
    mockChangeLanguage.mockRejectedValueOnce(new Error("load failed"));
    render(<LanguageFormComponent />);

    await user.selectOptions(screen.getByRole("combobox"), "ru");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "errors.saveChanges",
    );
  });
});
