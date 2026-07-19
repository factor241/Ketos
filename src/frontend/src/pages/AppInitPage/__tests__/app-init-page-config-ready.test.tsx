import { render, screen } from "@testing-library/react";
import { createContext } from "react";
import { AppInitPage } from "../index";

let authenticated = false;
let configFetched = false;

jest.mock("react-router-dom", () => ({
  Outlet: () => <div data-testid="app-init-outlet" />,
}));
jest.mock("@/contexts/authContext", () => ({
  AuthContext: createContext({ setUserData: jest.fn() }),
}));
jest.mock("@/controllers/API/queries/auth", () => ({
  useGetAuthSession: () => ({
    data: { authenticated: false },
    isFetched: true,
  }),
  useGetAutoLogin: () => ({ isFetched: true }),
}));
jest.mock("@/controllers/API/queries/config/use-get-config", () => ({
  useGetConfig: () => ({ isFetched: configFetched }),
}));
jest.mock("@/controllers/API/queries/flows/use-get-basic-examples", () => ({
  useGetBasicExamplesQuery: () => ({ isFetched: true, refetch: jest.fn() }),
}));
jest.mock("@/controllers/API/queries/folders/use-get-folders", () => ({
  useGetFoldersQuery: jest.fn(),
}));
jest.mock("@/controllers/API/queries/variables", () => ({
  useGetGlobalVariables: jest.fn(),
}));
jest.mock("@/controllers/API/queries/version", () => ({
  useGetVersionQuery: jest.fn(),
}));
jest.mock("@/customization/components/custom-loading-page", () => ({
  CustomLoadingPage: () => <div data-testid="custom-loading" />,
}));
jest.mock("@/customization/hooks/use-custom-primary-loading", () => ({
  useCustomPrimaryLoading: () => ({ isFetched: true }),
}));
jest.mock("@/stores/authStore", () => ({
  __esModule: true,
  default: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      autoLogin: false,
      isAuthenticated: authenticated,
      setIsAuthenticated: jest.fn(),
      setIsAdmin: jest.fn(),
    }),
}));
jest.mock("@/stores/flowsManagerStore", () => ({
  __esModule: true,
  default: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ isLoading: false }),
}));
jest.mock("../../LoadingPage", () => ({
  LoadingPage: () => <div data-testid="loading-page" />,
}));

describe("AppInitPage config readiness", () => {
  beforeEach(() => {
    authenticated = false;
    configFetched = false;
  });

  it("renders the outlet for an unauthenticated manual-login state without fetching config", () => {
    render(<AppInitPage />);

    expect(screen.getByTestId("app-init-outlet")).toBeInTheDocument();
    expect(screen.queryByTestId("loading-page")).not.toBeInTheDocument();
  });

  it("waits for config after authentication is ready", () => {
    authenticated = true;

    render(<AppInitPage />);

    expect(screen.queryByTestId("app-init-outlet")).not.toBeInTheDocument();
    expect(screen.getByTestId("loading-page")).toBeInTheDocument();
  });
});
