-- POL-215：服务端 authority 结果驱动的历史接管 manifest、映射、bridge、回执与因果链。
-- 本迁移只新增非生产模型和约束，不扫描、回填或写入业务数据。
BEGIN;

CREATE TABLE "OperatingTakeoverManifestVersion" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "manifestNo" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'prepared',
  "sourceScopeFingerprint" TEXT NOT NULL,
  "mapperName" TEXT NOT NULL,
  "mapperVersion" INTEGER NOT NULL,
  "schemaVersion" INTEGER NOT NULL,
  "candidateBaselineSha" TEXT NOT NULL,
  "permissionSnapshotFingerprint" TEXT NOT NULL,
  "readSetFingerprint" TEXT NOT NULL,
  "manifestFingerprint" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OperatingTakeoverManifestVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OperatingTakeoverRowMapping" (
  "id" TEXT NOT NULL,
  "manifestVersionId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "rowNo" INTEGER NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceBusinessId" TEXT NOT NULL,
  "sourceVersion" INTEGER NOT NULL,
  "sourceFingerprint" TEXT NOT NULL,
  "sourceCoordinate" TEXT NOT NULL,
  "normalizedRowHash" TEXT NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "evidenceLevel" TEXT NOT NULL,
  "coverageKind" TEXT,
  "coverageKey" TEXT,
  "periodStart" DATE,
  "entryKind" TEXT NOT NULL,
  "mappingDecision" TEXT NOT NULL,
  "conflictGroupKey" TEXT NOT NULL,
  "adjustmentTargetRef" TEXT,
  "sourceDiscriminator" TEXT,
  "governedSubjectKey" TEXT,
  "authorityCategory" TEXT,
  "authoritySnapshotRef" TEXT,
  "authorityFingerprint" TEXT,
  "authorityVersionId" TEXT,
  "authorityLineId" TEXT,
  "authorityLineFingerprint" TEXT,
  "obligationId" TEXT,
  "authoritativeGrossCapCents" BIGINT,
  "currencyCode" TEXT,
  "authoritySnapshot" JSONB NOT NULL,
  "legacySourceSnapshot" JSONB NOT NULL,
  "readSetSnapshot" JSONB NOT NULL,
  "mappingFingerprint" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OperatingTakeoverRowMapping_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OperatingTakeoverLegacySourceBridge" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "rowMappingId" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceBusinessId" TEXT NOT NULL,
  "sourceVersion" INTEGER NOT NULL,
  "sourceFingerprint" TEXT NOT NULL,
  "targetKind" TEXT NOT NULL,
  "targetRef" TEXT NOT NULL,
  "targetFingerprint" TEXT NOT NULL,
  "mappingDecision" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OperatingTakeoverLegacySourceBridge_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OperatingTakeoverCommandReceipt" (
  "id" TEXT NOT NULL,
  "manifestVersionId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "expectedRevision" INTEGER NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "delegatorUserId" TEXT,
  "actorSetSnapshot" JSONB NOT NULL,
  "permissionSnapshotFingerprint" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "resultSnapshot" JSONB NOT NULL,
  "causalityFingerprint" TEXT NOT NULL,
  "causesReceiptId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OperatingTakeoverCommandReceipt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OperatingTakeoverCommandReceiptLine" (
  "id" TEXT NOT NULL,
  "receiptId" TEXT NOT NULL,
  "rowMappingId" TEXT NOT NULL,
  "lineNo" INTEGER NOT NULL,
  "decision" TEXT NOT NULL,
  "entryKind" TEXT NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "targetKind" TEXT,
  "targetRef" TEXT,
  "causalOrdinal" INTEGER NOT NULL,
  "reversesLineId" TEXT,
  "causalityFingerprint" TEXT NOT NULL,
  "lineSnapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OperatingTakeoverCommandReceiptLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OperatingTakeoverManifestVersion_project_manifest_key" ON "OperatingTakeoverManifestVersion"("projectId", "manifestNo");
CREATE UNIQUE INDEX "OperatingTakeoverManifestVersion_project_fingerprint_key" ON "OperatingTakeoverManifestVersion"("projectId", "manifestFingerprint");
CREATE INDEX "OperatingTakeoverManifestVersion_project_status_created_idx" ON "OperatingTakeoverManifestVersion"("projectId", "status", "createdAt");
CREATE UNIQUE INDEX "OperatingTakeoverRowMapping_manifest_row_key" ON "OperatingTakeoverRowMapping"("manifestVersionId", "rowNo");
CREATE UNIQUE INDEX "OperatingTakeoverRowMapping_source_coordinate_key" ON "OperatingTakeoverRowMapping"("manifestVersionId", "sourceType", "sourceBusinessId", "sourceVersion", "sourceCoordinate");
CREATE UNIQUE INDEX "OperatingTakeoverRowMapping_source_fingerprint_key" ON "OperatingTakeoverRowMapping"("projectId", "sourceType", "sourceBusinessId", "sourceVersion", "sourceFingerprint");
CREATE INDEX "OperatingTakeoverRowMapping_manifest_conflict_idx" ON "OperatingTakeoverRowMapping"("manifestVersionId", "conflictGroupKey");
CREATE INDEX "OperatingTakeoverRowMapping_project_source_idx" ON "OperatingTakeoverRowMapping"("projectId", "sourceType", "sourceBusinessId");
CREATE UNIQUE INDEX "OperatingTakeoverLegacySourceBridge_source_key" ON "OperatingTakeoverLegacySourceBridge"("projectId", "sourceType", "sourceBusinessId", "sourceVersion", "sourceFingerprint");
CREATE UNIQUE INDEX "OperatingTakeoverLegacySourceBridge_source_coordinate_key" ON "OperatingTakeoverLegacySourceBridge"("projectId", "sourceType", "sourceBusinessId", "sourceVersion");
CREATE UNIQUE INDEX "OperatingTakeoverLegacySourceBridge_target_key" ON "OperatingTakeoverLegacySourceBridge"("projectId", "targetKind", "targetRef");
CREATE INDEX "OperatingTakeoverLegacySourceBridge_project_decision_created_idx" ON "OperatingTakeoverLegacySourceBridge"("projectId", "mappingDecision", "createdAt");
CREATE UNIQUE INDEX "OperatingTakeoverCommandReceipt_idempotencyKey_key" ON "OperatingTakeoverCommandReceipt"("idempotencyKey");
CREATE INDEX "OperatingTakeoverCommandReceipt_manifest_action_created_idx" ON "OperatingTakeoverCommandReceipt"("manifestVersionId", "action", "createdAt");
CREATE INDEX "OperatingTakeoverCommandReceipt_causesReceiptId_idx" ON "OperatingTakeoverCommandReceipt"("causesReceiptId");
CREATE UNIQUE INDEX "OperatingTakeoverCommandReceiptLine_receipt_line_key" ON "OperatingTakeoverCommandReceiptLine"("receiptId", "lineNo");
CREATE INDEX "OperatingTakeoverCommandReceiptLine_row_created_idx" ON "OperatingTakeoverCommandReceiptLine"("rowMappingId", "createdAt");
CREATE INDEX "OperatingTakeoverCommandReceiptLine_reversesLineId_idx" ON "OperatingTakeoverCommandReceiptLine"("reversesLineId");
CREATE UNIQUE INDEX "GuaranteeObligationVersion_authority_obligation_key" ON "GuaranteeObligationVersion"("authorityVersionId", "obligationId");
CREATE UNIQUE INDEX "AssignedWageAuthorityLine_authority_id_key" ON "AssignedWageAuthorityLine"("authorityVersionId", "id");

ALTER TABLE "OperatingTakeoverRowMapping" ADD CONSTRAINT "OperatingTakeoverRowMapping_manifestVersionId_fkey" FOREIGN KEY ("manifestVersionId") REFERENCES "OperatingTakeoverManifestVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OperatingTakeoverRowMapping" ADD CONSTRAINT "OperatingTakeoverRowMapping_authorityVersionId_fkey" FOREIGN KEY ("authorityVersionId") REFERENCES "AffiliateClearingAuthorityVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "OperatingTakeoverRowMapping" ADD CONSTRAINT "OperatingTakeoverRowMapping_assignedWageLine_fkey" FOREIGN KEY ("authorityVersionId", "authorityLineId") REFERENCES "AssignedWageAuthorityLine"("authorityVersionId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "OperatingTakeoverRowMapping" ADD CONSTRAINT "OperatingTakeoverRowMapping_guaranteeObligation_fkey" FOREIGN KEY ("authorityVersionId", "obligationId") REFERENCES "GuaranteeObligationVersion"("authorityVersionId", "obligationId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "OperatingTakeoverLegacySourceBridge" ADD CONSTRAINT "OperatingTakeoverLegacySourceBridge_rowMappingId_fkey" FOREIGN KEY ("rowMappingId") REFERENCES "OperatingTakeoverRowMapping"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OperatingTakeoverCommandReceipt" ADD CONSTRAINT "OperatingTakeoverCommandReceipt_manifestVersionId_fkey" FOREIGN KEY ("manifestVersionId") REFERENCES "OperatingTakeoverManifestVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OperatingTakeoverCommandReceipt" ADD CONSTRAINT "OperatingTakeoverCommandReceipt_causesReceiptId_fkey" FOREIGN KEY ("causesReceiptId") REFERENCES "OperatingTakeoverCommandReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OperatingTakeoverCommandReceiptLine" ADD CONSTRAINT "OperatingTakeoverCommandReceiptLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "OperatingTakeoverCommandReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OperatingTakeoverCommandReceiptLine" ADD CONSTRAINT "OperatingTakeoverCommandReceiptLine_rowMappingId_fkey" FOREIGN KEY ("rowMappingId") REFERENCES "OperatingTakeoverRowMapping"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OperatingTakeoverCommandReceiptLine" ADD CONSTRAINT "OperatingTakeoverCommandReceiptLine_reversesLineId_fkey" FOREIGN KEY ("reversesLineId") REFERENCES "OperatingTakeoverCommandReceiptLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OperatingTakeoverManifestVersion"
  ADD CONSTRAINT "OperatingTakeoverManifestVersion_version_check" CHECK ("version" > 0),
  ADD CONSTRAINT "OperatingTakeoverManifestVersion_status_check" CHECK ("status" IN ('prepared', 'inactive_applied', 'abandoned', 'activated', 'compensated')),
  ADD CONSTRAINT "OperatingTakeoverManifestVersion_hash_check" CHECK ("sourceScopeFingerprint" ~ '^[0-9a-f]{64}$' AND "permissionSnapshotFingerprint" ~ '^[0-9a-f]{64}$' AND "readSetFingerprint" ~ '^[0-9a-f]{64}$' AND "manifestFingerprint" ~ '^[0-9a-f]{64}$' AND "candidateBaselineSha" ~ '^[0-9a-fA-F]{40}$');
ALTER TABLE "OperatingTakeoverRowMapping"
  ADD CONSTRAINT "OperatingTakeoverRowMapping_source_version_check" CHECK ("sourceVersion" > 0),
  ADD CONSTRAINT "OperatingTakeoverRowMapping_amount_check" CHECK ("amountCents" > 0),
  ADD CONSTRAINT "OperatingTakeoverRowMapping_evidence_check" CHECK ("evidenceLevel" IN ('A', 'B', 'C')),
  ADD CONSTRAINT "OperatingTakeoverRowMapping_entry_check" CHECK ("entryKind" IN ('formal', 'gap')),
  ADD CONSTRAINT "OperatingTakeoverRowMapping_decision_check" CHECK ("mappingDecision" IN ('FORMAL', 'GAP', 'LINK', 'SKIP', 'BLOCKED')),
  ADD CONSTRAINT "OperatingTakeoverRowMapping_coverage_check" CHECK ("coverageKind" IS NULL OR "coverageKind" IN ('PERSON', 'ROLE_SUMMARY')),
  ADD CONSTRAINT "OperatingTakeoverRowMapping_hash_check" CHECK ("sourceFingerprint" ~ '^[0-9a-f]{64}$' AND "normalizedRowHash" ~ '^[0-9a-f]{64}$' AND "mappingFingerprint" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "OperatingTakeoverRowMapping_formal_authority_check" CHECK ("mappingDecision" <> 'FORMAL' OR ("authorityCategory" IS NOT NULL AND "authoritySnapshotRef" IS NOT NULL AND "authorityFingerprint" IS NOT NULL AND "authorityVersionId" IS NOT NULL AND "authoritativeGrossCapCents" IS NOT NULL AND "currencyCode" IS NOT NULL AND "sourceDiscriminator" IS NOT NULL AND "governedSubjectKey" IS NOT NULL)),
  ADD CONSTRAINT "OperatingTakeoverRowMapping_formal_authority_shape_check" CHECK ("mappingDecision" <> 'FORMAL' OR (("authorityCategory" = 'assigned_management_salary' AND "sourceDiscriminator" = 'construction_enterprise_assigned_wage' AND "authorityLineId" IS NOT NULL AND "authorityLineFingerprint" ~ '^[0-9a-f]{64}$') OR ("authorityCategory" = 'deposit' AND "sourceDiscriminator" = 'construction_enterprise_guarantee' AND "obligationId" IS NOT NULL))),
  ADD CONSTRAINT "OperatingTakeoverRowMapping_formal_entry_check" CHECK ("mappingDecision" <> 'FORMAL' OR "entryKind" = 'formal'),
  ADD CONSTRAINT "OperatingTakeoverRowMapping_gap_entry_check" CHECK ("mappingDecision" <> 'GAP' OR "entryKind" = 'gap'),
  ADD CONSTRAINT "OperatingTakeoverRowMapping_coverage_key_check" CHECK ("coverageKind" IS NULL OR ("coverageKind" = 'PERSON' AND "coverageKey" LIKE 'person:%') OR ("coverageKind" = 'ROLE_SUMMARY' AND "coverageKey" LIKE 'role:%')),
  ADD CONSTRAINT "OperatingTakeoverRowMapping_role_summary_no_person_check" CHECK ("coverageKind" <> 'ROLE_SUMMARY' OR ("authoritySnapshot"->>'personAuthorityKey' IS NULL AND "authoritySnapshot"->>'personNameSnapshot' IS NULL));
ALTER TABLE "OperatingTakeoverLegacySourceBridge"
  ADD CONSTRAINT "OperatingTakeoverLegacySourceBridge_source_check" CHECK ("sourceVersion" > 0 AND "sourceFingerprint" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "OperatingTakeoverLegacySourceBridge_target_check" CHECK (length(trim("targetRef")) > 0),
  ADD CONSTRAINT "OperatingTakeoverLegacySourceBridge_decision_check" CHECK ("mappingDecision" IN ('FORMAL', 'GAP', 'LINK', 'SKIP'));
ALTER TABLE "OperatingTakeoverCommandReceipt"
  ADD CONSTRAINT "OperatingTakeoverCommandReceipt_revision_check" CHECK ("expectedRevision" >= 0),
  ADD CONSTRAINT "OperatingTakeoverCommandReceipt_hash_check" CHECK ("permissionSnapshotFingerprint" ~ '^[0-9a-f]{64}$' AND "fingerprint" ~ '^[0-9a-f]{64}$' AND "causalityFingerprint" ~ '^[0-9a-f]{64}$');
ALTER TABLE "OperatingTakeoverCommandReceiptLine"
  ADD CONSTRAINT "OperatingTakeoverCommandReceiptLine_line_check" CHECK ("lineNo" > 0 AND "causalOrdinal" > 0 AND "amountCents" > 0),
  ADD CONSTRAINT "OperatingTakeoverCommandReceiptLine_hash_check" CHECK ("causalityFingerprint" ~ '^[0-9a-f]{64}$');

CREATE FUNCTION jg_pol215_reject_operating_takeover_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'POL-215 manifest、映射、bridge、回执与因果记录不可更新或删除';
END;
$$;

CREATE TRIGGER jg_pol215_manifest_append_only BEFORE UPDATE OR DELETE ON "OperatingTakeoverManifestVersion" FOR EACH ROW EXECUTE FUNCTION jg_pol215_reject_operating_takeover_history_mutation();
CREATE TRIGGER jg_pol215_mapping_append_only BEFORE UPDATE OR DELETE ON "OperatingTakeoverRowMapping" FOR EACH ROW EXECUTE FUNCTION jg_pol215_reject_operating_takeover_history_mutation();
CREATE TRIGGER jg_pol215_bridge_append_only BEFORE UPDATE OR DELETE ON "OperatingTakeoverLegacySourceBridge" FOR EACH ROW EXECUTE FUNCTION jg_pol215_reject_operating_takeover_history_mutation();
CREATE TRIGGER jg_pol215_receipt_append_only BEFORE UPDATE OR DELETE ON "OperatingTakeoverCommandReceipt" FOR EACH ROW EXECUTE FUNCTION jg_pol215_reject_operating_takeover_history_mutation();
CREATE TRIGGER jg_pol215_receipt_line_append_only BEFORE UPDATE OR DELETE ON "OperatingTakeoverCommandReceiptLine" FOR EACH ROW EXECUTE FUNCTION jg_pol215_reject_operating_takeover_history_mutation();

COMMIT;
