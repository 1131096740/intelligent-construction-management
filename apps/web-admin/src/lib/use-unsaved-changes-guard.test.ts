import { createSSRApp, defineComponent, effectScope, h, ref } from "vue";
import { renderToString } from "vue/server-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routeHooks = vi.hoisted(() => ({
  leave: null as null | (() => Promise<boolean>),
  update: null as null | ((to: unknown, from: unknown) => Promise<boolean>)
}));

vi.mock("vue-router", () => ({
  onBeforeRouteLeave: (hook: () => Promise<boolean>) => {
    routeHooks.leave = hook;
  },
  onBeforeRouteUpdate: (
    hook: (to: unknown, from: unknown) => Promise<boolean>
  ) => {
    routeHooks.update = hook;
  }
}));

import {
  createUnsavedChangesGuard,
  useUnsavedChangesGuard
} from "./use-unsaved-changes-guard";

describe("unsaved changes guard", () => {
  beforeEach(() => {
    routeHooks.leave = null;
    routeHooks.update = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("allows clean closes without asking and never clears dirty itself", async () => {
    const dirty = ref(false);
    const confirmLeave = vi.fn(async () => true);
    const guard = createUnsavedChangesGuard({ isDirty: () => dirty.value, confirmLeave });

    await expect(guard.requestClose()).resolves.toBe(true);
    expect(confirmLeave).not.toHaveBeenCalled();

    dirty.value = true;
    await expect(guard.requestClose()).resolves.toBe(true);
    expect(dirty.value).toBe(true);
  });

  it("merges concurrent requests and does not let a later request replace the pending decision", async () => {
    let decide!: (value: boolean) => void;
    const confirmLeave = vi.fn(() => new Promise<boolean>((resolve) => { decide = resolve; }));
    const guard = createUnsavedChangesGuard({ isDirty: () => true, confirmLeave });

    const routeDecision = guard.requestLeave();
    const componentCloseDecision = guard.requestClose();
    expect(routeDecision).toBe(componentCloseDecision);
    expect(confirmLeave).toHaveBeenCalledTimes(1);

    decide(false);
    await expect(routeDecision).resolves.toBe(false);
  });

  it("uses one stable beforeunload listener and cleans it up", () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    const target = { addEventListener, removeEventListener };
    const guard = createUnsavedChangesGuard({ isDirty: () => true, confirmLeave: async () => true });

    guard.mount(target);
    guard.mount(target);
    expect(addEventListener).toHaveBeenCalledTimes(1);
    const listener = addEventListener.mock.calls[0]?.[1] as (event: BeforeUnloadEvent) => void;
    const event = { preventDefault: vi.fn(), returnValue: undefined } as unknown as BeforeUnloadEvent;
    listener(event);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.returnValue).toBe("");

    guard.dispose();
    expect(removeEventListener).toHaveBeenCalledWith("beforeunload", listener);
  });

  it("resolves a pending decision as false when disposed", async () => {
    const guard = createUnsavedChangesGuard({
      isDirty: () => true,
      confirmLeave: () => new Promise<boolean>(() => undefined)
    });
    const pending = guard.requestLeave();
    guard.dispose();
    await expect(pending).resolves.toBe(false);
  });

  it("can be owned by a Vue scope and disposes with the component scope", async () => {
    const scope = effectScope();
    let guard!: ReturnType<typeof createUnsavedChangesGuard>;
    scope.run(() => {
      guard = createUnsavedChangesGuard({
        isDirty: () => true,
        confirmLeave: () => new Promise<boolean>(() => undefined)
      });
    });
    const pending = guard.requestClose();
    scope.stop();
    await expect(pending).resolves.toBe(false);
  });

  it.each([
    [
      "contractId",
      { params: { contractId: "contract-2" }, query: {} },
      { params: { contractId: "contract-1" }, query: {} }
    ],
    [
      "versionId",
      { params: { contractId: "contract-1" }, query: { versionId: "version-2" } },
      { params: { contractId: "contract-1" }, query: { versionId: "version-1" } }
    ]
  ])(
    "guards same-component %s updates before route watchers can replace local state",
    async (_kind, to, from) => {
      const rows = ref(["baseline", "unsaved-candidate"]);
      const decisions = [false, true];
      const discardChanges = vi.fn(() => {
        rows.value = ["baseline"];
      });
      const app = createSSRApp(defineComponent({
        setup() {
          useUnsavedChangesGuard({
            isDirty: () => rows.value.length > 1,
            confirmLeave: async () => decisions.shift() ?? false,
            discardChanges
          });
          return () => h("div");
        }
      }));
      await renderToString(app);

      expect(routeHooks.leave).toBeTypeOf("function");
      expect(routeHooks.update).toBeTypeOf("function");
      const routeWatcher = vi.fn(() => [...rows.value]);
      const navigate = async () => {
        const allowed = await routeHooks.update?.(to, from);
        if (allowed) routeWatcher();
        return allowed;
      };

      await expect(navigate()).resolves.toBe(false);
      expect(discardChanges).not.toHaveBeenCalled();
      expect(routeWatcher).not.toHaveBeenCalled();
      expect(rows.value).toEqual(["baseline", "unsaved-candidate"]);

      await expect(navigate()).resolves.toBe(true);
      expect(discardChanges).toHaveBeenCalledTimes(1);
      expect(routeWatcher).toHaveBeenCalledWith();
      expect(routeWatcher.mock.results[0]?.value).toEqual(["baseline"]);
      expect(rows.value).toEqual(["baseline"]);
    }
  );

  it("fails closed when discarding local state throws", async () => {
    const guard = createUnsavedChangesGuard({
      isDirty: () => true,
      confirmLeave: async () => true,
      discardChanges: () => {
        throw new Error("discard failed");
      }
    });

    await expect(guard.requestLeave()).resolves.toBe(false);
  });
});
