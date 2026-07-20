import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { AGENT_ID, COPILOT_PATH, UPSTREAM_URL } from "../server.js";

const serverPath = fileURLToPath(new URL("../server.ts", import.meta.url));

describe("ketos-chat runtime boundary", () => {
	it("exports the fixed public contract", () => {
		expect(AGENT_ID).toBe("ketos-chat");
		expect(COPILOT_PATH).toBe("/api/copilotkit");
		expect(UPSTREAM_URL).toBe(
			"http://127.0.0.1:7860/api/v1/agentic/ag-ui",
		);
	});

	it("remains a thin fixed HttpAgent transport", async () => {
		const source = await readFile(serverPath, "utf8");

		expect(source).toContain("new HttpAgent(");
		expect(source).toContain(
			'"http://127.0.0.1:7860/api/v1/agentic/ag-ui"',
		);
		expect(source).not.toMatch(
			/\b(?:db|database|prisma|sqlalchemy|kfx|modelRouter|toolRouter|tools?|mcp|businessLogic)\b/i,
		);
		expect(source).not.toMatch(
			/process\.env(?:\[[^\]]+\]|\.(?:AGENT_ID|COPILOT_PATH|UPSTREAM_URL|TARGET|BROWSER_TARGET))|(?:window|document)\.location|localStorage|sessionStorage|searchParams/,
		);
	});
});
