/**
 * Tests for assistant panel message helpers.
 *
 * Tests randomized message functions used for reasoning/validation UI states.
 */

import i18n from "@/i18n";
import {
  getRandomPlaceholderMessage,
  getRandomThinkingMessage,
} from "../messages";

describe("getRandomThinkingMessage", () => {
  it("should return a non-empty string ending with an ellipsis", () => {
    const result = getRandomThinkingMessage();

    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
    expect(result).toMatch(/(?:\.\.\.|…)$/);
  });
});

describe("getRandomPlaceholderMessage", () => {
  it("should return from a different pool than thinking messages", () => {
    const spy = jest.spyOn(Math, "random").mockReturnValue(0);
    const thinking = getRandomThinkingMessage();
    const placeholder = getRandomPlaceholderMessage();
    spy.mockRestore();

    // Placeholder messages are descriptive progress messages,
    // not the generic "Thinking..." headers
    expect(placeholder).not.toBe(thinking);
  });

  it("should_return_descriptive_progress_message_when_used_as_placeholder", () => {
    // Bug: getRandomPlaceholderMessage() returns from REASONING_HEADER_MESSAGES
    // ("Thinking...", "Processing...") instead of descriptive progress messages.
    // Placeholder messages should describe what the assistant is doing,
    // not generic "Thinking..." headers.
    const thinkingKeys = [
      "assistant.thinking.0",
      "assistant.thinking.1",
      "assistant.thinking.2",
      "assistant.thinking.3",
      "assistant.thinking.4",
      "assistant.thinking.5",
      "assistant.thinking.6",
      "assistant.thinking.7",
    ] as const;
    const headerMessages = thinkingKeys.map((key) => i18n.t(key));

    // Sample with deterministic Math.random to get the first message
    const spy = jest.spyOn(Math, "random").mockReturnValue(0);
    const firstPlaceholder = getRandomPlaceholderMessage();
    spy.mockRestore();

    // The first placeholder message must NOT be one of the generic headers
    expect(headerMessages).not.toContain(firstPlaceholder);
    // It should be a descriptive progress message (longer, more specific)
    expect(firstPlaceholder.length).toBeGreaterThan(15);
  });
});

describe("deterministic Math.random", () => {
  it("should return first element when Math.random is 0", () => {
    const spy = jest.spyOn(Math, "random").mockReturnValue(0);
    const result = getRandomThinkingMessage();
    spy.mockRestore();

    // Math.floor(0 * 8) = 0 → first localized element
    expect(result).toBe(i18n.t("assistant.thinking.0"));
  });

  it("should return last element when Math.random is 0.999", () => {
    const spy = jest.spyOn(Math, "random").mockReturnValue(0.999);
    const result = getRandomThinkingMessage();
    spy.mockRestore();

    // Math.floor(0.999 * 8) = Math.floor(7.992) = 7 → last localized element
    expect(result).toBe(i18n.t("assistant.thinking.7"));
  });
});
