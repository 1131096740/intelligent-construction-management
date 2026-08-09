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
    receipt.schemaVersion === 1 &&
    receipt.status === "passed" &&
    typeof receipt.verifiedAt === "string" &&
    receipt.verifiedAt.endsWith("Z") &&
    Number.isFinite(Date.parse(receipt.verifiedAt)) &&
    typeof receipt.nodeVersion === "string" &&
    /^20\.\d+\.\d+$/.test(receipt.nodeVersion) &&
    typeof receipt.pnpmVersion === "string" &&
    /^9\.\d+\.\d+$/.test(receipt.pnpmVersion) &&
    hasExactCheckSet;
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
