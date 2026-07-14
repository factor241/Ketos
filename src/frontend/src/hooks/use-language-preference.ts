import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  createElement,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  DEFAULT_LANGUAGE,
  isLanguageSupported,
  LANGUAGE_STORAGE_KEY,
  normalizeLanguage,
  PSEUDO_LOCALE_ENABLED,
  type SupportedLanguageCode,
  syncDocumentLanguage,
} from "@/constants/languages";
import { api } from "@/controllers/API/api";
import { getURL } from "@/controllers/API/helpers/constants";
import i18n, { loadLanguage } from "@/i18n";
import useAuthStore from "@/stores/authStore";
import { useTypesStore } from "@/stores/typesStore";
import type { Users } from "@/types/api";

type LanguagePreference = {
  language: SupportedLanguageCode;
  changeLanguage: (language: string) => Promise<void>;
};

const LanguagePreferenceContext = createContext<LanguagePreference | null>(
  null,
);

type ApplyLanguageResult = {
  language: SupportedLanguageCode;
  committed: boolean;
};

const userLanguageStorageKey = (userId: string): string =>
  `${LANGUAGE_STORAGE_KEY}:${userId}`;

function pseudoLocaleOverride(): string | null {
  if (!PSEUDO_LOCALE_ENABLED || typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("locale") ===
    "qps-ploc"
    ? "qps-ploc"
    : null;
}

export function LanguagePreferenceProvider({
  children,
}: PropsWithChildren): React.ReactElement {
  const queryClient = useQueryClient();
  const resetTypes = useTypesStore((state) => state.resetTypes);
  const userData = useAuthStore((state) => state.userData);
  const setUserData = useAuthStore((state) => state.setUserData);
  const [language, setLanguage] = useState<SupportedLanguageCode>(() =>
    normalizeLanguage(
      i18n.resolvedLanguage || i18n.language || DEFAULT_LANGUAGE,
    ),
  );
  const languageRef = useRef(language);
  const transitionRef = useRef(0);
  const commitQueueRef = useRef<Promise<void>>(Promise.resolve());
  const profileCommitQueueRef = useRef<Promise<void>>(Promise.resolve());
  const profileTransitionRef = useRef(0);
  const activeUserIdRef = useRef<string | null>(userData?.id ?? null);
  activeUserIdRef.current = userData?.id ?? null;

  const applyLanguage = useCallback(
    async (
      requestedLanguage: string,
      persist: boolean,
    ): Promise<ApplyLanguageResult> => {
      const nextLanguage = normalizeLanguage(requestedLanguage);
      const transition = ++transitionRef.current;

      if (nextLanguage === languageRef.current) {
        return { language: nextLanguage, committed: false };
      }

      await loadLanguage(nextLanguage);
      if (transition !== transitionRef.current) {
        return { language: nextLanguage, committed: false };
      }

      let committed = false;

      const commit = commitQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          if (transition !== transitionRef.current) return;

          await i18n.changeLanguage(nextLanguage);
          if (transition !== transitionRef.current) return;

          syncDocumentLanguage(nextLanguage);
          if (persist) {
            localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage);
          }
          resetTypes();
          languageRef.current = nextLanguage;
          setLanguage(nextLanguage);
          committed = true;
          await queryClient.invalidateQueries({ queryKey: ["useGetTypes"] });
        });
      commitQueueRef.current = commit;
      await commit;
      return { language: nextLanguage, committed };
    },
    [queryClient, resetTypes],
  );

  const changeLanguage = useCallback(
    async (requestedLanguage: string): Promise<void> => {
      const result = await applyLanguage(requestedLanguage, true);
      if (!result.committed || !userData?.id) return;

      localStorage.setItem(
        userLanguageStorageKey(userData.id),
        result.language,
      );
      const profileTransition = ++profileTransitionRef.current;
      const userSnapshot = userData;
      const profileCommit = profileCommitQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          const response = await api.patch<Users>(
            `${getURL("USERS")}/${userSnapshot.id}`,
            { preferred_locale: result.language },
          );

          if (
            profileTransition !== profileTransitionRef.current ||
            activeUserIdRef.current !== userSnapshot.id
          ) {
            return;
          }

          setUserData(
            response.data ?? {
              ...userSnapshot,
              preferred_locale: result.language,
            },
          );
        });
      profileCommitQueueRef.current = profileCommit;
      await profileCommit;
    },
    [applyLanguage, setUserData, userData],
  );

  useEffect(() => {
    if (!userData?.id) return;

    const testOverride = pseudoLocaleOverride();
    if (testOverride) {
      void applyLanguage(testOverride, false).catch(() => undefined);
      return;
    }

    const profilePreference = userData.preferred_locale;
    const profileLanguage = normalizeLanguage(profilePreference);
    const hasProfilePreference = Boolean(profilePreference?.trim());
    if (!hasProfilePreference || isLanguageSupported(profilePreference)) {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, profileLanguage);
      localStorage.setItem(
        userLanguageStorageKey(userData.id),
        profileLanguage,
      );
    }
    void applyLanguage(profileLanguage, false).catch(() => undefined);
  }, [applyLanguage, userData?.id, userData?.preferred_locale]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      const expectedKey = userData?.id
        ? userLanguageStorageKey(userData.id)
        : LANGUAGE_STORAGE_KEY;
      if (event.key !== expectedKey || event.newValue === null) return;

      void applyLanguage(event.newValue, false).catch(() => undefined);
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [applyLanguage, userData?.id]);

  const value = useMemo(
    () => ({ language, changeLanguage }),
    [changeLanguage, language],
  );

  return createElement(LanguagePreferenceContext.Provider, { value }, children);
}

export function useLanguagePreference(): LanguagePreference {
  const context = useContext(LanguagePreferenceContext);
  if (!context) throw new Error("missing_language_preference_provider");
  return context;
}
