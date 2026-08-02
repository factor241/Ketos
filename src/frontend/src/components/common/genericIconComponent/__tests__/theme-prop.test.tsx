import { render, waitFor } from "@testing-library/react";

jest.unmock("@/components/common/genericIconComponent");

jest.mock("../../../../stores/darkStore", () => ({
  useDarkStore: () => ({ dark: true }),
}));

jest.mock("../../../../utils/styleUtils", () => {
  const React = require("react");
  const DomSpreadingIcon = React.forwardRef(
    (props: Record<string, unknown>, ref: React.Ref<SVGSVGElement>) =>
      React.createElement("svg", { ...props, ref }),
  );

  return {
    getCachedIcon: () => DomSpreadingIcon,
    getNodeIcon: async () => DomSpreadingIcon,
    nodeIconToDisplayIconMap: {},
  };
});

import ForwardedIconComponent from "../index";

describe("ForwardedIconComponent theme props", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("does not forward isDark to icons that spread props onto the DOM", async () => {
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    render(<ForwardedIconComponent name="TestIcon" />);

    await waitFor(() => {
      expect(
        document.querySelector('[data-testid="icon-TestIcon"]'),
      ).toBeTruthy();
    });

    const isDarkWarnings = consoleError.mock.calls.filter((args) =>
      args.some((value) => String(value).includes("isDark")),
    );
    expect(isDarkWarnings).toHaveLength(0);
  });
});
