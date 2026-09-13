import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrationPath = resolve(
  __dirname,
  "../../prisma/migrations/20260912100000_pol284_participant_history_integrity/migration.sql"
);
const runtimeGrantPath = resolve(
  __dirname,
  "../../../../scripts/ops/grant-project-participating-company-fence-runtime-role.sh"
);
const runtimeVerifyPath = resolve(
  __dirname,
  "../../../../scripts/ops/verify-operating-ledger-runtime-role.sh"
);

describe("POL-284 participant history integrity migration", () => {
  it("adds all seven stable/version participant history indexes", () => {
    const sql = readFileSync(migrationPath, "utf8");
    const roles = [
      "debtor",
      "creditor",
      "approvedPayer",
      "actualPayer",
      "payee",
      "costBearingCompany"
    ];

    for (const role of roles) {
      expect(sql).toContain(
        `CREATE INDEX "OperatingFact_participant_${role}_history_idx"`
      );
      expect(sql).toContain(
        `("projectId", "${role}SubjectId", "occurredAt")`
      );
      expect(sql).toContain(`WHERE "${role}SubjectKind" = 'participating_company'`);
    }
    expect(sql).toContain(
      'CREATE INDEX "OperatingImpactEntry_participant_subject_history_idx"'
    );
    expect(sql).toContain('("projectId", "subjectId", "factId")');
    expect(sql).toContain('WHERE "subjectKind" = \'participating_company\'');
  });

  it("upgrades every participant invariant reader to stable ordered FOR SHARE locking", () => {
    const sql = readFileSync(migrationPath, "utf8");

    for (const functionName of [
      "requireActiveProjectParticipatingCompany",
      "validateOperatingFactReferences",
      "validateOperatingImpactEntryReferences",
      "activateProjectOperatingLedger",
      "protectProjectParticipatingCompanyEndDate",
      "protectFactfulProjectParticipatingCompany"
    ]) {
      expect(sql).toContain(functionName);
    }
    expect(sql).toContain('ORDER BY participant."id" FOR SHARE');
    expect(sql).toContain('participant."companyEntityVersionId"');
    expect(sql).toContain('pg_get_functiondef(\'"validateOperatingFactReferences"()\'::REGPROCEDURE)');
    expect(sql).toContain('jg_validate_canonical_wage_operating_fact(NEW)');
    expect(sql).toContain('pg_get_functiondef(\'"validateOperatingImpactEntryReferences"()\'::REGPROCEDURE)');
    expect(sql).toContain("fact_source_type = ''fund_execution''");
  });

  it("adds a project-scoped mutation fence and fail-closed terminal-function gates", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toContain(
      'CREATE TABLE "ProjectParticipatingCompanyMutationFence"'
    );
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public."serializeProjectParticipatingCompanyMutation"'
    );
    const fenceFunction = sql.slice(
      sql.indexOf('CREATE OR REPLACE FUNCTION public."serializeProjectParticipatingCompanyMutation"'),
      sql.indexOf('-- Evaluate the post-mutation participant timeline')
    );
    expect(fenceFunction).toContain("SECURITY DEFINER");
    expect(fenceFunction).toContain("SET search_path = pg_catalog, pg_temp");
    expect(fenceFunction).toContain(
      'INSERT INTO public."ProjectParticipatingCompanyMutationFence" AS fence'
    );
    expect(fenceFunction).toContain('SET "revision" = fence."revision" + 1');
    expect(fenceFunction).toMatch(
      /REVOKE ALL ON FUNCTION\s+public\."serializeProjectParticipatingCompanyMutation"\(TEXT\)\s+FROM PUBLIC/u
    );
    expect(sql).not.toContain(
      'ProjectParticipatingCompanyMutationFence_projectId_fkey'
    );
    expect(sql).not.toMatch(
      /ProjectParticipatingCompanyMutationFence[\s\S]{0,500}REFERENCES "Project"/u
    );
    expect(sql.match(
      /PERFORM public\."serializeProjectParticipatingCompanyMutation"\(OLD\."projectId"\);/gu
    )).toHaveLength(2);
    expect(sql).toContain(
      '"revision" = fence."revision" + 1'
    );
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION "hasProjectParticipatingCompanyCoverage"'
    );
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION "hasProjectParticipatingCompanyOperatingReferences"'
    );

    for (const functionName of [
      "requireActiveProjectParticipatingCompany",
      "protectProjectParticipatingCompanyEndDate",
      "protectFactfulProjectParticipatingCompany",
      "activateProjectOperatingLedger"
    ]) {
      expect(sql).toContain(
        `pg_get_functiondef('"${functionName}"()'::REGPROCEDURE)`
      );
    }
    expect(sql).toContain(
      'PERFORM 1 FROM "ProjectParticipatingCompany"'
    );
    expect(sql).toContain(
      'regexp_count(current_definition, \'FOR KEY SHARE\') < 3'
    );
    expect(sql).toContain("terminal semantics drifted; refusing replacement");
  });

  it("provisions and verifies only EXECUTE access to the internal fence function", () => {
    const grantScript = readFileSync(runtimeGrantPath, "utf8");
    const verifyScript = readFileSync(runtimeVerifyPath, "utf8");

    expect(grantScript).toContain(
      'GRANT EXECUTE ON FUNCTION public."serializeProjectParticipatingCompanyMutation"(TEXT)'
    );
    expect(grantScript).toContain(
      'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public."ProjectParticipatingCompanyMutationFence"'
    );
    expect(verifyScript).toContain(
      'public."serializeProjectParticipatingCompanyMutation"(text)'
    );
    expect(verifyScript).toContain(
      "operating-ledger runtime role retains direct participant fence write privilege"
    );
  });

  it("protects facts and enabled-ledger coverage without a reverse Project lock", () => {
    const sql = readFileSync(migrationPath, "utf8");
    const endDateGuard = sql.slice(
      sql.indexOf('CREATE OR REPLACE FUNCTION "protectProjectParticipatingCompanyEndDate"'),
      sql.indexOf('CREATE OR REPLACE FUNCTION "protectFactfulProjectParticipatingCompany"')
    );

    expect(endDateGuard).toContain('"hasProjectParticipatingCompanyCoverage"');
    expect(endDateGuard).toContain('NEW."effectiveFrom"');
    expect(endDateGuard).toContain('NEW."endedAt"');
    expect(endDateGuard).toContain('"hasProjectParticipatingCompanyOperatingReferences"');
    expect(endDateGuard).not.toContain('FROM "OperatingFact" fact');
    expect(endDateGuard).not.toContain('FROM "OperatingImpactEntry" impact');
    expect(endDateGuard).not.toContain('other_participant');
    expect(endDateGuard).not.toContain("FOR UPDATE");

    const deleteGuard = sql.slice(
      sql.indexOf('CREATE OR REPLACE FUNCTION "protectFactfulProjectParticipatingCompany"'),
      sql.indexOf('CREATE OR REPLACE FUNCTION "activateProjectOperatingLedger"')
    );
    expect(deleteGuard).toContain('"hasProjectParticipatingCompanyCoverage"');
    expect(deleteGuard).toContain('"hasProjectParticipatingCompanyOperatingReferences"');
    expect(deleteGuard).not.toContain('FROM "OperatingFact" fact');
    expect(deleteGuard).not.toContain('FROM "OperatingImpactEntry" impact');
    expect(deleteGuard).not.toContain('other_participant');
    expect(deleteGuard).not.toContain("FOR UPDATE");

    const coverageHelper = sql.slice(
      sql.indexOf('CREATE OR REPLACE FUNCTION "hasProjectParticipatingCompanyCoverage"'),
      sql.indexOf('CREATE OR REPLACE FUNCTION "hasProjectParticipatingCompanyOperatingReferences"')
    );
    expect(coverageHelper).toContain("range_agg(candidate.coverage)");
    expect(coverageHelper).toContain("daterange(ledger_effective_date, NULL, '[)')");
    expect(coverageHelper).toContain("'{}'::DATEMULTIRANGE");

    const operatingReferenceHelper = sql.slice(
      sql.indexOf('CREATE OR REPLACE FUNCTION "hasProjectParticipatingCompanyOperatingReferences"'),
      sql.indexOf('-- These four functions are redefined below')
    );
    for (const role of [
      "debtor", "creditor", "approvedPayer", "actualPayer", "payee", "costBearingCompany"
    ]) {
      expect(operatingReferenceHelper).toContain(`${role}SubjectKind`);
      expect(operatingReferenceHelper).toContain(`${role}SubjectId`);
    }
    expect(operatingReferenceHelper).toContain(
      'INNER JOIN "OperatingFact" fact ON fact."id" = impact."factId"'
    );
    expect(operatingReferenceHelper).toContain(
      'impact."projectId" = fact."projectId"'
    );
  });
});
