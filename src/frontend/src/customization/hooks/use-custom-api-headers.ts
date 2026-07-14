import { useTranslation } from "react-i18next";
import { normalizeLanguage } from "@/constants/languages";

export function useCustomApiHeaders() {
  const { i18n } = useTranslation();
  return {
    "Accept-Language": normalizeLanguage(i18n.language),
  };
}
