"use strict";

// Installation is limited to an injected synthetic module table. There is no
// fallback to Node's loader, native process, or filesystem.
const { types: { isPromise, isProxy } } = require("node:util");
const { claimTask16Sdk205PreloadEntry } = require("./task16-sdk205-guard.cjs");
const fault = code => Object.assign(new Error(code), { code });
const need = (condition, code) => { if (!condition) throw fault(code); };

const bindings = ["fs", "node:fs", "fs/promises", "node:fs/promises", "child_process", "node:child_process",
  "module", "process", "network"];

function plain(value) {
  return value !== null && typeof value === "object" && !isProxy(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function descriptor(object, key) {
  const value = plain(object) ? Object.getOwnPropertyDescriptor(object, key) : undefined;
  return value?.enumerable && Object.hasOwn(value, "value") ? value : undefined;
}

function exact(object, keys) {
  return plain(object) && Reflect.ownKeys(object).length === keys.length && keys.every(key => descriptor(object, key));
}

function sync(action, code) {
  let result;
  try { result = action(); } catch { throw fault(code); }
  if (isPromise(result)) {
    Promise.prototype.then.call(result, undefined, () => {});
    throw fault(code);
  }
  return result;
}

function readTable(table) {
  need(exact(table, bindings), "SDK205_PRELOAD_HOOK_TABLE");
  const before = Object.getOwnPropertyDescriptors(table);
  need(bindings.every(key => before[key].configurable && plain(before[key].value)), "SDK205_PRELOAD_HOOK_TABLE");
  need(before.fs.value === before["node:fs"].value &&
    descriptor(before.fs.value, "promises")?.value === before["fs/promises"].value &&
    before["fs/promises"].value === before["node:fs/promises"].value &&
    before.child_process.value === before["node:child_process"].value, "SDK205_PRELOAD_ALIAS");
  return before;
}

function installedDescriptors(api, before) {
  const methods = {
    fs: api.fs, "node:fs": api.fs, "fs/promises": api.fs.promises, "node:fs/promises": api.fs.promises,
    child_process: api.childProcess, "node:child_process": api.childProcess, module: api.module,
    process: api.process, network: api.network
  };
  return Object.fromEntries(bindings.map(key => [key, { ...before[key], value: methods[key] }]));
}

function sameDescriptor(a, b) {
  return Boolean(a && b && a.value === b.value && a.enumerable === b.enumerable &&
    a.configurable === b.configurable && a.writable === b.writable && Object.hasOwn(a, "value"));
}

function faultCode(error) {
  return typeof error?.code === "string" && /^SDK205_[A-Z0-9_]+$/u.test(error.code) ? error.code : "SDK205_PRELOAD_FAILED";
}

async function installTask16Sdk205Preload(manifest, boundary) {
  const api = descriptor(boundary, "guardedApi")?.value;
  const entry = claimTask16Sdk205PreloadEntry(api);
  let restore;
  try {
    need(exact(boundary, ["guardedApi", "readLaunch", "inspect", "loader"]) &&
      typeof boundary.readLaunch === "function" && typeof boundary.inspect === "function", "SDK205_PRELOAD_BOUNDARY");
    const { readLaunch, inspect, loader } = boundary;
    need(exact(loader, ["table", "loaded", "replace", "enter"]) &&
      [loader.loaded, loader.replace, loader.enter].every(fn => typeof fn === "function"), "SDK205_PRELOAD_BOUNDARY");
    const { table, loaded, replace, enter } = loader;
    const check = () => entry.check(manifest, sync(readLaunch, "SDK205_PRELOAD_LAUNCH"), sync(inspect, "SDK205_PRELOAD_PROCESS"));
    const unloaded = () => {
      const members = sync(loaded, "SDK205_PRELOAD_LOADED");
      need(Array.isArray(members) && !isProxy(members) && members.length === 0, "SDK205_PRELOAD_LOADED");
    };
    check();
    unloaded();
    const before = readTable(table);
    const installed = installedDescriptors(api, before);
    const unchanged = expected => exact(table, bindings) &&
      bindings.every(key => sameDescriptor(Object.getOwnPropertyDescriptor(table, key), expected[key]));
    let restored;
    restore = () => {
      if (restored !== undefined) return restored && unchanged(before);
      for (const key of [...bindings].reverse()) {
        if (sameDescriptor(Object.getOwnPropertyDescriptor(table, key), before[key])) continue;
        try { sync(() => replace(key, before[key]), "SDK205_PRELOAD_CLEANUP_UNCONFIRMED"); } catch { /* Readback decides. */ }
      }
      restored = unchanged(before);
      return restored;
    };
    entry.ownCleanup(restore);
    for (const key of bindings) {
      sync(() => replace(key, installed[key]), "SDK205_PRELOAD_HOOK_INSTALL");
      need(sameDescriptor(Object.getOwnPropertyDescriptor(table, key), installed[key]), "SDK205_PRELOAD_HOOK_INSTALL");
    }
    need(unchanged(installed), "SDK205_PRELOAD_HOOK_INSTALL");
    check();
    unloaded();
    let entered = false;
    return Object.freeze({
      status: "SIMULATED_PRELOAD_INSTALLED",
      async enter() {
        if (entered) return entry.reject("SDK205_PRELOAD_REPLAY");
        entered = true;
        let result, failure;
        try {
          check();
          unloaded();
          need(unchanged(installed), "SDK205_PRELOAD_HOOK_CHANGED");
          entry.enter();
          result = await enter();
          check();
          need(unchanged(installed), "SDK205_PRELOAD_HOOK_CHANGED");
        } catch (error) { failure = error; }
        if (!restore()) return entry.reject("SDK205_PRELOAD_CLEANUP_UNCONFIRMED");
        if (failure) return entry.reject(faultCode(failure));
        return result;
      }
    });
  } catch (error) {
    if (restore && !restore()) return entry.reject("SDK205_PRELOAD_CLEANUP_UNCONFIRMED");
    return entry.reject(faultCode(error));
  }
}

module.exports = { installTask16Sdk205Preload };
