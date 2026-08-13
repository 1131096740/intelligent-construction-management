#!/usr/bin/env node
"use strict";

if (require.main === module) {
  throw new Error("归零工具直接 Node 入口已禁用；必须使用受信启动器");
}

const {
  createTrustedEntrypoint,
  outputJson,
  parseOptions,
  readJson
} = require("./business-zeroing-cli.cjs");
const { sha256 } = require("./business-zeroing-core.cjs");

const DEFINITION = {
  input: { flag: "--input", type: "value" },
  output: { flag: "--output", type: "value" }
};

function main() {
  const args = parseOptions(process.argv.slice(2), DEFINITION);
  if (args.help) {
    process.stdout.write(
      "sh services/api/scripts/run-business-zeroing-cli.sh sign --input <未签名JSON> [--output <新路径>]\n"
    );
    return;
  }
  const input = readJson(args.input, "待签名输入");
  if (Object.hasOwn(input, "receiptSha256")) {
    throw new Error("待签名输入不得预置 receiptSha256");
  }
  outputJson({ ...input, receiptSha256: sha256(input) }, args.output);
}

const runMain = createTrustedEntrypoint(main, "归零输入签名失败");

module.exports = { runMain };
