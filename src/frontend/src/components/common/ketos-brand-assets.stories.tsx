import type { Meta, StoryObj } from "@storybook/react";
import ketosHorizontalDark from "@/assets/ketos-horizontal-dark.svg";
import ketosHorizontalLight from "@/assets/ketos-horizontal-light.svg";
import { KetosAssistantMark, KetosBrandMark } from "./ketos-brand-mark";
import { KetosMcpComposition } from "./ketos-mcp-composition";

const meta = {
  title: "Brand/Ketos Visual System",
  parameters: {
    layout: "padded",
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const symbolSizes = [16, 32, 64, 128] as const;

export const SymbolScale: Story = {
  render: () => (
    <div className="flex flex-wrap items-end gap-8 text-foreground">
      {symbolSizes.map((size) => (
        <figure key={size} className="flex flex-col items-center gap-2">
          <KetosBrandMark
            label={`Ketos logo at ${size} pixels`}
            style={{ width: size, height: size }}
          />
          <figcaption className="text-xs text-muted-foreground">
            {size}px
          </figcaption>
        </figure>
      ))}
    </div>
  ),
};

export const AssistantStates: Story = {
  render: () => (
    <div className="grid max-w-md grid-cols-2 gap-4">
      <figure className="flex flex-col items-center gap-3 rounded-xl border bg-background p-6 text-muted-foreground">
        <KetosAssistantMark
          state="idle"
          label="Ketos Assistant idle"
          className="h-12 w-12"
        />
        <figcaption className="text-sm">Idle</figcaption>
      </figure>
      <figure className="flex flex-col items-center gap-3 rounded-xl border bg-background p-6">
        <KetosAssistantMark
          state="active"
          label="Ketos Assistant active"
          className="h-12 w-12"
        />
        <figcaption className="text-sm">Active</figcaption>
      </figure>
    </div>
  ),
};

export const ThemeAndContrast: Story = {
  render: () => (
    <div className="grid gap-4 md:grid-cols-3">
      <figure className="flex min-h-48 items-center justify-center rounded-xl border bg-background p-6 text-foreground">
        <img
          src={ketosHorizontalLight}
          alt="Ketos logo for a light surface"
          className="w-full max-w-72"
        />
      </figure>
      <div className="dark">
        <figure className="flex min-h-48 items-center justify-center rounded-xl border bg-background p-6 text-foreground">
          <img
            src={ketosHorizontalDark}
            alt="Ketos logo for a dark surface"
            className="w-full max-w-72"
          />
        </figure>
      </div>
      <figure className="flex min-h-48 items-center justify-center rounded-xl border-4 border-current bg-foreground p-6 text-background">
        <KetosBrandMark
          theme="dark"
          label="High contrast Ketos logo"
          className="h-24 w-24"
        />
      </figure>
    </div>
  ),
};

export const McpComposition: Story = {
  render: () => (
    <KetosMcpComposition label="Ketos MCP composition" className="max-w-3xl" />
  ),
};
