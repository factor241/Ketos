import { render, screen } from "@testing-library/react";
import type { TFunction } from "i18next";
import { createTestI18n } from "@/test-utils/create-test-i18n";
import { timeElapsed } from "../time-elapse";

function TimeElapsedView({ value, t }: { value: string; t: TFunction }) {
  return <span>{timeElapsed(value, t)}</span>;
}

describe("timeElapsed Russian presentation", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-12T12:00:00.000Z"));
  });

  afterEach(async () => {
    jest.useRealTimers();
  });

  it("renders relative time through the required Russian translator", async () => {
    const russian = await createTestI18n("ru");

    render(
      <TimeElapsedView
        value="2026-07-12T11:55:00.000Z"
        t={russian.t.bind(russian)}
      />,
    );

    expect(screen.getByText("5 минут")).toBeInTheDocument();
    expect(screen.queryByText("5 minutes")).not.toBeInTheDocument();
  });
});
