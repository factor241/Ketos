import { useContext, useState } from "react";
import { useTranslation } from "react-i18next";
import ForwardedIconComponent from "@/components/common/genericIconComponent";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DATASTAX_DOCS_URL, DOCS_URL } from "@/constants/constants";
import { AuthContext } from "@/contexts/authContext";
import { useLogout } from "@/controllers/API/queries/auth";
import {
  ENABLE_DATASTAX_KETOS,
  ENABLE_FILE_MANAGEMENT,
  ENABLE_KNOWLEDGE_BASES,
} from "@/customization/feature-flags";
import { useCustomNavigate } from "@/customization/hooks/use-custom-navigate";
import useAuthStore from "@/stores/authStore";
import { useDarkStore } from "@/stores/darkStore";
import { useUtilityStore } from "@/stores/utilityStore";
import { cn, stripReleaseStageFromVersion } from "@/utils/utils";
import ThemeButtons from "../appHeaderComponent/components/ThemeButtons";
import { AvatarInitials } from "./components/avatar-initials";

const menuIconClassName = "h-4 w-4 shrink-0";

export function SidebarAccountCard() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { userData: contextUserData } = useContext(AuthContext);
  const storeUserData = useAuthStore((state) => state.userData);
  const isAdmin = useAuthStore((state) => state.isAdmin);
  const autoLogin = useAuthStore((state) => state.autoLogin);
  const hideLogoutButton = useUtilityStore((state) => state.hideLogoutButton);
  const version = useDarkStore((state) => state.version);
  const latestVersion = useDarkStore((state) => state.latestVersion);
  const navigate = useCustomNavigate();
  const { mutate: mutationLogout } = useLogout();

  const userData = contextUserData ?? storeUserData;
  const username = userData?.username ?? "";
  const isLatestVersion =
    !!version &&
    !!latestVersion &&
    stripReleaseStageFromVersion(version) ===
      stripReleaseStageFromVersion(latestVersion);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("account.openMenu")}
          data-testid="user_menu_button"
          className="flex w-full cursor-pointer items-center gap-3 rounded-lg bg-muted/50 px-3 py-2 text-left text-foreground transition-colors hover:bg-muted active:bg-muted data-[state=open]:bg-muted"
        >
          <span data-testid="user-profile-settings">
            <AvatarInitials
              username={username}
              profileImage={userData?.profile_image}
            />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">
              {username}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {t("account.workspace")}
            </span>
          </span>
          <ForwardedIconComponent
            name={open ? "ChevronUp" : "ChevronDown"}
            className={menuIconClassName}
          />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        side="top"
        align="start"
        sideOffset={4}
        className="m-0 max-h-[var(--radix-dropdown-menu-content-available-height)] w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto p-1"
      >
        <DropdownMenuLabel className="flex items-center gap-3 px-2 py-2 font-normal">
          <AvatarInitials
            username={username}
            profileImage={userData?.profile_image}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-foreground">
              {username}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {username}
            </span>
          </span>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          data-testid="menu_settings_button"
          id="menu_settings_button"
          onSelect={() => navigate("/settings")}
          className="gap-2 rounded-sm"
        >
          <ForwardedIconComponent
            name="Settings"
            className={menuIconClassName}
          />
          <span>{t("account.settings")}</span>
        </DropdownMenuItem>

        {ENABLE_FILE_MANAGEMENT && ENABLE_KNOWLEDGE_BASES ? (
          <DropdownMenuItem
            data-testid="account-menu-knowledge-bases"
            onSelect={() => navigate("/assets/knowledge-bases")}
            className="gap-2 rounded-sm"
          >
            <ForwardedIconComponent
              name="Library"
              className={menuIconClassName}
            />
            <span>{t("account.knowledgeBases")}</span>
          </DropdownMenuItem>
        ) : null}

        {ENABLE_FILE_MANAGEMENT ? (
          <DropdownMenuItem
            data-testid="account-menu-my-files"
            onSelect={() => navigate("/assets/files")}
            className="gap-2 rounded-sm"
          >
            <ForwardedIconComponent name="File" className={menuIconClassName} />
            <span>{t("account.myFiles")}</span>
          </DropdownMenuItem>
        ) : null}

        {isAdmin && !autoLogin && (
          <DropdownMenuItem
            data-testid="menu_admin_page_button"
            id="menu_admin_page_button"
            onSelect={() => navigate("/admin")}
            className="gap-2 rounded-sm"
          >
            <ForwardedIconComponent
              name="Shield"
              className={menuIconClassName}
            />
            <span>{t("account.adminPage")}</span>
          </DropdownMenuItem>
        )}

        <div
          role="group"
          aria-label={t("account.theme")}
          className="space-y-2 px-2 py-2"
        >
          <div className="flex items-center gap-2 text-sm">
            <ForwardedIconComponent
              name="Palette"
              className={menuIconClassName}
            />
            <span>{t("account.theme")}</span>
          </div>
          <ThemeButtons variant="menu" />
        </div>

        <DropdownMenuItem asChild className="gap-2 rounded-sm">
          <a
            href={ENABLE_DATASTAX_KETOS ? DATASTAX_DOCS_URL : DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="menu_docs_button"
            id="menu_docs_button"
          >
            <ForwardedIconComponent
              name="BookOpen"
              className={menuIconClassName}
            />
            <span>{t("account.documentation")}</span>
          </a>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <div
          data-testid="menu_version_button"
          id="menu_version_button"
          className="flex items-start gap-2 px-2 py-2 text-sm"
        >
          <ForwardedIconComponent
            name="Check"
            className={cn(
              menuIconClassName,
              isLatestVersion
                ? "text-accent-emerald-foreground"
                : "text-accent-amber-foreground",
            )}
          />
          <span className="min-w-0 flex-1">
            <span className="flex items-center justify-between gap-2 text-foreground">
              <span>{t("account.version")}</span>
              <span>{version}</span>
            </span>
            <span
              className={cn(
                "block text-xs",
                isLatestVersion
                  ? "text-accent-emerald-foreground"
                  : "text-accent-amber-foreground",
              )}
            >
              {isLatestVersion
                ? t("account.latest")
                : t("account.updateAvailable")}
            </span>
          </span>
        </div>

        {!autoLogin && !hideLogoutButton && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              data-testid="menu_logout_button"
              id="menu_logout_button"
              onSelect={() => mutationLogout()}
              className="gap-2 rounded-sm"
            >
              <ForwardedIconComponent
                name="LogOut"
                className={menuIconClassName}
              />
              <span>{t("account.signOut")}</span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default SidebarAccountCard;
