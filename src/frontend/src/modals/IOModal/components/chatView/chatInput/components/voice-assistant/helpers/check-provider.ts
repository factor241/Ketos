import { getLocalStorage, setLocalStorage } from "@/utils/local-storage-util";

export const checkProvider = () => {
  const audioSettings = JSON.parse(
    getLocalStorage("ketos-audio-settings-playground") || "{}",
  );
  if (!audioSettings?.provider) {
    setLocalStorage(
      "ketos-audio-settings-playground",
      JSON.stringify({ provider: "openai", voice: "alloy" }),
    );
  }
};
