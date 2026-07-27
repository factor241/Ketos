import type { Page } from "@playwright/test";
import { TID } from "../constants/testIds";
import { TIMEOUTS } from "../constants/timeouts";

// Single source of truth for the "new project" button selector. Some tests
// historically referenced it via id ([id="new-project-btn"]), others via
// data-testid; centralizing here keeps both call sites in sync if the
// attribute ever changes.
const NEW_PROJECT_BUTTON_SELECTOR = `[id="${TID.newProjectBtn}"]`;
const PROJECT_SIDEBAR_BUTTON_SELECTOR = '[data-testid="add-project-button"]';
const PROJECT_BOARDS_ROUTE = /\/project\/([0-9a-f-]+)\/boards(?:[/?#]|$)/i;

type BoardBootstrapResponse = {
  board: {
    id: string;
    project_id: string;
    revision: number;
  };
  automation: {
    id: string;
    folder_id: string;
  } | null;
  placement: {
    board_id: string;
    target_id: string;
    target_kind: "automation";
  } | null;
};

const openTemplatesModalFromBoards = async (
  page: Page,
  options?: {
    modalTimeout?: number;
  },
) => {
  const match = new URL(page.url()).pathname.match(PROJECT_BOARDS_ROUTE);
  const routeProjectId = match?.[1];
  const projectsResponse = await page.request.get("/api/v1/projects/");
  if (!projectsResponse.ok()) {
    throw new Error(
      `Project lookup failed with ${projectsResponse.status()}: ${await projectsResponse.text()}`,
    );
  }
  const projects = (await projectsResponse.json()) as Array<{ id: string }>;
  let projectId =
    projects.find((project) => project.id === routeProjectId)?.id ??
    projects[0]?.id;
  if (!projectId) {
    const projectResponse = await page.request.post("/api/v1/projects/", {
      data: {
        name: `E2E Project ${crypto.randomUUID().slice(0, 8)}`,
        description: "",
        flows_list: [],
        components_list: [],
      },
    });
    if (!projectResponse.ok()) {
      throw new Error(
        `Project bootstrap failed with ${projectResponse.status()}: ${await projectResponse.text()}`,
      );
    }
    projectId = ((await projectResponse.json()) as { id: string }).id;
  }

  const intentId = crypto.randomUUID();
  const response = await page.request.post(
    `/api/v1/projects/${projectId}/boards/bootstrap`,
    {
      data: {
        title: `E2E bootstrap ${intentId.slice(0, 8)}`,
        starter: {
          kind: "blank_automation",
          name: `E2E flow ${intentId.slice(0, 8)}`,
        },
      },
      headers: {
        "Idempotency-Key": intentId,
      },
    },
  );
  if (!response.ok()) {
    throw new Error(
      `Board bootstrap failed with ${response.status()}: ${await response.text()}`,
    );
  }

  const result = (await response.json()) as BoardBootstrapResponse;
  if (
    result.board.project_id !== projectId ||
    !result.automation?.id ||
    result.automation.folder_id !== projectId ||
    result.placement?.board_id !== result.board.id ||
    result.placement.target_id !== result.automation.id ||
    result.placement.target_kind !== "automation"
  ) {
    throw new Error(
      `Board bootstrap returned an invalid compound result: ${JSON.stringify(result)}`,
    );
  }

  const deleteBoardResponse = await page.request.delete(
    `/api/v1/boards/${result.board.id}?expected_revision=${result.board.revision}`,
  );
  if (deleteBoardResponse.status() !== 204) {
    throw new Error(
      `Temporary Board cleanup failed with ${deleteBoardResponse.status()}: ${await deleteBoardResponse.text()}`,
    );
  }

  await page.goto(`/flow/${result.automation.id}`);
  await page
    .locator("#react-flow-id")
    .waitFor({ state: "visible", timeout: TIMEOUTS.standard });
  await page.evaluate(async (flowId) => {
    // The removed home-page action used useStartNewFlow(), which primed this
    // store before navigating. The canonical Boards fallback creates the same
    // blank placeholder atomically, then reproduces only that test-fixture
    // state transition so the legacy template contract remains observable.
    const modulePath = "/src/stores/flowBuilderWelcomeStore.ts";
    const welcome = (await import(modulePath)) as {
      default: {
        getState: () => {
          open: (openedForFlowId: string) => void;
        };
      };
    };
    welcome.default.getState().open(flowId);
  }, result.automation.id);
  await page
    .getByTestId("flow-builder-welcome-panel")
    .waitFor({ state: "visible", timeout: TIMEOUTS.standard });
  await page.getByTestId("flow-builder-welcome-browse-more").click();
  await page.getByTestId(TID.modalTitle).waitFor({
    state: "visible",
    timeout: options?.modalTimeout ?? TIMEOUTS.standard,
  });
};

/**
 * Waits for the "new project" button on the projects/home page to be ready.
 * Use when a test only needs to confirm the main page has finished loading
 * before reading or interacting with surrounding UI (it does NOT click).
 */
export const waitForNewProjectButton = async (
  page: Page,
  options?: { timeout?: number },
) => {
  await page
    .locator(
      `${NEW_PROJECT_BUTTON_SELECTOR}, ${PROJECT_SIDEBAR_BUTTON_SELECTOR}`,
    )
    .first()
    .waitFor({
      state: "visible",
      timeout: options?.timeout ?? TIMEOUTS.standard,
    });
};

/**
 * Opens the templates modal from the projects page. Encapsulates the post-
 * 1.10 screen flow so future intermediate-screen changes only need to be
 * applied here:
 *   1. wait for the "new project" button,
 *   2. click it — both the header "New Flow" button and the empty-page CTA
 *      now navigate to a fresh flow with the welcome overlay,
 *   3. if the welcome overlay surfaces, click "Browse more templates" to
 *      open the templates modal,
 *   4. wait for the templates modal title to render.
 *
 * Pass `fromEmptyPage: true` when the home page is in its empty state, where
 * the CTA carries the `new_project_btn_empty_page` test id instead of the
 * header `new-project-btn`.
 *
 * Replaces the legacy `page.getByTestId("new-project-btn").click()` pattern
 * that assumed the modal opened directly.
 */
export const openTemplatesModal = async (
  page: Page,
  options?: {
    buttonTimeout?: number;
    modalTimeout?: number;
    fromEmptyPage?: boolean;
  },
) => {
  await waitForNewProjectButton(page, { timeout: options?.buttonTimeout });

  if ((await page.locator(NEW_PROJECT_BUTTON_SELECTOR).count()) === 0) {
    await openTemplatesModalFromBoards(page, options);
    return;
  }

  await page
    .getByTestId(
      options?.fromEmptyPage ? TID.newProjectBtnEmptyPage : TID.newProjectBtn,
    )
    .click();

  // After clicking the header "New Flow" button the app navigates to a
  // freshly-created empty flow and surfaces the FlowBuilderWelcome overlay.
  // On a slow runner the navigation + canvas mount can take well over 5s,
  // so race the welcome overlay against the templates modal — whichever
  // shows up first wins, and we only click "Browse more" when the overlay
  // actually surfaces.
  const welcomeSelector = '[data-testid="flow-builder-welcome-panel"]';
  const modalSelector = `[data-testid="${TID.modalTitle}"]`;

  await Promise.race([
    page.waitForSelector(welcomeSelector, { timeout: TIMEOUTS.standard }),
    page.waitForSelector(modalSelector, { timeout: TIMEOUTS.standard }),
  ]);

  if ((await page.locator(welcomeSelector).count()) > 0) {
    await page.getByTestId("flow-builder-welcome-browse-more").click();
  }

  await page.waitForSelector(modalSelector, {
    timeout: options?.modalTimeout ?? TIMEOUTS.standard,
  });
};
