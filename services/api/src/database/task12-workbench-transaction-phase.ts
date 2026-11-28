import { performance } from "node:perf_hooks";
import { types } from "node:util";

type Phase = "BEGIN" | "VERSION_READ" | "LAYOUT_READ" | "TEMPLATE_READ" | "BILLS_READ" | "CALLBACK_RETURNED";
export type Task12WorkbenchPhase = Readonly<{ phase: Phase; elapsedMs: number; phaseElapsedMs: number }>;

const failures = new WeakMap<object, { request: object; observedAt: number; proof: Task12WorkbenchPhase } | false>();

export function observeTask12WorkbenchTransaction(request: object) {
  const started = performance.now();
  let changed = started;
  let phase: Phase = "BEGIN";
  return {
    step(next: Phase) {
      phase = next;
      changed = performance.now();
    },
    capture(error: unknown) {
      if (!error || typeof error !== "object" || types.isProxy(error) || !types.isNativeError(error)) return;
      if (failures.has(error)) {
        failures.set(error, false);
        return;
      }
      const observedAt = performance.now();
      const elapsedMs = Math.round(observedAt - started);
      if (elapsedMs < 0 || elapsedMs > 3600000) return;
      failures.set(error, { request, observedAt, proof: Object.freeze({
        phase, elapsedMs, phaseElapsedMs: Math.round(observedAt - changed)
      }) });
    }
  };
}

export function takeTask12WorkbenchPhase(error: unknown, request: object, notBefore = 0): Task12WorkbenchPhase | undefined {
  if (!error || typeof error !== "object") return;
  const entry = failures.get(error);
  if (!entry || entry.request !== request || entry.observedAt < notBefore || performance.now() - entry.observedAt > 15000) return;
  failures.set(error, false);
  return entry.proof;
}
