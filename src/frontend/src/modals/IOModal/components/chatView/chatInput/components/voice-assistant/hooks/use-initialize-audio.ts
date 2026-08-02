import type { MutableRefObject } from "react";
import i18n from "@/i18n";

export const useInitializeAudio = async (
  audioContextRef: MutableRefObject<AudioContext | null>,
  setStatus: (status: string) => void,
  startConversation: () => void,
): Promise<void> => {
  try {
    if (audioContextRef.current?.state === "closed") {
      audioContextRef.current = null;
    }

    if (!audioContextRef.current) {
      const AudioContextConstructor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      audioContextRef.current = new AudioContextConstructor({
        sampleRate: 24000,
      });
    }

    if (audioContextRef.current.state === "suspended") {
      await audioContextRef.current.resume();
    }

    startConversation();
  } catch (error) {
    console.error("Failed to initialize audio:", error);
    setStatus(i18n.t("voiceAssistant.audioInitializationFailed"));
  }
};
