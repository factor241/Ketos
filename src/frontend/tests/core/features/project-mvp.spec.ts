import type { Page, Request, Response } from "@playwright/test";
import { expect, test } from "../../fixtures";
import { awaitBootstrapTest } from "../../utils/await-bootstrap-test";

type JsonRecord = Record<string, unknown>;

type RealFlow = {
  id: string;
  folderId: string;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unwrapRecord(value: unknown): JsonRecord {
  if (!isRecord(value)) {
    throw new Error("Expected an object response");
  }

  for (const key of ["data", "project", "folder", "flow"]) {
    if (isRecord(value[key])) return value[key];
  }

  return value;
}

function unwrapRecords(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];

  for (const key of ["data", "items", "flows", "projects"]) {
    if (Array.isArray(value[key])) return value[key].filter(isRecord);
  }

  return [];
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function findRealFlow(page: Page): Promise<RealFlow> {
  const response = await page.request.get("/api/v1/flows/");
  expect(response.ok()).toBeTruthy();

  const flow = unwrapRecords(await response.json()).find(
    (candidate) =>
      asNonEmptyString(candidate.id) !== null &&
      asNonEmptyString(candidate.folder_id) !== null,
  );
  expect(flow, "Bootstrap must persist a real Flow").toBeDefined();

  return {
    id: asNonEmptyString(flow?.id) as string,
    folderId: asNonEmptyString(flow?.folder_id) as string,
  };
}

async function reloadRealFlow(page: Page, flowId: string): Promise<RealFlow> {
  const response = await page.request.get("/api/v1/flows/");
  expect(response.ok()).toBeTruthy();

  const flow = unwrapRecords(await response.json()).find(
    (candidate) => asNonEmptyString(candidate.id) === flowId,
  );
  expect(flow, "The same persisted Flow must remain listed").toBeDefined();

  return {
    id: asNonEmptyString(flow?.id) as string,
    folderId: asNonEmptyString(flow?.folder_id) as string,
  };
}

test("Project shell preserves identity through create, rename, reload, and legacy Flow navigation", async ({
  page,
}) => {
  await awaitBootstrapTest(page, { skipModal: true });

  const boardApiRequests: string[] = [];
  const captureBoardApiRequest = (request: Request) => {
    const pathname = new URL(request.url()).pathname;
    if (/\/api\/v[12]\/boards(?:\/|$)/.test(pathname)) {
      boardApiRequests.push(pathname);
    }
  };
  page.on("request", captureBoardApiRequest);

  const configResponse = await page.request.get("/api/v1/config");
  expect(configResponse.ok()).toBe(true);
  const config = unwrapRecord(await configResponse.json());
  expect(isRecord(config.feature_flags)).toBe(true);
  expect((config.feature_flags as Record<string, unknown>).mvp_workspace).toBe(
    true,
  );

  const existingFlow = await findRealFlow(page);

  let createRequests = 0;
  const countCreateRequests = (response: Response) => {
    const url = new URL(response.url());
    if (
      response.request().method() === "POST" &&
      /^\/api\/v1\/projects\/?$/.test(url.pathname)
    ) {
      createRequests += 1;
    }
  };
  page.on("response", countCreateRequests);

  const [createResponse] = await Promise.all([
    page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === "POST" &&
        /^\/api\/v1\/projects\/?$/.test(url.pathname) &&
        response.ok()
      );
    }),
    page.getByTestId("add-project-button").click(),
  ]);

  const createdProject = unwrapRecord(await createResponse.json());
  const projectId = asNonEmptyString(createdProject.id);
  const originalName = asNonEmptyString(createdProject.name);
  expect(projectId).not.toBeNull();
  expect(originalName).not.toBeNull();
  await expect.poll(() => createRequests).toBe(1);
  page.off("response", countCreateRequests);

  const encodedProjectId = encodeURIComponent(projectId as string);
  await expect(page).toHaveURL(
    new RegExp(`/project/${encodedProjectId}/boards$`),
  );
  await expect(page.getByTestId("project-page")).toHaveCount(1);
  await expect(page.getByTestId("project-title")).toContainText(
    originalName as string,
  );
  await expect(
    page.getByRole("heading", { name: "No boards yet", exact: true }),
  ).toBeVisible();

  const originalRow = page.getByTestId(`sidebar-nav-${originalName as string}`);
  await expect(originalRow).toBeVisible();
  await originalRow.hover();
  await originalRow
    .locator("xpath=..")
    .getByTestId(/^more-options-button_/)
    .click();
  await page.getByTestId("btn-rename-project").click();

  const renamedProject = `Stage 02 ${projectId?.slice(0, 8)}`;
  const renameInput = page.getByTestId("input-project");
  await expect(renameInput).toBeVisible();
  await renameInput.fill(renamedProject);

  let renameRequests = 0;
  const countRenameRequests = (response: Response) => {
    const url = new URL(response.url());
    if (
      response.request().method() === "PATCH" &&
      url.pathname === `/api/v1/projects/${encodedProjectId}`
    ) {
      renameRequests += 1;
    }
  };
  page.on("response", countRenameRequests);

  const [renameResponse] = await Promise.all([
    page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === "PATCH" &&
        url.pathname === `/api/v1/projects/${encodedProjectId}` &&
        response.ok()
      );
    }),
    renameInput.press("Enter"),
  ]);

  const serverProject = unwrapRecord(await renameResponse.json());
  expect(asNonEmptyString(serverProject.id)).toBe(projectId);
  expect(asNonEmptyString(serverProject.name)).toBe(renamedProject);
  await expect.poll(() => renameRequests).toBe(1);
  page.off("response", countRenameRequests);
  await expect(page.getByTestId("project-title")).toContainText(renamedProject);

  await page.reload();
  await expect(page).toHaveURL(
    new RegExp(`/project/${encodedProjectId}/boards$`),
  );
  await expect(page.getByTestId("project-page")).toHaveCount(1);
  await expect(page.getByTestId("project-title")).toContainText(renamedProject);
  await expect(page.getByTestId("project-sidebar")).toHaveCount(1);
  await expect(page.getByTestId("add-project-button")).toHaveCount(1);
  await expect(page.getByTestId("input-project")).toHaveCount(0);
  await page.getByTestId("user_menu_button").click();
  await expect(page.getByTestId("menu_settings_button")).toHaveCount(1);
  await page.keyboard.press("Escape");

  await expect(
    page
      .getByRole("navigation", { name: "Project navigation" })
      .getByRole("link", { name: "Boards" }),
  ).toBeVisible();
  await expect(page.getByTestId("project-flows-link")).toHaveCount(0);

  const persistedFlow = await reloadRealFlow(page, existingFlow.id);
  expect(persistedFlow).toEqual(existingFlow);

  const legacyFlowRoute = `/flow/${encodeURIComponent(
    existingFlow.id,
  )}/folder/${encodeURIComponent(existingFlow.folderId)}`;
  await page.goto(legacyFlowRoute);
  await expect(page).toHaveURL(new RegExp(`${legacyFlowRoute}$`));
  await expect(page.locator("body")).not.toContainText("Something went wrong");
  expect(boardApiRequests).toHaveLength(0);
  page.off("request", captureBoardApiRequest);
});
