import type { HTMLAttributes } from "react";
import ketosSymbolDark from "@/assets/ketos-symbol-dark.svg";
import ketosSymbolLight from "@/assets/ketos-symbol-light.svg";
import { cn } from "@/utils/utils";

type AccessibleMark = {
  label: string;
  decorative?: false;
};

type DecorativeMark = {
  decorative: true;
  label?: never;
};

type KetosBrandMarkProps = (AccessibleMark | DecorativeMark) &
  HTMLAttributes<HTMLSpanElement> & {
    theme?: "auto" | "light" | "dark";
  };

export function KetosBrandMark({
  label,
  decorative = false,
  theme = "auto",
  className,
  ...props
}: KetosBrandMarkProps) {
  return (
    <span
      {...props}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? "true" : undefined}
      className={cn("inline-flex shrink-0", className)}
    >
      {theme !== "dark" && (
        <img
          src={ketosSymbolLight}
          alt=""
          aria-hidden="true"
          data-testid="ketos-mark-light"
          className={cn(
            "h-full w-full object-contain",
            theme === "auto" && "dark:hidden",
          )}
        />
      )}
      {theme !== "light" && (
        <img
          src={ketosSymbolDark}
          alt=""
          aria-hidden="true"
          data-testid="ketos-mark-dark"
          className={cn(
            "h-full w-full object-contain",
            theme === "auto" && "hidden dark:block",
          )}
        />
      )}
    </span>
  );
}

type KetosAssistantMarkProps = KetosBrandMarkProps & {
  state: "active" | "idle";
};

export function KetosAssistantMark({
  state,
  className,
  ...props
}: KetosAssistantMarkProps) {
  return (
    <KetosBrandMark
      {...props}
      data-testid={`ketos-assistant-${state}`}
      data-state={state}
      className={cn(
        "transition-opacity motion-reduce:transition-none",
        state === "active" ? "opacity-100" : "opacity-60",
        className,
      )}
    />
  );
}
