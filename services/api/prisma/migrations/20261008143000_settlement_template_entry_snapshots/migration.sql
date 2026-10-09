-- Additive local candidate: legacy versions remain explicitly without entry snapshots.
ALTER TABLE "SettlementTemplateVersion"
  ADD COLUMN "submissionEntrySnapshot" JSONB,
  ADD COLUMN "publicationEntrySnapshot" JSONB;

CREATE FUNCTION enforce_settlement_template_entry_snapshots() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE stage text; snapshot jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."submissionEntrySnapshot" IS NOT NULL OR OLD."publicationEntrySnapshot" IS NOT NULL THEN
      RAISE EXCEPTION '已冻结的结算模板版本不可删除';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (OLD."submissionEntrySnapshot" IS NOT NULL AND NEW."submissionEntrySnapshot" IS DISTINCT FROM OLD."submissionEntrySnapshot")
      OR (OLD."publicationEntrySnapshot" IS NOT NULL AND NEW."publicationEntrySnapshot" IS DISTINCT FROM OLD."publicationEntrySnapshot") THEN
      RAISE EXCEPTION '结算模板提交发布快照不可覆盖';
    END IF;
  END IF;
  FOREACH stage IN ARRAY ARRAY['submission', 'publication'] LOOP
    snapshot := CASE stage WHEN 'submission' THEN NEW."submissionEntrySnapshot" ELSE NEW."publicationEntrySnapshot" END;
    IF snapshot IS NOT NULL AND (
      jsonb_typeof(snapshot) IS DISTINCT FROM 'object'
      OR snapshot->>'stage' IS DISTINCT FROM stage
      OR snapshot->>'actorUserId' IS NULL OR btrim(snapshot->>'actorUserId') = ''
      OR snapshot->'target'->>'entityId' IS DISTINCT FROM NEW.id
      OR snapshot->'target'->>'entityType' IS DISTINCT FROM 'settlement_template_version'
      OR snapshot->>'draftRevision' IS DISTINCT FROM NEW."draftRevision"::text
      OR snapshot->>'definitionVersion' IS DISTINCT FROM '2'
      OR jsonb_typeof(snapshot->'definition') IS DISTINCT FROM 'object'
      OR jsonb_typeof(snapshot->'domainValues') IS DISTINCT FROM 'object'
    ) THEN
      RAISE EXCEPTION '结算模板快照必须绑定真实版本、修订与统一字段定义';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER settlement_template_entry_snapshots_immutable
BEFORE INSERT OR UPDATE OR DELETE ON "SettlementTemplateVersion"
FOR EACH ROW EXECUTE FUNCTION enforce_settlement_template_entry_snapshots();
