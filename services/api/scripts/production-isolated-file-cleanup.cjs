#!/usr/bin/env node
"use strict";

// Distinct trusted-launcher command. The production path is intentionally
// blocked after validating continuity until the complete adapter is reviewed.
const { productionRunMain } = require("./isolated-file-cleanup.cjs");
module.exports = { runMain: productionRunMain };
if (require.main === module) {
  process.stderr.write("生产清理必须使用受信启动器\n");
  process.exitCode = 1;
}
