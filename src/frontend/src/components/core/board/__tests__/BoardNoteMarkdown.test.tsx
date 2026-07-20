import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

import { BoardNoteLink } from "@/components/core/sanitizedMarkdown";
import { boardNoteSanitizeSchema } from "@/utils/sanitizeSchema";
import { BoardNoteMarkdown } from "../BoardNoteMarkdown";

jest.mock("react-markdown", () => ({
  __esModule: true,
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
jest.mock("rehype-mathjax/browser", () => () => undefined);
jest.mock("rehype-raw", () => () => undefined);
jest.mock("rehype-sanitize", () => () => undefined);
jest.mock("remark-gfm", () => () => undefined);
jest.mock("@/components/core/codeTabsComponent", () => () => null);

describe("BoardNoteMarkdown", () => {
  it("uses a minimal schema without script, media, or code", () => {
    expect(boardNoteSanitizeSchema.tagNames).toEqual([
      "p",
      "strong",
      "ul",
      "ol",
      "li",
      "a",
    ]);
    expect(boardNoteSanitizeSchema.protocols?.href).toEqual([
      "http",
      "https",
      "mailto",
    ]);
    expect(boardNoteSanitizeSchema.strip).toEqual(["script", "style"]);
  });

  it("hardens external links and degrades unsafe links to text", () => {
    render(<BoardNoteLink href="https://example.com">safe</BoardNoteLink>);
    expect(screen.getByRole("link", { name: "safe" })).toHaveAttribute(
      "target",
      "_blank",
    );
    expect(screen.getByRole("link", { name: "safe" })).toHaveAttribute(
      "rel",
      "noopener noreferrer",
    );
    render(<BoardNoteLink href="javascript:alert(1)">unsafe</BoardNoteLink>);
    expect(screen.queryByRole("link", { name: "unsafe" })).toBeNull();
    render(<BoardNoteLink href="#part">local</BoardNoteLink>);
    expect(screen.getByRole("link", { name: "local" })).toHaveAttribute(
      "href",
      "#part",
    );
  });

  it("forwards note content through the dedicated profile", () => {
    render(<BoardNoteMarkdown content="**draft**" />);
    expect(screen.getByText("**draft**")).toBeInTheDocument();
  });
});
