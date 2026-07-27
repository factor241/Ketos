const FOCUS_MONITOR_FRAMES = 60;

export function focusPlacementWithRetry(placementId: string): () => void {
  let cancelled = false;
  let frame: number | null = null;
  let remainingFrames = FOCUS_MONITOR_FRAMES;

  const removeInteractionListeners = () => {
    window.removeEventListener("keydown", cancel, true);
    window.removeEventListener("pointerdown", cancel, true);
  };
  function cancel() {
    if (cancelled) return;
    cancelled = true;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    removeInteractionListeners();
  }
  const focusAndMonitor = () => {
    if (cancelled || remainingFrames-- <= 0) {
      cancel();
      return;
    }
    const section = document.querySelector<HTMLElement>(
      `[data-id="${placementId}"] > section`,
    );
    const activeElement = document.activeElement;
    if (
      section &&
      activeElement !== section &&
      !(activeElement instanceof Node && section.contains(activeElement))
    ) {
      section.focus({ preventScroll: true });
    }
    frame = requestAnimationFrame(focusAndMonitor);
  };

  window.addEventListener("keydown", cancel, true);
  window.addEventListener("pointerdown", cancel, true);
  frame = requestAnimationFrame(() => {
    frame = requestAnimationFrame(focusAndMonitor);
  });
  return cancel;
}
