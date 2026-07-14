jest.unmock("react-i18next");

import i18n from "@/i18n";
import {
  compareForPresentation,
  formatCompactNumber,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatRelativeTime,
  getIntlLocale,
} from "../locale-format";
import { convertUTCToLocalTimezone } from "../utils";

describe("locale-format", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("maps the active UI language to its deterministic Intl locale", async () => {
    await i18n.changeLanguage("ru-RU");
    expect(getIntlLocale()).toBe("ru-RU");

    await i18n.changeLanguage("unknown-locale");
    expect(getIntlLocale()).toBe("en-US");
  });

  it("formats Russian dates and date-times with explicit locale data", async () => {
    await i18n.changeLanguage("ru");
    const value = new Date("2025-07-11T15:04:00.000Z");

    expect(
      formatDate(value, {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }),
    ).toMatch(/11 июля 2025/i);
    expect(
      formatDateTime(value, {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
        timeZone: "UTC",
      }),
    ).toContain("15:04");
  });

  it("formats Russian numbers, currencies, durations, and relative time", async () => {
    await i18n.changeLanguage("ru");

    expect(formatNumber(1234.5)).toMatch(/^1\s234,5$/);
    expect(formatCurrency(1234.5, "RUB")).toMatch(/1\s234,50\s₽/);
    expect(formatDuration(3_723_000)).toMatch(/1\sч.*2\sмин.*3\sс/i);
    expect(
      formatRelativeTime(
        new Date("2025-07-09T12:00:00.000Z"),
        new Date("2025-07-11T12:00:00.000Z"),
      ),
    ).toBe("2 дня назад");
  });

  it("formats compact community counts with the active locale", async () => {
    await i18n.changeLanguage("en");
    expect(formatCompactNumber(149_000)).toBe("149K");

    await i18n.changeLanguage("ru");
    expect(formatCompactNumber(149_000)).toMatch(/^149\s*тыс\.$/i);
    expect(formatCompactNumber(undefined)).toBe("0");
  });

  it("updates formatting after a runtime language change", async () => {
    const value = new Date("2025-07-11T12:00:00.000Z");

    await i18n.changeLanguage("ru");
    const russian = formatDate(value, {
      month: "long",
      timeZone: "UTC",
    });

    await i18n.changeLanguage("en");
    const english = formatDate(value, {
      month: "long",
      timeZone: "UTC",
    });

    expect(russian).toBe("июль");
    expect(english).toBe("July");
  });

  it("uses the active locale only for presentation sorting", async () => {
    await i18n.changeLanguage("ru");
    const values = ["Я", "А", "Ё", "Е"];

    expect([...values].sort(compareForPresentation)).toEqual([
      "А",
      "Е",
      "Ё",
      "Я",
    ]);
    expect(values).toEqual(["Я", "А", "Ё", "Е"]);
  });

  it("formats the legacy UTC timestamp entry point with the active locale", async () => {
    const timestamp = "2025-07-11T12:34:56Z";

    await i18n.changeLanguage("en");
    expect(convertUTCToLocalTimezone(timestamp)).toMatch(
      /^07\/11\/2025,? \d{2}:34:56$/,
    );

    await i18n.changeLanguage("ru");
    expect(convertUTCToLocalTimezone(timestamp)).toMatch(
      /^11\.07\.2025,? \d{2}:34:56$/,
    );
  });
});
