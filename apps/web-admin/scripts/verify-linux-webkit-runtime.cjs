"use strict";

const { readFileSync } = require("node:fs");
const { basename, dirname, join } = require("node:path");
const { webkit } = require("@playwright/test");

if (process.platform !== "linux") throw new Error("此检查仅用于 Linux 浏览器验收环境");
const version = require("@playwright/test/package.json").version;
const expected = require("../package.json").devDependencies["@playwright/test"];
if (version !== expected) throw new Error("Playwright 实际版本与固定依赖不一致");

const root = dirname(webkit.executablePath());
const library = readFileSync(join(root, "minibrowser-wpe/sys/lib/libsoup-3.0.so.0"));
const soup = library.toString("latin1").match(/libsoup\/(\d+\.\d+\.\d+)\x00/)?.[1];
// The bundled 3.6.5 can crash the network process during cancelled navigation.
// https://bugs.webkit.org/show_bug.cgi?id=324897
if (soup !== "3.6.6") throw new Error("WebKit 未使用本轮验收的 libsoup 3.6.6");
console.log(JSON.stringify({ playwright: version, webkit: basename(root), libsoup: soup }));
