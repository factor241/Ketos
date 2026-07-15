import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import ForwardedIconComponent from "@/components/common/genericIconComponent";
import { Button } from "@/components/ui/button";
import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import useTheme, {
  type ThemePreference,
} from "@/customization/hooks/use-custom-theme";

type ThemeButtonsProps = {
  variant?: "icon" | "labeled" | "menu";
};

export const ThemeButtons = ({ variant = "icon" }: ThemeButtonsProps) => {
  const { t } = useTranslation();
  const { systemTheme, dark, setThemePreference } = useTheme();
  const isLabeled = variant === "labeled";
  const [selectedTheme, setSelectedTheme] = useState<ThemePreference>(
    systemTheme ? "system" : dark ? "dark" : "light",
  );
  const [hasInteracted, setHasInteracted] = useState(false); // Track user interaction

  useEffect(() => {
    if (!hasInteracted) {
      // Set initial theme without triggering the animation
      if (systemTheme) {
        setSelectedTheme("system");
      } else if (dark) {
        setSelectedTheme("dark");
      } else {
        setSelectedTheme("light");
      }
    }
  }, [systemTheme, dark, hasInteracted]);

  const handleThemeChange = (theme: ThemePreference) => {
    setHasInteracted(true); // Mark that a button has been clicked
    setSelectedTheme(theme);
    setThemePreference(theme);
  };

  if (variant === "menu") {
    const menuItemClassName =
      "relative z-10 inline-flex min-w-0 flex-1 basis-0 cursor-pointer items-center justify-center rounded-full px-1.5 py-1 text-xs leading-4 outline-none [&>span:first-child]:hidden";

    return (
      <DropdownMenuRadioGroup
        value={selectedTheme}
        onValueChange={(value) => handleThemeChange(value as ThemePreference)}
        className="relative ml-auto flex w-full max-w-[248px] rounded-full border border-border"
      >
        <div
          aria-hidden="true"
          className={`absolute bottom-0.5 left-0.5 top-0.5 w-[calc((100%_-_0.25rem)/3)] rounded-full bg-accent-amber-foreground dark:bg-accent-purple-foreground ${hasInteracted ? "transition-all duration-300" : ""}`}
          style={{
            transform: `translateX(${selectedTheme === "light" ? "0" : selectedTheme === "dark" ? "100%" : "200%"})`,
          }}
        />
        <DropdownMenuRadioItem
          value="light"
          aria-label={t("theme.light")}
          data-testid="menu_light_button"
          id="menu_light_button"
          onSelect={(event) => event.preventDefault()}
          className={`${menuItemClassName} ${
            selectedTheme === "light"
              ? "text-background"
              : "text-foreground hover:bg-accent-amber-foreground hover:text-background"
          }`}
        >
          <span>{t("theme.lightLabel")}</span>
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem
          value="dark"
          aria-label={t("theme.dark")}
          data-testid="menu_dark_button"
          id="menu_dark_button"
          onSelect={(event) => event.preventDefault()}
          className={`${menuItemClassName} ${
            selectedTheme === "dark"
              ? "bg-indigo-foreground text-background hover:bg-indigo-foreground"
              : "text-foreground hover:bg-indigo-foreground hover:text-background"
          }`}
        >
          <span>{t("theme.darkLabel")}</span>
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem
          value="system"
          aria-label={t("theme.system")}
          data-testid="menu_system_button"
          id="menu_system_button"
          onSelect={(event) => event.preventDefault()}
          className={`${menuItemClassName} ${
            selectedTheme === "system"
              ? "bg-foreground text-background"
              : "hover:bg-foreground hover:text-background"
          }`}
        >
          <span>{t("theme.systemLabel")}</span>
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    );
  }

  return (
    <div
      className={
        isLabeled
          ? "relative ml-auto flex w-full max-w-[248px] rounded-full border border-border"
          : "relative ml-auto inline-flex rounded-full border border-border"
      }
    >
      {/* Sliding Indicator - Behind the Buttons */}
      <div
        className={`${
          isLabeled
            ? "absolute bottom-0.5 left-0.5 top-0.5 w-[calc((100%_-_0.25rem)/3)] rounded-full bg-accent-amber-foreground"
            : "absolute bottom-0.5 left-[1px] top-0.5 w-[30%] rounded-full bg-accent-amber-foreground"
        } ${
          hasInteracted ? "transition-all duration-300" : ""
        } dark:bg-accent-purple-foreground`}
        style={{
          transform: isLabeled
            ? `translateX(${selectedTheme === "light" ? "0" : selectedTheme === "dark" ? "100%" : "200%"})`
            : `translateX(${
                selectedTheme === "light"
                  ? "2%"
                  : selectedTheme === "dark"
                    ? "112%"
                    : "223%"
              })`,
          zIndex: 0, // Ensure it's behind the buttons
        }}
      ></div>

      {/* Light Theme Button */}
      <Button
        unstyled
        aria-label={t("theme.light")}
        aria-pressed={isLabeled ? selectedTheme === "light" : undefined}
        className={`${
          isLabeled
            ? "relative z-10 inline-flex min-w-0 flex-1 basis-0 items-center justify-center rounded-full px-1.5 py-1 text-xs leading-4"
            : "relative z-10 inline-flex items-center rounded-full px-1"
        } ${
          selectedTheme === "light"
            ? "text-background"
            : "text-foreground hover:bg-accent-amber-foreground hover:text-background"
        }`}
        onClick={() => handleThemeChange("light")}
        data-testid="menu_light_button"
        id="menu_light_button"
      >
        {!isLabeled && (
          <ForwardedIconComponent strokeWidth={2} name="Sun" className="w-4" />
        )}
        {isLabeled && <span>{t("theme.lightLabel")}</span>}
      </Button>

      {/* Dark Theme Button */}
      <Button
        unstyled
        aria-label={t("theme.dark")}
        aria-pressed={isLabeled ? selectedTheme === "dark" : undefined}
        className={`${
          isLabeled
            ? "relative z-10 inline-flex min-w-0 flex-1 basis-0 items-center justify-center rounded-full px-1.5 py-1 text-xs leading-4"
            : "relative z-10 mx-1 inline-flex items-center rounded-full px-1"
        } ${
          selectedTheme === "dark"
            ? "bg-indigo-foreground text-background hover:bg-indigo-foreground"
            : "text-foreground hover:bg-indigo-foreground hover:text-background"
        }`}
        onClick={() => handleThemeChange("dark")}
        data-testid="menu_dark_button"
        id="menu_dark_button"
      >
        {!isLabeled && (
          <ForwardedIconComponent strokeWidth={2} name="Moon" className="w-4" />
        )}
        {isLabeled && <span>{t("theme.darkLabel")}</span>}
      </Button>

      {/* System Theme Button */}
      <Button
        unstyled
        aria-label={t("theme.system")}
        aria-pressed={isLabeled ? selectedTheme === "system" : undefined}
        className={`${
          isLabeled
            ? "relative z-10 inline-flex min-w-0 flex-1 basis-0 items-center justify-center rounded-full px-1.5 py-1 text-xs leading-4"
            : "relative z-10 inline-flex items-center rounded-full px-1"
        } ${
          selectedTheme === "system"
            ? "bg-foreground text-background"
            : "hover:bg-foreground hover:text-background"
        }`}
        onClick={() => handleThemeChange("system")}
        data-testid="menu_system_button"
        id="menu_system_button"
      >
        {!isLabeled && (
          <ForwardedIconComponent
            name="Monitor"
            className="w-4"
            strokeWidth={2}
          />
        )}
        {isLabeled && <span>{t("theme.systemLabel")}</span>}
      </Button>
    </div>
  );
};

export default ThemeButtons;
