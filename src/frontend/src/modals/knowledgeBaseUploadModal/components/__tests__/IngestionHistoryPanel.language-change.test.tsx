jest.unmock("react-i18next");

import { act, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createTestI18n } from "@/test-utils/create-test-i18n";

jest.mock("@/components/common/genericIconComponent", () => ({
  __esModule: true,
  default: ({ name }: { name: string }) => <span aria-hidden>{name}</span>,
}));

const mockUseGetIngestionRuns = jest.fn();
jest.mock(
  "@/controllers/API/queries/knowledge-bases/use-get-ingestion-runs",
  () => ({
    useGetIngestionRuns: (...args: unknown[]) =>
      mockUseGetIngestionRuns(...args),
  }),
);

import { IngestionHistoryPanel } from "../IngestionHistoryPanel";

describe("IngestionHistoryPanel runtime locale updates", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2025-07-11T12:00:00Z"));
    mockUseGetIngestionRuns.mockReturnValue({
      data: {
        runs: [
          {
            id: "run-1",
            source_type: "file_upload",
            source_name: "User dataset A",
            status: "succeeded",
            succeeded: 1,
            failed: 0,
            skipped: 0,
            chunks_created: 2,
            started_at: "2025-07-09T12:00:00Z",
          },
        ],
        total: 1,
      },
      isLoading: false,
      isError: false,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("rerenders an already-open panel after languageChanged", async () => {
    const testI18n = await createTestI18n("en");
    render(
      <I18nextProvider i18n={testI18n}>
        <IngestionHistoryPanel kbName="kb" />
      </I18nextProvider>,
    );

    expect(screen.getByText("2 days ago")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Previously ingested/u }),
    ).toBeInTheDocument();
    expect(screen.getByText("User dataset A")).toBeInTheDocument();

    await act(async () => {
      await testI18n.changeLanguage("ru");
    });

    expect(screen.getByText("2 дня назад")).toBeInTheDocument();
    expect(screen.queryByText("2 days ago")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Добавлено ранее/u }),
    ).toBeInTheDocument();
    expect(screen.getByText("User dataset A")).toBeInTheDocument();
  });
});
