import { useTranslation } from "react-i18next";
import logoDarkPng from "@/assets/logo_dark.png";
import logoLightPng from "@/assets/logo_light.png";
import { ForwardedIconComponent } from "@/components/common/genericIconComponent";
import CardsWrapComponent from "@/components/core/cardsWrapComponent";
import { useStartNewFlow } from "@/components/core/flowBuilderWelcome/hooks/use-start-new-flow";
import { Button } from "@/components/ui/button";
import { DotBackgroundDemo } from "@/components/ui/dot-background";
import { useFolderStore } from "@/stores/foldersStore";
import useFileDrop from "../hooks/use-on-file-drop";

export const EmptyPageCommunity = ({
  setOpenModal,
}: {
  setOpenModal: (open: boolean) => void;
}) => {
  const { t } = useTranslation();
  const handleFileDrop = useFileDrop(undefined);
  const folders = useFolderStore((state) => state.folders);
  const startNewFlow = useStartNewFlow();

  return (
    <DotBackgroundDemo>
      <CardsWrapComponent
        dragMessage={t("home.dragFlowsOrComponents")}
        onFileDrop={handleFileDrop}
      >
        <div className="m-0 h-full w-full bg-background p-0">
          <div className="z-50 flex h-full w-full flex-col items-center justify-center gap-5">
            <div className="z-50 flex flex-col items-center gap-2">
              <div className="z-50 dark:hidden">
                <img
                  src={logoLightPng}
                  alt={t("common.ketosLogoLight")}
                  data-testid="empty_page_logo_light"
                  className="relative top-8 h-40 pointer-events-none select-none"
                />
              </div>
              <div className="z-50 hidden dark:block">
                <img
                  src={logoDarkPng}
                  alt={t("common.ketosLogoDark")}
                  data-testid="empty_page_logo_dark"
                  className="relative top-8 h-40 pointer-events-none select-none"
                />
              </div>
              <span
                data-testid="mainpage_title"
                className="z-50 text-center font-chivo text-2xl font-medium text-foreground"
              >
                {t("page.welcomeTitle")}
              </span>

              <span
                data-testid="empty_page_description"
                className="z-50 text-center text-base text-secondary-foreground"
              >
                {folders?.length > 1
                  ? t("page.emptyFolder")
                  : t("page.welcomeDescription")}
              </span>
            </div>

            <div className="flex w-full max-w-[510px] flex-col gap-7 sm:gap-[29px]">
              <Button
                variant="default"
                className="z-10 m-auto mt-3 h-auto min-h-10 w-auto whitespace-normal rounded-lg font-bold transition-all duration-300"
                onClick={() => startNewFlow()}
                id="new-project-btn"
                data-testid="new_project_btn_empty_page"
              >
                <ForwardedIconComponent
                  name="Plus"
                  aria-hidden="true"
                  className="h-4 w-4"
                />
                <span>{t("page.createFirstFlow")}</span>
              </Button>
            </div>
          </div>
        </div>
        <p
          data-testid="empty_page_drag_and_drop_text"
          className="absolute bottom-5 left-0 right-0 mt-4 cursor-default text-center text-xxs text-muted-foreground"
        >
          {t("page.dragAndDropText")}
        </p>
      </CardsWrapComponent>
    </DotBackgroundDemo>
  );
};

export default EmptyPageCommunity;
