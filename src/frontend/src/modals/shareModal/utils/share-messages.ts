export type ShareTranslator = (key: string) => string;

export const getShareErrorTitle = (
  isComponent: boolean,
  t: ShareTranslator,
): string =>
  isComponent ? t("share.errorSharingComponent") : t("share.errorSharingFlow");
