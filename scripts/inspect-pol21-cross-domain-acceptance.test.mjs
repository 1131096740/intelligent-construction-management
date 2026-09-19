import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { inspectPol21CrossDomainAcceptance } from "./lib/pol21-cross-domain-acceptance.mjs";
import { runPol21CrossDomainAcceptanceCli } from "./inspect-pol21-cross-domain-acceptance.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const requiredAspects = [
  "amount_integrity",
  "subject_isolation",
  "source_traceability",
  "authorization",
  "external_reconciliation"
];

const statements = Array.from(
  { length: 15 },
  (_, index) => `业务验收主线 ${index + 1}`
);

const specificationSource = `
## 28. 业务验收主线

自动化和实现验收必须覆盖：

${statements.map((statement, index) => `${index + 1}. ${statement}；`).join("\n")}

每条主线都必须证明金额不重复、主体不混淆、来源可追溯、权限正确，并能与外部财务或对账资料比较。

## 29. 下一节
`;

function readyFixture() {
  const releaseChecks = [
    "workspace-test",
    "business-errors-and-operations-safety",
    "release-manifests",
    "exact-sha-postgresql-16",
    "playwright-p0",
    "playwright-rc06-mock"
  ];
  return {
    manifest: {
      schemaVersion: 1,
      specSection: 28,
      requiredReleaseChecks: releaseChecks,
      mainlines: statements.map((statement, index) => ({
        id: `POL21-MAINLINE-${String(index + 1).padStart(2, "0")}`,
        statement,
        requiredAspects,
        dynamicGroups: [`group_${String(index + 1).padStart(2, "0")}`],
        releaseChecks: [
          "exact-sha-postgresql-16",
          ...([3, 5, 7, 9, 12, 13, 14].includes(index)
            ? ["playwright-p0"]
            : [])
        ]
      }))
    },
    dynamicGateManifest: {
      inventory: { remainingFiles: 0, remainingTests: 0 },
      coveredGroups: statements.map((_, index) => ({
        id: `group_${String(index + 1).padStart(2, "0")}`,
        state: "executable_local_runner",
        pendingTests: 1,
        testFiles: [{ path: `test-${index + 1}.spec.ts`, pendingTests: 1 }]
      }))
    },
    releaseChecks,
    specificationSource
  };
}

test("accepts all 15 authoritative mainlines only when each has executable PostgreSQL evidence", () => {
  const report = inspectPol21CrossDomainAcceptance(readyFixture());

  assert.equal(report.status, "ready");
  assert.equal(report.mainlineCount, 15);
  assert.deepEqual(report.blockers, []);
});

test("fails closed when a mainline loses a cross-domain invariant or required browser proof", () => {
  const fixture = readyFixture();
  fixture.manifest.mainlines[0].requiredAspects = requiredAspects.slice(0, -1);
  fixture.manifest.mainlines[3].releaseChecks = ["exact-sha-postgresql-16"];

  const report = inspectPol21CrossDomainAcceptance(fixture);

  assert.equal(report.status, "blocked");
  assert.ok(
    report.blockers.includes(
      "POL21_MAINLINE_ASPECTS_INCOMPLETE:POL21-MAINLINE-01"
    )
  );
  assert.ok(
    report.blockers.includes(
      "POL21_MAINLINE_BROWSER_EVIDENCE_MISSING:POL21-MAINLINE-04"
    )
  );
});

test("fails closed when the exact-SHA PostgreSQL gate or one of the six global release gates is removed", () => {
  const fixture = readyFixture();
  fixture.manifest.mainlines[6].releaseChecks = [];
  fixture.manifest.requiredReleaseChecks = fixture.manifest.requiredReleaseChecks
    .filter((check) => check !== "release-manifests");

  const report = inspectPol21CrossDomainAcceptance(fixture);

  assert.equal(report.status, "blocked");
  assert.ok(
    report.blockers.includes(
      "POL21_MAINLINE_EXACT_SHA_EVIDENCE_MISSING:POL21-MAINLINE-07"
    )
  );
  assert.ok(
    report.blockers.includes("POL21_REQUIRED_RELEASE_CHECK_MISSING:release-manifests")
  );
});

test("repository POL-21 manifest passes the public require-ready CLI seam", async () => {
  const report = await runPol21CrossDomainAcceptanceCli(
    ["--check", "--require-ready"],
    { root }
  );

  assert.equal(report.status, "ready");
  assert.equal(report.mainlineCount, 15);
});

test("the fail-closed POL-21 checker is itself mandatory in CI orchestration", async () => {
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));

  assert.match(
    packageJson.scripts["test:ci-orchestration"],
    /scripts\/inspect-pol21-cross-domain-acceptance\.test\.mjs/u
  );
});
