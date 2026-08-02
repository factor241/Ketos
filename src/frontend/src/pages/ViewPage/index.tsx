import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { useGetFlow } from "@/controllers/API/queries/flows/use-get-flow";
import { useGetTypes } from "@/controllers/API/queries/flows/use-get-types";
import CustomLoader from "@/customization/components/custom-loader";
import { useCustomNavigate } from "@/customization/hooks/use-custom-navigate";
import { useTypesStore } from "@/stores/typesStore";
import useFlowsManagerStore from "../../stores/flowsManagerStore";
import Page from "../FlowPage/components/PageComponent";

const ignoreLoadingState = (_isLoading: boolean): void => undefined;

export default function ViewPage() {
  const { t } = useTranslation();
  const types = useTypesStore((state) => state.types);
  useGetTypes({ enabled: Object.keys(types).length === 0 });

  const setCurrentFlow = useFlowsManagerStore((state) => state.setCurrentFlow);

  const { id } = useParams();
  const navigate = useCustomNavigate();
  const { mutateAsync: getFlow } = useGetFlow();
  const getFlowRef = useRef(getFlow);
  const navigateRef = useRef(navigate);
  getFlowRef.current = getFlow;
  navigateRef.current = navigate;

  const currentFlowId = useFlowsManagerStore((state) => state.currentFlowId);

  useEffect(() => {
    if (!id) return;

    let cancelled = false;

    const loadFlow = async () => {
      try {
        const flow = await getFlowRef.current({ id });
        if (!cancelled) setCurrentFlow(flow);
      } catch {
        if (!cancelled) navigateRef.current("/all");
      }
    };

    void loadFlow();

    return () => {
      cancelled = true;
    };
  }, [id, setCurrentFlow]);

  useEffect(
    () => () => {
      setCurrentFlow(undefined);
    },
    [setCurrentFlow],
  );

  return (
    <div
      className="flow-page-positioning"
      role="region"
      aria-label={t("version.readOnly")}
    >
      {id && currentFlowId === id ? (
        <Page view setIsLoading={ignoreLoadingState} />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <CustomLoader remSize={20} />
        </div>
      )}
    </div>
  );
}
