"use strict";
const fs = require("node:fs");
const http = require("node:http");
const { AsyncLocalStorage } = require("node:async_hooks");
const { isPromise } = require("node:util").types;
const nativeThen = Promise.prototype.then;
const contextPaths = require("./context.json");
const SOURCE = contextPaths.source + "/services/api/src/";
const FILE = contextPaths.events + "/backend.jsonl";
const routes = new Set(["/organization/project-roster/options", "/organization/project-roster/preview", "/organization/project-roster/apply"]);
const context = new AsyncLocalStorage();
let suite = "unknown";
try {
  const testPath = expect.getState().testPath;
  if (testPath === SOURCE + "database/employee-onboarding-http-postgres.spec.ts") suite = "onboarding";
  if (testPath === SOURCE + "database/project-roster-http-postgres.spec.ts") suite = "roster";
} catch {}
let ordinal = 0, attempted = 0, rows = 0, dropped = 0, writeFailures = 0;
const restore = [];
function record(phase, extra = {}) {
  try {
    const state = context.getStore();
    if (!state) return;
    if (attempted >= 4000) { dropped++; return; }
    attempted++;
    fs.appendFileSync(FILE, JSON.stringify({ schemaVersion: 1, suite, serverRequestOrdinal: state.ordinal, route: state.route, method: state.method,
      phase, serverMonotonicMs: Number(process.hrtime.bigint()) / 1e6, serverEpochMs: Date.now(), ...extra }) + "\n", { mode: 0o600 });
    rows++;
  } catch { writeFailures++; }
}
function routeOf(request) {
  try {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname.replace(/^\/api(?=\/)/, "");
    if (!routes.has(pathname) || !["GET", "POST"].includes(request.method)) return null;
    return { ordinal: ++ordinal, route: pathname.split("/").pop(), method: request.method };
  } catch { return null; }
}
const originalEmit = http.Server.prototype.emit;
http.Server.prototype.emit = function(event, ...args) {
  if (event !== "request") return originalEmit.call(this, event, ...args);
  const [request, response] = args, state = routeOf(request);
  if (!state) return originalEmit.call(this, event, ...args);
  return context.run(state, () => {
    record("http-request");
    for (const eventName of ["end", "aborted", "close"]) request.once(eventName, () => context.run(state, () => record("http-request-" + eventName, { complete: Boolean(request.complete), aborted: Boolean(request.aborted) })));
    for (const eventName of ["finish", "close"]) response.once(eventName, () => context.run(state, () => record("http-response-" + eventName, {
      status: Number.isSafeInteger(response.statusCode) ? response.statusCode : null,
      writableEnded: Boolean(response.writableEnded), writableFinished: Boolean(response.writableFinished) })));
    return originalEmit.call(this, event, ...args);
  });
};
restore.push(() => { http.Server.prototype.emit = originalEmit; });
function wrap(prototype, name, label, settle) {
  const descriptor = Object.getOwnPropertyDescriptor(prototype, name), original = prototype[name];
  if (typeof original !== "function") throw new Error("fixed backend observer method missing");
  const replacement = function(...args) {
    record(label + ":enter");
    let value;
    try { value = original.apply(this, args); }
    catch(error) { record(label + ":thrown"); throw error; }
    record(label + ":returned");
    // Never inspect or subscribe to lazy PrismaPromise / arbitrary thenables.
    try {
      if (settle && isPromise(value) && context.getStore()) nativeThen.call(value,
        () => { record(label + ":resolved"); }, () => { record(label + ":rejected"); });
    } catch {}
    return value;
  };
  Object.defineProperty(prototype, name, { ...descriptor, configurable: true, writable: true, value: replacement });
  restore.push(() => { if (descriptor) Object.defineProperty(prototype, name, descriptor); else delete prototype[name]; });
}
beforeAll(() => {
for (const [modulePath, exported, methods] of [
  ["organization/project-roster-management.service.ts", "ProjectRosterManagementService", ["options", "preview", "apply", "evaluate"]],
  ["auth/auth.service.ts", "AuthService", ["confirmPassword"]],
  ["organization/permission-impact.service.ts", "PermissionImpactService", ["evaluateRoleRemovalBatch", "evaluateProjectRosterDeparture"]],
  ["auth/guards/jwt-auth.guard.ts", "JwtAuthGuard", ["canActivate"]],
  ["auth/guards/permission.guard.ts", "PermissionGuard", ["canActivate"]],
  ["database/prisma.service.ts", "PrismaService", ["$transaction"]],
  ["audit/audit.service.ts", "AuditService", ["record"]]
]) {
  const type = require(SOURCE + modulePath)[exported];
  if (!type?.prototype) throw new Error("fixed backend observer export missing");
  for (const method of methods) wrap(type.prototype, method, exported + "." + method, exported !== "AuditService");
}
});
afterAll(() => {
  try { fs.appendFileSync(FILE, JSON.stringify({ schemaVersion: 1, suite, phase: "observer-summary", rowLimit: 4000, rowsAttempted: attempted, rowsWritten: rows, rowsDropped: dropped, writeFailures, overflow: dropped > 0 }) + "\n", { mode: 0o600 }); } catch {}
  for (const undo of restore.reverse()) undo();
});
module.exports = { routeOf, wrap };
