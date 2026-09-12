import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrationPath = resolve(
  __dirname,
  "../../prisma/migrations/20260912100000_pol284_participant_history_integrity/migration.sql"
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
      'CREATE OR REPLACE FUNCTION "serializeProjectParticipatingCompanyMutation"'
    );
    expect(sql).not.toContain(
      'ProjectParticipatingCompanyMutationFence_projectId_fkey'
    );
    expect(sql).not.toMatch(
      /ProjectParticipatingCompanyMutationFence[\s\S]{0,500}REFERENCES "Project"/u
    );
    expect(sql.match(
      /PERFORM "serializeProjectParticipatingCompanyMutation"\(OLD\."projectId"\);/gu
    )).toHaveLength(2);
    expect(sql).toContain(
      '"revision" = "ProjectParticipatingCompanyMutationFence"."revision" + 1'
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
    expect(sql).toContain("terminal semantics drifted; refusing replacement");
  });

  it("protects facts and enabled-ledger coverage without a reverse Project lock", () => {
    const sql = readFileSync(migrationPath, "utf8");
    const endDateGuard = sql.slice(
      sql.indexOf('CREATE OR REPLACE FUNCTION "protectProjectParticipatingCompanyEndDate"'),
      sql.indexOf('CREATE OR REPLACE FUNCTION "protectFactfulProjectParticipatingCompany"')
    );

    expect(endDateGuard).toContain('FROM "OperatingFact" fact');
    expect(endDateGuard).toContain('FROM "OperatingImpactEntry" impact');
    expect(endDateGuard).toContain('fact."occurredAt" >= NEW."endedAt"::timestamp');
    expect(endDateGuard).not.toContain('fact."occurredAt"::DATE');
    expect(endDateGuard).toContain('FROM "Project" project');
    expect(endDateGuard).toContain('project."operatingLedgerEffectiveDate"');
    expect(endDateGuard).toContain('other_participant');
    expect(endDateGuard).not.toContain("FOR UPDATE");

    const deleteGuard = sql.slice(
      sql.indexOf('CREATE OR REPLACE FUNCTION "protectFactfulProjectParticipatingCompany"'),
      sql.indexOf('CREATE OR REPLACE FUNCTION "activateProjectOperatingLedger"')
    );
    expect(deleteGuard).toContain('FROM "OperatingFact" fact');
    expect(deleteGuard).toContain('FROM "OperatingImpactEntry" impact');
    expect(deleteGuard).toContain('FROM "Project" project');
    expect(deleteGuard).toContain('project."operatingLedgerEffectiveDate"');
    expect(deleteGuard).toContain('other_participant');
    expect(deleteGuard).not.toContain("FOR UPDATE");
  });
});
