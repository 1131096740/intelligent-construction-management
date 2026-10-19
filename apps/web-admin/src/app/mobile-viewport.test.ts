import { describe, expect, it } from "vitest";
import { mobileViewportLayout } from "./mobile-viewport";
const normal = { width: 390, layoutHeight: 844, visibleHeight: 844, top: 0, scale: 1, editing: false, wasOpen: false };
describe("mobile viewport keyboard detection", () => {
  it("keeps the visible height and offset while typing or scrolling with an open keyboard", () => {
    expect(mobileViewportLayout({ ...normal, visibleHeight: 480, top: 25, editing: true })).toEqual({ height: 480, top: 25, keyboardOpen: true });
    expect(mobileViewportLayout({ ...normal, visibleHeight: 480, top: 12, wasOpen: true }).keyboardOpen).toBe(true);
  });
  it("does not treat desktop resize, zoom, or browser toolbar as a keyboard", () => {
    for (const item of [
      { ...normal, visibleHeight: 760, editing: true },
      { ...normal, visibleHeight: 480, scale: 2, editing: true },
      { ...normal, width: 1366, visibleHeight: 480, editing: true },
      normal
    ]) expect(mobileViewportLayout(item).keyboardOpen).toBe(false);
    expect(mobileViewportLayout({ ...normal, wasOpen: true }).keyboardOpen).toBe(false);
  });
});
