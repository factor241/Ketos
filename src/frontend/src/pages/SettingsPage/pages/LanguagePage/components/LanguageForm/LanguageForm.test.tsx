import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockChangeLanguage = jest.fn<Promise<void>, [string]>();

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

jest.mock("@/hooks/use-language-preference", () => ({
  useLanguagePreference: () => ({
    language: "ru",
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
    const trigger = items[0] as React.ReactElement<{
      "aria-label"?: string;
      className?: string;
      children?: React.ReactNode;
      "data-testid"?: string;
    }>;
    const valueWrapper = trigger.props.children as
      | React.ReactElement<{ className?: string }>
      | undefined;
    const content = items[1] as React.ReactElement<{
      children?: React.ReactNode;
    }>;
    return (
      <select
        value={value}
        aria-label={trigger.props["aria-label"]}
        className={trigger.props.className}
        data-value-wrapper-class={valueWrapper?.props.className}
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
  Card: ({
    children,
    className,
  }: React.PropsWithChildren<{ className?: string }>) => (
    <section className={className}>{children}</section>
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

  it("renders exactly English and Russian interface options", () => {
    render(<LanguageFormComponent />);

    const options = screen.getByRole("combobox").querySelectorAll("option");
    expect(options).toHaveLength(2);

    expect(screen.getByRole("option", { name: /English/ })).toHaveValue("en");
    expect(screen.getByRole("option", { name: /Русский/ })).toHaveValue("ru");
  });

  it("marks only Russian as recommended", () => {
    render(<LanguageFormComponent />);

    expect(screen.getByRole("option", { name: /Русский/ })).toHaveTextContent(
      "settings.languageRecommended",
    );
    expect(
      screen.getByRole("option", { name: /English/ }),
    ).not.toHaveTextContent("settings.languageRecommended");
  });

  it("exposes a stable selector test id and translated accessible name", () => {
    render(<LanguageFormComponent />);

    expect(screen.getByTestId("language-preference-select")).toHaveAttribute(
      "aria-label",
      "settings.languageSelectAriaLabel",
    );
  });

  it("allows the card and selector to shrink and wrap at narrow responsive widths", () => {
    render(<LanguageFormComponent />);

    const selector = screen.getByTestId("language-preference-select");
    expect(selector.closest("section")).toHaveClass("min-w-0");
    expect(selector).toHaveClass(
      "h-auto",
      "min-w-0",
      "w-full",
      "whitespace-normal",
    );
    expect(selector).toHaveAttribute(
      "data-value-wrapper-class",
      expect.stringContaining("min-w-0"),
    );
    expect(selector).toHaveAttribute(
      "data-value-wrapper-class",
      expect.stringContaining("break-words"),
    );
  });

  it("applies a selection without reloading and announces the saved state", async () => {
    const user = userEvent.setup();
    const transition = deferred<void>();
    mockChangeLanguage.mockReturnValueOnce(transition.promise);
    const locationBeforeSelection = window.location.href;
    render(<LanguageFormComponent />);

    await user.selectOptions(screen.getByRole("combobox"), "en");

    expect(mockChangeLanguage).toHaveBeenCalledWith("en");
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

    await user.selectOptions(screen.getByRole("combobox"), "en");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "errors.saveChanges",
    );
  });
});
