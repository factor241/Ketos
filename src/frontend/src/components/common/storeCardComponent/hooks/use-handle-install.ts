import type { Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import useAddFlow from "@/hooks/flows/use-add-flow";
import { getLocalizedApiErrorMessage } from "@/utils/localized-api-error";
import { getComponent } from "../../../../controllers/API";
import type { storeComponent } from "../../../../types/store";
import cloneFlowWithParent from "../../../../utils/storeUtils";

const useInstallComponent = (
  data: storeComponent,
  name: string,
  downloadsCount: number,
  setDownloadsCount: Dispatch<SetStateAction<number>>,
  setLoading: (value: boolean) => void,
  setSuccessData: (value: { title: string }) => void,
  setErrorData: (value: { title: string; list: string[] }) => void,
) => {
  const { t } = useTranslation();
  const addFlow = useAddFlow();

  const handleInstall = () => {
    const temp = downloadsCount;
    setDownloadsCount((old) => Number(old) + 1);
    setLoading(true);

    getComponent(data.id)
      .then((res) => {
        const newFlow = cloneFlowWithParent(res, res.id, data.is_component);
        addFlow({ flow: newFlow })
          .then((id) => {
            setSuccessData({
              title: t("store.installedSuccess", { name }),
            });
            setLoading(false);
          })
          .catch((error) => {
            setLoading(false);
            setErrorData({
              title: t("store.installError", { name }),
              list: [
                getLocalizedApiErrorMessage(error, (key) => t(key), {
                  fallbackKey: "errors.requestFailed",
                }),
              ],
            });
          });
      })
      .catch((err) => {
        setLoading(false);
        setErrorData({
          title: t("store.installError", { name }),
          list: [
            getLocalizedApiErrorMessage(err, (key) => t(key), {
              fallbackKey: "errors.requestFailed",
            }),
          ],
        });
        setDownloadsCount(temp);
      });
  };

  return { handleInstall };
};

export default useInstallComponent;
