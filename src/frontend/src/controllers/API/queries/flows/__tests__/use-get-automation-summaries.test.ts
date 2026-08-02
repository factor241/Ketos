const mockApiGet = jest.fn();
const mockQuery = jest.fn();

jest.mock("@/controllers/API/api", () => ({
  api: { get: (...args: unknown[]) => mockApiGet(...args) },
}));
jest.mock("@/controllers/API/helpers/constants", () => ({
  getURL: jest.fn(() => "/api/v1/flows"),
}));
jest.mock("@/controllers/API/services/request-processor", () => ({
  UseRequestProcessor: () => ({
    query: (...args: unknown[]) => mockQuery(...args),
  }),
}));

import {
  mapAutomationSummary,
  useGetAutomationSummaries,
} from "../use-get-automation-summaries";

type CapturedQuery = {
  key: readonly unknown[];
  request: () => Promise<unknown>;
  options: { enabled?: boolean };
};

describe("useGetAutomationSummaries", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockImplementation((key, request, options) => ({
      key,
      request,
      options,
    }));
  });

  it("uses the project-scoped key and strips every extra field", async () => {
    mockApiGet.mockResolvedValue({
      data: [
        {
          id: 42,
          name: "Automation",
          description: "Description",
          data: { secret: true },
          folder_id: "hidden",
          endpoint_name: "hidden",
        },
      ],
    });
    const projectId = "project / alpha";
    const captured = useGetAutomationSummaries(
      { projectId },
      {},
    ) as unknown as CapturedQuery;
    expect(captured.key).toEqual(["automation-summaries", projectId]);
    expect(captured.options.enabled).toBe(true);
    await expect(captured.request()).resolves.toEqual([
      { id: "42", name: "Automation", description: "Description" },
    ]);
    expect(mockApiGet).toHaveBeenCalledWith(
      "/api/v1/flows/?get_all=true&header_flows=true&automation_summaries=true&folder_id=project+%2F+alpha",
    );
  });

  it("normalizes an invalid description and disables empty project input", () => {
    expect(
      mapAutomationSummary({
        id: "flow",
        name: "Automation",
        description: { unsafe: true },
        data: { secret: true },
      }),
    ).toEqual({ id: "flow", name: "Automation", description: null });
    const captured = useGetAutomationSummaries(
      { projectId: "" },
      {},
    ) as unknown as CapturedQuery;
    expect(captured.key).toEqual(["automation-summaries", ""]);
    expect(captured.options.enabled).toBe(false);
  });
});
