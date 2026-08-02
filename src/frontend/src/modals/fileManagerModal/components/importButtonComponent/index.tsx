import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { MorphingMenu } from "@/components/ui/morphing-menu";

export default function ImportButtonComponent({
  variant = "large",
}: {
  variant?: "large" | "small";
}) {
  const { t } = useTranslation();
  const items = useMemo(
    () => [
      {
        icon: "GoogleDrive",
        label: t("knowledge.ingestionSourceGoogleDrive"),
        onClick: () => {
          // Handle Google Drive click
        },
      },
      {
        icon: "OneDrive",
        label: t("knowledge.ingestionSourceOneDrive"),
        onClick: () => {
          // Handle OneDrive click
        },
      },
      {
        icon: "AWSInverted",
        label: t("knowledge.ingestionSourceS3"),
        onClick: () => {
          // Handle S3 click
        },
      },
    ],
    [t],
  );

  return (
    <MorphingMenu
      variant={variant}
      trigger={t("fileManager.importFrom")}
      items={items}
    />
  );
}
