#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { inspectPol23ReleaseCandidate } from "./lib/pol23-release-candidate.mjs";
import { runPol21CrossDomainAcceptanceCli } from "./inspect-pol21-cross-domain-acceptance.mjs";

const defaultRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function parseArguments(arguments_) {
  if (
    arguments_.length !== 2 ||
    arguments_[0] !== "--check" ||
    arguments_[1] !== "--require-ready"
  ) {
    const error = new Error("Invalid POL-23 candidate arguments");
    error.code = "POL23_CANDIDATE_INVALID_ARGUMENTS";
    throw error;
  }
}

function loadReleaseChecks(root) {
  const result = spawnSync(
    "bash",
    [join(root, "scripts", "ops", "run-local-release-gate.sh"), "--list-checks"],
    { cwd: root, encoding: "utf8" }
  );
  if (result.status !== 0) {
    const error = new Error("POL-23 cannot read the authoritative release checks");
    error.code = "POL23_RELEASE_CHECKS_UNAVAILABLE";
    throw error;
  }
  return result.stdout.split("\n").map((value) => value.trim()).filter(Boolean);
}

export async function runPol23ReleaseCandidateCli(
  arguments_,
  { root = defaultRoot } = {}
) {
  parseArguments(arguments_);
  const [
    manifestSource,
    userFillInventorySource,
    dynamicGateManifestSource,
    localReleaseSource,
    runbookSource,
    pol21Report
  ] = await Promise.all([
    readFile(
      join(root, "docs", "product", "manifests", "pol23-release-candidate.json"),
      "utf8"
    ),
    readFile(
      join(root, "docs", "product", "manifests", "user-fill-entry-inventory.json"),
      "utf8"
    ),
    readFile(
      join(root, "services", "api", "prisma", "database-dynamic-gate-manifest.json"),
      "utf8"
    ),
    readFile(join(root, "scripts", "ops", "run-local-release-gate.sh"), "utf8"),
    readFile(
      join(root, "docs", "runbooks", "pol23-unified-cutover-release-candidate.md"),
      "utf8"
    ),
    runPol21CrossDomainAcceptanceCli(["--check", "--require-ready"], { root })
  ]);
  const report = inspectPol23ReleaseCandidate({
    manifest: JSON.parse(manifestSource),
    releaseChecks: loadReleaseChecks(root),
    userFillInventory: JSON.parse(userFillInventorySource),
    pol21Report,
    dynamicGateManifest: JSON.parse(dynamicGateManifestSource),
    localReleaseSource,
    runbookSource
  });
  if (report.status !== "ready") {
    const error = new Error(
      `POL-23 release candidate is blocked: ${report.blockers.join(", ")}`
    );
    error.code = "POL23_CANDIDATE_BLOCKED";
    error.report = report;
    throw error;
  }
  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runPol23ReleaseCandidateCli(process.argv.slice(2))
    .then(() => process.stdout.write("POL-23 release candidate ready\n"))
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
