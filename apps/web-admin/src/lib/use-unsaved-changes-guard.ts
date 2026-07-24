import {
  getCurrentScope,
  onBeforeUnmount,
  onMounted,
  onScopeDispose,
  type MaybeRefOrGetter,
  toValue
} from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate } from "vue-router";

interface BeforeUnloadTarget {
  addEventListener(type: "beforeunload", listener: (event: BeforeUnloadEvent) => void): void;
  removeEventListener(type: "beforeunload", listener: (event: BeforeUnloadEvent) => void): void;
}

export interface UnsavedChangesGuardOptions {
  isDirty: MaybeRefOrGetter<boolean>;
  confirmLeave: () => boolean | Promise<boolean>;
  discardChanges?: () => void | Promise<void>;
}

export interface UnsavedChangesGuard {
  requestLeave: () => Promise<boolean>;
  requestClose: () => Promise<boolean>;
  beforeUnload: (event: BeforeUnloadEvent) => void;
  mount: (target: BeforeUnloadTarget) => void;
  dispose: () => void;
}

interface PendingDecision {
  promise: Promise<boolean>;
  resolve: (decision: boolean) => void;
}

export function createUnsavedChangesGuard(
  options: UnsavedChangesGuardOptions
): UnsavedChangesGuard {
  let target: BeforeUnloadTarget | null = null;
  let pending: PendingDecision | null = null;
  let disposed = false;

  function settle(current: PendingDecision, decision: boolean) {
    if (pending !== current) return;
    pending = null;
    current.resolve(decision);
  }

  function requestLeave(): Promise<boolean> {
    if (!toValue(options.isDirty)) return Promise.resolve(true);
    if (disposed) return Promise.resolve(false);
    if (pending) return pending.promise;

    let resolve!: (decision: boolean) => void;
    const promise = new Promise<boolean>((next) => { resolve = next; });
    const current = { promise, resolve };
    pending = current;

    let confirmation: boolean | Promise<boolean>;
    try {
      confirmation = options.confirmLeave();
    } catch {
      settle(current, false);
      return promise;
    }
    Promise.resolve(confirmation)
      .then(async (decision) => {
        if (decision !== true) return false;
        await options.discardChanges?.();
        return true;
      })
      .then(
        (decision) => settle(current, decision),
        () => settle(current, false)
      );
    return promise;
  }

  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (!toValue(options.isDirty) || disposed) return;
    event.preventDefault();
    event.returnValue = "";
  };

  function mount(nextTarget: BeforeUnloadTarget) {
    if (disposed || target === nextTarget) return;
    if (target) target.removeEventListener("beforeunload", beforeUnload);
    target = nextTarget;
    target.addEventListener("beforeunload", beforeUnload);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (target) target.removeEventListener("beforeunload", beforeUnload);
    target = null;
    if (pending) settle(pending, false);
  }

  if (getCurrentScope()) onScopeDispose(dispose);

  return {
    requestLeave,
    requestClose: requestLeave,
    beforeUnload,
    mount,
    dispose
  };
}

export function useUnsavedChangesGuard(options: UnsavedChangesGuardOptions) {
  const guard = createUnsavedChangesGuard(options);

  onBeforeRouteLeave((): Promise<boolean> => guard.requestLeave());
  onBeforeRouteUpdate((): Promise<boolean> => guard.requestLeave());
  onMounted(() => guard.mount(window));
  onBeforeUnmount(guard.dispose);

  return {
    requestClose: guard.requestClose
  };
}
