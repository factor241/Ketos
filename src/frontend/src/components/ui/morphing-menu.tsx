import * as React from "react";
import ForwardedIconComponent from "@/components/common/genericIconComponent";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/utils/utils";

interface MorphingMenuProps {
  trigger: React.ReactNode;
  items: { icon?: string; label: string; onClick?: () => void }[];
  className?: string;
  buttonClassName?: string;
  itemsClassName?: string;
  variant?: "large" | "small";
}

const MorphingMenu = React.forwardRef<HTMLDivElement, MorphingMenuProps>(
  (
    { trigger, items, className, buttonClassName, itemsClassName, variant },
    ref,
  ) => {
    const menuId = React.useId();

    return (
      <div
        ref={ref}
        className={cn(
          "relative flex w-fit select-none items-center justify-center whitespace-nowrap",
          variant === "large" ? "h-10" : "h-8",
          variant === "large" ? "w-36" : "w-[134px]",
          className,
        )}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-controls={menuId}
              className={cn(
                "flex w-full cursor-pointer items-center justify-between gap-2 bg-primary px-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover",
                variant === "large"
                  ? "h-10 rounded-md"
                  : "h-8 rounded-lg text-[13px] font-medium",
                buttonClassName,
              )}
            >
              {trigger}
              <ForwardedIconComponent name="ChevronDown" className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            id={menuId}
            align="end"
            sideOffset={4}
            className={cn("w-40 p-1", itemsClassName)}
          >
            {items.map((item) => (
              <DropdownMenuItem
                key={`${item.icon ?? "item"}-${item.label}`}
                className="h-8 gap-2"
                onSelect={item.onClick}
              >
                {item.icon && (
                  <ForwardedIconComponent
                    name={item.icon}
                    className="h-4 w-4"
                  />
                )}
                {item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  },
);

MorphingMenu.displayName = "MorphingMenu";

export { MorphingMenu };
export type { MorphingMenuProps };
