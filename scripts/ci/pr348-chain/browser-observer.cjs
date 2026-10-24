"use strict";
const fs = require("node:fs");
const PREFIX = "[jg-pr348-chain]";
const ROUTES = new Set(["unknown", "options", "preview", "apply"]);
const PHASES = new Set(["submit-enter", "submit-catch", "submit-finally", "submit-guard-passed", "submit-await-apply-before", "submit-await-apply-resolved", "saved-emit-before", "saved-emit-returned", "apply-options-before", "apply-options-resolved", "apply-post-call", "parent-saved-enter", "parent-visible-false", "parent-reload-resolved", "read-fetch-before", "read-fetch-headers", "read-ensure-ok", "read-json-call", "send-fetch-before", "send-fetch-headers", "send-ensure-ok", "send-json-call", "fetch-before", "fetch-headers", "fetch-rejected", "json-before", "json-resolved", "json-rejected", "pointerdown", "pointerup", "click", "dom-drawer-count", "observer-overflow"]);
function installBrowserObserver() {
  const prefix = "[jg-pr348-chain]";
  let sequence = 0, operation = "unknown", lastCount = -1;
  const record = (phase, route = "unknown", extra = {}) => {
    try {
      sequence++;
      const now = performance.now();
      if (sequence > 2000) {
        if (sequence === 2001) console.info(prefix + JSON.stringify({ schemaVersion: 1, sequence: 2001, phase: "observer-overflow", route: "unknown", operation: "unknown", browserMonotonicMs: now, browserEpochMs: performance.timeOrigin + now }));
        return;
      }
      if (route === "unknown" && /^(read|send|fetch|json)-/.test(phase)) return;
      console.info(prefix + JSON.stringify({ schemaVersion: 1, sequence, phase, route, operation,
        browserMonotonicMs: now, browserEpochMs: performance.timeOrigin + now, ...extra }));
    } catch {}
  };
  Object.defineProperty(globalThis, "__jgPr348Emit", { value: record, writable: false, configurable: false });
  for (const phase of ["pointerdown", "pointerup", "click"]) {
    document.addEventListener(phase, event => {
      try {
        const button = event.target instanceof Element ? event.target.closest("button") : null;
        if (!button) return;
        const label = (button.textContent || "").trim();
        const selected = label === "确认调入项目" ? "join" : label === "确认调出项目" ? "leave" : null;
        if (!selected) return;
        operation = selected;
        const rect = button.getBoundingClientRect();
        const atPoint = Number.isFinite(event.clientX) && Number.isFinite(event.clientY) ? document.elementFromPoint(event.clientX, event.clientY) : null;
        record(phase, "unknown", { disabled: Boolean(button.disabled), ariaDisabled: button.getAttribute("aria-disabled") === "true",
          pointWithinButton: Boolean(atPoint && (atPoint === button || button.contains(atPoint))),
          geometry: [rect.x, rect.y, rect.width, rect.height].map(value => Math.round(value * 100) / 100) });
      } catch {}
    }, true);
  }
  const check = () => {
    try {
      const count = document.querySelectorAll(".t-drawer__content-wrapper").length;
      if (count === lastCount) return;
      lastCount = count; record("dom-drawer-count", "unknown", { count });
    } catch {}
  };
  new MutationObserver(check).observe(document, { childList: true, subtree: true });
  check();
}
function sanitize(value) {
  if (!value || value.schemaVersion !== 1 || !PHASES.has(value.phase) || !ROUTES.has(value.route) || !["join", "leave", "unknown"].includes(value.operation) ||
      !Number.isSafeInteger(value.sequence) || value.sequence < 1 || value.sequence > (value.phase === "observer-overflow" ? 2001 : 2000) ||
      !Number.isFinite(value.browserMonotonicMs) || value.browserMonotonicMs < 0 || !Number.isFinite(value.browserEpochMs)) return null;
  if (value.phase === "observer-overflow" && (value.sequence !== 2001 || value.route !== "unknown" || value.operation !== "unknown")) return null;
  const out = { schemaVersion: 1, sequence: value.sequence, phase: value.phase, route: value.route, operation: value.operation,
    browserMonotonicMs: value.browserMonotonicMs, browserEpochMs: value.browserEpochMs };
  if (["pointerdown", "pointerup", "click"].includes(value.phase)) {
    if (!Array.isArray(value.geometry) || value.geometry.length !== 4 || !value.geometry.every(Number.isFinite)) return null;
    out.geometry = value.geometry.map(number => Math.round(number * 100) / 100);
    for (const key of ["disabled", "ariaDisabled", "pointWithinButton"]) if (typeof value[key] === "boolean") out[key] = value[key];
  }
  if (value.phase === "dom-drawer-count" && Number.isSafeInteger(value.count) && value.count >= 0 && value.count <= 10) out.count = value.count;
  return out;
}
function collectConsole(message, file, state) {
  try {
    state.attempted ??= state.rows || 0; state.dropped ??= 0; state.writeFailures ??= 0;
    const text = message.text();
    if (!text.startsWith(PREFIX) || text.length > 2000) return;
    let safe = sanitize(JSON.parse(text.slice(PREFIX.length)));
    if (!safe) return;
    if (state.overflow) { state.dropped++; return; }
    if (state.attempted >= 2000 && safe.phase !== "observer-overflow") {
      state.dropped++;
      safe = { schemaVersion: 1, sequence: 2001, phase: "observer-overflow", route: "unknown", operation: "unknown", browserMonotonicMs: safe.browserMonotonicMs, browserEpochMs: safe.browserEpochMs };
    } else state.attempted++;
    if (safe.phase === "observer-overflow") state.overflow = true;
    fs.appendFileSync(file, JSON.stringify({ ...safe, collectorEpochMs: Date.now() }) + "\n", { mode: 0o600 });
    state.rows++;
  } catch { state.writeFailures = (state.writeFailures || 0) + 1; }
}
function finishConsole(file, state) {
  try {
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, rowsWritten: state.rows || 0, rowsAttempted: state.attempted || 0,
      rowsDropped: state.dropped || 0, writeFailures: state.writeFailures || 0, overflow: Boolean(state.overflow) }) + "\n", { flag: "wx", mode: 0o600 });
  } catch { /* Missing collector summary makes projection incomplete. */ }
}
module.exports = { installBrowserObserver, collectConsole, finishConsole, sanitize, PREFIX, PHASES, ROUTES };
