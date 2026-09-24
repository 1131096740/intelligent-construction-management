"use strict";
/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require("node:fs");
const os = require("node:os");
const dns = require("node:dns/promises");

// Current authorization is local synthetic verification only. This guard is
// mandatory for execute/postcheck; no environment switch disables it.
async function assertLocalExecutionBoundary(source) {
  const reject = () => { throw new Error("LOCAL_ISOLATION_REQUIRED"); };
  if (process.platform !== "linux" || !fs.existsSync("/.dockerenv") || source.environment !== "isolated-test") reject();
  const addresses = Object.values(os.networkInterfaces()).flat().filter(Boolean);
  if (!addresses.length || addresses.some(item => !item.internal || !["127.0.0.1", "::1"].includes(item.address))) reject();
  const routes = fs.readFileSync("/proc/net/route", "utf8").trim().split("\n").slice(1);
  if (routes.some(line => line.trim() && line.trim().split(/\s+/u)[0] !== "lo")) reject();
  for (const [key, database] of [["DATABASE_URL", "orphan_cleanup_test"],
    ["ISOLATED_FILE_CLEANUP_RESTORE_DATABASE_URL", "orphan_cleanup_restore"]]) {
    const url = new URL(process.env[key] || "");
    if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hostname !== "127.0.0.1" ||
        url.port !== "5432" || url.pathname !== `/${database}` ||
        [...url.searchParams].some(([name, value]) => name !== "schema" || value !== "public")) reject();
  }
  if (process.env.COS_BUCKET !== "private-local" || process.env.COS_REGION !== "ap-test") reject();
  const resolved = await dns.lookup("private-local.cos.ap-test.myqcloud.com", { all: true });
  if (!resolved.length || resolved.some(item => item.address !== "127.0.0.1")) reject();
}

module.exports = { assertLocalExecutionBoundary };
