import type { Page } from "@playwright/test";
import { addFlowToTestOnEmptyKetos } from "./add-flow-to-test-on-empty-ketos";
import {
  openTemplatesModal,
  waitForNewProjectButton,
} from "./flow/new-project-flow";

export const awaitBootstrapTest = async (
  page: Page,
  options?: {
    skipGoto?: boolean;
    skipModal?: boolean;
  },
) => {
  if (!options?.skipGoto) {
    await page.goto("/");
  }

  await page
    .locator('[data-testid="mainpage_title"], [data-testid="project-sidebar"]')
    .first()
    .waitFor({ state: "visible", timeout: 30000 });

  const countEmptyButton = await page
    .getByTestId("new_project_btn_empty_page")
    .count();
  if (countEmptyButton > 0) {
    await addFlowToTestOnEmptyKetos(page);
  }

  await waitForNewProjectButton(page);

  if (!options?.skipModal) {
    const modalTitle = page.getByTestId("modal-title");
    if (!(await modalTitle.isVisible())) {
      await openTemplatesModal(page);
    }
    await modalTitle.waitFor({ state: "visible", timeout: 30000 });
  }
};
