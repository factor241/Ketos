import { CustomNavigate } from "@/customization/components/custom-navigate";
import { ENABLE_PROFILE_ICONS } from "@/customization/feature-flags";
import useAuthStore from "@/stores/authStore";

export const AuthSettingsGuard = ({ children }) => {
  const autoLogin = useAuthStore((state) => state.autoLogin);

  // Hides the General settings if there is nothing to show
  const showGeneralSettings = ENABLE_PROFILE_ICONS || !autoLogin;

  if (showGeneralSettings) {
    return children;
  } else {
    return <CustomNavigate replace to="/settings/global-variables" />;
  }
};
