import ForwardedIconComponent from "@/components/common/genericIconComponent";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { useTranslation } from "react-i18next";

export const CustomStoreButton = () => {
  const { t } = useTranslation();
  return (
    <>
      <div className="flex w-full items-center" data-testid="button-store">
        <SidebarMenuButton
          size="md"
          className="text-sm"
          onClick={() => {
            window.open("/store", "_blank");
          }}
        >
          <ForwardedIconComponent name="Store" className="h-4 w-4" />
          {t("store.title")}
        </SidebarMenuButton>
      </div>
    </>
  );
};
