import type { HTMLAttributes } from "react";
import ketosHorizontalDark from "@/assets/ketos-horizontal-dark.svg";
import ketosHorizontalLight from "@/assets/ketos-horizontal-light.svg";
import { McpIcon } from "@/icons/MCP";
import { cn } from "@/utils/utils";

interface KetosMcpCompositionProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
}

export function KetosMcpComposition({
  label,
  className,
  ...props
}: KetosMcpCompositionProps) {
  return (
    <div
      {...props}
      role="img"
      aria-label={label}
      className={cn(
        "flex aspect-[16/9] w-full flex-col items-center justify-center gap-5 rounded-xl border bg-background p-6 text-foreground",
        className,
      )}
    >
      <div
        data-testid="ketos-mcp-brand"
        aria-hidden="true"
        className="w-full max-w-64"
      >
        <img
          src={ketosHorizontalLight}
          alt=""
          className="h-auto w-full dark:hidden"
        />
        <img
          src={ketosHorizontalDark}
          alt=""
          className="hidden h-auto w-full dark:block"
        />
      </div>
      <div
        aria-hidden="true"
        className="flex items-center gap-2 rounded-full border bg-muted px-4 py-2 font-mono text-sm font-semibold"
      >
        <span
          data-testid="mcp-protocol-mark"
          className="h-6 w-6 [&>svg]:h-full [&>svg]:w-full"
        >
          <McpIcon />
        </span>
        <span>MCP</span>
      </div>
    </div>
  );
}
