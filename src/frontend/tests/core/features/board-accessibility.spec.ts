import type { Page } from "@playwright/test";

import { expect, test } from "../../fixtures";

type Project = { id: string; name: string };
type Board = { id: string; title: string };

async function createProject(page: Page): Promise<Project> {
  const response = await page.request.post("/api/v1/projects/", {
    data: {
      name: `D4 accessibility ${crypto.randomUUID().slice(0, 8)}`,
      description: "",
      flows_list: [],
      components_list: [],
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return response.json();
}

async function createBoard(page: Page, projectId: string): Promise<Board> {
  const response = await page.request.post(
    `/api/v1/projects/${projectId}/boards`,
    { data: { title: "Accessible Board" } },
  );
  expect(response.status(), await response.text()).toBe(201);
  return response.json();
}

async function deleteProject(page: Page, projectId: string) {
  const response = await page.request.delete(`/api/v1/projects/${projectId}`);
  expect([204, 404]).toContain(response.status());
}

async function awaitWorkspaceReady(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("project-sidebar")).toBeVisible();
}

async function openWizardWithKeyboard(page: Page, projectId: string) {
  await page.goto(`/project/${projectId}/boards`);
  const trigger = page.getByRole("button", { name: "Create board" }).first();
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("board-create-dialog")).toBeVisible();
  await expect(page.getByTestId("board-name-input")).toBeFocused();
  return trigger;
}

test(
  "wizard traps focus, announces validation, restores focus, and supports radio keys",
  { tag: ["@release", "@workspace", "@a11y"] },
  async ({ page }) => {
    await awaitWorkspaceReady(page);
    const project = await createProject(page);
    try {
      const trigger = await openWizardWithKeyboard(page, project.id);
      const dialog = page.getByTestId("board-create-dialog");

      await page.keyboard.press("Enter");
      await expect(page.getByRole("alert")).toHaveText("Enter a Board name.");
      await expect(page.getByTestId("board-name-input")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      await expect(page.getByTestId("board-name-input")).toBeFocused();

      await page.getByTestId("board-name-input").fill("Keyboard Board");
      await page.keyboard.press("Tab");
      await expect(page.getByTestId("board-template-clean")).toBeFocused();
      await page.keyboard.press("ArrowRight");
      await expect(
        page.getByTestId("board-template-simple-agent"),
      ).toBeChecked();
      await page.keyboard.press("ArrowRight");
      await expect(
        page.getByTestId("board-template-vector-store-rag"),
      ).toBeChecked();

      for (let index = 0; index < 12; index += 1) {
        await page.keyboard.press("Tab");
        expect(
          await dialog.evaluate((element) =>
            element.contains(document.activeElement),
          ),
        ).toBe(true);
      }

      await expect(page.getByTestId("board-create-submit")).toBeEnabled();
      await expect(dialog).toHaveAttribute("aria-busy", "false");
      const nameInput = page.getByTestId("board-name-input");
      await nameInput.focus();
      await expect(nameInput).toBeFocused();
      await nameInput.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
    } finally {
      await deleteProject(page, project.id);
    }
  },
);

test(
  "project menu and Board picker are keyboard operable with named icon controls",
  { tag: ["@release", "@workspace", "@a11y"] },
  async ({ page }) => {
    await awaitWorkspaceReady(page);
    const project = await createProject(page);
    const board = await createBoard(page, project.id);
    try {
      await page.reload();
      const projectTrigger = page.getByTestId(
        `project-create-menu-trigger-${project.id}`,
      );
      await expect(projectTrigger).toHaveAccessibleName(
        `Create in ${project.name}`,
      );
      await projectTrigger.focus();
      await page.keyboard.press("Enter");
      const boardItem = page.getByTestId(
        `project-create-board-item-${project.id}`,
      );
      const automationItem = page.getByTestId(
        `project-create-automation-item-${project.id}`,
      );
      await expect(boardItem).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(automationItem).toBeFocused();
      await page.keyboard.press("Enter");
      const picker = page.getByTestId("board-picker-dialog");
      await expect(picker).toBeVisible();
      const boardChoice = picker.getByRole("button", { name: board.title });
      await boardChoice.focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(
        new RegExp(`/project/${project.id}/board/${board.id}`),
      );
      const automationPanel = page.getByRole("complementary", {
        name: "Automations",
      });
      await expect(automationPanel).toBeVisible();
      await expect(
        automationPanel.getByRole("button", { name: "Create", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(automationPanel).toBeHidden();
      await expect(
        page.getByRole("button", { name: "Add automation" }),
      ).toBeFocused();

      const chatButton = page.getByRole("button", {
        name: "Create chat in Board",
      });
      await expect(chatButton).toBeVisible();
      await expect(chatButton).toHaveAccessibleName("Create chat in Board");
      await expect(
        page.getByRole("button", { name: "Reset viewport" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Add automation" }),
      ).toBeVisible();
    } finally {
      await deleteProject(page, project.id);
    }
  },
);

test(
  "wizard and Board remain contained at 320, 768, 1440, and 200 percent zoom",
  { tag: ["@release", "@workspace", "@a11y"] },
  async ({ page }) => {
    await awaitWorkspaceReady(page);
    const project = await createProject(page);
    const board = await createBoard(page, project.id);
    try {
      for (const width of [320, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await openWizardWithKeyboard(page, project.id);
        const box = await page.getByTestId("board-create-dialog").boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
        await page.keyboard.press("Escape");
      }

      // Browser zoom reduces the CSS viewport: 768 physical pixels at 200%
      // corresponds to a 384 CSS pixel layout viewport.
      await page.setViewportSize({ width: 384, height: 450 });
      await page.goto(`/project/${project.id}/board/${board.id}`);
      await expect(
        page.getByRole("heading", { name: board.title }),
      ).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
    } finally {
      await deleteProject(page, project.id);
    }
  },
);
