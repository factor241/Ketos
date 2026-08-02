import { focusPlacementWithRetry } from "../focus-placement";

describe("focusPlacementWithRetry", () => {
  let callbacks: FrameRequestCallback[];

  beforeEach(() => {
    callbacks = [];
    globalThis.requestAnimationFrame = jest.fn((callback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    globalThis.cancelAnimationFrame = jest.fn();
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  const flush = () => {
    const current = callbacks;
    callbacks = [];
    current.forEach((callback, index) => callback(index));
  };
  const mount = (placementId: string) => {
    const wrapper = document.createElement("div");
    wrapper.dataset.id = placementId;
    const section = document.createElement("section");
    section.tabIndex = -1;
    wrapper.append(section);
    document.body.append(wrapper);
    return section;
  };

  it("refocuses the current card when React Flow replaces its section", () => {
    const original = mount("placement-1");
    const cancel = focusPlacementWithRetry("placement-1");
    flush();
    flush();
    expect(original).toHaveFocus();

    const replacement = document.createElement("section");
    replacement.tabIndex = -1;
    original.parentElement?.replaceChildren(replacement);
    expect(document.body).toHaveFocus();
    flush();

    expect(replacement).toHaveFocus();
    cancel();
  });

  it("stops retrying after subsequent user interaction", () => {
    const original = mount("placement-1");
    focusPlacementWithRetry("placement-1");
    flush();
    flush();

    const userTarget = document.createElement("button");
    document.body.append(userTarget);
    userTarget.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
    );
    userTarget.focus();
    original.remove();
    flush();

    expect(userTarget).toHaveFocus();
    expect(callbacks).toHaveLength(0);
  });
});
