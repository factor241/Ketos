import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";

import { expect, test } from "../../fixtures";
import { awaitBootstrapTest } from "../../utils/await-bootstrap-test";
import { TEXTS } from "../../utils/constants/texts";

type Project = { id: string; name: string };
type Flow = { id: string; name: string; folder_id: string };
type BootstrapResult = {
  board: { id: string; revision: number };
  automation: Flow | null;
};

async function readProjects(page: Page): Promise<Project[]> {
  const response = await page.request.get("/api/v1/projects/");
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

async function readProjectFlows(
  page: Page,
  projectId: string,
): Promise<Flow[]> {
  const response = await page.request.get("/api/v1/flows/?get_all=true");
  expect(response.ok(), await response.text()).toBeTruthy();
  const flows = (await response.json()) as Flow[];
  return flows.filter((flow) => flow.folder_id === projectId);
}

async function openProject(page: Page, project: Project) {
  await page.getByTestId(`sidebar-nav-${project.name}`).click();
  await expect(page).toHaveURL(
    new RegExp(`/project/${project.id}/boards(?:[/?#]|$)`),
  );
  await expect(
    page.getByRole("heading", { name: "Boards", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByRole("searchbox", { name: "Search project automations" }),
  ).toBeVisible();
}

async function createProjectFromSidebar(
  page: Page,
  name: string,
): Promise<Project> {
  const createdResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/projects/" &&
      response.status() === 201,
  );
  await page.getByTestId("add-project-button").click();
  const created = (await (await createdResponse).json()) as Project;
  const defaultNav = page.getByTestId(`sidebar-nav-${created.name}`).last();
  await expect(defaultNav).toBeVisible();
  await defaultNav.dblclick();
  const input = page.getByTestId("input-project");
  await expect(input).toBeVisible();
  await input.fill(name);
  const renameResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      new URL(response.url()).pathname === `/api/v1/projects/${created.id}` &&
      response.ok(),
  );
  await input.press("Enter");
  await renameResponse;
  const project = { id: created.id, name };
  await expect(page.getByTestId(`sidebar-nav-${name}`)).toBeVisible();
  return project;
}

async function deleteProjectFromSidebar(page: Page, project: Project) {
  const nav = page.getByTestId(`sidebar-nav-${project.name}`);
  await nav.hover();
  await page.getByTestId(`more-options-button_${project.name}`).click();
  await page.getByTestId("btn-delete-project").click();
  const deleteResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "DELETE" &&
      new URL(response.url()).pathname === `/api/v1/projects/${project.id}` &&
      response.ok(),
  );
  await page.getByText(TEXTS.delete, { exact: true }).last().click();
  await deleteResponse;
  await expect(nav).toHaveCount(0);
}

async function createBlankAutomation(
  page: Page,
  project: Project,
  name: string,
): Promise<BootstrapResult> {
  const idempotencyKey = crypto.randomUUID();
  const response = await page.request.post(
    `/api/v1/projects/${project.id}/boards/bootstrap`,
    {
      data: {
        title: `Move test ${idempotencyKey.slice(0, 8)}`,
        starter: { kind: "blank_automation", name },
      },
      headers: { "Idempotency-Key": idempotencyKey },
    },
  );
  expect(response.status(), await response.text()).toBe(201);
  const result = (await response.json()) as BootstrapResult;
  expect(result.automation?.folder_id).toBe(project.id);
  return result;
}

test(
  "CRUD projects in the canonical workspace",
  { tag: ["@release", "@api"] },
  async ({ page }) => {
    await awaitBootstrapTest(page, { skipModal: true });
    const existing = (await readProjects(page))[0];
    if (existing) await openProject(page, existing);

    const project = await createProjectFromSidebar(
      page,
      `crud-${crypto.randomUUID().slice(0, 8)}`,
    );
    await openProject(page, project);
    await deleteProjectFromSidebar(page, project);
    await expect
      .poll(async () =>
        (await readProjects(page)).some(
          (candidate) => candidate.id === project.id,
        ),
      )
      .toBe(false);
  },
);

test("imports automations into a selected project by file drop", async ({
  page,
}) => {
  await awaitBootstrapTest(page, { skipModal: true });
  const project = await createProjectFromSidebar(
    page,
    `import-${crypto.randomUUID().slice(0, 8)}`,
  );
  await openProject(page, project);

  const jsonContent = readFileSync("tests/assets/collection.json", "utf-8");
  const collection = JSON.parse(jsonContent) as {
    flows: Array<{ name: string }>;
  };
  const beforeIds = new Set(
    (await readProjectFlows(page, project.id)).map((flow) => flow.id),
  );
  const dataTransfer = await page.evaluateHandle((data) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([data], "flowtest.json", { type: "application/json" }),
    );
    return transfer;
  }, jsonContent);
  const uploadResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === "POST" &&
      url.pathname === "/api/v1/flows/upload/" &&
      url.searchParams.get("folder_id") === project.id &&
      response.ok()
    );
  });
  await page.getByTestId(`sidebar-nav-${project.name}`).dispatchEvent("drop", {
    dataTransfer,
  });
  await uploadResponse;

  await expect
    .poll(
      async () =>
        (await readProjectFlows(page, project.id)).filter(
          (flow) => !beforeIds.has(flow.id),
        ).length,
      { timeout: 30_000 },
    )
    .toBe(collection.flows.length);
  const imported = (await readProjectFlows(page, project.id)).filter(
    (flow) => !beforeIds.has(flow.id),
  );
  expect(imported.map((flow) => flow.folder_id)).toEqual(
    imported.map(() => project.id),
  );

  await page.goto(`/project/${project.id}/boards`);
  const inventory = page.getByRole("complementary", { name: "Automations" });
  await expect(inventory).toBeVisible();
  for (const flow of imported) {
    await expect(inventory.getByText(flow.name, { exact: true })).toBeVisible();
  }
});

test("moves an automation between project inventories", async ({ page }) => {
  await awaitBootstrapTest(page, { skipModal: true });
  const source = await createProjectFromSidebar(
    page,
    `source-${crypto.randomUUID().slice(0, 8)}`,
  );
  const destination = await createProjectFromSidebar(
    page,
    `dest-${crypto.randomUUID().slice(0, 8)}`,
  );
  const flowName = `move-${crypto.randomUUID().slice(0, 8)}`;
  const created = await createBlankAutomation(page, source, flowName);
  const automation = created.automation;
  expect(automation).not.toBeNull();

  await openProject(page, source);
  await expect(page.getByText(flowName, { exact: true })).toBeVisible();
  const moveResponse = await page.request.patch(
    `/api/v1/flows/${automation!.id}`,
    { data: { folder_id: destination.id } },
  );
  expect(moveResponse.ok(), await moveResponse.text()).toBeTruthy();
  expect(((await moveResponse.json()) as Flow).folder_id).toBe(destination.id);

  await openProject(page, destination);
  await expect(page.getByText(flowName, { exact: true })).toBeVisible();
  await openProject(page, source);
  await expect(page.getByText(flowName, { exact: true })).toHaveCount(0);
  expect(
    (await readProjectFlows(page, destination.id)).some(
      (flow) => flow.id === automation!.id,
    ),
  ).toBe(true);
});
