import type { Page } from "@playwright/test";

import { expect, test } from "../../fixtures";
import { awaitBootstrapTest } from "../../utils/await-bootstrap-test";

type JsonRecord = Record<string, unknown>;
type BoardRead = {
  id: string;
  project_id: string;
  revision: number;
  title: string;
  viewport_x: number;
  viewport_y: number;
  viewport_zoom: number;
};

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function records(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];
  for (const key of ["data", "items", "flows"]) {
    if (Array.isArray(value[key])) return value[key].filter(isRecord);
  }
  return [];
}

async function createProject(page: Page): Promise<{ id: string }> {
  const uniquePrefix = Date.now().toString(36);
  const response = await page.request.post("/api/v1/projects/", {
    data: {
      // The MCP server slug is length-limited, so uniqueness must come first.
      name: `S03 ${uniquePrefix} viewport`,
      description: "",
      flows_list: [],
      components_list: [],
    },
  });
  if (!response.ok()) {
    throw new Error(
      `Project creation failed: ${response.status()} ${await response.text()}`,
    );
  }
  return response.json();
}

async function createBoard(
  page: Page,
  projectId: string,
  title: string,
): Promise<BoardRead> {
  const response = await page.request.post(
    `/api/v1/projects/${projectId}/boards`,
    { data: { title } },
  );
  if (!response.ok()) {
    throw new Error(
      `Board creation failed: ${response.status()} ${await response.text()}`,
    );
  }
  return response.json();
}

async function getBoard(page: Page, boardId: string): Promise<BoardRead> {
  const response = await page.request.get(`/api/v1/boards/${boardId}`);
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function putViewport(
  page: Page,
  boardId: string,
  viewport: { x: number; y: number; zoom: number },
  expectedRevision: number,
): Promise<BoardRead> {
  const response = await page.request.put(
    `/api/v1/boards/${boardId}/viewport`,
    { data: { ...viewport, expected_revision: expectedRevision } },
  );
  if (!response.ok()) {
    throw new Error(
      `Viewport update failed: ${response.status()} ${await response.text()}`,
    );
  }
  return response.json();
}

async function renderedViewport(page: Page) {
  return page.locator(".react-flow__viewport").evaluate((element) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return { x: matrix.e, y: matrix.f, zoom: matrix.a };
  });
}

async function expectRenderedViewportClose(
  page: Page,
  expected: { x: number; y: number; zoom: number },
) {
  await expect
    .poll(async () => {
      const actual = await renderedViewport(page);
      return {
        x: Math.abs(actual.x - expected.x) <= 1e-6,
        y: Math.abs(actual.y - expected.y) <= 1e-6,
        zoom: Math.abs(actual.zoom - expected.zoom) <= 1e-6,
      };
    })
    .toEqual({ x: true, y: true, zoom: true });
}

test(
  "persists one board viewport independently across reloads",
  { tag: ["@release", "@workspace", "@api", "@database"] },
  async ({ page }) => {
    await awaitBootstrapTest(page, { skipModal: true });

    const configResponse = await page.request.get("/api/v1/config");
    expect(configResponse.ok()).toBeTruthy();
    const config = (await configResponse.json()) as JsonRecord;
    expect(isRecord(config.feature_flags)).toBe(true);
    expect((config.feature_flags as JsonRecord).mvp_workspace).toBe(true);

    const project = await createProject(page);
    const first = await createBoard(page, project.id, "Viewport board");
    const second = await createBoard(page, project.id, "Independent board");
    expect([
      second.viewport_x,
      second.viewport_y,
      second.viewport_zoom,
    ]).toEqual([0, 0, 1]);

    await page.goto(`/project/${project.id}/boards`);
    await page.getByRole("button", { name: `Rename ${first.title}` }).click();
    const renameDialog = page.getByRole("dialog", { name: "Rename board" });
    await renameDialog.getByLabel("Board title").fill("Renamed viewport board");
    await renameDialog.getByRole("button", { name: "Save name" }).click();
    await expect(page.getByText("Renamed viewport board")).toBeVisible();
    const secondAfterRename = await getBoard(page, second.id);
    expect(secondAfterRename).toMatchObject(second);

    await page.getByRole("link", { name: "Renamed viewport board" }).click();
    await expect(
      page.getByRole("heading", { name: "Renamed viewport board" }),
    ).toBeVisible();
    await expect(page.locator(".react-flow__background")).toBeVisible();
    await expect(page.locator(".react-flow__minimap")).toBeVisible();
    await expect(page.locator(".react-flow__controls")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Reset viewport" }),
    ).toBeVisible();

    const entryButton = page.getByRole("button", { name: "Open canvas" });
    await entryButton.click();
    const canvas = page.getByRole("region", { name: "Board canvas" });
    await expect(canvas).toBeFocused();

    const viewportWrite = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        new URL(response.url()).pathname ===
          `/api/v1/boards/${first.id}/viewport` &&
        response.ok(),
    );
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Shift+ArrowDown");
    await page.keyboard.press("=");
    await viewportWrite;
    await page.keyboard.press("Escape");
    await expect(entryButton).toBeFocused();

    await entryButton.click();
    const pane = page.locator(".react-flow__pane");
    const paneBox = await pane.boundingBox();
    expect(paneBox).not.toBeNull();
    const pointerWrite = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        new URL(response.url()).pathname ===
          `/api/v1/boards/${first.id}/viewport` &&
        response.ok(),
    );
    await page.mouse.move(
      (paneBox as NonNullable<typeof paneBox>).x + 300,
      (paneBox as NonNullable<typeof paneBox>).y + 220,
    );
    await page.mouse.down();
    await page.mouse.move(
      (paneBox as NonNullable<typeof paneBox>).x + 350,
      (paneBox as NonNullable<typeof paneBox>).y + 260,
      { steps: 5 },
    );
    await page.mouse.up();
    await pointerWrite;

    const beforeReload = await getBoard(page, first.id);
    expect(beforeReload.revision).toBeGreaterThan(first.revision);
    expect([
      beforeReload.viewport_x,
      beforeReload.viewport_y,
      beforeReload.viewport_zoom,
    ]).not.toEqual([0, 0, 1]);

    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Renamed viewport board" }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Board canvas" }),
    ).toBeVisible();
    await expectRenderedViewportClose(page, {
      x: beforeReload.viewport_x,
      y: beforeReload.viewport_y,
      zoom: beforeReload.viewport_zoom,
    });

    const afterReload = await getBoard(page, first.id);
    expect(afterReload).toMatchObject(beforeReload);
    const independent = await getBoard(page, second.id);
    expect([
      independent.viewport_x,
      independent.viewport_y,
      independent.viewport_zoom,
    ]).toEqual([0, 0, 1]);

    await page.goto(`/project/${project.id}/board/${second.id}`);
    await expect(
      page.getByRole("heading", { name: second.title }),
    ).toBeVisible();
    await expectRenderedViewportClose(page, { x: 0, y: 0, zoom: 1 });

    await page.goto(`/project/${project.id}/board/${first.id}`);
    await expect(
      page.getByRole("heading", { name: "Renamed viewport board" }),
    ).toBeVisible();
    const staleBase = await getBoard(page, first.id);
    const winner = await putViewport(
      page,
      first.id,
      { x: 90, y: 110, zoom: 1.2 },
      staleBase.revision,
    );
    await page.getByRole("button", { name: "Open canvas" }).click();
    const conflictWrite = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        new URL(response.url()).pathname ===
          `/api/v1/boards/${first.id}/viewport` &&
        response.status() === 409,
    );
    await page.keyboard.press("ArrowLeft");
    await conflictWrite;
    await expect(page.getByRole("alert")).toContainText(
      "The server version replaced this change.",
    );
    await expectRenderedViewportClose(page, {
      x: winner.viewport_x,
      y: winner.viewport_y,
      zoom: winner.viewport_zoom,
    });

    const flushedWrite = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        new URL(response.url()).pathname ===
          `/api/v1/boards/${first.id}/viewport` &&
        response.ok(),
    );
    await page.keyboard.press("ArrowDown");
    await page.getByRole("link", { name: "Back to boards" }).click();
    await flushedWrite;
    const flushed = await getBoard(page, first.id);
    expect(flushed.viewport_y).not.toBe(winner.viewport_y);

    const flowsResponse = await page.request.get("/api/v1/flows/");
    expect(flowsResponse.ok()).toBeTruthy();
    const flowId = records(await flowsResponse.json())[0]?.id;
    expect(typeof flowId).toBe("string");
    await page.goto(`/flow/${flowId as string}`);
    await expect(page).toHaveURL(new RegExp(`/flow/${flowId as string}/?$`));
    await expect(page.locator("body")).not.toContainText(
      "Something went wrong",
    );
  },
);
