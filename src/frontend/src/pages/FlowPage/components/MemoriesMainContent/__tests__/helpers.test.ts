import { getIntlLocale } from "@/utils/locale-format";
import { formatDate, formatTimestamp } from "../helpers";

describe("Memories helpers", () => {
  it("returns fallback values for empty dates", () => {
    expect(formatDate()).toBe("Never");
    expect(formatTimestamp()).toBe("-");
  });

  it("returns original value for invalid date strings", () => {
    expect(formatDate("not-a-date")).toBe("not-a-date");
    expect(formatTimestamp("also-not-a-date")).toBe("also-not-a-date");
  });

  it("formats valid dates", () => {
    const value = new Date("2025-01-15T10:30:00.000Z");
    const date = formatDate(value.toISOString());
    const timestamp = formatTimestamp("2025-01-15   10:30:00Z");
    const expectedDate = new Intl.DateTimeFormat(getIntlLocale(), {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(value);
    const expectedTimestamp = new Intl.DateTimeFormat(getIntlLocale(), {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(value);

    expect(date).toBe(expectedDate);
    expect(timestamp).toBe(expectedTimestamp);
  });
});
