-- POL-13B relationship evidence is a non-exclusive FileObject reference.
-- Extend the deployed unified binding registry without rewriting the already
-- applied parent migration or changing any existing business ownership rule.
BEGIN;

SELECT pg_advisory_xact_lock(190731, 13);
LOCK TABLE "InterEntityRelationshipEntry" IN SHARE ROW EXCLUSIVE MODE;

ALTER FUNCTION jg_file_business_binding_columns()
  RENAME TO jg_file_business_binding_columns_before_pol13b;

CREATE FUNCTION jg_file_business_binding_columns()
RETURNS TABLE ("tableName" TEXT, "columnName" TEXT, "exclusive" BOOLEAN)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT * FROM jg_file_business_binding_columns_before_pol13b()
  UNION ALL
  VALUES
    ('InterEntityRelationshipEntry', 'evidenceFileId', FALSE);
$$;

CREATE TRIGGER jg_efb_inter_entity_relationship_evidence
BEFORE INSERT OR UPDATE OF "evidenceFileId" ON "InterEntityRelationshipEntry"
FOR EACH ROW
EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding(
  'evidenceFileId',
  'false'
);

COMMIT;
