import { expect, test } from "../../fixtures";
import { adjustScreenView } from "../../utils/adjust-screen-view";
import { awaitBootstrapTest } from "../../utils/await-bootstrap-test";
import { TEXTS } from "../../utils/constants/texts";
import { waitForNewProjectButton } from "../../utils/flow/new-project-flow";
import { renameFlow } from "../../utils/rename-flow";

test(
  "when auto_login is false, admin can CRUD user's and should see just your own flows",
  { tag: ["@release", "@api", "@database", "@mainpage"] },
  async ({ page }) => {
    await page.route("**/api/v1/auto_login", (route) => {
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          detail: { auto_login: false },
        }),
      });
    });

    await page.addInitScript(() => {
      window.process = window.process || {};

      const newEnv = { ...window.process.env, KETOS_AUTO_LOGIN: "false" };

      Object.defineProperty(window.process, "env", {
        value: newEnv,
        writable: true,
        configurable: true,
      });

      sessionStorage.setItem("testMockAutoLogin", "true");
    });

    const randomName = Math.random().toString(36).substring(5);
    const randomPassword = Math.random().toString(36).substring(5);
    const secondRandomName = Math.random().toString(36).substring(5);
    const randomFlowName = Math.random().toString(36).substring(5);
    const secondRandomFlowName = Math.random().toString(36).substring(5);

    await page.goto("/");

    await page.waitForSelector(`text=${TEXTS.authSignInHeader}`, {
      timeout: 30000,
    });

    const initialAdminLogin = await page.request.post("/api/v1/login", {
      form: {
        username: TEXTS.authDefaultCredential,
        password: TEXTS.authDefaultPassword,
      },
    });
    expect(initialAdminLogin.status(), await initialAdminLogin.text()).toBe(
      200,
    );
    await page.goto("/");

    await page.waitForSelector('[data-testid="mainpage_title"]', {
      timeout: 90000,
    });

    await waitForNewProjectButton(page);

    await page.getByTestId("user-profile-settings").click();

    await page.getByText("Admin Page", { exact: true }).click();

    //CRUD an user
    await page.getByText("New User", { exact: true }).click();

    await page
      .getByPlaceholder(TEXTS.placeholderUsername)
      .last()
      .fill(randomName);
    await page.locator('input[name="password"]').fill(randomPassword);
    await page.locator('input[name="confirmpassword"]').fill(randomPassword);

    await page.waitForSelector("#is_active", {
      timeout: 1500,
    });

    await page.locator("#is_active").click();

    await page.getByText(TEXTS.save, { exact: true }).click();

    await page.waitForSelector("text=new user added", { timeout: 30000 });

    await expect(page.getByText(randomName, { exact: true })).toBeVisible({
      timeout: 2000,
    });

    await page.getByTestId("icon-Trash2").last().click();
    await page.getByText(TEXTS.delete, { exact: true }).last().click();

    await page.waitForSelector("text=user deleted", { timeout: 30000 });

    await expect(page.getByText(randomName, { exact: true })).toBeVisible({
      timeout: 2000,
      visible: false,
    });

    await page.getByText("New User", { exact: true }).click();

    await page
      .getByPlaceholder(TEXTS.placeholderUsername)
      .last()
      .fill(randomName);
    await page.locator('input[name="password"]').fill(randomPassword);
    await page.locator('input[name="confirmpassword"]').fill(randomPassword);

    await page.waitForSelector("#is_active", {
      timeout: 1500,
    });

    await page.locator("#is_active").click();

    await page.getByText(TEXTS.save, { exact: true }).click();

    await page.waitForSelector("text=new user added", { timeout: 30000 });

    const searchResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/users") && response.status() === 200,
    );
    const userSearch = page.getByPlaceholder("Search Username", {
      exact: true,
    });
    await userSearch.fill(randomName);
    await searchResponse;

    await page
      .getByRole("row")
      .filter({ hasText: randomName })
      .getByTestId("icon-Pencil")
      .click();

    const editDialog = page.getByRole("dialog");
    const editUsername = editDialog.getByPlaceholder(
      TEXTS.placeholderUsername,
      { exact: true },
    );
    await expect(editUsername).toHaveValue(randomName);
    await editUsername.fill(secondRandomName);
    await expect(editUsername).toHaveValue(secondRandomName);
    const editRequest = page.waitForRequest(
      (request) =>
        request.method() === "PATCH" &&
        request.url().includes("/api/v1/users/"),
    );
    await editDialog
      .getByRole("button", { name: TEXTS.save, exact: true })
      .dispatchEvent("click");
    expect((await editRequest).postDataJSON()).toMatchObject({
      username: secondRandomName,
    });

    await page.waitForSelector("text=user edited", { timeout: 30000 });

    await userSearch.fill("");

    await expect(page.getByText(secondRandomName, { exact: true })).toBeVisible(
      {
        timeout: 5000,
      },
    );

    //user must see just your own flows
    await page.waitForSelector('[data-testid="icon-ChevronLeft"]', {
      timeout: 100000,
    });

    await page.getByTestId("icon-ChevronLeft").first().click();

    await waitForNewProjectButton(page);

    await awaitBootstrapTest(page, { skipGoto: true });

    await page.getByTestId("side_nav_options_all-templates").click();
    await page
      .getByRole("heading", { name: TEXTS.templateBasicPrompting })
      .click();

    await adjustScreenView(page, { numberOfZoomOut: 1 });

    await renameFlow(page, { flowName: randomFlowName });

    await page.waitForSelector('[data-testid="sidebar-search-input"]', {
      timeout: 100000,
      state: "visible",
    });

    await page.waitForSelector('[data-testid="sidebar-search-input"]', {
      timeout: 1500,
    });

    await page.getByTestId("icon-ChevronLeft").first().click();

    await page.waitForSelector('[data-testid="search-store-input"]:enabled', {
      timeout: 30000,
      state: "visible",
    });

    await expect(page.getByText(randomFlowName, { exact: true })).toBeVisible({
      timeout: 2000,
    });
    const adminProjectUrl = page.url();

    await page.waitForSelector("[data-testid='user-profile-settings']", {
      timeout: 1500,
    });

    await page.getByTestId("user-profile-settings").click();

    await page.evaluate(() => {
      sessionStorage.setItem("testMockAutoLogin", "true");
    });

    await page.getByTestId("menu_logout_button").click();

    await page.waitForSelector(`text=${TEXTS.authSignInHeader}`, {
      timeout: 30000,
    });

    const secondUserLogin = await page.request.post("/api/v1/login", {
      form: {
        username: secondRandomName,
        password: randomPassword,
      },
    });
    expect(secondUserLogin.status(), await secondUserLogin.text()).toBe(200);
    await page.goto("/");

    await waitForNewProjectButton(page);

    await awaitBootstrapTest(page, { skipGoto: true });

    await page.getByTestId("side_nav_options_all-templates").click();
    await page
      .getByRole("heading", { name: TEXTS.templateBasicPrompting })
      .click();

    await adjustScreenView(page, { numberOfZoomOut: 2 });

    await renameFlow(page, { flowName: secondRandomFlowName });

    await page.waitForSelector('[data-testid="sidebar-search-input"]', {
      timeout: 100000,
    });

    await page.getByTestId("icon-ChevronLeft").first().click();

    await page.waitForSelector('[data-testid="search-store-input"]:enabled', {
      timeout: 30000,
    });

    await expect(
      page.getByText(secondRandomFlowName, { exact: true }),
    ).toBeVisible({
      timeout: 2000,
    });

    await expect(page.getByText(randomFlowName, { exact: true })).toBeVisible({
      timeout: 2000,
      visible: false,
    });

    await page.getByTestId("user-profile-settings").click();

    await page.evaluate(() => {
      sessionStorage.setItem("testMockAutoLogin", "true");
    });

    await page.getByTestId("menu_logout_button").click();

    await page.waitForSelector(`text=${TEXTS.authSignInHeader}`, {
      timeout: 30000,
    });

    const finalAdminLogin = await page.request.post("/api/v1/login", {
      form: {
        username: TEXTS.authDefaultCredential,
        password: TEXTS.authDefaultPassword,
      },
    });
    expect(finalAdminLogin.status(), await finalAdminLogin.text()).toBe(200);
    await page.goto(adminProjectUrl);
    await expect(page).toHaveURL(adminProjectUrl);
    await expect(page.getByText("Project is unavailable")).not.toBeVisible();

    await page.waitForSelector('[data-testid="mainpage_title"]', {
      timeout: 30000,
    });

    await page.waitForSelector('[data-testid="search-store-input"]:enabled', {
      timeout: 30000,
    });

    expect(
      await page.getByText(secondRandomFlowName, { exact: true }).isVisible(),
    ).toBe(false);

    await expect(page.getByText(randomFlowName, { exact: true })).toBeVisible({
      timeout: 2000,
    });

    await page.evaluate(() => {
      sessionStorage.removeItem("testMockAutoLogin");
    });
  },
);
