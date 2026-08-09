import { readFileSync } from "node:fs";

const requiredChecks = Object.freeze([
  "ci-orchestration",
  "frozen-dependency-install",
  "prisma-client-generation",
  "production-dependency-audit",
  "workspace-typecheck",
  "web-e2e-typecheck",
  "workspace-lint",
  "business-errors-and-operations-safety",
  "workspace-test",
  "api-and-web-production-build",
  "web-ui-governance",
  "release-manifests",
  "exact-sha-postgresql-16",
  "playwright-p0",
  "playwright-rc06-mock"
]);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if ((option !== "--receipt" && option !== "--candidate-sha") || !value) {
      fail("release receipt is incomplete");
    }
    options[option] = value;
  }
  return options;
}

function hasExactDurations(durationsMs) {
  if (
    durationsMs === null ||
    typeof durationsMs !== "object" ||
    Array.isArray(durationsMs)
  ) {
    return false;
  }
  const durationKeys = Object.keys(durationsMs);
  return (
    durationKeys.length === requiredChecks.length &&
    requiredChecks.every(
      (check) =>
        Object.hasOwn(durationsMs, check) &&
        Number.isInteger(durationsMs[check]) &&
        durationsMs[check] >= 0
    )
  );
}

function readDurations(durationPath) {
  let lines;
  try {
    lines = readFileSync(durationPath, "utf8").split("\n").filter(Boolean);
  } catch {
    fail("release duration ledger is incomplete");
  }

  const entries = [];
  for (const line of lines) {
    const parts = line.split("\t");
    if (parts.length !== 2 || !/^(?:0|[1-9]\d*)$/u.test(parts[1])) {
      fail("release duration ledger is incomplete");
    }
    const duration = Number(parts[1]);
    if (!Number.isSafeInteger(duration)) {
      fail("release duration ledger is incomplete");
    }
    entries.push([parts[0], duration]);
  }

  const durations = Object.fromEntries(entries);
  if (entries.length !== requiredChecks.length || !hasExactDurations(durations)) {
    fail("release duration ledger is incomplete");
  }
  return Object.fromEntries(requiredChecks.map((check) => [check, durations[check]]));
}

function validateReceipt(receiptPath, candidateSha) {
  let receipt;
  try {
    receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  } catch {
    fail("release receipt is incomplete");
  }

  if (receipt.candidateSha !== candidateSha) {
    fail("release receipt does not match target SHA");
  }

  const checks = receipt.checks;
  const hasExactCheckSet =
    Array.isArray(checks) &&
    checks.length === requiredChecks.length &&
    new Set(checks).size === requiredChecks.length &&
    requiredChecks.every((check) => checks.includes(check));
  const isComplete =
    receipt.schemaVersion === 2 &&
    receipt.status === "passed" &&
    typeof receipt.verifiedAt === "string" &&
    receipt.verifiedAt.endsWith("Z") &&
    Number.isFinite(Date.parse(receipt.verifiedAt)) &&
    typeof receipt.nodeVersion === "string" &&
    /^20\.\d+\.\d+$/.test(receipt.nodeVersion) &&
    typeof receipt.pnpmVersion === "string" &&
    /^9\.\d+\.\d+$/.test(receipt.pnpmVersion) &&
    hasExactCheckSet &&
    hasExactDurations(receipt.durationsMs);
  if (!isComplete) {
    fail("release receipt is incomplete");
  }
}

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case "--list-checks":
    if (args.length !== 0) fail("release receipt is incomplete");
    process.stdout.write(`${requiredChecks.join("\n")}\n`);
    break;
  case "--checks-json":
    if (args.length !== 0) fail("release receipt is incomplete");
    process.stdout.write(JSON.stringify(requiredChecks));
    break;
  case "--durations-json":
    if (args.length !== 2 || args[0] !== "--file") {
      fail("release duration ledger is incomplete");
    }
    process.stdout.write(JSON.stringify(readDurations(args[1])));
    break;
  case "--validate": {
    const options = parseOptions(args);
    if (!options["--receipt"] || !options["--candidate-sha"]) {
      fail("release receipt is incomplete");
    }
    validateReceipt(options["--receipt"], options["--candidate-sha"]);
    break;
  }
  default:
    fail("release receipt is incomplete");
}
