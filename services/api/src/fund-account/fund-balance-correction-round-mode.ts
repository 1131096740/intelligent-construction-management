import { ServiceUnavailableException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

export async function fundBalanceCorrectionRoundMode(tx: Prisma.TransactionClient): Promise<"legacy" | "controlled"> {
  const [row] = await tx.$queryRaw<Array<{mode: string}>>`
    WITH new_key AS (
      SELECT pg_catalog.to_regclass('public.jg_fund_balance_correction_witness_key') AS oid
    ), functions(signature, body, definer) AS (
      VALUES
        ('public.jg_fund_balance_correction_fields(text[])', '301d8d496077e1732bd4c144fb5d82348e7757cebb2ceed3f402816d763a90b9', false),
        ('public.jg_create_fund_balance_correction_round()', 'ed1e01e9ec3c9263ac318c5c5960321601c5fc135fded616dc3261e455651d2e', true),
        ('public.jg_validate_fund_balance_correction_round()', 'ce59aa729d90d982e1c906d2af7b4daa0ba861d778aea3990f859957aeffc630', true)
    ), triggers(name, relation, routine, kind, deferred, predicate) AS (
      VALUES
        ('FundBalanceCorrection_create_round', 'public."FundAccountBalanceRegistration"', 'public.jg_create_fund_balance_correction_round()', 7, false,
          $when$new.kind = 'correction'::text AND new.status = 'pending_review'::text AND new."approvalInstanceId" IS NULL$when$),
        ('FundBalanceCorrection_round_complete', 'public."ApprovalInstance"', 'public.jg_validate_fund_balance_correction_round()', 5, true,
          $when$new."businessType" = 'fund_account_balance_registration'::text AND new."flowType" = 'fund_account_balance_correction'::text AND pg_trigger_depth() > 0$when$),
        ('FundBalanceCorrection_round_creation_immutable', 'public."ApprovalInstance"', 'public.jg_validate_fund_balance_correction_round()', 19, false,
          $when$old."businessType" = 'fund_account_balance_registration'::text AND old."flowType" = 'fund_account_balance_correction'::text$when$),
        ('FundBalanceCorrection_source_bound', 'public."FundAccountSourceBatch"', 'public.jg_validate_fund_balance_correction_round()', 7, false, NULL)
    ), expected_owner AS (
      SELECT relowner AS oid FROM pg_catalog.pg_class WHERE oid = 'public."ApprovalInstance"'::regclass
    )
    SELECT CASE
      WHEN current_user::text <> session_user::text THEN 'unknown'
      WHEN EXISTS (
        SELECT 1 FROM new_key k JOIN pg_catalog.pg_class c ON c.oid = k.oid JOIN expected_owner o ON o.oid = c.relowner
        WHERE c.relkind = 'r'
          AND NOT pg_catalog.has_schema_privilege(current_user, c.relnamespace, 'CREATE')
          AND NOT pg_catalog.has_table_privilege(current_user, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          AND NOT pg_catalog.has_any_column_privilege(current_user, c.oid, 'SELECT,INSERT,UPDATE,REFERENCES')
      ) AND NOT pg_catalog.has_table_privilege(current_user, 'public."ApprovalInstance"', 'INSERT')
        AND NOT pg_catalog.has_any_column_privilege(current_user, 'public."ApprovalInstance"', 'INSERT')
        AND NOT EXISTS (
        SELECT 1 FROM functions f WHERE NOT EXISTS (
          SELECT 1 FROM pg_catalog.pg_proc p JOIN expected_owner o ON o.oid = p.proowner
          WHERE p.oid = pg_catalog.to_regprocedure(f.signature) AND p.prosecdef = f.definer
            AND p.proconfig = ARRAY['search_path=pg_catalog'] AND NOT pg_catalog.has_function_privilege(current_user, p.oid, 'EXECUTE')
            AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') = f.body
        )
      ) AND NOT EXISTS (
        SELECT 1 FROM triggers wanted WHERE NOT EXISTS (
          SELECT 1 FROM pg_catalog.pg_trigger t
          WHERE t.tgname = wanted.name AND t.tgrelid = pg_catalog.to_regclass(wanted.relation)
            AND t.tgfoid = pg_catalog.to_regprocedure(wanted.routine) AND t.tgtype = wanted.kind
            AND t.tgenabled = 'O' AND NOT t.tgisinternal
            AND t.tgdeferrable = wanted.deferred AND t.tginitdeferred = wanted.deferred
            AND t.tgnargs = 0 AND t.tgattr::text = ''
            AND (CASE WHEN t.tgqual IS NULL THEN wanted.predicate IS NULL
              ELSE wanted.predicate IS NOT NULL AND
                (pg_catalog.regexp_match(pg_catalog.pg_get_triggerdef(t.oid, true),
                  ' WHEN [(](.*)[)] EXECUTE FUNCTION [^()]+[(][)]$'))[1] = wanted.predicate
            END)
        )
      ) AND pg_catalog.to_regclass('public."AuditLog_fund_balance_correction_round_witness"') IS NOT NULL
      THEN 'controlled'
      WHEN (SELECT oid IS NULL FROM new_key)
        AND pg_catalog.to_regclass('public."AuditLog_fund_balance_correction_round_witness"') IS NULL
        AND NOT EXISTS (SELECT 1 FROM functions f WHERE pg_catalog.to_regprocedure(f.signature) IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t JOIN triggers w ON t.tgname = w.name AND t.tgrelid = pg_catalog.to_regclass(w.relation))
        AND EXISTS (
          SELECT 1 FROM pg_catalog.pg_trigger t
          WHERE t.tgrelid = 'public."FundAccountBalanceRegistration"'::regclass
            AND t.tgname = 'FundAccountBalanceRegistration_review_evidence'
            AND t.tgfoid = 'public.jg_fund_review_evidence()'::regprocedure
            AND t.tgenabled = 'O' AND t.tgtype = 21 AND t.tgdeferrable AND t.tginitdeferred AND NOT t.tgisinternal
        )
        AND EXISTS (
          SELECT 1 FROM pg_catalog.pg_trigger t
          WHERE t.tgrelid = 'public."FundAccountBalanceRegistration"'::regclass
            AND t.tgname = 'FundAccountBalanceRegistration_insert'
            AND t.tgfoid = 'public.jg_registered_fund_registration_insert()'::regprocedure
            AND t.tgenabled = 'O' AND t.tgtype = 7 AND NOT t.tgdeferrable AND NOT t.tgisinternal
        )
        AND NOT EXISTS (
          SELECT 1 FROM pg_catalog.unnest(ARRAY['id','flowType','businessType','businessId','status','currentNodeIndex',
            'frozenNodes','applicantUserId','createdAt','updatedAt']) AS footprint(column_name)
          WHERE NOT pg_catalog.has_column_privilege(current_user, 'public."ApprovalInstance"', footprint.column_name, 'INSERT')
        )
      THEN 'legacy'
      ELSE 'unknown' END AS mode`;
  if (row?.mode !== "controlled" && row?.mode !== "legacy") {
    throw new ServiceUnavailableException("资金更正审批轮次授权不可用");
  }
  return row.mode;
}
