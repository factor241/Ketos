import { TextDecoder as NodeTextDecoder } from "node:util";
import i18n from "@/i18n";
import {
  getLocaleHeadersForURL,
  isTrustedApiURL,
  performStreamingRequest,
} from "../api";

describe("locale request header boundary", () => {
  const appOrigin = "https://app.example.test";
  const apiBase = "https://api.example.test/api/v1";

  it.each([
    ["/api/v1/flows", true],
    ["https://app.example.test/api/v1/flows", true],
    ["https://api.example.test/api/v1/flows", true],
    ["https://external.example.test/api/v1/flows", false],
    ["https://api.example.test.attacker.invalid/flows", false],
    ["data:text/plain,hello", false],
  ])(
    "classifies %s against the same/configured API origins",
    (url, expected) => {
      expect(isTrustedApiURL(url, appOrigin, apiBase)).toBe(expected);
    },
  );

  it("normalizes and attaches Accept-Language only to a trusted request", () => {
    expect(
      getLocaleHeadersForURL(
        "https://api.example.test/api/v1/flows",
        "RU-ru",
        appOrigin,
        apiBase,
      ),
    ).toEqual({ "Accept-Language": "ru" });
    expect(
      getLocaleHeadersForURL(
        "https://external.example.test/collect",
        "ru",
        appOrigin,
        apiBase,
      ),
    ).toEqual({});
  });

  it("applies the same boundary to streaming fetch requests", async () => {
    await i18n.changeLanguage("ru-RU");
    const originalTextDecoder = global.TextDecoder;
    Object.defineProperty(global, "TextDecoder", {
      configurable: true,
      value: NodeTextDecoder,
    });
    const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      body: null,
    } as Response);
    const request = (url: string) =>
      performStreamingRequest({
        method: "POST",
        url,
        onData: async () => true,
        buildController: new AbortController(),
      });

    try {
      await request("/api/v1/build");
      await request("https://external.example.test/collect");

      expect(fetchSpy.mock.calls[0][1]?.headers).toEqual(
        expect.objectContaining({ "Accept-Language": "ru" }),
      );
      expect(fetchSpy.mock.calls[1][1]?.headers).not.toEqual(
        expect.objectContaining({ "Accept-Language": expect.any(String) }),
      );
    } finally {
      fetchSpy.mockRestore();
      Object.defineProperty(global, "TextDecoder", {
        configurable: true,
        value: originalTextDecoder,
      });
      await i18n.changeLanguage("en");
    }
  });
});
