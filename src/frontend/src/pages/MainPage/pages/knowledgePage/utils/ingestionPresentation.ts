import type { TFunction } from "i18next";

export function translateIngestionStatus(t: TFunction, status: string): string {
  switch (status) {
    case "succeeded":
      return t("knowledge.ingestionStatus.succeeded");
    case "partial":
      return t("knowledge.ingestionStatus.partial");
    case "failed":
      return t("knowledge.ingestionStatus.failed");
    case "cancelled":
      return t("knowledge.ingestionStatus.cancelled");
    case "running":
      return t("knowledge.ingestionStatus.running");
    case "pending":
      return t("knowledge.ingestionStatus.pending");
    case "skipped":
      return t("knowledge.ingestionStatus.skipped");
    default:
      return t("knowledge.unknown");
  }
}

export function translateIngestionSourceType(
  t: TFunction,
  sourceType: string,
): string {
  switch (sourceType) {
    case "file_upload":
      return t("knowledge.ingestionSourceFileUpload");
    case "folder":
      return t("knowledge.ingestionSourceFolder");
    case "template":
      return t("knowledge.ingestionSourceTemplate");
    case "google_drive":
      return t("knowledge.ingestionSourceGoogleDrive");
    case "s3":
      return t("knowledge.ingestionSourceS3");
    case "onedrive":
      return t("knowledge.ingestionSourceOneDrive");
    case "sharepoint":
      return t("knowledge.ingestionSourceSharePoint");
    default:
      return t("knowledge.unknown");
  }
}
