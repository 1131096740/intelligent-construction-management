#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectPol21CrossDomainAcceptance } from "./lib/pol21-cross-domain-acceptance.mjs";

const defaultRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function parseArguments(arguments_) {
  if (
    arguments_.length !== 2 ||
    arguments_[0] !== "--check" ||
    arguments_[1] !== "--require-ready"
  ) {
    const error = new Error("Invalid POL-21 acceptance arguments");
    error.code = "POL21_ACCEPTANCE_INVALID_ARGUMENTS";
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
    const error = new Error("POL-21 cannot read the authoritative release checks");
    error.code = "POL21_RELEASE_CHECKS_UNAVAILABLE";
    throw error;
  }
  return result.stdout.split("\n").map((value) => value.trim()).filter(Boolean);
}

async function loadEvidenceSources(root, manifest) {
  const paths = new Set();
  for (const evidence of Object.values(manifest.evidenceCatalog ?? {})) {
    const path = evidence?.testFile;
    if (
      typeof path !== "string" ||
      !/^services\/api\/(?:src|prisma)\/[A-Za-z0-9_./-]+\.(?:ts|cjs)$/u.test(path) ||
      path.split("/").includes("..")
    ) {
      const error = new Error("POL-21 evidence path is invalid");
      error.code = "POL21_EVIDENCE_PATH_INVALID";
      throw error;
    }
    paths.add(path);
  }
  return Object.fromEntries(
    await Promise.all(
      [...paths].map(async (path) => [path, await readFile(join(root, path), "utf8")])
    )
  );
}

export async function runPol21CrossDomainAcceptanceCli(
  arguments_,
  { root = defaultRoot } = {}
) {
  parseArguments(arguments_);
  const [manifestSource, dynamicGateSource, specificationSource] =
    await Promise.all([
      readFile(
        join(root, "docs", "product", "manifests", "pol21-cross-domain-acceptance.json"),
        "utf8"
      ),
      readFile(
        join(root, "services", "api", "prisma", "database-dynamic-gate-manifest.json"),
        "utf8"
      ),
      readFile(
        join(
          root,
          "docs",
          "specs",
          "2026-08-12-project-operating-ledger-construction-enterprise-takeover-unified-entry.md"
        ),
        "utf8"
      )
    ]);
  const manifest = JSON.parse(manifestSource);
  const report = inspectPol21CrossDomainAcceptance({
    manifest,
    dynamicGateManifest: JSON.parse(dynamicGateSource),
    releaseChecks: loadReleaseChecks(root),
    specificationSource,
    evidenceSources: await loadEvidenceSources(root, manifest)
  });
  if (report.status !== "ready") {
    const error = new Error(
      `POL-21 cross-domain acceptance is blocked: ${report.blockers.join(", ")}`
    );
    error.code = "POL21_ACCEPTANCE_BLOCKED";
    error.report = report;
    throw error;
  }
  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runPol21CrossDomainAcceptanceCli(process.argv.slice(2))
    .then((report) => {
      process.stdout.write(
        `POL-21 cross-domain acceptance ready: ${report.mainlineCount}/15 mainlines\n`
      );
    })
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
