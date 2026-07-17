import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const migrationsPath = join(process.cwd(), "prisma/migrations");
const m54Name = "20260717120000_approval_assignee_and_signature_snapshots";
const m55Name = "20260717130000_contract_formal_documents_authorizations_and_seal_tasks";
const migrationPath = join(migrationsPath, m55Name, "migration.sql");

function validateM55(sql: string) {
  expect(sql.trimStart()).toMatch(/^BEGIN;/u);
  expect(sql.trimEnd()).toMatch(/COMMIT;$/u);
  expect(sql.match(/\bBEGIN;/gu)).toHaveLength(1);
  expect(sql.match(/\bCOMMIT;/gu)).toHaveLength(1);
  expect(sql).not.toMatch(/\bIF\s+(?:NOT\s+)?EXISTS\b/iu);
  expect(sql).not.toMatch(
    /(?:^|;)\s*(?:(?:UPDATE|DELETE|TRUNCATE|DROP)\b|WITH\b[\s\S]*?\b(?:UPDATE|DELETE|INSERT)\b)/iu
  );
  expect(sql).not.toMatch(/(?:^|;)\s*INSERT\s+INTO\b/iu);
  expect(sql).not.toMatch(
    /ALTER\s+TABLE\s+"ContractVersion"[\s\S]*?ALTER\s+COLUMN\s+"contractGovernanceVersion"\s+SET\s+(?:DEFAULT|NOT\s+NULL)\b/iu
  );
  expect(sql).not.toMatch(
    /ALTER\s+TABLE\s+"PdfDocument"[\s\S]*?ALTER\s+COLUMN\s+"approvalInstanceId"\s+SET\s+(?:DEFAULT|NOT\s+NULL)\b/iu
  );

  const governanceColumn =
    sql.match(/ADD COLUMN "contractGovernanceVersion"[\s\S]*?;/u)?.[0] ?? "";
  expect(governanceColumn).toMatch(/"contractGovernanceVersion" INTEGER/u);
  expect(governanceColumn).not.toMatch(/\b(?:NOT\s+NULL|DEFAULT)\b/iu);
  expect(sql).toMatch(
    /ContractVersion_contract_governance_version_check[\s\S]*?"contractGovernanceVersion" IS NULL[\s\S]*?"contractGovernanceVersion" = 1[\s\S]*?NOT VALID;/u
  );

  const approvalInstanceColumn =
    sql.match(/ADD COLUMN "approvalInstanceId"[\s\S]*?;/u)?.[0] ?? "";
  expect(approvalInstanceColumn).toMatch(/"approvalInstanceId" TEXT/u);
  expect(approvalInstanceColumn).not.toMatch(/\b(?:NOT\s+NULL|DEFAULT)\b/iu);
  expect(sql).toMatch(
    /PdfDocument_approval_instance_fk[\s\S]*?FOREIGN KEY \("approvalInstanceId"\) REFERENCES "ApprovalInstance"\("id"\)[\s\S]*?NOT VALID;/u
  );
  expect(sql).toContain(
    'CREATE UNIQUE INDEX "PdfDocument_approvalInstanceId_key" ON "PdfDocument"("approvalInstanceId")'
  );

  for (const table of [
    "ContractFormalFile",
    "ContractAuthorization",
    "ContractVersionAuthorizationLink",
    "ContractSealTask",
    "ApprovalFormGenerationClaim"
  ]) {
    expect(sql).toContain(`CREATE TABLE "${table}"`);
  }

  for (const reference of [
    'FOREIGN KEY ("contractVersionId") REFERENCES "ContractVersion"("id")',
    'FOREIGN KEY ("originContractVersionId") REFERENCES "ContractVersion"("id")',
    'FOREIGN KEY ("fileId") REFERENCES "FileObject"("id")',
    'FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id")',
    'FOREIGN KEY ("authorizationId") REFERENCES "ContractAuthorization"("id")',
    'FOREIGN KEY ("reusedFromContractVersionId") REFERENCES "ContractVersion"("id")',
    'FOREIGN KEY ("handlerUserId") REFERENCES "User"("id")'
  ]) {
    expect(sql).toContain(reference);
  }
  expect(sql).toMatch(
    /ContractSealTask_approval_instance_fk[\s\S]*?FOREIGN KEY \("approvalInstanceId"\) REFERENCES "ApprovalInstance"\("id"\)/u
  );
  expect(sql).toMatch(
    /ApprovalFormGenerationClaim_approval_instance_fk[\s\S]*?FOREIGN KEY \("approvalInstanceId"\) REFERENCES "ApprovalInstance"\("id"\)/u
  );
  expect(sql).toMatch(
    /ApprovalFormGenerationClaim_uploaded_file_fk[\s\S]*?FOREIGN KEY \("uploadedFileId"\) REFERENCES "FileObject"\("id"\)/u
  );
  expect(sql).toMatch(
    /ApprovalFormGenerationClaim_pdf_document_fk[\s\S]*?FOREIGN KEY \("pdfDocumentId"\) REFERENCES "PdfDocument"\("id"\)/u
  );
  expect(sql).toMatch(
    /ApprovalFormGenerationClaim_status_check[\s\S]*?'pending'[\s\S]*?'uploaded'[\s\S]*?'completed'[\s\S]*?'failed'/u
  );
  expect(sql).toContain('"ApprovalFormGenerationClaim_state_fields_check"');
  expect(sql).toMatch(
    /ApprovalFormGenerationClaim_state_fields_check[\s\S]*?"status" = 'pending'[\s\S]*?"uploadedFileId" IS NULL[\s\S]*?"status" = 'uploaded'[\s\S]*?"uploadedFileId" IS NOT NULL[\s\S]*?"status" = 'completed'[\s\S]*?"pdfDocumentId" IS NOT NULL/u
  );
  expect(sql).toMatch(
    /ContractFormalFile_supersedes_fk[\s\S]*?FOREIGN KEY \("supersedesId"\) REFERENCES "ContractFormalFile"\("id"\)/u
  );
  expect(sql).toMatch(
    /ContractFormalFile_file_fk"\s+FOREIGN KEY \("fileId"\) REFERENCES "FileObject"\("id"\)/u
  );
  expect(sql).toMatch(
    /ContractAuthorization_supersedes_fk[\s\S]*?FOREIGN KEY \("supersedesId"\) REFERENCES "ContractAuthorization"\("id"\)/u
  );
  for (const [constraint, column] of [
    ["ContractFormalFile_uploaded_by_fk", "uploadedByUserId"],
    ["ContractFormalFile_declared_by_fk", "declaredByUserId"],
    ["ContractFormalFile_confirmed_by_fk", "confirmedByUserId"],
    ["ContractAuthorization_uploaded_by_fk", "uploadedByUserId"],
    ["ContractSealTask_approved_by_fk", "approvedByUserId"],
    ["ContractSealTask_completed_by_fk", "completedByUserId"],
    ["ContractSealTask_cancelled_by_fk", "cancelledByUserId"]
  ]) {
    expect(sql).toMatch(
      new RegExp(`${constraint}"\\s+FOREIGN KEY \\("${column}"\\) REFERENCES "User"\\("id"\\)`, "u")
    );
  }

  expect(sql).toMatch(
    /ContractFormalFile_purpose_check[\s\S]*?'approval_original'[\s\S]*?'mutually_signed_final'/u
  );
  expect(sql).toMatch(
    /ContractFormalFile_status_check[\s\S]*?'active'[\s\S]*?'invalidated'[\s\S]*?'superseded'/u
  );
  expect(sql).toMatch(
    /ContractAuthorization_side_check[\s\S]*?'first_party'[\s\S]*?'counterparty'/u
  );
  expect(sql).toMatch(
    /ContractAuthorization_status_check[\s\S]*?'active'[\s\S]*?'invalidated'[\s\S]*?'superseded'/u
  );
  expect(sql).toMatch(
    /ContractAuthorization_nonblank_facts_check[\s\S]*?BTRIM\("grantorName"\)[\s\S]*?BTRIM\("agentName"\)[\s\S]*?BTRIM\("scopeSummary"\)/u
  );
  expect(sql).toMatch(
    /ContractVersionAuthorizationLink_side_check[\s\S]*?'first_party'[\s\S]*?'counterparty'/u
  );
  expect(sql).toMatch(
    /ContractSealTask_status_check[\s\S]*?'pending_approval'[\s\S]*?'in_seal'[\s\S]*?'completed'[\s\S]*?'cancelled'/u
  );
  expect(sql).toMatch(/ContractFormalFile_page_count_check[\s\S]*?"pageCount" > 0/u);
  expect(sql).toMatch(/ContractAuthorization_page_count_check[\s\S]*?"pageCount" > 0/u);
  expect(sql).toMatch(
    /ContractFormalFile_sha256_check"\s+CHECK \("contentSha256" ~ '\^\[0-9a-f\]\{64\}\$'\)/u
  );
  expect(sql).toMatch(
    /ContractAuthorization_sha256_check"\s+CHECK \("contentSha256" ~ '\^\[0-9a-f\]\{64\}\$'\)/u
  );
  expect(sql).toMatch(
    /ContractFormalFile_source_revision_check[\s\S]*?"sourceRevision" >= 1/u
  );
  expect(sql).toMatch(
    /ContractFormalFile_invalidation_fields_check[\s\S]*?"status" = 'active'[\s\S]*?"invalidatedAt" IS NULL[\s\S]*?"status" IN \('invalidated', 'superseded'\)[\s\S]*?"invalidatedAt" IS NOT NULL[\s\S]*?NULLIF\(BTRIM\("invalidationReason"\), ''\) IS NOT NULL/u
  );
  expect(sql).toMatch(
    /ContractFormalFile_confirmation_fields_check[\s\S]*?"confirmedByUserId" IS NULL[\s\S]*?"confirmedAt" IS NULL[\s\S]*?"confirmationSnapshot" IS NULL[\s\S]*?"confirmedByUserId" IS NOT NULL[\s\S]*?"confirmedAt" IS NOT NULL[\s\S]*?"confirmationSnapshot" IS NOT NULL/u
  );
  expect(sql).toMatch(
    /ContractAuthorization_invalidation_fields_check[\s\S]*?"status" = 'active'[\s\S]*?"invalidatedAt" IS NULL[\s\S]*?"status" IN \('invalidated', 'superseded'\)[\s\S]*?"invalidatedAt" IS NOT NULL[\s\S]*?NULLIF\(BTRIM\("invalidationReason"\), ''\) IS NOT NULL/u
  );
  expect(sql).toMatch(
    /ContractFormalFile_supersedes_not_self_check[\s\S]*?"supersedesId" <> "id"/u
  );
  expect(sql).toMatch(
    /ContractAuthorization_supersedes_not_self_check[\s\S]*?"supersedesId" <> "id"/u
  );
  expect(sql).toMatch(
    /ContractVersionAuthorizationLink_required_pair_check[\s\S]*?"required" = TRUE[\s\S]*?"authorizationId" IS NOT NULL[\s\S]*?"required" = FALSE[\s\S]*?"authorizationId" IS NULL/u
  );
  expect(sql).toMatch(
    /ContractVersionAuthorizationLink_reuse_not_self_check[\s\S]*?"reusedFromContractVersionId" IS NULL[\s\S]*?"reusedFromContractVersionId" <> "contractVersionId"/u
  );
  expect(sql).toMatch(
    /ContractVersionAuthorizationLink_reuse_requires_authorization_check[\s\S]*?"reusedFromContractVersionId" IS NULL[\s\S]*?"authorizationId" IS NOT NULL/u
  );
  expect(sql).toMatch(
    /ContractSealTask_state_fields_check[\s\S]*?'pending_approval'[\s\S]*?'in_seal'[\s\S]*?'completed'[\s\S]*?'cancelled'/u
  );

  expect(sql).toContain(
    'CREATE UNIQUE INDEX "ContractFormalFile_active_purpose_key"\n  ON "ContractFormalFile"("contractVersionId", "purpose")\n  WHERE "status" = \'active\';'
  );
  expect(sql).toMatch(
    /CREATE UNIQUE INDEX "ContractAuthorization_active_origin_side_key"[\s\S]*?ON "ContractAuthorization"\("originContractVersionId", "side"\)[\s\S]*?WHERE "status" = 'active';/u
  );
  expect(sql).toContain(
    'CREATE UNIQUE INDEX "ContractVersionAuthorizationLink_contractVersionId_side_key"'
  );
  expect(sql).toContain(
    'CREATE INDEX "ContractFormalFile_contractVersionId_purpose_status_idx"'
  );
  expect(sql).toContain(
    'CREATE INDEX "ContractSealTask_status_handlerUserId_idx"'
  );
  expect(sql).toContain(
    'CREATE UNIQUE INDEX "ContractSealTask_approvalInstanceId_key"'
  );
  expect(sql).toMatch(
    /CREATE UNIQUE INDEX "ContractSealTask_active_contract_version_key"[\s\S]*?ON "ContractSealTask"\("contractVersionId"\)[\s\S]*?WHERE "status" <> 'cancelled';/u
  );
}

function insertBeforeCommit(sql: string, statement: string) {
  return sql.replace("\nCOMMIT;", `\n${statement}\n\nCOMMIT;`);
}

function removeNamedConstraint(sql: string, name: string) {
  return sql.replace(
    new RegExp(
      `,\\n  ADD CONSTRAINT "${name}"[\\s\\S]*?(?=,\\n  ADD CONSTRAINT|;\\n)`,
      "u"
    ),
    ""
  );
}

describe("M55 contract governance evidence schema", () => {
  const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
  const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");

  it("is ordered after M54 and is one drift-visible compatible transaction", () => {
    const names = readdirSync(migrationsPath).sort();
    expect(names).toContain(m54Name);
    expect(names).toContain(m55Name);
    expect(names.indexOf(m54Name)).toBeLessThan(names.indexOf(m55Name));
    validateM55(migration);
  });

  it("keeps legacy archive data while exposing all new Prisma models", () => {
    expect(schema).toContain("model ContractArchiveFile");
    expect(schema).toMatch(/contractGovernanceVersion\s+Int\?/u);
    expect(schema).toMatch(/approvalInstanceId\s+String\?\s+@unique/u);
    for (const name of [
      "ContractFormalFile",
      "ContractAuthorization",
      "ContractVersionAuthorizationLink",
      "ContractSealTask",
      "ApprovalFormGenerationClaim"
    ]) {
      expect(schema).toContain(`model ${name}`);
    }
    expect(schema).toMatch(/model ContractSealTask[\s\S]*?approvalInstanceId\s+String\s+@unique/u);
    expect(schema).toMatch(
      /model ApprovalFormGenerationClaim[\s\S]*?approvalInstanceId\s+String\s+@id[\s\S]*?uploadedFileId\s+String\?\s+@unique[\s\S]*?pdfDocumentId\s+String\?\s+@unique/u
    );
    expect(schema).not.toMatch(/model ContractSealTask[\s\S]*?contractVersionId\s+String\s+@unique/u);
  });

  it.each([
    [
      "removing a foreign key",
      (sql: string) => sql.replace(
        'FOREIGN KEY ("fileId") REFERENCES "FileObject"("id")',
        'FOREIGN KEY ("fileId") REFERENCES "MissingFile"("id")'
      )
    ],
    [
      "removing the active formal-file uniqueness predicate",
      (sql: string) => sql.replace('WHERE "status" = \'active\';', ";")
    ],
    [
      "weakening the sha constraint",
      (sql: string) => sql.replace("~ '^[0-9a-f]{64}$'", "IS NOT NULL")
    ],
    [
      "making the governance marker required",
      (sql: string) => insertBeforeCommit(
        sql,
        'ALTER TABLE "ContractVersion" ALTER COLUMN "contractGovernanceVersion" SET NOT NULL;'
      )
    ],
    [
      "adding a guessed governance default",
      (sql: string) => insertBeforeCommit(
        sql,
        'ALTER TABLE "ContractVersion" ALTER COLUMN "contractGovernanceVersion" SET DEFAULT 1;'
      )
    ],
    [
      "making the approval document binding required for old rows",
      (sql: string) => insertBeforeCommit(
        sql,
        'ALTER TABLE "PdfDocument" ALTER COLUMN "approvalInstanceId" SET NOT NULL;'
      )
    ],
    [
      "backfilling the governance marker",
      (sql: string) => insertBeforeCommit(
        sql,
        'UPDATE "ContractVersion" SET "contractGovernanceVersion" = 1;'
      )
    ],
    [
      "deleting old archive evidence",
      (sql: string) => insertBeforeCommit(sql, 'DELETE FROM "ContractArchiveFile";')
    ],
    [
      "writing history through a CTE",
      (sql: string) => insertBeforeCommit(
        sql,
        'WITH "legacy" AS (SELECT "id" FROM "ContractVersion") UPDATE "ContractVersion" SET "contractGovernanceVersion" = 1 WHERE "id" IN (SELECT "id" FROM "legacy");'
      )
    ],
    [
      "deleting evidence through a CTE",
      (sql: string) => insertBeforeCommit(
        sql,
        'WITH "legacy" AS (SELECT "id" FROM "ContractArchiveFile") DELETE FROM "ContractArchiveFile" WHERE "id" IN (SELECT "id" FROM "legacy");'
      )
    ],
    [
      "removing the seal-state grouped check",
      (sql: string) => sql.replace(
        '"ContractSealTask_state_fields_check"',
        '"ContractSealTask_state_fields_removed"'
      )
    ],
    [
      "removing formal-file invalidation grouping",
      (sql: string) => removeNamedConstraint(sql, "ContractFormalFile_invalidation_fields_check")
    ],
    [
      "removing formal-file confirmation grouping",
      (sql: string) => removeNamedConstraint(sql, "ContractFormalFile_confirmation_fields_check")
    ],
    [
      "removing authorization nonblank facts",
      (sql: string) => removeNamedConstraint(sql, "ContractAuthorization_nonblank_facts_check")
    ],
    [
      "removing authorization invalidation grouping",
      (sql: string) => removeNamedConstraint(sql, "ContractAuthorization_invalidation_fields_check")
    ],
    [
      "removing authorization reuse self-reference protection",
      (sql: string) => removeNamedConstraint(sql, "ContractVersionAuthorizationLink_reuse_not_self_check")
    ],
    [
      "removing authorization reuse association protection",
      (sql: string) => removeNamedConstraint(sql, "ContractVersionAuthorizationLink_reuse_requires_authorization_check")
    ],
    [
      "removing active authorization uniqueness",
      (sql: string) => sql.replace(
        'CREATE UNIQUE INDEX "ContractAuthorization_active_origin_side_key"\n  ON "ContractAuthorization"("originContractVersionId", "side")\n  WHERE "status" = \'active\';\n',
        ""
      )
    ],
    [
      "removing approval-form claim state grouping",
      (sql: string) => removeNamedConstraint(sql, "ApprovalFormGenerationClaim_state_fields_check")
    ],
    [
      "removing approval-form claim file ownership",
      (sql: string) => sql.replace(
        'FOREIGN KEY ("uploadedFileId") REFERENCES "FileObject"("id")',
        'FOREIGN KEY ("uploadedFileId") REFERENCES "MissingFile"("id")'
      )
    ]
  ])("rejects %s", (_name, mutate) => {
    const changed = mutate(migration);
    expect(changed).not.toBe(migration);
    expect(() => validateM55(changed)).toThrow();
  });
});
