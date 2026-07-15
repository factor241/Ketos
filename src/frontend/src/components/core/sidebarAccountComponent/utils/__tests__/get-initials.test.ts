import { getInitials } from "../get-initials";

describe("getInitials", () => {
  it.each(["", "   ", "\t\n"])(
    "should return a question mark when the username is empty or whitespace-only",
    (username) => {
      expect(getInitials(username)).toBe("?");
    },
  );

  it("should uppercase a single-character username", () => {
    expect(getInitials("é")).toBe("É");
  });

  it("should use the first two characters of a single-word username", () => {
    expect(getInitials("kirill")).toBe("KI");
  });

  it("should use the first character of words separated by spaces", () => {
    expect(getInitials("john doe")).toBe("JD");
  });

  it("should use the first character of username segments separated by dots", () => {
    expect(getInitials("john.doe")).toBe("JD");
  });

  it("should uppercase Cyrillic initials", () => {
    expect(getInitials("иван петров")).toBe("ИП");
  });

  it("should ignore repeated and mixed separators", () => {
    expect(getInitials("..  john...   doe  ..")).toBe("JD");
  });

  it("should return at most two initials", () => {
    expect(getInitials("john paul jones")).toBe("JP");
  });
});
