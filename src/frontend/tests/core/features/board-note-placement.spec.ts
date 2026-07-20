import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { APIResponse, Locator, Page } from "@playwright/test";

import { expect, test } from "../../fixtures";
import { awaitBootstrapTest } from "../../utils/await-bootstrap-test";

type Entity = { id: string; revision: number };
type NoteCreate = { note: Entity; placement: Entity };

function setRawNoteContent(noteId: string, content: string) {
  const runRoot = process.env.KETOS_MVP_RUN_DIR;
  if (!runRoot) throw new Error("KETOS_MVP_RUN_DIR is required");
  const database = new DatabaseSync(
    path.join(runRoot, "backend", "ketos.sqlite3"),
  );
  try {
    const result = database
      .prepare(
        "UPDATE board_note SET content = ? WHERE replace(id, '-', '') = ?",
      )
      .run(content, noteId.replaceAll("-", ""));
    expect(result.changes).toBe(1);
  } finally {
    database.close();
  }
}

async function createProject(page: Page): Promise<Entity> {
  const response = await page.request.post("/api/v1/projects/", {
    data: {
      name: `S04 note ${Date.now().toString(36)}`,
      description: "",
      flows_list: [],
      components_list: [],
    },
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function createBoard(page: Page, projectId: string): Promise<Entity> {
  const response = await page.request.post(
    `/api/v1/projects/${projectId}/boards`,
    { data: { title: "Placement lifecycle" } },
  );
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function readPlacement(page: Page, boardId: string, placementId: string) {
  const response = await page.request.get(
    `/api/v1/boards/${boardId}/placements`,
  );
  expect(response.ok()).toBeTruthy();
  const placements = (await response.json()) as Array<Record<string, unknown>>;
  const placement = placements.find((item) => item.id === placementId);
  expect(placement).toBeDefined();
  return placement as Record<string, unknown>;
}

const placementWrite = (page: Page, placementId: string, method = "PATCH") =>
  page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === method &&
      url.pathname === `/api/v1/placements/${placementId}` &&
      response.ok()
    );
  });

async function awaitPlacementCommit(
  response: Promise<APIResponse>,
  card: Locator,
) {
  const committed = (await (await response).json()) as Entity;
  await expect(card).toHaveAttribute(
    "data-placement-revision",
    String(committed.revision),
  );
  return committed;
}

test(
  "BoardNote lifecycle keeps entity and placement separate",
  { tag: ["@release", "@workspace", "@api", "@database", "@a11y"] },
  async ({ page }) => {
    await awaitBootstrapTest(page, { skipModal: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    const project = await createProject(page);
    const board = await createBoard(page, project.id);
    await page.goto(`/project/${project.id}/board/${board.id}`);
    await expect(
      page.getByRole("heading", { name: "Placement lifecycle" }),
    ).toBeVisible();

    const createResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname ===
          `/api/v1/boards/${board.id}/board-notes` &&
        response.status() === 201,
    );
    const addNote = page.getByRole("button", { name: "Add note" });
    await addNote.click();
    const created = (await (await createResponsePromise).json()) as NoteCreate;
    const noteId = created.note.id;
    let placementId = created.placement.id;
    let placementPatchCount = 0;
    page.on("request", (request) => {
      if (
        request.method() === "PATCH" &&
        new URL(request.url()).pathname === `/api/v1/placements/${placementId}`
      ) {
        placementPatchCount += 1;
      }
    });

    let card = page.getByRole("region", { name: "Note" });
    await expect(card).toBeVisible();
    const textarea = card.getByRole("textbox", { name: "Edit note" });
    const markdown =
      "**Bold evidence**\n\n- first\n- second\n\n[Ketos docs](https://example.com)";
    await textarea.fill(markdown);
    const saveResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        new URL(response.url()).pathname === `/api/v1/board-notes/${noteId}` &&
        response.ok(),
    );
    await card.getByRole("button", { name: "Save note" }).click();
    const savedNote = (await (await saveResponsePromise).json()) as Entity;
    const serverWinner = await page.request.patch(
      `/api/v1/board-notes/${noteId}`,
      {
        data: { content: markdown, expected_revision: savedNote.revision },
      },
    );
    expect(serverWinner.ok()).toBeTruthy();
    const unsavedDraft = `${markdown}\n\nlocal unsaved draft`;
    await textarea.fill(unsavedDraft);
    const conflictResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        new URL(response.url()).pathname === `/api/v1/board-notes/${noteId}` &&
        response.status() === 409,
    );
    await card.getByRole("button", { name: "Save note" }).click();
    await conflictResponsePromise;
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Your draft is still available" }),
    ).toBeVisible();
    await expect(textarea).toHaveValue(unsavedDraft);
    await textarea.fill(markdown);
    await card.getByRole("button", { name: "Note preview" }).click();
    await expect(
      card.getByText("Bold evidence", { exact: true }),
    ).toHaveJSProperty("tagName", "STRONG");
    await expect(card.getByRole("list")).toBeVisible();
    const safeLink = card.getByRole("link", { name: "Ketos docs" });
    await expect(safeLink).toHaveAttribute("target", "_blank");
    await expect(safeLink).toHaveAttribute("rel", "noopener noreferrer");

    const dragHandle = card.locator(".board-card-drag-handle");
    const dragBox = await dragHandle.boundingBox();
    expect(dragBox).not.toBeNull();
    expect((dragBox as NonNullable<typeof dragBox>).width).toBeGreaterThan(20);
    const dragWrite = placementWrite(page, placementId);
    await page.mouse.move(
      (dragBox as NonNullable<typeof dragBox>).x +
        (dragBox as NonNullable<typeof dragBox>).width / 2,
      (dragBox as NonNullable<typeof dragBox>).y +
        (dragBox as NonNullable<typeof dragBox>).height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      (dragBox as NonNullable<typeof dragBox>).x +
        (dragBox as NonNullable<typeof dragBox>).width / 2 +
        80,
      (dragBox as NonNullable<typeof dragBox>).y +
        (dragBox as NonNullable<typeof dragBox>).height / 2 +
        60,
      { steps: 6 },
    );
    await page.mouse.up();
    await awaitPlacementCommit(dragWrite, card);
    expect(placementPatchCount).toBe(1);

    card = page.getByRole("region", { name: "Note" });
    await card.click({ position: { x: 4, y: 4 } });
    const pointerResizeHandle = page
      .locator(".react-flow__resize-control.handle.bottom.right")
      .first();
    await expect(pointerResizeHandle).toBeVisible();
    const resizeBox = await pointerResizeHandle.boundingBox();
    expect(resizeBox).not.toBeNull();
    const pointerResizeWrite = placementWrite(page, placementId);
    await pointerResizeHandle.hover({ force: true });
    await page.mouse.down();
    await page.mouse.move(
      (resizeBox as NonNullable<typeof resizeBox>).x +
        (resizeBox as NonNullable<typeof resizeBox>).width / 2 +
        80,
      (resizeBox as NonNullable<typeof resizeBox>).y +
        (resizeBox as NonNullable<typeof resizeBox>).height / 2 +
        60,
      { steps: 5 },
    );
    await page.mouse.up();
    await awaitPlacementCommit(pointerResizeWrite, card);
    expect(placementPatchCount).toBe(2);

    await card.focus();
    const moveWrite = placementWrite(page, placementId);
    await page.keyboard.press("Alt+ArrowRight");
    await awaitPlacementCommit(moveWrite, card);
    expect(placementPatchCount).toBe(3);

    const resizeWrite = placementWrite(page, placementId);
    await page.keyboard.press("Control+Alt+ArrowRight");
    await awaitPlacementCommit(resizeWrite, card);
    expect(placementPatchCount).toBe(4);
    const beforeConflict = await readPlacement(page, board.id, placementId);
    const placementWinner = await page.request.patch(
      `/api/v1/placements/${placementId}`,
      {
        data: {
          x: Number(beforeConflict.x) + 5,
          expected_revision: beforeConflict.revision,
        },
      },
    );
    expect(placementWinner.ok()).toBeTruthy();
    const placementWinnerEntity = (await placementWinner.json()) as Entity;
    const geometryConflict = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        new URL(response.url()).pathname ===
          `/api/v1/placements/${placementId}` &&
        response.status() === 409,
    );
    await card.focus();
    await page.keyboard.press("Alt+ArrowDown");
    const geometryConflictResponse = await geometryConflict;
    expect(geometryConflictResponse.status()).toBe(409);
    expect(placementPatchCount).toBe(5);
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "The server version replaced this change." }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(card).toHaveAttribute(
      "data-placement-revision",
      String(placementWinnerEntity.revision),
    );
    const baseGeometry = await readPlacement(page, board.id, placementId);

    const collapseWrite = placementWrite(page, placementId);
    await card.getByRole("button", { name: "Collapse" }).click();
    await awaitPlacementCommit(collapseWrite, card);
    expect(placementPatchCount).toBe(6);
    await expect(card).toHaveAttribute("data-display-state", "collapsed");
    await expect(textarea).toBeHidden();
    const expandWrite = placementWrite(page, placementId);
    await card.getByRole("button", { name: "Expand" }).click();
    await awaitPlacementCommit(expandWrite, card);
    expect(placementPatchCount).toBe(7);

    const maximizeWrite = placementWrite(page, placementId);
    await card.getByRole("button", { name: "Maximize" }).click();
    await awaitPlacementCommit(maximizeWrite, card);
    expect(placementPatchCount).toBe(8);
    card = page.getByRole("region", { name: "Note" });
    await expect(card).toHaveAttribute("data-display-state", "maximized");
    const restoreWrite = placementWrite(page, placementId);
    await card.press("Escape");
    await awaitPlacementCommit(restoreWrite, card);
    expect(placementPatchCount).toBe(9);
    await expect(card).toHaveAttribute("data-display-state", "normal");
    await expect(card.getByRole("button", { name: "Maximize" })).toBeFocused();
    const restoredGeometry = await readPlacement(page, board.id, placementId);
    expect(restoredGeometry).toMatchObject({
      x: baseGeometry.x,
      y: baseGeometry.y,
      width: baseGeometry.width,
      height: baseGeometry.height,
      display_state: "normal",
    });

    const closeWrite = placementWrite(page, placementId, "DELETE");
    await card.getByRole("button", { name: "Close placement" }).click();
    await closeWrite;
    await expect(addNote).toBeFocused();
    const preserved = await page.request.get(`/api/v1/board-notes/${noteId}`);
    expect(preserved.ok()).toBeTruthy();

    const replaceResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname ===
          `/api/v1/boards/${board.id}/placements` &&
        response.status() === 201,
    );
    await page.getByRole("button", { name: "Re-place note" }).click();
    const replaced = (await (await replaceResponsePromise).json()) as Entity;
    expect(replaced.id).not.toBe(placementId);
    placementId = replaced.id;
    await page.reload();
    card = page.getByRole("region", { name: "Note" });
    await card.getByRole("button", { name: "Note preview" }).click();
    await expect(
      card.getByText("Bold evidence", { exact: true }),
    ).toBeVisible();

    for (const content of [
      "<img src=x onerror=alert(1)>",
      "[unsafe](javascript:alert(1))",
    ]) {
      const unsafe = await page.request.patch(`/api/v1/board-notes/${noteId}`, {
        data: {
          content,
          expected_revision: savedNote.revision,
        },
      });
      expect(unsafe.status()).toBe(422);
    }

    const hostileSource =
      '<img src=x onerror="window.__stage04Xss=1"><script>window.__stage04Xss=1</script>[unsafe](javascript:alert(1)) **safe text**';
    setRawNoteContent(noteId, hostileSource);
    await page.reload();
    card = page.getByRole("region", { name: "Note" });
    await card.getByRole("button", { name: "Note preview" }).click();
    await expect(card.getByText("safe text", { exact: true })).toBeVisible();
    await expect(card.getByLabel("Note preview")).toContainText("unsafe");
    await expect(card.getByRole("link", { name: "unsafe" })).toHaveCount(0);
    await expect(card.locator("script, img, code")).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() => (window as { __stage04Xss?: number }).__stage04Xss),
      )
      .toBeUndefined();
    setRawNoteContent(noteId, markdown);
    await page.reload();
    card = page.getByRole("region", { name: "Note" });

    await card.getByRole("button", { name: "Delete note" }).click();
    let dialog = page.getByRole("dialog", { name: "Delete note entity?" });
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(
      card.getByRole("button", { name: "Delete note" }),
    ).toBeFocused();
    await card.getByRole("button", { name: "Delete note" }).click();
    dialog = page.getByRole("dialog", { name: "Delete note entity?" });
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    const deleteResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "DELETE" &&
        new URL(response.url()).pathname === `/api/v1/board-notes/${noteId}` &&
        response.status() === 204,
    );
    await dialog.getByRole("button", { name: "Delete note" }).click();
    await deleteResponsePromise;
    await expect(page.getByRole("region", { name: "Note" })).toHaveCount(0);
    const deleted = await page.request.get(`/api/v1/board-notes/${noteId}`);
    expect(deleted.status()).toBe(404);
  },
);
