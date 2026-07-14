import { createInstance } from "i18next";
import en from "@/locales/en.json";
import ru from "@/locales/ru.json";

export async function createTestI18n(language: "en" | "ru") {
  const instance = createInstance();
  await instance.init({
    lng: language,
    fallbackLng: "en",
    interpolation: { escapeValue: false },
    resources: {
      en: { translation: en },
      ru: { translation: ru },
    },
  });
  return instance;
}
