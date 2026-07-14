jest.unmock("react-i18next");

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createTestI18n } from "@/test-utils/create-test-i18n";
import ChatMessageBubble from "../chat-message-bubble";

jest.mock("react-markdown", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock("remark-gfm", () => ({ __esModule: true, default: jest.fn() }));

jest.mock("@/components/common/genericIconComponent", () => ({
  __esModule: true,
  default: ({ name }: { name: string }) => <span>{name}</span>,
}));

jest.mock("@/components/core/codeTabsComponent", () => ({
  __esModule: true,
  default: ({ code }: { code: string }) => <pre>{code}</pre>,
}));

describe("deployment chat tool traces in Russian", () => {
  it("renders localized input and output labels without changing trace values", async () => {
    const russian = await createTestI18n("ru");
    const user = userEvent.setup();

    render(
      <I18nextProvider i18n={russian}>
        <ChatMessageBubble
          message={{
            id: "message-1",
            role: "assistant",
            content: "Готово",
            toolTraces: [
              {
                toolName: "stable_tool_id",
                input: { query: "raw-input" },
                output: "raw-output",
              },
            ],
          }}
        />
      </I18nextProvider>,
    );

    await user.click(screen.getByText("stable_tool_id"));

    expect(screen.getByText("Вход")).toBeInTheDocument();
    expect(screen.getByText("Выход")).toBeInTheDocument();
    expect(screen.queryByText("Input")).not.toBeInTheDocument();
    expect(screen.queryByText("Output")).not.toBeInTheDocument();
    expect(screen.getByText(/raw-input/)).toBeInTheDocument();
    expect(screen.getByText("raw-output")).toBeInTheDocument();
  });
});
