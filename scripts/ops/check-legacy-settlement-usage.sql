-- CUT-03 read-only audit (#396): prove whether the retired multi-node
-- settlement flow ever held real business data. Run inside a READ ONLY
-- transaction only; this file must never mutate anything.
WITH legacy AS (
  SELECT
    count(*) AS total,
    count(*) FILTER (
      WHERE status IN ('effective', 'partially_paid', 'paid')
    ) AS usable,
    count(*) FILTER (WHERE status = 'voided') AS voided,
    count(*) FILTER (WHERE "sourceType" = 'historical_takeover') AS historical,
    min("createdAt") AS first_created_at,
    max("createdAt") AS last_created_at
  FROM public."Settlement"
),
drafts AS (
  SELECT count(*) AS total, max("createdAt") AS last_created_at
  FROM public."SettlementDraft"
),
archives AS (
  SELECT count(*) AS total
  FROM public."SettlementArchiveFile"
),
signed_documents AS (
  SELECT count(*) AS total
  FROM public."SettlementSignedDocument"
  WHERE "settlementId" IS NOT NULL
),
processes AS (
  SELECT count(*) AS total
  FROM public."ContractSettlementProcess"
)
SELECT jsonb_build_object(
  'schema', 'jg_legacy_settlement_usage_audit/V1',
  'checkedAt', clock_timestamp(),
  'legacySettlement', jsonb_build_object(
    'total', legacy.total,
    'usable', legacy.usable,
    'voided', legacy.voided,
    'historical', legacy.historical,
    'firstCreatedAt', legacy.first_created_at,
    'lastCreatedAt', legacy.last_created_at
  ),
  'legacyDrafts', jsonb_build_object(
    'total', drafts.total,
    'lastCreatedAt', drafts.last_created_at
  ),
  'legacyArchives', jsonb_build_object('total', archives.total),
  'legacySignedDocuments', jsonb_build_object('total', signed_documents.total),
  'legacyMultiNodeProcesses', jsonb_build_object('total', processes.total),
  'verdict', CASE
    WHEN legacy.total > 0 OR drafts.total > 0 OR archives.total > 0
      OR signed_documents.total > 0 OR processes.total > 0
      THEN 'LEGACY_SETTLEMENT_DATA_FOUND'
    ELSE 'LEGACY_SETTLEMENT_UNUSED'
  END,
  'note', CASE
    WHEN legacy.total > 0 OR drafts.total > 0 OR archives.total > 0
      OR signed_documents.total > 0 OR processes.total > 0
      THEN '发现旧结算真实记录：按 CUT-03 停止删除/退役，先人工核对，不自动按已确认处理。'
    ELSE '未发现旧多节点结算真实记录；删除仍属 #425，本脚本不执行任何退役。'
  END
) AS audit
FROM legacy, drafts, archives, signed_documents, processes;
