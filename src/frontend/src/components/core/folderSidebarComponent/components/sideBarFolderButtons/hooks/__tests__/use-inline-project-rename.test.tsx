import { act, renderHook } from "@testing-library/react";
import type { KeyboardEvent } from "react";
import {
  type InlineProjectRenameTarget,
  useInlineProjectRename,
} from "../use-inline-project-rename";

const project = { id: "project-1", name: "Original project" };

function attachInput(inputRef: { current: HTMLInputElement | null }) {
  const input = document.createElement("input");
  document.body.appendChild(input);
  inputRef.current = input;
  return input;
}

afterEach(() => {
  document.body.replaceChildren();
  jest.restoreAllMocks();
});

describe("useInlineProjectRename", () => {
  it("commits a trimmed name once and trusts the returned server name", async () => {
    const renameProject = jest
      .fn()
      .mockResolvedValue({ id: project.id, name: "Canonical server name" });
    const { result } = renderHook(() =>
      useInlineProjectRename({ renameProject, onError: jest.fn() }),
    );

    act(() => result.current.beginRename(project));
    act(() => result.current.setDraftName("  Updated project  "));
    await act(async () =>
      expect(await result.current.commitRename()).toBe(true),
    );

    expect(renameProject).toHaveBeenCalledTimes(1);
    expect(renameProject).toHaveBeenCalledWith(project.id, "Updated project");
    expect(result.current.editingProjectId).toBeNull();
    expect(result.current.draftName).toBe("Canonical server name");
  });

  it("uses Enter only to blur before blur integration commits once", async () => {
    const renameProject = jest
      .fn()
      .mockResolvedValue({ id: project.id, name: "Updated project" });
    const { result } = renderHook(() =>
      useInlineProjectRename({ renameProject, onError: jest.fn() }),
    );
    act(() => result.current.beginRename(project));
    const input = attachInput(result.current.inputRef);
    const blurSpy = jest.spyOn(input, "blur");
    act(() => result.current.setDraftName("Updated project"));

    const preventDefault = jest.fn();
    act(() =>
      result.current.handleKeyDown({
        key: "Enter",
        preventDefault,
      } as unknown as KeyboardEvent<HTMLInputElement>),
    );
    expect(blurSpy).toHaveBeenCalledTimes(1);
    expect(renameProject).not.toHaveBeenCalled();

    await act(async () => void (await result.current.commitRename()));
    expect(renameProject).toHaveBeenCalledTimes(1);
  });

  it("cancels on Escape without mutation and returns focus", () => {
    const renameProject = jest.fn();
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    const { result } = renderHook(() =>
      useInlineProjectRename({ renameProject, onError: jest.fn() }),
    );
    act(() => result.current.beginRename(project, trigger));
    attachInput(result.current.inputRef);
    act(() => result.current.setDraftName("Unsaved"));

    act(() =>
      result.current.handleKeyDown({
        key: "Escape",
        preventDefault: jest.fn(),
      } as unknown as KeyboardEvent<HTMLInputElement>),
    );

    expect(renameProject).not.toHaveBeenCalled();
    expect(result.current.draftName).toBe(project.name);
    expect(result.current.editingProjectId).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("restores server truth, reports error, and refocuses", async () => {
    const error = new Error("rename failed");
    const renameProject = jest.fn().mockRejectedValue(error);
    const onError = jest.fn();
    const { result } = renderHook(() =>
      useInlineProjectRename({ renameProject, onError }),
    );
    act(() => result.current.beginRename(project));
    const input = attachInput(result.current.inputRef);
    act(() => result.current.setDraftName("Rejected"));

    await act(async () => {
      expect(await result.current.commitRename()).toBe(false);
      await Promise.resolve();
    });

    expect(onError).toHaveBeenCalledWith(error);
    expect(result.current.editingProjectId).toBe(project.id);
    expect(result.current.draftName).toBe(project.name);
    expect(document.activeElement).toBe(input);
  });

  it("guards repeated commits while the first request is pending", async () => {
    let resolveRename!: (value: InlineProjectRenameTarget) => void;
    const renameProject = jest.fn(
      () =>
        new Promise<InlineProjectRenameTarget>((resolve) => {
          resolveRename = resolve;
        }),
    );
    const { result } = renderHook(() =>
      useInlineProjectRename({ renameProject, onError: jest.fn() }),
    );
    act(() => result.current.beginRename(project));
    act(() => result.current.setDraftName("Updated"));

    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    act(() => {
      first = result.current.commitRename();
      second = result.current.commitRename();
    });
    await expect(second).resolves.toBe(false);
    expect(renameProject).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRename({ id: project.id, name: "Updated" });
      await first;
    });
    expect(renameProject).toHaveBeenCalledTimes(1);
  });
});
