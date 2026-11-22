BEGIN;

-- 已签补充协议附录（ContractSignedChange.appendixFormalFileId）与已签结算
-- 附件（SignedContractSettlementAttachment.fileId）都是签署原件事实：同一
-- 文件只能归属于一条签署记录，不能作为共享附件复用。两者因此以 exclusive
-- 登记进中心绑定清单，由统一触发器拒绝重复绑定与文件替换链接入。
SELECT pg_advisory_xact_lock(190731, 13);
DO $registry$
DECLARE
  old_oid oid := 'public.jg_file_business_binding_columns()'::regprocedure;
  owner_id oid;
  owner_name TEXT;
  original_acl aclitem[];
  installer TEXT := current_user;
  privilege RECORD;
BEGIN
  SELECT proowner, proacl INTO STRICT owner_id, original_acl FROM pg_proc WHERE oid = old_oid;
  SELECT rolname INTO STRICT owner_name FROM pg_roles WHERE oid = owner_id;
  IF EXISTS (SELECT 1 FROM aclexplode(coalesce(original_acl, acldefault('f', owner_id))) WHERE grantor <> owner_id) THEN
    RAISE EXCEPTION 'signed settlement attachment cannot change a third-party file registry grant';
  END IF;

  EXECUTE format('SET LOCAL ROLE %I', owner_name);
  ALTER FUNCTION public.jg_file_business_binding_columns()
    RENAME TO jg_file_business_binding_columns_before_signed_settlement;
  EXECUTE $new_registry$
    CREATE FUNCTION public.jg_file_business_binding_columns()
    RETURNS TABLE ("tableName" TEXT, "columnName" TEXT, "exclusive" BOOLEAN)
    LANGUAGE sql STABLE PARALLEL SAFE SET search_path = pg_catalog, public AS $body$
      SELECT * FROM public.jg_file_business_binding_columns_before_signed_settlement()
      UNION ALL
      VALUES
        ('ContractSignedChange', 'appendixFormalFileId', TRUE),
        ('SignedContractSettlementAttachment', 'fileId', TRUE);
    $body$;
  $new_registry$;
  FOR privilege IN SELECT grantee FROM aclexplode(coalesce((SELECT proacl FROM pg_proc
    WHERE oid = 'public.jg_file_business_binding_columns()'::regprocedure), acldefault('f', owner_id)))
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.jg_file_business_binding_columns() FROM %s',
      CASE WHEN privilege.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(privilege.grantee)) END);
  END LOOP;
  FOR privilege IN SELECT grantee, is_grantable FROM aclexplode(coalesce(original_acl, acldefault('f', owner_id)))
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.jg_file_business_binding_columns() TO %s%s',
      CASE WHEN privilege.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(privilege.grantee)) END,
      CASE WHEN privilege.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
  END LOOP;
  EXECUTE format('SET LOCAL ROLE %I', installer);
END;
$registry$;

-- 补充协议附录在提交时由 SECURITY DEFINER 函数写入且不可覆写；这里补齐它
-- 自己的独占绑定触发器。已签结算附件已在
-- 20261119004100_signed_contract_settlement_registration 中用
-- SignedContractSettlementAttachment_legacy_collision 以同一守卫 ('fileId',
-- 'true') 保护，且该表禁止 UPDATE，故不重复安装第二个独占触发器。
CREATE TRIGGER jg_efb_contract_signed_change_appendix
BEFORE INSERT OR UPDATE OF "appendixFormalFileId" ON public."ContractSignedChange"
FOR EACH ROW EXECUTE FUNCTION public.jg_enforce_exclusive_file_business_binding(
  'appendixFormalFileId',
  'true'
);

COMMIT;
