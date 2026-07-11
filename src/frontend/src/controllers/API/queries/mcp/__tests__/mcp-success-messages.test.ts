import { getMcpSuccessMessage } from "../mcp-success-messages";

describe("getMcpSuccessMessage", () => {
  const translate = jest.fn((key: string) => `translated:${key}`);

  beforeEach(() => translate.mockClear());

  it.each([
    ["added", "mcp.servers.addedSuccessfully"],
    ["deleted", "mcp.servers.deletedSuccessfully"],
    ["installed", "mcp.servers.installedSuccessfully"],
    ["updated", "mcp.servers.updatedSuccessfully"],
  ] as const)("localizes the %s success fallback", (action, key) => {
    expect(getMcpSuccessMessage(action, translate)).toBe(`translated:${key}`);
    expect(translate).toHaveBeenCalledWith(key);
  });
});
