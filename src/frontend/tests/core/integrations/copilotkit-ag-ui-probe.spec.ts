import type { Page, Request } from "@playwright/test";
import { expect, test } from "../../fixtures";
import { awaitBootstrapTest } from "../../utils/await-bootstrap-test";

type ResumeDecision = Readonly<{
  interruptId: string;
  status: string;
  payload: Readonly<{ approved: boolean }>;
}>;

type RunBody = Readonly<{
  threadId: string;
  runId: string;
  resume?: ResumeDecision[];
}>;

const isProbeRun = (request: Request) =>
  request.method() === "POST" &&
  request.url().includes("/api/copilotkit/agent/ketos-mvp-probe/run");

async function openProbe(page: Page) {
  await awaitBootstrapTest(page, { skipModal: true });
  await page.goto("/mvp/copilotkit-probe");
  await expect(page.getByTestId("mvp-copilotkit-probe-page")).toBeVisible({
    timeout: 30_000,
  });
}

async function startProbe(page: Page, prompt: string) {
  await page.getByTestId("copilot-chat-textarea").fill(prompt);
  const initialRequest = page.waitForRequest(isProbeRun);
  const initialResponse = page.waitForResponse((response) =>
    isProbeRun(response.request()),
  );
  await page.getByTestId("copilot-send-button").click();
  const request = await initialRequest;
  const response = await initialResponse;
  const responseText = await response.text();
  expect(response.status()).toBe(200);
  expect(responseText).toMatch(/"type"\s*:\s*"interrupt"/);
  const cards = page.getByRole("region", { name: /^Approval request / });
  await expect(cards).toHaveCount(2);
  return { cards, request, body: request.postDataJSON() as RunBody };
}

function interruptIdFromLabel(label: string | null): string {
  expect(label).toMatch(/^Approval request .+/);
  return label?.replace(/^Approval request /, "") ?? "";
}

async function resolveBoth(page: Page, approved: boolean) {
  const cards = page.getByRole("region", { name: /^Approval request / });
  const ids = [
    interruptIdFromLabel(await cards.nth(0).getAttribute("aria-label")),
    interruptIdFromLabel(await cards.nth(1).getAttribute("aria-label")),
  ];
  expect(new Set(ids).size).toBe(2);

  const resumeRequestPromise = page.waitForRequest(isProbeRun);
  const resumeResponsePromise = page.waitForResponse((response) =>
    isProbeRun(response.request()),
  );
  const firstDecision = cards.nth(0).getByRole("button", {
    name: new RegExp(`^${approved ? "Approve" : "Reject"} `),
  });
  await firstDecision.dblclick();
  await cards
    .nth(1)
    .getByRole("button", {
      name: new RegExp(`^${approved ? "Approve" : "Reject"} `),
    })
    .click();

  const resumeRequest = await resumeRequestPromise;
  const resumeResponse = await resumeResponsePromise;
  await expect(cards).toHaveCount(0);
  const body = resumeRequest.postDataJSON() as RunBody;
  expect(body.resume).toHaveLength(2);
  expect(body.resume?.map((entry) => entry.interruptId).sort()).toEqual(
    ids.sort(),
  );
  expect(body.resume?.every((entry) => entry.status === "resolved")).toBe(true);
  expect(
    body.resume?.every((entry) => entry.payload.approved === approved),
  ).toBe(true);
  const responseText = await resumeResponse.text();
  expect(responseText).toMatch(/"effect_count"\s*:\s*1/);
  expect(responseText).toMatch(
    new RegExp(
      `"final_decision"\\s*:\\s*"${approved ? "approved" : "rejected"}"`,
    ),
  );
  return { body, responseText };
}

test.describe("Stage 01 CopilotKit AG-UI probe", () => {
  test(
    "completes a fresh all-approve run once and prevents replay after reload",
    { tag: ["@release", "@api", "@regression"] },
    async ({ page }) => {
      await openProbe(page);
      const initial = await startProbe(page, "Run fresh all-approve");
      const resumed = await resolveBoth(page, true);

      expect(resumed.body.threadId).toBe(initial.body.threadId);
      expect(resumed.body.runId).not.toBe(initial.body.runId);

      await page.reload();
      await expect(page.getByTestId("mvp-copilotkit-probe-page")).toBeVisible();
      await expect(
        page.getByRole("region", { name: /^Approval request / }),
      ).toHaveCount(0);

      const postReload = await startProbe(
        page,
        "Run after reload with access cookie",
      );
      const postReloadHeaders = await postReload.request.allHeaders();
      expect(postReloadHeaders.authorization).toBeUndefined();
      expect(postReloadHeaders.cookie).toContain("access_token_lf=");
      expect(postReload.body.threadId).not.toBe(initial.body.threadId);
      await resolveBoth(page, true);
    },
  );

  test(
    "completes a separate fresh all-reject run exactly once",
    { tag: ["@release", "@api", "@regression"] },
    async ({ page }) => {
      await openProbe(page);
      const initial = await startProbe(page, "Run fresh all-reject");
      const resumed = await resolveBoth(page, false);

      expect(resumed.body.threadId).toBe(initial.body.threadId);
      expect(resumed.body.runId).not.toBe(initial.body.runId);
    },
  );

  test(
    "close and Escape cancel cards without sending a resume or rejection",
    { tag: ["@release", "@api", "@regression"] },
    async ({ page }) => {
      await openProbe(page);
      let runRequests = 0;
      page.on("request", (request) => {
        if (isProbeRun(request)) runRequests += 1;
      });
      const { cards } = await startProbe(page, "Run cancel-only story");
      await expect.poll(() => runRequests).toBe(1);

      await cards
        .nth(0)
        .getByRole("button", { name: /^Close approval request / })
        .click();
      await cards.nth(1).focus();
      await cards.nth(1).press("Escape");

      await expect(
        page.getByRole("button", { name: /^Reopen approval request / }),
      ).toHaveCount(2);
      const unexpectedResume = await page
        .waitForRequest(isProbeRun, { timeout: 500 })
        .then(() => true)
        .catch(() => false);
      expect(unexpectedResume).toBe(false);
      expect(runRequests).toBe(1);
    },
  );

  test(
    "keeps the legacy flow route owned by the existing application router",
    { tag: ["@release", "@workspace", "@regression"] },
    async ({ page }) => {
      await awaitBootstrapTest(page, { skipModal: true });
      await page.getByText("Basic Prompting", { exact: true }).click();

      await expect(page).toHaveURL(/\/flow\/[^/]+/);
      await expect(page.locator("#react-flow-id")).toBeVisible({
        timeout: 30_000,
      });
    },
  );
});
