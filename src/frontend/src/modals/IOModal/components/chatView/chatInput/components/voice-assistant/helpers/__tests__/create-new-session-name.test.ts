jest.unmock("react-i18next");

import { getSessionTitle } from "@/components/core/playgroundComponent/chat-view/chat-header/utils/get-session-title";
import i18n, { loadLanguage } from "@/i18n";
import {
  createNewSessionName,
  createUniqueSessionId,
} from "../create-new-session-name";

describe("generated session identity and presentation", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2025-07-11T15:04:05.000Z"));
  });

  afterEach(async () => {
    jest.useRealTimers();
    await i18n.changeLanguage("en");
  });

  it("creates a locale-independent machine identifier", () => {
    expect(createNewSessionName()).toBe("lf-session-1752246245000");
  });

  it("increments the machine timestamp until the identifier is unique", () => {
    const existingIds = new Set([
      "lf-session-1752246245000",
      "lf-session-1752246245001",
    ]);

    expect(
      createUniqueSessionId(existingIds, new Date("2025-07-11T15:04:05.000Z")),
    ).toBe("lf-session-1752246245002");
  });

  it("derives a localized display label without changing the identifier", async () => {
    const sessionId = createNewSessionName();
    await loadLanguage("ru");
    await i18n.changeLanguage("ru");

    const label = getSessionTitle(sessionId, "flow-id");

    expect(label).not.toBe(sessionId);
    expect(label).toMatch(/сеанс/i);
    expect(sessionId).toBe("lf-session-1752246245000");
  });

  it("preserves user-renamed and legacy English session identifiers", () => {
    expect(getSessionTitle("Customer demo", "flow-id")).toBe("Customer demo");
    expect(getSessionTitle("Session 11 Jul, 15:04:05", "flow-id")).toBe(
      "Session 11 Jul, 15:04:05",
    );
    expect(getSessionTitle("lf-session-", "flow-id")).toBe("lf-session-");
  });
});
