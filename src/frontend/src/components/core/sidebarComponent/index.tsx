import { useLocation } from "react-router-dom";
import { CustomLink } from "@/customization/components/custom-link";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "../../ui/sidebar";

type SideBarButtonsComponentProps = {
  items: {
    href?: string;
    title: string;
    icon: React.ReactNode;
    testId?: string;
  }[];
  handleOpenNewFolderModal?: () => void;
  wrapLabels?: boolean;
};

const SideBarButtonsComponent = ({
  items,
  wrapLabels = false,
}: SideBarButtonsComponentProps) => {
  const location = useLocation();
  const pathname = location.pathname;

  const isMobile = useIsMobile();

  return (
    <Sidebar collapsible={isMobile ? "icon" : "none"} className="border-none">
      <SidebarContent className="pr-6 group-data-[collapsible=icon]:pr-0">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item, index) => (
                <SidebarMenuItem key={index}>
                  <CustomLink to={item.href!} replace>
                    <SidebarMenuButton
                      size="md"
                      className={
                        wrapLabels
                          ? "h-auto min-h-9 items-start group-data-[collapsible=icon]:!min-h-8 group-data-[collapsible=icon]:items-center"
                          : undefined
                      }
                      isActive={
                        item.href ? pathname.endsWith(item.href) : false
                      }
                      data-testid={item.testId ?? `sidebar-nav-${item.title}`}
                      tooltip={item.title}
                    >
                      {item.icon}
                      <span
                        className={
                          wrapLabels
                            ? "block max-w-full break-words !overflow-visible !text-clip !whitespace-normal group-data-[collapsible=icon]:hidden"
                            : "block max-w-full truncate"
                        }
                      >
                        {item.title}
                      </span>
                    </SidebarMenuButton>
                  </CustomLink>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
};

export default SideBarButtonsComponent;
