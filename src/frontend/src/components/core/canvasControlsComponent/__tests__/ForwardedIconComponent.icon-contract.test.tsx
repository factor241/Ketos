import { render, screen, waitFor } from "@testing-library/react";

jest.unmock("@/components/common/genericIconComponent");

import ForwardedIconComponent from "@/components/common/genericIconComponent";

describe("canvas create-chat icon contract", () => {
  it("resolves MessageSquarePlus from the existing icon library without fallback or console error", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ForwardedIconComponent
        name="MessageSquarePlus"
        dataTestId="message-square-plus-icon"
        skipFallback
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByTestId("message-square-plus-icon"),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("icon-placeholder")).not.toBeInTheDocument();
    expect(error).not.toHaveBeenCalled();
  });
});
