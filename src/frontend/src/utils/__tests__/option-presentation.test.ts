import {
  findOptionIndex,
  getOptionLabel,
  getOptionMetadata,
} from "../option-presentation";

describe("option presentation metadata", () => {
  it("uses a localized label while preserving a string machine value", () => {
    const options = ["fast", "accurate"];
    const metadata = [
      { value: "fast", label: "Быстро" },
      { value: "accurate", label: "Точно" },
    ];

    expect(getOptionLabel("accurate", options, metadata)).toBe("Точно");
    expect(options[1]).toBe("accurate");
  });

  it("matches explicit stable values even when metadata order differs", () => {
    const options = ["fast", "accurate"];
    const metadata = [
      { value: "accurate", label: "Точно" },
      { value: "fast", label: "Быстро" },
    ];

    expect(getOptionMetadata("fast", options, metadata)).toEqual({
      value: "fast",
      label: "Быстро",
    });
  });

  it("renders an object option label without mutating the raw object", () => {
    const option = { id: "provider-1", name: "OpenAI", link: "stable" };
    const options = [option];
    const metadata = [{ label: "OpenAI — провайдер" }];

    expect(getOptionLabel(option, options, metadata)).toBe(
      "OpenAI — провайдер",
    );
    expect(option).toEqual({
      id: "provider-1",
      name: "OpenAI",
      link: "stable",
    });
  });

  it("finds a reloaded object option by stable id and falls back to raw name", () => {
    const options = [{ id: "provider-1", name: "OpenAI" }];
    const reloadedSelection = { id: "provider-1", name: "Custom label" };

    expect(findOptionIndex(reloadedSelection, options)).toBe(0);
    expect(getOptionLabel(reloadedSelection, [], [])).toBe("Custom label");
  });
});
