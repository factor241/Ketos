import { useTranslation } from "react-i18next";
import ForwardedIconComponent from "@/components/common/genericIconComponent";
import LanguageFormComponent from "./components/LanguageForm";

const LanguagePage = () => {
  const { t } = useTranslation();

  return (
    <div
      className="flex h-full w-full flex-col gap-6"
      data-testid="settings-language-page"
    >
      <div className="flex w-full items-start justify-between gap-6">
        <div className="flex w-full flex-col">
          <h2
            className="flex items-center text-lg font-semibold tracking-tight"
            data-testid="settings-language-heading"
          >
            {t("settings.languageTitle")}
            <ForwardedIconComponent
              name="Languages"
              className="ml-2 h-5 w-5 text-primary"
            />
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("settings.languageDescription")}
          </p>
        </div>
      </div>

      <div className="grid gap-6 pb-8">
        <LanguageFormComponent />
      </div>
    </div>
  );
};

export default LanguagePage;
