import type { Page } from "@playwright/test";
import { expect, test } from "../../fixtures";
import { mockAutoLoginDisabled } from "../../utils/auth/mock-auto-login-disabled";
import { awaitBootstrapTest } from "../../utils/await-bootstrap-test";
import { RUSSIAN_OPTION_NAME } from "../../utils/localization-option-names";

const LANGUAGE_STORAGE_KEY = "ketos-language-preference";

type LanguageBootProbe = {
  englishSamples: string[];
  stop: () => void;
};

async function mockProfileWithoutLanguagePreference(page: Page) {
  await page.route("**/api/v1/users/whoami", async (route) => {
    const response = await route.fetch();
    const profile = (await response.json()) as Record<string, unknown>;
    await route.fulfill({
      response,
      json: { ...profile, preferred_locale: null },
    });
  });
}

async function installLanguageBootProbe(page: Page) {
  await page.addInitScript((storageKey) => {
    for (const key of Object.keys(localStorage)) {
      if (key === storageKey || key.startsWith(`${storageKey}:`)) {
        localStorage.removeItem(key);
      }
    }

    const englishSamples: string[] = [];
    let rootObserver: MutationObserver | undefined;
    let documentObserver: MutationObserver | undefined;
    const stop = () => {
      rootObserver?.disconnect();
      documentObserver?.disconnect();
    };
    const record = (node: Node) => {
      const text =
        node.nodeType === Node.TEXT_NODE
          ? (node.textContent ?? "")
          : ((node as Element).textContent ?? "");
      if (/\bLanguage\b|Choose language/.test(text)) {
        englishSamples.push(text.trim().slice(0, 160));
        if (englishSamples.length >= 8) stop();
      }
    };
    const attachToRoot = () => {
      const root = document.getElementById("root");
      if (!root) return false;
      rootObserver = new MutationObserver((records) => {
        for (const mutation of records) {
          if (mutation.type === "characterData") record(mutation.target);
          for (const node of mutation.addedNodes) record(node);
        }
      });
      rootObserver.observe(root, {
        childList: true,
        characterData: true,
        subtree: true,
      });
      return true;
    };

    if (!attachToRoot()) {
      documentObserver = new MutationObserver(() => {
        if (attachToRoot()) documentObserver?.disconnect();
      });
      documentObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    }

    (
      window as typeof window & {
        __KETOS_LANGUAGE_BOOT_PROBE__?: LanguageBootProbe;
      }
    ).__KETOS_LANGUAGE_BOOT_PROBE__ = { englishSamples, stop };
  }, LANGUAGE_STORAGE_KEY);
}

async function waitForProfilePatch(page: Page) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      /^\/api\/v1\/users\/[^/]+$/.test(new URL(response.url()).pathname),
    { timeout: 30_000 },
  );
}

async function selectWithPointer(
  page: Page,
  optionName: RegExp,
  expectedLocale: "en" | "ru",
): Promise<void> {
  if ((await page.locator("html").getAttribute("lang")) === expectedLocale) {
    return;
  }
  const profilePatch = waitForProfilePatch(page);
  await page.getByTestId("language-preference-select").click();
  await page.getByRole("option", { name: optionName }).click();
  expect((await profilePatch).ok()).toBe(true);
  await expect(page.locator("html")).toHaveAttribute("lang", expectedLocale);
}

test.describe("dedicated Language settings acceptance", () => {
  test.describe.configure({ mode: "serial" });

  test(
    "clean storage and profile default to Russian without an English UI flash",
    { tag: ["@release", "@regression", "@api"] },
    async ({ page }) => {
      await mockProfileWithoutLanguagePreference(page);
      await installLanguageBootProbe(page);
      await page.goto("/settings/language");

      await expect(page.locator("html")).toHaveAttribute("lang", "ru");
      await expect(page.getByTestId("settings-language-heading")).toHaveText(
        "Язык",
      );
      const englishSamples = await page.evaluate(() => {
        const probe = (
          window as typeof window & {
            __KETOS_LANGUAGE_BOOT_PROBE__?: LanguageBootProbe;
          }
        ).__KETOS_LANGUAGE_BOOT_PROBE__;
        probe?.stop();
        return probe?.englishSamples ?? [];
      });
      expect(englishSamples).toEqual([]);
    },
  );

  test(
    "language selector exposes exactly English and Russian",
    { tag: ["@release", "@regression"] },
    async ({ page }) => {
      await page.goto("/settings/language");
      await expect(page.getByTestId("settings-language-page")).toBeVisible();
      await page.getByTestId("language-preference-select").click();

      const options = page.getByRole("option");
      await expect(options).toHaveCount(2);
      const labels = (await options.allTextContents()).map((label) =>
        label.replace(/\u00a0\([^)]*\)$/u, "").trim(),
      );
      expect(labels).toEqual(["English", "Русский"]);
    },
  );

  test(
    "legacy Japanese storage preference falls back to Russian",
    { tag: ["@release", "@regression"] },
    async ({ page }) => {
      await mockAutoLoginDisabled(page);
      await page.addInitScript((storageKey) => {
        localStorage.setItem(storageKey, "ja");
      }, LANGUAGE_STORAGE_KEY);
      await page.goto("/login");

      await expect(page.locator("html")).toHaveAttribute("lang", "ru");
      await expect(
        page.getByText("Вход в Ketos", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("Sign in to Ketos", { exact: true }),
      ).toHaveCount(0);
    },
  );

  test(
    "sidebar, keyboard focus, authenticated profile, reload, and new tab preserve the final Russian choice",
    { tag: ["@release", "@regression", "@api"] },
    async ({ context, page }) => {
      await awaitBootstrapTest(page, { skipModal: true });
      await page.goto("/settings/mcp-client");

      const languageNavigation = page.getByTestId("sidebar-nav-language");
      await expect(languageNavigation).toBeVisible();
      await languageNavigation.focus();
      await expect(languageNavigation).toBeFocused();
      await languageNavigation.press("Enter");
      await expect(page).toHaveURL(/\/settings\/language$/);
      await expect(page.getByTestId("settings-language-page")).toBeVisible();

      await selectWithPointer(page, /^English/, "en");
      const select = page.getByTestId("language-preference-select");
      await select.focus();
      await expect(select).toBeFocused();
      await select.press("Space");
      const russianProfilePatch = waitForProfilePatch(page);
      await page
        .getByRole("option", {
          name: RUSSIAN_OPTION_NAME,
        })
        .press("Enter");
      expect((await russianProfilePatch).ok()).toBe(true);
      await expect(page.locator("html")).toHaveAttribute("lang", "ru");
      await expect(page.getByRole("heading", { name: "Язык" })).toBeVisible();
      await expect(
        page.getByRole("combobox", { name: "Выберите язык" }),
      ).toBeVisible();

      // Exercise ru -> en -> ru without waiting for a page reload. The hook
      // serializes profile PATCH transport, so the server must end on the last
      // choice even if an earlier response is slow.
      await selectWithPointer(page, /^English/, "en");
      await selectWithPointer(page, RUSSIAN_OPTION_NAME, "ru");
      await expect
        .poll(async () => {
          const response = await page.request.get("/api/v1/users/whoami");
          if (!response.ok()) return `http-${response.status()}`;
          return (
            (await response.json()) as { preferred_locale?: string | null }
          ).preferred_locale;
        })
        .toBe("ru");

      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.locator("html")).toHaveAttribute("lang", "ru");
      expect(
        await page.evaluate(
          (storageKey) => localStorage.getItem(storageKey),
          LANGUAGE_STORAGE_KEY,
        ),
      ).toBe("ru");

      const secondPage = await context.newPage();
      await secondPage.goto("/settings/language");
      await expect(secondPage.locator("html")).toHaveAttribute("lang", "ru");
      await expect(
        secondPage.getByTestId("settings-language-heading"),
      ).toHaveText("Язык");
      await secondPage.close();
    },
  );

  test(
    "unauthenticated shell restores the last-used local cache",
    { tag: ["@release", "@regression"] },
    async ({ page }) => {
      await mockAutoLoginDisabled(page);
      await page.addInitScript((storageKey) => {
        localStorage.setItem(storageKey, "ru");
      }, LANGUAGE_STORAGE_KEY);
      await page.goto("/login");
      await expect(page.locator("html")).toHaveAttribute("lang", "ru");
    },
  );
});
