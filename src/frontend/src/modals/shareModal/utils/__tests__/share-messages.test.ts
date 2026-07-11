import { getShareErrorTitle } from "../share-messages";

describe("getShareErrorTitle", () => {
  const translate = jest.fn((key: string) => `translated:${key}`);

  beforeEach(() => translate.mockClear());

  it("uses a complete localized component error sentence", () => {
    expect(getShareErrorTitle(true, translate)).toBe(
      "translated:share.errorSharingComponent",
    );
  });

  it("uses a complete localized flow error sentence", () => {
    expect(getShareErrorTitle(false, translate)).toBe(
      "translated:share.errorSharingFlow",
    );
  });
});
