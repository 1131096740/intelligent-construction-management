#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

export const RELEASE_MANIFEST_COMMANDS = [
  {
    command: pnpm,
    args: ["--filter", "@jiangkong/api", "build"]
  },
  {
    command: process.execPath,
    args: [
      "scripts/inspect-contract-workbench-capabilities.mjs",
      "--check",
      "docs/product/contract-workbench-capability-matrix.md"
    ]
  },
  {
    command: process.execPath,
    args: ["scripts/inspect-whole-site-capabilities.mjs", "--check"]
  },
  {
    command: process.execPath,
    args: [
      "scripts/inspect-whole-site-web-api-manifest.mjs",
      "--check",
      "--require-ready"
    ]
  },
  {
    command: process.execPath,
    args: [
      "scripts/inspect-whole-site-page-action-manifest.mjs",
      "--check",
      "--require-ready"
    ]
  },
  {
    command: process.execPath,
    args: [
      "scripts/inspect-whole-site-route-usage-manifest.mjs",
      "--check",
      "--require-ready"
    ]
  },
  {
    command: process.execPath,
    args: ["scripts/inspect-contract-mutation-authority-manifest.mjs", "--check"]
  },
  {
    command: process.execPath,
    args: [
      "scripts/inspect-whole-site-capability-matrix.mjs",
      "--check",
      "--require-ready"
    ]
  }
];

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit"
  });
  if (result.error) {
    console.error(result.error.message);
    return 1;
  }
  return result.status ?? 1;
}

export function runReleaseManifestChecks({
  runCommand: executeCommand = runCommand
} = {}) {
  for (const { command, args } of RELEASE_MANIFEST_COMMANDS) {
    const status = executeCommand(command, args);
    if (status !== 0) return status;
  }
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(runReleaseManifestChecks());
}
