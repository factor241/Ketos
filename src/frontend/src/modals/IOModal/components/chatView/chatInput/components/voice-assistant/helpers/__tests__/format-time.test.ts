import { formatTime } from "../format-time";

describe("formatTime", () => {
  it("uses a locale-neutral clock display", () => {
    expect(formatTime(0)).toBe("00:00");
    expect(formatTime(65)).toBe("01:05");
  });
});
