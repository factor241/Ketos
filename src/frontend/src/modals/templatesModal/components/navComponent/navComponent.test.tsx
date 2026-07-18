import { fireEvent, render, screen } from "@testing-library/react";
import { Nav } from "./index";

jest.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

jest.mock("@/components/common/genericIconComponent", () => ({
  __esModule: true,
  default: () => <span />,
}));

jest.mock("@/components/ui/sidebar", () => {
  const React = jest.requireActual("react");
  const Wrapper = ({ children, ...props }: React.ComponentProps<"div">) => (
    <div {...props}>{children}</div>
  );
  const Button = ({
    children,
    isActive: _isActive,
    tooltip: _tooltip,
    ...props
  }: React.ComponentProps<"button"> & {
    isActive?: boolean;
    tooltip?: string;
  }) => <button {...props}>{children}</button>;

  return {
    Sidebar: Wrapper,
    SidebarContent: Wrapper,
    SidebarGroup: Wrapper,
    SidebarGroupContent: Wrapper,
    SidebarGroupLabel: Wrapper,
    SidebarMenu: Wrapper,
    SidebarMenuButton: Button,
    SidebarMenuItem: Wrapper,
    SidebarTrigger: Button,
  };
});

describe("TemplatesModal Nav", () => {
  it("uses the locale-independent item id in the navigation test id", () => {
    const setCurrentTab = jest.fn();

    render(
      <Nav
        categories={[
          {
            title: "Шаблоны",
            items: [
              {
                id: "all-templates",
                title: "Все шаблоны",
                icon: "LayoutGrid",
              },
            ],
          },
        ]}
        currentTab="get-started"
        setCurrentTab={setCurrentTab}
      />,
    );

    const allTemplates = screen.getByTestId("side_nav_options_all-templates");
    expect(
      screen.queryByTestId("side_nav_options_все-шаблоны"),
    ).not.toBeInTheDocument();

    fireEvent.click(allTemplates);
    expect(setCurrentTab).toHaveBeenCalledWith("all-templates");
  });
});
