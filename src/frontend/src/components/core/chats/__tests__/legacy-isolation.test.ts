import { readFileSync } from "node:fs";
import { join } from "node:path";

const chatSources = [
  join(__dirname, "..", "ChatList.tsx"),
  join(__dirname, "..", "CopilotKitBoardProvider.tsx"),
  join(__dirname, "..", "..", "board", "placements", "ChatPlacement.tsx"),
];

describe("durable Board Chat legacy isolation", () => {
  it.each(chatSources)(
    "keeps %s independent from the legacy Assistant stack",
    (path) => {
      const source = readFileSync(path, "utf8");

      expect(source).not.toMatch(
        /assistantPanel|use-post-assist-stream|use-assistant-chat|apply-flow-update/,
      );
      expect(source).not.toMatch(
        /CopilotChatView|renderToolCalls|renderActivityMessages|renderCustomMessages|ChatComposer|ChatLoadingCard/,
      );
    },
  );

  it("keeps the legacy Assistant transport in its original isolated module", () => {
    const source = readFileSync(
      join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "controllers",
        "API",
        "queries",
        "agentic",
        "use-post-assist-stream.ts",
      ),
      "utf8",
    );

    expect(source).toContain('getURL("AGENTIC_ASSIST_STREAM")');
    expect(source).not.toContain("/api/copilotkit");
  });
});
