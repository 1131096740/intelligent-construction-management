import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

describe("contract settlement governance UAT runners", () => {
  it("keeps the governed runner fail-closed and covers the exact 20 release cases", () => {
    const caseIds = [
      "contract_material_purchase",
      "contract_equipment_rental",
      "contract_labor_subcontract",
      "contract_professional_subcontract",
      "contract_generic",
      "contract_director_initiator_skip",
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

    expect(caseIds).toHaveLength(20);
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
});
