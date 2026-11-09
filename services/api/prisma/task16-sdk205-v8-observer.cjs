"use strict";

// Load this observer in the trusted pre-tool phase. It observes a frame only;
// the guard must separately bind the executable, launch and source file.
const { types: { isProxy } } = require("node:util");
const ErrorAtLoad = Error;
const get = Object.getOwnPropertyDescriptor;
const define = Object.defineProperty;
const getPrototypeOf = Object.getPrototypeOf;
const create = Object.create;
const freeze = Object.freeze;
const hasOwn = Object.hasOwn;
const plainPrototype = Object.prototype;
const ownKeys = Reflect.ownKeys;
const integer = Number.isSafeInteger;
const startsWith = String.prototype.startsWith;
const apply = Reflect.apply;
const formatter = get(ErrorAtLoad, "prepareStackTrace");
const stackLimit = get(ErrorAtLoad, "stackTraceLimit");
const capture = get(ErrorAtLoad, "captureStackTrace");
const errorBinding = get(globalThis, "Error");
const methods = ["getFileName", "getScriptNameOrSourceURL", "getLineNumber", "getColumnNumber", "isEval", "isNative"];
let capturing = false;

function same(a, b) {
  return a === b || Boolean(a && b && a.value === b.value && a.get === b.get && a.set === b.set &&
    a.configurable === b.configurable && a.writable === b.writable && a.enumerable === b.enumerable);
}

function primordialsIntact() {
  return same(get(globalThis, "Error"), errorBinding) &&
    same(get(ErrorAtLoad, "captureStackTrace"), capture) &&
    same(get(ErrorAtLoad, "stackTraceLimit"), stackLimit) &&
    same(get(ErrorAtLoad, "prepareStackTrace"), formatter);
}

function firstFrame(skip) {
  if (capturing || !primordialsIntact()) return null;
  const holder = create(null);
  capturing = true;
  try {
    define(ErrorAtLoad, "prepareStackTrace", {
      configurable: true, writable: true, value: (_, frames) => get(frames, "0")?.value ?? null
    });
    apply(capture.value, ErrorAtLoad, [holder, skip]);
    return holder.stack;
  } finally {
    try {
      if (formatter) define(ErrorAtLoad, "prepareStackTrace", formatter);
      else delete ErrorAtLoad.prepareStackTrace;
      if (!primordialsIntact()) throw ErrorAtLoad("SDK205_V8_FRAME_RESTORE");
    } finally {
      capturing = false;
    }
  }
}

if (!primordialsIntact() || typeof capture?.value !== "function" ||
  !integer(stackLimit?.value) || stackLimit.value < 1 ||
  (formatter && (!hasOwn(formatter, "value") || !formatter.configurable))) {
  throw ErrorAtLoad("SDK205_V8_FRAME_INTRINSICS");
}
const sample = firstFrame(firstFrame);
if (!sample) throw ErrorAtLoad("SDK205_V8_FRAME_INTRINSICS");
const prototype = getPrototypeOf(sample);
const descriptors = [];
for (let index = 0; index < methods.length; index++) {
  const descriptor = get(prototype, methods[index]);
  if (typeof descriptor?.value !== "function") throw ErrorAtLoad("SDK205_V8_FRAME_INTRINSICS");
  descriptors[index] = descriptor;
}

function callSiteIntact() {
  for (let index = 0; index < methods.length; index++) {
    if (!same(get(prototype, methods[index]), descriptors[index])) return false;
  }
  return true;
}

function createTask16Sdk205V8Observer(location) {
  if (location === null || typeof location !== "object" || isProxy(location) ||
    getPrototypeOf(location) !== plainPrototype || ownKeys(location).length !== 3) {
    throw ErrorAtLoad("SDK205_V8_FRAME_CONFIG");
  }
  const filename = get(location, "filename")?.value;
  const line = get(location, "line")?.value;
  const column = get(location, "column")?.value;
  if (typeof filename !== "string" || !apply(startsWith, filename, ["/"]) ||
    !integer(line) || line < 1 || !integer(column) || column < 1) {
    throw ErrorAtLoad("SDK205_V8_FRAME_CONFIG");
  }
  if (!primordialsIntact() || !callSiteIntact()) throw ErrorAtLoad("SDK205_V8_FRAME_INTRINSICS");

  return function observe(canonicalMkdir) {
    if (typeof canonicalMkdir !== "function" || isProxy(canonicalMkdir) || !callSiteIntact()) return null;
    const frame = firstFrame(canonicalMkdir);
    if (!frame || getPrototypeOf(frame) !== prototype || !callSiteIntact()) return null;
    if (apply(descriptors[0].value, frame, []) !== filename ||
      apply(descriptors[1].value, frame, []) !== filename ||
      apply(descriptors[2].value, frame, []) !== line ||
      apply(descriptors[3].value, frame, []) !== column ||
      apply(descriptors[4].value, frame, []) !== false ||
      apply(descriptors[5].value, frame, []) !== false) return null;
    return freeze({ filename, line, column });
  };
}

module.exports = { createTask16Sdk205V8Observer };
