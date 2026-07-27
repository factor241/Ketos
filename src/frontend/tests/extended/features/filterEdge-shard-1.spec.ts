import type { Locator } from "@playwright/test";

import { expect, test } from "../../fixtures";
import { adjustScreenView } from "../../utils/adjust-screen-view";
import { awaitBootstrapTest } from "../../utils/await-bootstrap-test";
import { enableOptionalComponents } from "../../utils/enable-optional-components";

async function findVisibleElement(
  elements: Locator[],
): Promise<Locator | undefined> {
  for (const element of elements) {
    if (await element.isVisible()) {
      return element;
    }
  }
  return undefined;
}

test(
  "user must see on handle click the possibility connections - RetrievalQA",
  { tag: ["@release", "@api", "@components"] },
  async ({ page }) => {
    await awaitBootstrapTest(page);

    await page.getByTestId("blank-flow").click();

    await page.waitForSelector('[data-testid="sidebar-options-trigger"]', {
      timeout: 3000,
    });

    await enableOptionalComponents(page);

    const componentSearch = page.getByTestId("sidebar-search-input");
    await componentSearch.click();
    await componentSearch.fill("retrievalqa");

    await page.waitForSelector(
      '[data-testid="langchain_utilitiesRetrieval QA"]',
      {
        timeout: 3000,
      },
    );
    await page
      .getByTestId("langchain_utilitiesRetrieval QA")
      .dragTo(page.locator('//*[@id="react-flow-id"]'));
    await page.mouse.up();
    await page.mouse.down();

    await adjustScreenView(page);
    await componentSearch.fill("");
    await expect(componentSearch).toHaveValue("");
    await expect(page.getByTestId("disclosure-input & output")).toBeVisible({
      timeout: 15_000,
    });

    const outputElements = await page
      .getByTestId("handle-retrievalqa-shownode-text-right")
      .all();

    let visibleElementHandle = await findVisibleElement(outputElements);
    if (!visibleElementHandle) {
      throw new Error("Output handle not visible");
    }

    await visibleElementHandle.dispatchEvent("click");

    const disclosureTestIds = [
      "disclosure-input & output",
      "disclosure-data sources",
      "disclosure-models & agents",
      "disclosure-llm operations",
      "disclosure-files & knowledge",
      "disclosure-processing",
      "disclosure-flow control",
      "disclosure-utilities",
      "disclosure-bundles-langchain",
      "disclosure-bundles-assemblyai",
      "disclosure-bundles-datastax",
    ];

    const elementTestIds = [
      "input_outputChat Output",
      "data_sourceAPI Request",
      "langchain_utilitiesTool Calling Agent",
      "langchain_utilitiesConversationChain",
      "mem0Mem0 Chat Memory",
      "flow_controlsCondition",
      "langchain_utilitiesSelf Query Retriever",
      "langchain_utilitiesCharacter Text Splitter",
    ];

    await Promise.all(
      disclosureTestIds.map((id) =>
        expect(page.getByTestId(id)).toBeVisible({ timeout: 15_000 }),
      ),
    );

    await Promise.all(
      elementTestIds.map((id) =>
        expect(page.getByTestId(id).first()).toBeVisible({ timeout: 15_000 }),
      ),
    );

    await page.getByTestId("sidebar-search-input").click();

    const visibleModelSpecsTestIds = [
      "cohereCohere Language Models",
      "groqGroq",
      "lmstudioLM Studio",
      "maritalkMariTalk",
      "perplexityPerplexity",
      "baiduQianfan",
      "sambanovaSambaNova",
      "xaixAI",
    ];

    await Promise.all(
      visibleModelSpecsTestIds.map((id) =>
        expect(page.getByTestId(id)).toBeVisible({ timeout: 15_000 }),
      ),
    );

    const chainInputElements1 = await page
      .getByTestId("handle-retrievalqa-shownode-llm-left")
      .all();

    const llmHandle = await findVisibleElement(chainInputElements1);
    if (llmHandle) {
      visibleElementHandle = llmHandle;
    }

    await visibleElementHandle.blur();

    await visibleElementHandle.dispatchEvent("click");

    await expect(page.getByTestId("disclosure-models & agents")).toBeVisible();

    const rqaChainInputElements0 = await page
      .getByTestId("handle-retrievalqa-shownode-template-left")
      .all();

    const templateHandle = await findVisibleElement(rqaChainInputElements0);
    if (templateHandle) {
      visibleElementHandle = templateHandle;
    }

    await visibleElementHandle.dispatchEvent("click");

    await expect(page.getByTestId("disclosure-input & output")).toBeVisible();
    await expect(page.getByTestId("disclosure-data sources")).toBeVisible();
    await expect(page.getByTestId("disclosure-models & agents")).toBeVisible();
  },
);
