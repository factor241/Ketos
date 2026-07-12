import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, within } from "@testing-library/react";

const brandMarkPath = resolve(__dirname, "../ketos-brand-mark.tsx");
const mcpCompositionPath = resolve(__dirname, "../ketos-mcp-composition.tsx");

jest.mock("@/icons/MCP", () => ({
  McpIcon: (props: React.SVGProps<SVGSVGElement>) => <svg {...props} />,
}));

describe("Ketos visual primitives", () => {
  it("renders repeated accessible marks without embedded SVG id collisions", () => {
    expect(existsSync(brandMarkPath)).toBe(true);
    if (!existsSync(brandMarkPath)) return;

    const { KetosBrandMark } = require("../ketos-brand-mark");
    const { container } = render(
      <>
        <KetosBrandMark label="Ketos logo" className="h-4 w-4 sm:h-8 sm:w-8" />
        <KetosBrandMark label="Ketos logo" />
        <KetosBrandMark data-testid="decorative-mark" decorative />
      </>,
    );

    expect(screen.getAllByRole("img", { name: "Ketos logo" })).toHaveLength(2);
    expect(screen.getByTestId("decorative-mark")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(container.querySelectorAll("svg")).toHaveLength(0);
    expect(
      container.querySelectorAll("[id='title'], [id='desc']"),
    ).toHaveLength(0);
    expect(screen.getAllByRole("img", { name: "Ketos logo" })[0]).toHaveClass(
      "h-4",
      "w-4",
      "sm:h-8",
      "sm:w-8",
    );
  });

  it("renders light and dark theme variants for active and idle assistant states", () => {
    expect(existsSync(brandMarkPath)).toBe(true);
    if (!existsSync(brandMarkPath)) return;

    const {
      KetosAssistantMark,
      KetosBrandMark,
    } = require("../ketos-brand-mark");
    render(
      <>
        <KetosAssistantMark label="Idle assistant" state="idle" />
        <KetosAssistantMark label="Active assistant" state="active" />
        <KetosBrandMark label="High contrast logo" theme="dark" />
      </>,
    );

    for (const state of ["idle", "active"]) {
      const mark = screen.getByTestId(`ketos-assistant-${state}`);
      expect(mark).toHaveAttribute("data-state", state);
      expect(within(mark).getByTestId("ketos-mark-light")).toHaveClass(
        "dark:hidden",
      );
      expect(within(mark).getByTestId("ketos-mark-dark")).toHaveClass(
        "hidden",
        "dark:block",
      );
    }
    expect(screen.getByTestId("ketos-assistant-idle")).toHaveClass(
      "opacity-60",
    );
    expect(screen.getByTestId("ketos-assistant-active")).toHaveClass(
      "opacity-100",
    );
    expect(
      within(
        screen.getByRole("img", { name: "High contrast logo" }),
      ).queryByTestId("ketos-mark-light"),
    ).not.toBeInTheDocument();
  });

  it("builds the MCP composition from Ketos artwork and the protocol mark", () => {
    expect(existsSync(mcpCompositionPath)).toBe(true);
    if (!existsSync(mcpCompositionPath)) return;

    const { KetosMcpComposition } = require("../ketos-mcp-composition");
    render(<KetosMcpComposition label="Ketos MCP composition" />);

    const composition = screen.getByRole("img", {
      name: "Ketos MCP composition",
    });
    expect(within(composition).getByTestId("ketos-mcp-brand")).toBeVisible();
    expect(within(composition).getByTestId("mcp-protocol-mark")).toBeVisible();
    expect(within(composition).getByText("MCP")).toBeVisible();
    expect(composition).toHaveClass("aspect-[16/9]", "w-full");
  });
});
