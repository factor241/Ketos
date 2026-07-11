import type { Page } from "@playwright/test";
import { expect, test } from "../../fixtures";
import { awaitBootstrapTest } from "../../utils/await-bootstrap-test";
import { openTemplatesModal } from "../../utils/flow/new-project-flow";

const RAW_BACKEND_MESSAGE = "RAW_BACKEND_MESSAGE_MUST_NOT_RENDER";
const RAW_TECHNICAL_DETAIL = "PROVIDER_TRACEBACK_MUST_NOT_RENDER";

async function bootstrapToMainPage(page: Page): Promise<void> {
  try {
    await awaitBootstrapTest(page, { skipModal: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const path = new URL(page.url()).pathname;
    const isKnownFreshDatabaseState =
      message.includes('id="new-project-btn"') && path.startsWith("/flow/");

    if (!isKnownFreshDatabaseState) throw error;

    await page.goto("/flows/");
    await expect(page.getByTestId("mainpage_title")).toBeVisible({
      timeout: 30_000,
    });
  }
}

async function selectRussian(page: Page): Promise<void> {
  await page.goto("/settings/language");
  await expect(page.getByTestId("settings-language-page")).toBeVisible({
    timeout: 30_000,
  });

  if ((await page.locator("html").getAttribute("lang")) !== "ru") {
    await page.getByTestId("language-preference-select").click();
    const savedPreference = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        new URL(response.url()).pathname.includes("/api/v1/users/"),
    );
    await page.getByRole("option", { name: "Русский", exact: true }).click();
    expect((await savedPreference).ok()).toBe(true);
    await expect(page.getByTestId("language-preference-select")).toContainText(
      "Русский",
    );
  }

  await expect(page.locator("html")).toHaveAttribute("lang", "ru", {
    timeout: 30_000,
  });
}

test(
  "stable flow error code renders Russian UI without leaking backend diagnostics",
  { tag: ["@release", "@regression", "@api", "@workspace"] },
  async ({ page }) => {
    page.allowFlowErrors();
    await bootstrapToMainPage(page);
    await selectRussian(page);

    await page.goto("/flows/");
    await expect(page.getByTestId("mainpage_title")).toBeVisible({
      timeout: 30_000,
    });
    await openTemplatesModal(page);

    await page.route("**/api/v1/flows/", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }

      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          code: "flows.invalid",
          params: {},
          message: RAW_BACKEND_MESSAGE,
          detail: RAW_BACKEND_MESSAGE,
          technical_detail: RAW_TECHNICAL_DETAIL,
        }),
      });
    });

    const rejectedCreateRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname.endsWith("/api/v1/flows/"),
    );
    await page.getByTestId("blank-flow").click();
    await rejectedCreateRequest;

    const errorAlert = page.locator(".error-build-message").first();
    await expect(errorAlert).toBeVisible({ timeout: 30_000 });
    await expect(errorAlert).toContainText("Ошибка создания сценария");
    await expect(errorAlert).toContainText("Сценарий содержит ошибку.");
    await expect(errorAlert).not.toContainText("The flow is invalid.");

    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toContain(RAW_BACKEND_MESSAGE);
    expect(visibleText).not.toContain(RAW_TECHNICAL_DETAIL);

    const diagnostics = await page.evaluate(
      () => window.__LANGFLOW_I18N_DIAGNOSTICS__?.snapshot() ?? null,
    );
    expect(diagnostics).not.toBeNull();
    expect(diagnostics?.missing).toEqual([]);
    expect(diagnostics?.failedLoading).toEqual([]);
    expect(diagnostics?.fallback).toEqual([]);
  },
);
