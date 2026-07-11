const mockTranslate = jest.fn(
  (_key: string, { suffix }: { suffix: string }) => `Группа ${suffix}`,
);

jest.mock("@/i18n", () => ({
  __esModule: true,
  default: {
    t: (...args: [string, { suffix: string }]) => mockTranslate(...args),
  },
}));

jest.mock("@/utils/reactflowUtils", () => ({
  getRandomElement: jest
    .fn()
    .mockReturnValueOnce("admiring")
    .mockReturnValueOnce("turing"),
}));

import getRandomName from "../get-random-name";

describe("localized random group names", () => {
  it("localizes the generated presentation name", () => {
    jest.spyOn(Math, "random").mockReturnValueOnce(0.0042);

    expect(getRandomName()).toBe("Группа 0042");
    expect(mockTranslate).toHaveBeenCalledWith("flow.groupDefaultName", {
      suffix: "0042",
    });
  });

  it("keeps the no-space technical slug independent from the display locale", () => {
    expect(getRandomName(0, true)).toBe("admiring_turing");
  });
});
