import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import NoticeAlert from "../index";

jest.mock("@headlessui/react", () => ({
  Transition: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({ "common.dismiss": "Dismiss", "common.details": "Details" })[key] ??
      key,
  }),
  initReactI18next: { type: "3rdParty", init: jest.fn() },
}));

jest.mock("@/components/common/genericIconComponent", () => ({
  __esModule: true,
  default: ({ name }: { name: string }) => <span aria-hidden>{name}</span>,
}));

describe("NoticeAlert accessibility", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("dismisses from a focused semantic button", async () => {
    const user = userEvent.setup();
    const removeAlert = jest.fn();
    render(
      <NoticeAlert
        id="notice-1"
        title="Localized notice"
        removeAlert={removeAlert}
      />,
    );

    const dismiss = screen.getByRole("button", { name: "Dismiss" });
    dismiss.focus();
    expect(dismiss).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(removeAlert).not.toHaveBeenCalled();

    await new Promise((resolve) => window.setTimeout(resolve, 550));
    expect(removeAlert).toHaveBeenCalledWith("notice-1");
  });

  it("cancels auto-dismiss after a manual keyboard dismissal", async () => {
    jest.useFakeTimers();
    const user = userEvent.setup({
      advanceTimers: (milliseconds) => jest.advanceTimersByTime(milliseconds),
    });
    const removeAlert = jest.fn();
    render(
      <NoticeAlert
        id="notice-2"
        title="Localized notice"
        removeAlert={removeAlert}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    act(() => jest.advanceTimersByTime(500));
    expect(removeAlert).toHaveBeenCalledTimes(1);

    act(() => jest.advanceTimersByTime(5000));
    expect(removeAlert).toHaveBeenCalledTimes(1);
  });
});
