import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";

import type { AutomationSummary } from "@/types/flow/automation";
import {
  AutomationPreview,
  type AutomationPreviewProps,
} from "./AutomationPreview";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      key === "board.automation.descriptionEmpty" ? "No description" : key,
  }),
  initReactI18next: { type: "3rdParty", init: jest.fn() },
}));

const summary = (
  overrides: Partial<AutomationSummary> = {},
): AutomationSummary => ({
  id: "automation-1",
  name: "Customer onboarding",
  description: "Creates and assigns the onboarding tasks.",
  ...overrides,
});

type IsEqual<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends <
  Value,
>() => Value extends Right ? 1 : 2
  ? true
  : false;

describe("AutomationPreview", () => {
  it("renders only the automation name and description", () => {
    render(<AutomationPreview summary={summary()} />);
    expect(
      screen.getByRole("heading", { name: "Customer onboarding" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Creates and assigns the onboarding tasks."),
    ).toBeInTheDocument();
  });

  it.each([null, "", "   "])(
    "renders the translated fallback for description %p",
    (description) => {
      render(<AutomationPreview summary={summary({ description })} />);
      expect(screen.getByText("No description")).toBeInTheDocument();
    },
  );

  it("renders unsafe markup as text without creating an image", () => {
    const unsafeDescription = '<img src=x onerror="alert(1)">';
    const { container } = render(
      <AutomationPreview
        summary={summary({ description: unsafeDescription })}
      />,
    );
    expect(screen.getByText(unsafeDescription)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  it("visually bounds long descriptions", () => {
    render(
      <AutomationPreview
        summary={summary({ description: "Long description ".repeat(100) })}
      />,
    );
    expect(screen.getByTestId("automation-preview-description")).toHaveClass(
      "line-clamp-3",
      "overflow-hidden",
      "break-words",
    );
  });

  it("accepts exactly the summary prop", () => {
    type ActualProps = ComponentProps<typeof AutomationPreview>;
    const propsAreExact: IsEqual<ActualProps, AutomationPreviewProps> = true;
    const propKeys: Array<keyof ActualProps> = ["summary"];
    expect(propsAreExact).toBe(true);
    expect(propKeys).toEqual(["summary"]);
  });

  it("keeps presentation free from editor and raw-flow dependencies", () => {
    const source = readFileSync(
      path.join(__dirname, "AutomationPreview.tsx"),
      "utf8",
    );
    expect(source).not.toContain(".data");
    expect(source).not.toMatch(/reactflow|editor|flowStore|useFlowStore/i);
    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(source).not.toMatch(
      /\b(nodes|status|count|parameters|secrets|endpoint)\b/i,
    );
  });
});
