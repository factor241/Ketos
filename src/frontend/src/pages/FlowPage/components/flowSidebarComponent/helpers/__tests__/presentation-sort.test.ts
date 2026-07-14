const mockCompareForPresentation = jest.fn(
  (_left: string, _right: string) => 37,
);

jest.mock("@/utils/locale-format", () => ({
  compareForPresentation: (left: string, right: string) =>
    mockCompareForPresentation(left, right),
}));

import sortFields from "@/CustomNodes/utils/sort-fields";
import sensitiveSort from "../sensitive-sort";

describe("canvas presentation sorting", () => {
  beforeEach(() => {
    mockCompareForPresentation.mockClear();
  });

  it("uses the active-locale collator for sidebar labels", () => {
    expect(sensitiveSort("Ёж", "Ель")).toBe(37);
    expect(mockCompareForPresentation).toHaveBeenCalledWith("Ёж", "Ель");
  });

  it("keeps numeric suffix ordering stable after locale-aware name matching", () => {
    expect(sensitiveSort("Модель (2)", "Модель (10)")).toBe(-8);
    expect(mockCompareForPresentation).not.toHaveBeenCalled();
  });

  it("uses the active-locale collator for non-priority component fields", () => {
    expect(sortFields("ёж", "ель", [])).toBe(37);
    expect(mockCompareForPresentation).toHaveBeenCalledWith("ёж", "ель");
  });
});
