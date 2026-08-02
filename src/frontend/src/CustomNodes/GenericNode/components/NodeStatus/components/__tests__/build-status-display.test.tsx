import { render, screen } from "@testing-library/react";
import { BuildStatus } from "@/constants/enums";
import BuildStatusDisplay from "../build-status-display";

const mockFormatDateTime = jest.fn((_value: string) => "11.07.2026, 14:30");

jest.mock("@/utils/locale-format", () => ({
  formatDateTime: (value: string) => mockFormatDateTime(value),
}));

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock("@/components/common/genericIconComponent", () => () => null);

describe("BuildStatusDisplay timestamp localization", () => {
  it("formats the stored ISO timestamp only at render time", () => {
    const timestamp = "2026-07-11T07:30:00.000Z";

    render(
      <BuildStatusDisplay
        buildStatus={BuildStatus.BUILT}
        validationStatus={{ data: { duration: "1.0s" } }}
        validationString=""
        lastRunTime={timestamp}
      />,
    );

    expect(mockFormatDateTime).toHaveBeenCalledWith(timestamp);
    expect(screen.getByText("11.07.2026, 14:30")).toBeInTheDocument();
    expect(screen.queryByText(timestamp)).not.toBeInTheDocument();
  });
});
