import { useTranslation } from "react-i18next";
import { BASE_URL_API } from "@/customization/config-constants";
import { getInitials } from "../utils/get-initials";

interface AvatarInitialsProps {
  username: string;
  profileImage?: string | null;
}

const DEFAULT_PROFILE_IMAGE = "Space/046-rocket.svg";

export function AvatarInitials({
  username,
  profileImage,
}: AvatarInitialsProps) {
  const { t } = useTranslation();
  const normalizedProfileImage = profileImage?.trim();

  if (
    normalizedProfileImage &&
    normalizedProfileImage !== DEFAULT_PROFILE_IMAGE
  ) {
    return (
      <img
        src={`${BASE_URL_API}files/profile_pictures/${normalizedProfileImage}`}
        alt={t("common.userProfileAlt")}
        className="h-6 w-6 shrink-0 rounded-full focus-visible:outline-0"
      />
    );
  }

  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
      {getInitials(username)}
    </span>
  );
}
