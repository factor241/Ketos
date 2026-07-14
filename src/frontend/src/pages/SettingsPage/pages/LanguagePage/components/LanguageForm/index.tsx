import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SUPPORTED_LANGUAGES } from "@/constants/languages";
import { useLanguagePreference } from "@/hooks/use-language-preference";

type SaveState = "idle" | "saving" | "saved" | "error";

const visibleLanguages = SUPPORTED_LANGUAGES.filter(
  (language) => language.shipped && !language.hidden,
);

const LanguageFormComponent = () => {
  const { t } = useTranslation();
  const { language, changeLanguage } = useLanguagePreference();
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const transitionRef = useRef(0);

  const handleLanguageChange = async (code: string) => {
    const transition = ++transitionRef.current;
    setSaveState("saving");

    try {
      await changeLanguage(code);
      if (transition === transitionRef.current) setSaveState("saved");
    } catch {
      if (transition === transitionRef.current) setSaveState("error");
    }
  };

  const statusMessage =
    saveState === "saving"
      ? t("loading.loading")
      : saveState === "saved"
        ? t("success.changesSaved")
        : saveState === "error"
          ? t("errors.saveChanges")
          : null;

  return (
    <Card>
      <CardContent className="space-y-3 pt-4">
        <Select
          value={language}
          onValueChange={(code) => void handleLanguageChange(code)}
        >
          <SelectTrigger
            aria-busy={saveState === "saving"}
            aria-label={t("settings.languageSelectAriaLabel")}
            data-testid="language-preference-select"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {visibleLanguages.map((languageOption) => (
              <SelectItem key={languageOption.code} value={languageOption.code}>
                {languageOption.label}
                {languageOption.code === "en" && (
                  <>
                    {"\u00A0("}
                    {t("settings.languageRecommended")}
                    {")"}
                  </>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {statusMessage && (
          <p
            aria-live={saveState === "error" ? "assertive" : "polite"}
            className={
              saveState === "error"
                ? "text-sm text-destructive"
                : "text-sm text-muted-foreground"
            }
            role={saveState === "error" ? "alert" : "status"}
          >
            {statusMessage}
          </p>
        )}
      </CardContent>
    </Card>
  );
};

export default LanguageFormComponent;
