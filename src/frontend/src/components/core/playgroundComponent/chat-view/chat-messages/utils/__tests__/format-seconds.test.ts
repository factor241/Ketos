import { formatSeconds } from "../format";

const seconds = (value: number) =>
  new Intl.NumberFormat("ru-RU", {
    style: "unit",
    unit: "second",
    unitDisplay: "short",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);

describe("formatSeconds", () => {
  it("should_format_values_under_1000ms_as_seconds", () => {
    expect(formatSeconds(500)).toBe(seconds(0.5));
  });

  it("should_ceil_to_next_tenth_for_fractional_values", () => {
    expect(formatSeconds(500.3)).toBe(seconds(0.6));
  });

  it("should_ceil_to_next_tenth_when_1000ms_or_above", () => {
    // 2113ms → ceil(2.113 * 10) / 10 = ceil(21.13) / 10 = 22 / 10 = 2.2
    expect(formatSeconds(2113)).toBe(seconds(2.2));
  });

  it("should_keep_exact_tenths_unchanged", () => {
    expect(formatSeconds(2100)).toBe(seconds(2.1));
  });

  it("should_ceil_small_fractions_above_a_tenth", () => {
    // 1001ms → ceil(1.001 * 10) / 10 = ceil(10.01) / 10 = 11 / 10 = 1.1
    expect(formatSeconds(1001)).toBe(seconds(1.1));
  });

  it("should_format_values_under_1ms_as_seconds", () => {
    expect(formatSeconds(0.5)).toBe(seconds(0.1));
  });

  it("should_handle_exact_1000ms_boundary", () => {
    expect(formatSeconds(1000)).toBe(seconds(1));
  });

  it("should_handle_zero", () => {
    expect(formatSeconds(0)).toBe(seconds(0));
  });
});
