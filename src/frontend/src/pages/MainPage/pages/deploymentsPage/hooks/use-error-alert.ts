import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import useAlertStore from "@/stores/alertStore";
import { getLocalizedApiErrorMessage } from "@/utils/localized-api-error";

export function useErrorAlert() {
  const { t } = useTranslation();
  const translateRef = useRef(t);
  translateRef.current = t;
  const setErrorData = useAlertStore((s) => s.setErrorData);
  return useCallback(
    (title: string, err: unknown) => {
      setErrorData({
        title,
        list: [
          getLocalizedApiErrorMessage(err, translateRef.current, {
            fallbackKey: "errors.requestFailed",
          }),
        ],
      });
    },
    [setErrorData],
  );
}
