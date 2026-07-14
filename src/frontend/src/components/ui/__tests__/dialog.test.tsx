import { fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../dialog";

const mockTranslations = {
  en: { "dialog.fallbackTitle": "Dialog", "common.close": "Close" },
  ru: { "dialog.fallbackTitle": "Диалог", "common.close": "Закрыть" },
};
let mockLanguage: keyof typeof mockTranslations = "en";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: "dialog.fallbackTitle" | "common.close") =>
      mockTranslations[mockLanguage][key] ?? key,
  }),
  initReactI18next: { type: "3rdParty", init: jest.fn() },
}));

// Mock genericIconComponent (already globally mocked, but be explicit)
jest.mock("@/components/common/genericIconComponent", () => ({
  __esModule: true,
  default: () => null,
}));

const renderWithProviders = (ui: React.ReactElement) => {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
};

describe("DialogContent", () => {
  beforeEach(() => {
    mockLanguage = "en";
  });

  it("should_not_auto_focus_close_button_when_dialog_opens", () => {
    // Arrange — open dialog with default behavior (no custom onOpenAutoFocus)
    renderWithProviders(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Test Dialog</DialogTitle>
          <DialogDescription>Test description</DialogDescription>
          <p>Content</p>
        </DialogContent>
      </Dialog>,
    );

    // Act — dialog is already open, focus should have been handled

    // Assert — close button must NOT have focus
    const closeButton = screen.getByRole("button", { name: /close/i });
    expect(closeButton).not.toHaveFocus();

    // Assert — "Close" tooltip must NOT be visible on open
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("should_call_custom_onOpenAutoFocus_when_provided", () => {
    // Arrange — provide a custom onOpenAutoFocus handler
    const customHandler = jest.fn((e: Event) => {
      e.preventDefault();
    });

    renderWithProviders(
      <Dialog open>
        <DialogContent onOpenAutoFocus={customHandler}>
          <DialogTitle>Test Dialog</DialogTitle>
          <DialogDescription>Test description</DialogDescription>
          <p>Content</p>
        </DialogContent>
      </Dialog>,
    );

    // Assert — custom handler was called
    expect(customHandler).toHaveBeenCalledTimes(1);
  });

  it("should_hide_close_button_when_requested", () => {
    renderWithProviders(
      <Dialog open>
        <DialogContent hideCloseButton>
          <DialogTitle>Test Dialog</DialogTitle>
          <DialogDescription>Test description</DialogDescription>
          <p>Content</p>
        </DialogContent>
      </Dialog>,
    );

    expect(
      screen.queryByRole("button", { name: /close/i }),
    ).not.toBeInTheDocument();
  });

  it("localizes the fallback title and close button accessible name", () => {
    mockLanguage = "ru";
    renderWithProviders(
      <Dialog open>
        <DialogContent>
          <DialogDescription>Описание</DialogDescription>
          <p>Содержимое</p>
        </DialogContent>
      </Dialog>,
    );

    expect(screen.getByRole("dialog", { name: "Диалог" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Закрыть" })).toBeInTheDocument();
  });

  it("closes from the keyboard without moving focus to the close button", () => {
    const onOpenChange = jest.fn();
    renderWithProviders(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogTitle>Test Dialog</DialogTitle>
          <DialogDescription>Test description</DialogDescription>
          <button type="button">Primary action</button>
        </DialogContent>
      </Dialog>,
    );

    const closeButton = screen.getByRole("button", { name: /close/i });
    expect(closeButton).not.toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
