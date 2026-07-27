import React from "react";
import { ForwardedIconComponent } from "@/components/common/genericIconComponent";
import { Button } from "@/components/ui/button";
import { cn } from "@/utils/utils";
import ToggleShadComponent from "../parameterRenderComponent/components/toggleShadComponent";
import { getModifierKey } from "./utils/canvasUtils";

export type DropdownControlButtonProps = {
  tooltipText?: string;
  onClick?: () => void;
  disabled?: boolean;
  testId?: string;
  label?: string;
  shortcut?: string;
  iconName?: string;
  hasToogle?: boolean;
  toggleValue?: boolean;
  externalLink?: boolean;
};

const DropdownControlButton: React.FC<DropdownControlButtonProps> = ({
  tooltipText,
  onClick = () => {},
  disabled,
  testId,
  label = "",
  shortcut = "",
  iconName,
  hasToogle = false,
  toggleValue = false,
  externalLink = false,
}) => {
  const content = (
    <>
      {iconName && (
        <ForwardedIconComponent
          name={iconName}
          className="text-muted-foreground group-hover:text-primary"
        />
      )}
      <div className="flex flex-row items-center justify-between w-full h-full">
        <span className="text-muted-foreground text-sm mr-2 group-hover:text-primary">
          {label}
        </span>
        <div className="flex flex-row items-center text-sm">
          {shortcut && (
            <div className="flex items-center gap-0.5 text-muted-foreground group-hover:text-primary">
              <span>{getModifierKey()}</span>
              <span>{shortcut}</span>
            </div>
          )}
          {externalLink && (
            <ForwardedIconComponent
              name="external-link"
              className="text-muted-foreground group-hover:text-primary opacity-0 group-hover:opacity-100"
            />
          )}
        </div>
      </div>
    </>
  );
  const className = cn(
    "group flex items-center justify-center !py-1.5 !px-2 hover:bg-accent h-full rounded-none ",
    disabled && "cursor-not-allowed opacity-50",
  );

  if (hasToogle) {
    const toggleId = `${testId}-toggle`;
    return (
      <Button asChild className={className} shouldScale={false} variant="ghost">
        <label
          aria-disabled={disabled}
          data-testid={testId}
          htmlFor={toggleId}
          title={tooltipText || ""}
        >
          {content}
          <ToggleShadComponent
            value={toggleValue}
            handleOnNewValue={onClick}
            editNode={true}
            id={toggleId}
            disabled={disabled ?? false}
          />
        </label>
      </Button>
    );
  }

  return (
    <Button
      data-testid={testId}
      className={className}
      onClick={onClick}
      shouldScale={false}
      variant="ghost"
      disabled={disabled}
      title={tooltipText || ""}
    >
      {content}
    </Button>
  );
};

export default DropdownControlButton;
