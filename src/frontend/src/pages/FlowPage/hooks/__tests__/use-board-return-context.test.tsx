import { renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { api } from "@/controllers/API/api";
import { UseRequestProcessor } from "@/controllers/API/services/request-processor";
import { useBoardReturnContext } from "../use-board-return-context";

jest.mock("@/controllers/API/api", () => ({
  api: { get: jest.fn() },
}));
jest.mock("@/controllers/API/services/request-processor", () => ({
  UseRequestProcessor: jest.fn(),
}));

const mockApiGet = api.get as jest.Mock;
const mockProcessor = UseRequestProcessor as jest.Mock;
const FLOW_ID = "11111111-1111-4111-8111-111111111111";
const BOARD_ID = "22222222-2222-4222-8222-222222222222";
const PLACEMENT_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";

type Captured = {
  key: readonly unknown[];
  request: () => Promise<unknown>;
  options: { enabled?: boolean; retry?: boolean };
};

function renderContext(search: string, queryResult: Record<string, unknown>) {
  let captured: Captured | undefined;
  mockProcessor.mockReturnValue({
    query: (
      key: readonly unknown[],
      request: () => Promise<unknown>,
      options: Captured["options"],
    ) => {
      captured = { key, request, options };
      return queryResult;
    },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter initialEntries={[`/flow/${FLOW_ID}${search}`]}>
      {children}
    </MemoryRouter>
  );
  const hook = renderHook(() => useBoardReturnContext({ flowId: FLOW_ID }), {
    wrapper,
  });
  return {
    hook,
    get captured() {
      return captured;
    },
  };
}

describe("useBoardReturnContext", () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([
    [""],
    [`?returnBoardId=${BOARD_ID}`],
    [`?returnPlacementId=${PLACEMENT_ID}`],
    ["?returnBoardId=bad&returnPlacementId=bad"],
  ])("disables validation for absent or invalid context: %s", (search) => {
    const rendered = renderContext(search, {
      data: undefined,
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
    expect(rendered.captured?.options.enabled).toBe(false);
    expect(rendered.hook.result.current.returnUrl).toBeNull();
    expect(rendered.hook.result.current.context).toBeNull();
    expect(rendered.hook.result.current.hasBoardReturnIntent).toBe(
      search.length > 0,
    );
    expect(rendered.hook.result.current.status).toBe(
      search.length > 0 ? "invalid" : "absent",
    );
    expect(mockApiGet).not.toHaveBeenCalled();
  });

  it("calls the exact owner-validation endpoint and builds only server-derived Board URL", async () => {
    mockApiGet.mockResolvedValue({
      data: {
        project_id: PROJECT_ID,
        board_id: BOARD_ID,
        placement_id: PLACEMENT_ID,
        flow_id: FLOW_ID,
      },
    });
    const rendered = renderContext(
      `?returnBoardId=${BOARD_ID}&returnPlacementId=${PLACEMENT_ID}`,
      {
        data: {
          project_id: PROJECT_ID,
          board_id: BOARD_ID,
          placement_id: PLACEMENT_ID,
          flow_id: FLOW_ID,
        },
        isLoading: false,
        isError: false,
        refetch: jest.fn(),
      },
    );
    expect(rendered.captured?.key).toEqual([
      "automation-editor-context",
      BOARD_ID,
      PLACEMENT_ID,
      FLOW_ID,
    ]);
    expect(rendered.captured?.options).toEqual(
      expect.objectContaining({ enabled: true, retry: false }),
    );
    await expect(rendered.captured?.request()).resolves.toEqual({
      project_id: PROJECT_ID,
      board_id: BOARD_ID,
      placement_id: PLACEMENT_ID,
      flow_id: FLOW_ID,
    });
    expect(mockApiGet).toHaveBeenCalledWith(
      `/api/v1/boards/${BOARD_ID}/placements/${PLACEMENT_ID}/automation-editor-context?flow_id=${FLOW_ID}`,
    );
    expect(rendered.hook.result.current.returnUrl).toBe(
      `/project/${PROJECT_ID}/board/${BOARD_ID}?focusPlacementId=${PLACEMENT_ID}`,
    );
    expect(rendered.hook.result.current.context).toEqual({
      project_id: PROJECT_ID,
      board_id: BOARD_ID,
      placement_id: PLACEMENT_ID,
      flow_id: FLOW_ID,
    });
    expect(rendered.hook.result.current.status).toBe("valid");
  });

  it.each([
    [
      "mismatched flow",
      {
        project_id: PROJECT_ID,
        board_id: BOARD_ID,
        placement_id: PLACEMENT_ID,
        flow_id: PROJECT_ID,
      },
    ],
    [
      "extra field",
      {
        project_id: PROJECT_ID,
        board_id: BOARD_ID,
        placement_id: PLACEMENT_ID,
        flow_id: FLOW_ID,
        secret: "no",
      },
    ],
  ])("rejects a %s response", async (_name, response) => {
    mockApiGet.mockResolvedValue({ data: response });
    const rendered = renderContext(
      `?returnBoardId=${BOARD_ID}&returnPlacementId=${PLACEMENT_ID}`,
      {
        data: undefined,
        isLoading: false,
        isError: false,
        refetch: jest.fn(),
      },
    );
    await expect(rendered.captured?.request()).rejects.toThrow(
      "automation editor context",
    );
    expect(rendered.hook.result.current.returnUrl).toBeNull();
  });

  it("hides Return while loading or after an API error", () => {
    for (const queryResult of [
      { isLoading: true, isError: false },
      { isLoading: false, isError: true },
    ]) {
      const rendered = renderContext(
        `?returnBoardId=${BOARD_ID}&returnPlacementId=${PLACEMENT_ID}`,
        { ...queryResult, data: undefined, refetch: jest.fn() },
      );
      expect(rendered.hook.result.current.returnUrl).toBeNull();
      expect(rendered.hook.result.current.context).toBeNull();
      expect(rendered.hook.result.current.status).toBe(
        queryResult.isLoading ? "loading" : "invalid",
      );
    }
  });
});
