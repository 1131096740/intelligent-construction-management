import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const schema = readFileSync(resolve(root, "prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  resolve(root, "prisma/migrations/20260918170000_pol109_project_close_stages/migration.sql"),
  "utf8"
);

describe("POL-16 project close stage schema", () => {
  it("defines one lock root plus append-only stage versions and command receipts", () => {
    expect(schema).toContain("model ProjectCloseAggregate {");
    expect(schema).toContain("model ProjectCloseStageVersion {");
    expect(schema).toContain("model ProjectCloseCommandReceipt {");
    expect(schema).toContain('@@unique([projectId, stageKey, revision], map: "ProjectCloseStageVersion_project_stage_revision_key")');
    expect(migration).toContain('CREATE TABLE "ProjectCloseAggregate"');
    expect(migration).toContain('CREATE TABLE "ProjectCloseStageVersion"');
    expect(migration).toContain('CREATE TABLE "ProjectCloseCommandReceipt"');
    expect(migration).toContain('CREATE TRIGGER "ProjectCloseStageVersion_immutable"');
    expect(migration).toContain('CREATE TRIGGER "ProjectCloseCommandReceipt_immutable"');
  });

  it("fails closed on unknown stages, invalid revisions and mutable history", () => {
    for (const stage of [
      "construction_completed",
      "owner_settlement_completed",
      "downstream_cost_confirmed",
      "tax_and_enterprise_clearing_completed",
      "final_profit_confirmed",
      "profit_distribution_completed",
      "project_funds_cleared"
    ]) {
      expect(migration).toContain(`'${stage}'`);
    }
    expect(migration).toContain('CHECK ("revision" > 0)');
    expect(migration).toContain("'completed', 'needs_reconfirmation'");
    expect(migration).toContain("POL-109 immutable history cannot be changed");
    expect(migration).toContain("REVOKE UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON TABLE");
  });

  it("hardens dual attestation, final profit, company conservation and execution authorization", () => {
    for (const model of [
      "ProjectCloseProfessionalAttestation",
      "ProjectCloseStageAttestationLink",
      "ProjectCloseProfitConfirmation",
      "ProjectCloseDistribution",
      "ProjectCloseDistributionLine",
      "ProjectProfitDistributionAuthorization"
    ]) {
      expect(schema).toContain(`model ${model} {`);
      expect(migration).toContain(`CREATE TABLE "${model}"`);
    }
    expect(migration).toContain('CREATE CONSTRAINT TRIGGER "ProjectCloseStageVersion_validate_completion"');
    expect(migration).toContain("downstream cost requires contract and finance attestations");
    expect(migration).toContain('CREATE CONSTRAINT TRIGGER "ProjectCloseDistribution_validate_total"');
    expect(migration).toContain("distribution lines do not conserve final profit");
    expect(migration).toContain("distribution subject is not effective at projection cutoff");
    expect(migration).toContain("distribution must cover every company effective at projection cutoff");
    expect(migration).toContain('p."effectiveFrom" <= d."projectionCutoffAt"::date');
    expect(migration).toContain('p."endedAt" > d."projectionCutoffAt"::date');
    expect(migration).toContain('CONSTRAINT "ProjectCloseDistributionLine_participant_fkey"');
    expect(migration).toContain('"finalShareCents" =');
    expect(migration).toContain('"existingFundsAppliedCents" + "actualTransferCents" + "toReceiveCents"');
    expect(migration).toContain('NEW."authorizedAmountCents" IS DISTINCT FROM line_row."toReceiveCents"');
    expect(migration).toContain('distribution_row."projectId" IS DISTINCT FROM NEW."projectId"');
    expect(migration).toContain('distribution_row."projectionFingerprint" IS DISTINCT FROM NEW."projectionFingerprint"');
    expect(migration).toContain('CONSTRAINT "FundMovement_profit_authorization_fkey"');
    expect(migration).toContain('CREATE INDEX "FundMovement_profit_authorization_status_idx"');
    expect(migration).toContain("'fund_execution', 'fund_movement'");
    expect(migration).toContain('CREATE FUNCTION "pol109_validate_profit_movement_lineage"');
    expect(migration).toContain("target_kind = 'profit_distribution_execution'");
    expect(migration).toContain('consumed_amount > authorization_row."authorizedAmountCents"');
  });

  it("serializes stage lineage and temporary profit authorization under database locks", () => {
    expect(schema).toContain("model ProjectTemporaryProfitDistribution {");
    expect(schema).toContain("model ProjectCloseImpact {");
    expect(schema).toContain("model ProjectCloseDecisionSubmission {");
    expect(migration).toContain('CREATE TABLE "ProjectCloseDecisionSubmission"');
    expect(migration).toContain("'final_profit', 'distribution'");
    expect(migration).toContain('CREATE TRIGGER "ProjectCloseDecisionSubmission_immutable"');
    expect(migration).toContain('CREATE FUNCTION "pol109_validate_decision_submission_lineage"()');
    expect(migration).toContain("POL-109 decision submission lineage is not contiguous");
    expect(migration).toContain('FOREIGN KEY ("projectId", "submissionId")');
    expect(schema).toContain("authorizationKind");
    expect(migration).toContain('CREATE FUNCTION "pol109_validate_stage_lineage"()');
    expect(migration).toContain("POL-109 stage lineage is not contiguous");
    expect(schema).toContain("prerequisiteStageVersionIds Json");
    expect(migration).toContain('"prerequisiteStageVersionIds" JSONB NOT NULL');
    expect(migration).toContain("POL-109 prerequisite stage snapshot is not exact");
    expect(migration).toContain('FOREIGN KEY ("projectId", "previousVersionId")');
    expect(migration).toContain('FOREIGN KEY ("projectId", "previousConfirmationId")');
    expect(migration).toContain('FOREIGN KEY ("projectId", "profitConfirmationId")');
    expect(migration).toContain('FOREIGN KEY ("projectId", "previousDistributionId")');
    expect(migration).toContain('CREATE FUNCTION "pol109_validate_temporary_distribution"()');
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("authorizedCumulativeCents");
    expect(migration).toContain("temporary authorization does not match its snapshot");
    expect(migration).toContain('CREATE TRIGGER "ProjectCloseImpact_immutable"');
  });
});
