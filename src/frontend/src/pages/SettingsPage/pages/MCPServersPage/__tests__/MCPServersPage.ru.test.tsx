jest.unmock("react-i18next");

import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createTestI18n } from "@/test-utils/create-test-i18n";

jest.mock("@/controllers/API/queries/mcp/use-get-mcp-servers", () => ({
  useGetMCPServers: () => ({
    data: [
      {
        name: "stable-server-id",
        command: "stable-command",
        args: [],
        env: {},
        headers: {},
        action_count: 0,
      },
    ],
  }),
}));
jest.mock("@/controllers/API/queries/mcp/use-get-mcp-server", () => ({
  useGetMCPServer: () => ({ mutateAsync: jest.fn() }),
}));
jest.mock("@/controllers/API/queries/mcp/use-delete-mcp-server", () => ({
  useDeleteMCPServer: () => ({ mutate: jest.fn() }),
}));
jest.mock("@/stores/alertStore", () => ({
  __esModule: true,
  default: (selector: (state: unknown) => unknown) =>
    selector({ setErrorData: jest.fn() }),
}));
jest.mock("@/modals/addMcpServerModal", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/components/common/shadTooltipComponent", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock("@/components/common/genericIconComponent", () => ({
  __esModule: true,
  default: ({ name }: { name: string }) => <span>{name}</span>,
}));
jest.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => (
    <button>{children}</button>
  ),
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
jest.mock("@/modals/deleteConfirmationModal", () => ({
  __esModule: true,
  default: ({ description }: { description: string }) => (
    <div data-testid="delete-confirmation" data-description={description} />
  ),
}));

import MCPServersPage from "../index";

describe("MCPServersPage Russian delete confirmation", () => {
  it("renders a localized MCP server description and preserves machine data", async () => {
    const russian = await createTestI18n("ru");

    render(
      <I18nextProvider i18n={russian}>
        <MCPServersPage />
      </I18nextProvider>,
    );

    expect(screen.getByText("stable-server-id")).toBeInTheDocument();
    expect(screen.getByTestId("delete-confirmation")).toHaveAttribute(
      "data-description",
      "MCP-сервер",
    );
  });
});
