-- The preceding draft-deletion migration removed all inherited ACLs from these
-- immutable tables. Restore only previously configured read-only defaults, so
-- existing backup identities can continue taking complete backups. Keep runtime
-- write-default identities and PUBLIC excluded; never grant mutation or EXECUTE.
DO $$
DECLARE reader RECORD;
BEGIN
  FOR reader IN
    SELECT DISTINCT c.relname AS table_name, r.rolname AS role_name
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_default_acl d ON d.defaclrole = c.relowner
      AND d.defaclobjtype = 'r' AND d.defaclnamespace IN (0, c.relnamespace)
    CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) a
    JOIN pg_catalog.pg_roles r ON r.oid = a.grantee
    WHERE n.nspname = 'public'
      AND c.relname IN ('SpotProcurementAuditSource', 'SpotPaymentAuditSource')
      AND a.privilege_type = 'SELECT' AND a.grantee <> c.relowner
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_default_acl writes
        CROSS JOIN LATERAL pg_catalog.aclexplode(writes.defaclacl) w
        WHERE writes.defaclrole = c.relowner AND writes.defaclobjtype = 'r'
          AND writes.defaclnamespace IN (0, c.relnamespace)
          AND w.grantee = a.grantee AND w.privilege_type <> 'SELECT'
      )
  LOOP
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO %I', reader.table_name, reader.role_name);
  END LOOP;
END;
$$;
