#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  inspectUserFillEntryInventory,
  renderUserFillEntryInventory,
  USER_FILL_ENTRY_INVENTORY_PATH,
  writeOrCheckUserFillEntryInventory
} from "./lib/user-fill-entry-inventory.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

function parseArguments(arguments_) {
  if (
    arguments_.length < 1 ||
    arguments_.length > 2 ||
    !["--write", "--check"].includes(arguments_[0]) ||
    (arguments_.length === 2 && arguments_[1] !== "--require-ready") ||
    (arguments_[0] === "--write" && arguments_.length === 2)
  ) {
    const error = new Error("Invalid user-fill entry inventory arguments");
    error.code = "USER_FILL_ENTRY_INVENTORY_INVALID_ARGUMENTS";
    throw error;
  }
  return {
    mode: arguments_[0] === "--write" ? "write" : "check",
    requireReady: arguments_[1] === "--require-ready"
  };
}

export async function runUserFillEntryInventoryCli(
  arguments_ = process.argv.slice(2),
  { root = ROOT } = {}
) {
  const { mode, requireReady } = parseArguments(arguments_);
  const inventory = await inspectUserFillEntryInventory({ root });
  if (requireReady && inventory.status !== "ready") {
    const error = new Error("User-fill entry inventory is blocked");
    error.code = "USER_FILL_ENTRY_INVENTORY_BLOCKED";
    error.details = inventory.blockers;
    throw error;
  }
  await writeOrCheckUserFillEntryInventory({
    mode,
    targetPath: resolve(root, USER_FILL_ENTRY_INVENTORY_PATH),
    rendered: renderUserFillEntryInventory(inventory)
  });
  return inventory;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runUserFillEntryInventoryCli()
    .then((inventory) => {
      console.log(
        `用户可填写入口清单：${inventory.status}，当前业务动作 ${inventory.summary.activeBusinessActionCount}，技术动作 ${inventory.summary.technicalActionCount}，旧写入口 410 ${inventory.summary.retiredWriteEntryCount}，只读旧入口 ${inventory.summary.retainedReadonlyExitCount}，阻塞 ${inventory.summary.blockerCount}`
      );
    })
    .catch((error) => {
      console.error(error.code ?? error.message);
      if (error.details) console.error(JSON.stringify(error.details, null, 2));
      process.exitCode = 1;
    });
}
