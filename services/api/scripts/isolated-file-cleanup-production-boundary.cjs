"use strict";
/* eslint-disable @typescript-eslint/no-var-requires */

const fs = require("node:fs");

// Runtime admission only. The independently signed two-scope write-freeze
// lease, checkout/runtime identity and database fingerprint are checked by
// the coordinator; this module cannot replace any of them.
function assertProductionInspectionBoundary(source, runtime = {
  platform: process.platform,
  inContainer: fs.existsSync("/.dockerenv"),
  environment: process.env
}) {
  const reject = () => { throw new Error("PRODUCTION_RUNTIME_INVALID"); };
  if (runtime.platform !== "linux" || runtime.inContainer ||
      source?.environment !== "production" ||
      runtime.environment?.FILE_STORAGE_DRIVER !== "cos") reject();
  const bucket = runtime.environment.COS_BUCKET;
  const region = runtime.environment.COS_REGION;
  if (typeof bucket !== "string" || !/^[a-z0-9][a-z0-9-]{2,127}$/u.test(bucket) ||
      bucket === "private-local" || typeof region !== "string" ||
      !/^[a-z0-9][a-z0-9-]{2,63}$/u.test(region) || region === "ap-test") reject();
  let url;
  try { url = new URL(runtime.environment.DATABASE_URL || ""); }
  catch { reject(); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.pathname ||
      url.pathname === "/" || url.username !== "jiangkong_runtime" ||
      url.searchParams.has("options")) reject();
}

module.exports = { assertProductionInspectionBoundary };
