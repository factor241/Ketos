jest.unmock("react-i18next");

import i18n from "@/i18n";
import sortByName from "../sort-by-name";

describe("sortByName", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("uses the active presentation locale", async () => {
    await i18n.changeLanguage("en");
    expect(sortByName(["А", "A"])).toEqual(["A", "А"]);

    await i18n.changeLanguage("ru");
    expect(sortByName(["А", "A"])).toEqual(["А", "A"]);
  });
});
