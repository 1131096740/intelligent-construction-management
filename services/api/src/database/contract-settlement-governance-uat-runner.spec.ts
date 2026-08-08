import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const browserRunner = createRequire(__filename)("../../prisma/run-real-role-browser-uat.cjs") as {
  evidenceFilesFor(evidencePath: string): string[];
  finalizeBrowserEvidence(input: { evidenceFiles: string[]; candidateSha: string }): void;
  resolveSelfArchiveContractId(input: {
    governanceEvidencePath: string;
    runId: string;
    candidateSha: string;
  }): string;
  writeFailedBrowserEvidence(input: { evidenceFiles: string[]; candidateSha: string }): void;
};

const prismaRoot = resolve(__dirname, "../../prisma");
const governedRunner = readFileSync(
  resolve(prismaRoot, "run-contract-settlement-governance-uat.cjs"),
  "utf8"
);
const localRunner = readFileSync(
  resolve(prismaRoot, "run-contract-settlement-governance-uat-local.cjs"),
  "utf8"
);
const trialRunVerifier = readFileSync(
  resolve(prismaRoot, "verify-trial-run.cjs"),
  "utf8"
);
const settlementSignatureStart = trialRunVerifier.indexOf(
  "async function prepareSettlementSignatures"
);
const settlementSignatureEnd = trialRunVerifier.indexOf(
  "\nasync function prepareGovernedSettlementDraft",
  settlementSignatureStart
);
const settlementSignatureSource = trialRunVerifier.slice(
  settlementSignatureStart,
  settlementSignatureEnd
);
const browserCandidateSha = "53fea6fe0e8d45587535142186e3588bec3aa946";
const browserRunId = "issue15-browser-53fea6f";
const selfArchiveContractId = "b44383d7-32e2-4740-8ba3-d3cdd0a39a0c";

function withBrowserRunnerDirectory(run: (directory: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), "jiangkong-real-browser-runner-"));
  try {
    run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function writeGovernanceEvidence(
  file: string,
  evidenceIds = [`${browserRunId}:${selfArchiveContractId}`],
  candidateSha = browserCandidateSha,
  passed = true
) {
  writeFileSync(file, `${JSON.stringify({
    runId: browserRunId,
    candidateSha,
    cases: [{ id: "contract_director_handler_self_archive", passed, evidenceIds }]
  })}\n`);
}

function writePendingBrowserEvidence(file: string) {
  writeFileSync(file, `${JSON.stringify({
    schemaVersion: 1,
    gate: "rc06-real-api-backed-browser",
    status: "pending",
    candidateSha: browserCandidateSha,
    requestStatusCounts: { 400: 1, 403: 1, 409: 1, 503: 1 },
    browserErrors: [],
    failedRequests: [],
    testFailures: []
  })}\n`);
}

describe("contract settlement governance UAT runners", () => {
  it("keeps the governed runner fail-closed and covers the exact 21 release cases", () => {
    const caseIds = [
      "contract_material_purchase",
      "contract_equipment_rental",
      "contract_labor_subcontract",
      "contract_professional_subcontract",
      "contract_generic",
      "contract_director_initiator_self_review",
      "contract_director_handler_self_archive",
      "contract_final_or_sign",
      "contract_authorization_none_none",
      "contract_authorization_first_only",
      "contract_authorization_counterparty_only",
      "contract_authorization_both",
      "contract_change_9_99_percent",
      "contract_change_10_percent",
      "contract_change_10_01_percent",
      "settlement_material_route",
      "settlement_labor_route",
      "settlement_single_page_signatures",
      "settlement_multi_page_signatures",
      "readonly_cross_domain_positive",
      "readonly_cross_domain_negative"
    ];

    expect(caseIds).toHaveLength(21);
    for (const caseId of caseIds) {
      expect(governedRunner).toContain(`"${caseId}"`);
    }
    expect(governedRunner).toContain("productionData: false");
    expect(governedRunner).toContain('storageDriver: "local"');
    expect(governedRunner).toContain("writeFileSync(temporary");
    expect(governedRunner).toContain("renameSync(temporary, output)");
    expect(governedRunner).toContain("UAT 拒绝非本机 PostgreSQL");
    expect(governedRunner).toContain("UAT 拒绝疑似生产数据库");
  });

  it("creates and always cleans an isolated database, API and file-storage runtime", () => {
    expect(localRunner).toContain('"postgres:16"');
    expect(localRunner).toContain('"migrate", "deploy"');
    expect(localRunner).toContain('"services/api/prisma/seed.cjs"');
    expect(localRunner).toContain('HOST: "127.0.0.1"');
    expect(localRunner).toContain('FILE_STORAGE_DRIVER: "local"');
    expect(localRunner).toContain('"status", "--porcelain"');
    expect(localRunner).toContain("候选工作树必须洁净");
    expect(localRunner).toContain("run-contract-settlement-governance-uat.cjs");
    expect(localRunner).toContain("verify-trial-run.cjs");
    expect(localRunner).toContain("removeContainer");
    expect(localRunner).toContain("removeTemporaryRoot");
    expect(localRunner).toContain("await cleanup()");
  });

  it("keeps the trial-run verifier read-only by default and requires an isolated write flag", () => {
    expect(trialRunVerifier).toContain(
      'const IS_ISOLATED_WRITE_UAT = process.argv.includes("--isolated-write-uat")'
    );
    expect(trialRunVerifier).toContain("if (!IS_ISOLATED_WRITE_UAT)");
    expect(trialRunVerifier).toContain("默认只读检查通过");
    expect(localRunner).toContain('"--isolated-write-uat"');
  });

  it("uses the dual-department takeover protocol only inside isolated write UAT", () => {
    expect(trialRunVerifier).toContain(
      "`/projects/${PROJECT_ID}/contract-takeovers/${takeover.id}/contract-side`"
    );
    expect(trialRunVerifier).toContain(
      "`/projects/${PROJECT_ID}/contract-takeovers/${takeover.id}/finance-side`"
    );
    expect(trialRunVerifier).toContain(
      "`/projects/${PROJECT_ID}/contract-takeovers/${takeover.id}/contract-side/confirmation`"
    );
    expect(trialRunVerifier).toContain(
      "`/projects/${PROJECT_ID}/contract-takeovers/${takeover.id}/finance-side/confirmation`"
    );
    expect(trialRunVerifier).not.toContain(
      "`/projects/${PROJECT_ID}/contract-takeovers/${takeover.id}/confirmation`"
    );
  });

  it("prepares settlement signatures through the personal signature route", () => {
    expect(trialRunVerifier).toMatch(/async function uploadCanvasSignature\(/u);
    expect(settlementSignatureSource).toMatch(
      /uploadCanvasSignature\(\s*`UAT-\$\{RUN_ID\}-\$\{role\}-signature\.png`,\s*signaturePng,\s*tokens\[role\]/u
    );
    expect(settlementSignatureSource).not.toMatch(
      /uploadPrivateBuffer\(\s*`UAT-\$\{RUN_ID\}-\$\{role\}-signature\.png`/u
    );
    expect(settlementSignatureSource).toContain("signature.signatureFileId");
    expect(settlementSignatureSource).not.toContain("signatureFileId: signature.id");
  });

  it("derives the browser self-archive contract route from the governed evidence UUID", () => {
    withBrowserRunnerDirectory((directory) => {
      const governanceEvidencePath = join(directory, "governance.json");
      writeGovernanceEvidence(governanceEvidencePath);

      expect(browserRunner.resolveSelfArchiveContractId({
        governanceEvidencePath,
        runId: browserRunId,
        candidateSha: browserCandidateSha
      })).toBe(selfArchiveContractId);
    });
  });

  it("rejects an unbound, non-UUID, or candidate-mismatched browser self-archive fixture", () => {
    withBrowserRunnerDirectory((directory) => {
      const governanceEvidencePath = join(directory, "governance.json");
      writeGovernanceEvidence(governanceEvidencePath, [`${browserRunId}:not-a-contract-id`]);
      expect(() => browserRunner.resolveSelfArchiveContractId({
        governanceEvidencePath,
        runId: browserRunId,
        candidateSha: browserCandidateSha
      })).toThrow("合同 UUID");

      writeGovernanceEvidence(governanceEvidencePath, [`another-run:${selfArchiveContractId}`]);
      expect(() => browserRunner.resolveSelfArchiveContractId({
        governanceEvidencePath,
        runId: browserRunId,
        candidateSha: browserCandidateSha
      })).toThrow("runId");

      writeGovernanceEvidence(governanceEvidencePath, undefined, "0".repeat(40));
      expect(() => browserRunner.resolveSelfArchiveContractId({
        governanceEvidencePath,
        runId: browserRunId,
        candidateSha: browserCandidateSha
      })).toThrow("SHA");

      writeGovernanceEvidence(governanceEvidencePath, undefined, browserCandidateSha, false);
      expect(() => browserRunner.resolveSelfArchiveContractId({
        governanceEvidencePath,
        runId: browserRunId,
        candidateSha: browserCandidateSha
      })).toThrow("未通过");
    });
  });

  it("marks stale worker receipts failed when Playwright fails and never promotes them again", () => {
    withBrowserRunnerDirectory((directory) => {
      const files = browserRunner.evidenceFilesFor(join(directory, "browser.json"));
      for (const file of files) writePendingBrowserEvidence(file);

      browserRunner.finalizeBrowserEvidence({ evidenceFiles: files, candidateSha: browserCandidateSha });
      expect(files.map((file) => JSON.parse(readFileSync(file, "utf8")).status)).toEqual(["passed", "passed"]);

      browserRunner.writeFailedBrowserEvidence({ evidenceFiles: files, candidateSha: browserCandidateSha });
      expect(files.map((file) => JSON.parse(readFileSync(file, "utf8")).status)).toEqual(["failed", "failed"]);
      expect(() => browserRunner.finalizeBrowserEvidence({
        evidenceFiles: files,
        candidateSha: browserCandidateSha
      })).toThrow("未通过");
    });
  });
});
