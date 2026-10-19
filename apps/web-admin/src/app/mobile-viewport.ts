export function mobileViewportLayout(input: {
  width: number; layoutHeight: number; visibleHeight: number; top: number;
  scale: number; editing: boolean; wasOpen: boolean;
}) {
  return {
    height: input.visibleHeight,
    top: input.top,
    keyboardOpen: input.width <= 720 && Math.abs(input.scale - 1) < 0.05 &&
      input.layoutHeight - input.visibleHeight > 120 && (input.editing || input.wasOpen)
  };
}

// Keep scroll ownership in the dialog body/content. Never scroll to a focused
// field in response to a viewport scroll event (that makes iOS fight the user).
export function installMobileViewport(win: Window = window, doc: Document = document) {
  const viewport = win.visualViewport;
  let frame = 0;
  let open = false;
  const update = () => {
    const layout = mobileViewportLayout({
      width: win.innerWidth,
      layoutHeight: win.innerHeight,
      visibleHeight: viewport?.height ?? win.innerHeight,
      top: viewport?.offsetTop ?? 0,
      scale: viewport?.scale ?? 1,
      editing: Boolean(doc.activeElement?.matches("input,textarea,select,[contenteditable=true]")),
      wasOpen: open
    });
    open = layout.keyboardOpen;
    doc.documentElement.style.setProperty("--jg-visible-height", `${layout.height}px`);
    doc.documentElement.style.setProperty("--jg-visible-top", `${layout.top}px`);
    doc.documentElement.dataset.keyboard = open ? "open" : "closed";
  };
  const schedule = () => { win.cancelAnimationFrame(frame); frame = win.requestAnimationFrame(update); };
  win.addEventListener("resize", schedule, { passive: true });
  viewport?.addEventListener("resize", schedule, { passive: true });
  viewport?.addEventListener("scroll", schedule, { passive: true });
  doc.addEventListener("focusin", schedule);
  doc.addEventListener("focusout", schedule);
  update();
  return () => {
    win.cancelAnimationFrame(frame);
    win.removeEventListener("resize", schedule);
    viewport?.removeEventListener("resize", schedule);
    viewport?.removeEventListener("scroll", schedule);
    doc.removeEventListener("focusin", schedule);
    doc.removeEventListener("focusout", schedule);
  };
}
