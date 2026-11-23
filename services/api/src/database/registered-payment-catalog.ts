import { ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

// The pre-signed-change registry bodies are fixed by the retained 205 and 295 installers.
const signedContractFileBindingState = Prisma.sql`
  , (
    WITH relations AS (
      SELECT pg_catalog.to_regclass('public."ContractSignedChange"')::oid AS change,
        pg_catalog.to_regclass('public."SignedContractSettlementAttachment"')::oid AS attachment,
        pg_catalog.to_regclass('public."ContractFormalFile"')::oid AS formal
    ), readable_columns AS (
      SELECT c.oid AS relation, a.attname::text AS name, a.attnum
      FROM relations r
      JOIN pg_catalog.pg_class c ON c.oid IN (r.change, r.attachment, r.formal)
      JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
      WHERE c.relowner=anchor.owner AND c.relkind='r' AND c.relpersistence='p'
        AND NOT (c.relispartition OR c.relrowsecurity OR c.relforcerowsecurity)
        AND a.attnum>0 AND NOT a.attisdropped AND a.attnotnull
        AND a.atttypid='pg_catalog.text'::regtype AND a.attgenerated='' AND a.attidentity=''
        AND pg_catalog.has_schema_privilege(c.relnamespace,'USAGE')
        AND pg_catalog.has_column_privilege(c.oid,a.attnum,'SELECT')
    )
    SELECT CASE
      WHEN change IS NULL AND attachment IS NULL
        AND pg_catalog.to_regprocedure('public.jg_contract_signed_change_history_guard()') IS NULL
        AND pg_catalog.to_regprocedure('public.jg_guard_signed_settlement_attachment()') IS NULL
        AND pg_catalog.to_regprocedure('public.jg_file_business_binding_columns_before_signed_settlement()') IS NULL
        AND EXISTS (
          SELECT FROM pg_catalog.pg_proc p WHERE p.oid=anchor.registry AND p.proowner=anchor.owner
            AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex') IN (
              'd2a3171b76def6792d43f5cc37ede636f0f25e57b4dcf25625d3e4c91471080f',
              '6d15e2b77fe89fbfa944d26522a9bf3a5c44636ecbfc1e99201e3e676502289f'
            )
        )
        THEN 'absent'
      WHEN NOT EXISTS (
        SELECT FROM (VALUES (change,'id'),(change,'appendixFormalFileId'),(attachment,'settlementId'),
          (attachment,'fileId'),(formal,'id'),(formal,'fileId')) required(relation,name)
        WHERE NOT EXISTS (
          SELECT FROM readable_columns c WHERE c.relation=required.relation AND c.name=required.name
        )
      ) AND EXISTS (
        SELECT FROM pg_catalog.pg_constraint k
        JOIN readable_columns source ON source.relation=change AND source.name='appendixFormalFileId'
        JOIN readable_columns target ON target.relation=formal AND target.name='id'
        WHERE k.contype='f' AND k.convalidated AND k.conrelid=change AND k.confrelid=formal
          AND k.conkey=ARRAY[source.attnum] AND k.confkey=ARRAY[target.attnum]
      ) AND EXISTS (
        SELECT FROM pg_catalog.pg_constraint k
        JOIN readable_columns source ON source.relation=attachment AND source.name='fileId'
        WHERE k.contype='f' AND k.convalidated AND k.conrelid=attachment AND k.confrelid=anchor.file
          AND k.conkey=ARRAY[source.attnum]
          AND k.confkey=ARRAY[(SELECT a.attnum FROM pg_catalog.pg_attribute a WHERE a.attrelid=anchor.file
            AND a.attname='id' AND a.attnum>0 AND NOT a.attisdropped)]
      ) THEN 'installed'
      ELSE 'unavailable'
    END FROM relations
  ) AS "signedContractFileBindings"
`;

/** Recognize the atomic registered-payment installation on the caller’s transaction. */
export async function readFileBindingCatalog(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  includeSignedContractFileBindings = false
) {
  const [row, extra] = await tx.$queryRaw<Array<{
    state: string;
    ownerSettlementVoucher?: boolean;
    signedContractFileBindings?: "absent" | "installed" | "unavailable";
  }>>(Prisma.sql`
    /* registered_payment_voucher_catalog */
    WITH scope AS (
      SELECT pg_catalog.to_regclass('public."PaymentExecution"')::oid AS payment,
        pg_catalog.to_regclass('public."FileObject"')::oid AS file,
        pg_catalog.to_regclass('public."RegisteredPaymentVoucher"')::oid AS voucher,
        pg_catalog.to_regclass('public."RegisteredPaymentFunding"')::oid AS funding,
        pg_catalog.to_regclass('public."RegisteredFundPaymentAllocation"')::oid AS allocation,
        pg_catalog.to_regclass('public."RegisteredPaymentEvent"')::oid AS event,
        pg_catalog.to_regclass('public."RegisteredContractHistoryRevision"')::oid AS history,
        pg_catalog.to_regprocedure('public.jg_file_business_binding_columns()')::oid AS registry,
        pg_catalog.to_regprocedure('public.jg_file_business_binding_columns_before_registered_payment()')::oid AS alias,
        pg_catalog.to_regprocedure('public.jg_file_business_binding_columns_before_owner_settlement()')::oid AS settlement_prior,
        pg_catalog.to_regprocedure('public.jg_project_owner_settlement_voucher_bound(text)')::oid AS settlement_reader,
        pg_catalog.to_regprocedure('public.jg_registered_payment_voucher_file_immutable()')::oid AS guard
    ), voucher_columns(name, type) AS (VALUES
      ('executionId',25), ('fileId',25), ('uploadedByUserId',25), ('contentSha256',25), ('createdAt',1114)
    ), anchor AS (
      SELECT scope.*, p.relowner AS owner, a.attnotnull AS legacy_voucher
      FROM scope JOIN pg_catalog.pg_class p ON p.oid=payment AND p.relkind='r'
      JOIN pg_catalog.pg_class f ON f.oid=file AND f.relkind='r' AND f.relowner=p.relowner
      JOIN pg_catalog.pg_attribute a ON a.attrelid=p.oid AND a.attname='voucherFileId'
        AND a.attnum>0 AND NOT a.attisdropped AND a.atttypid='pg_catalog.text'::regtype
    ), registry_routines AS (
      SELECT p.*,pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex') AS body_sha
      FROM anchor a JOIN pg_catalog.pg_proc p ON p.oid IN (a.registry,a.settlement_prior)
      JOIN pg_catalog.pg_language l ON l.oid=p.prolang
      WHERE p.pronamespace=pg_catalog.to_regnamespace('public') AND p.proowner=a.owner AND l.lanname='sql'
        AND p.prokind='f' AND p.provolatile='s' AND p.proparallel='s' AND p.proretset
        AND NOT (p.prosecdef OR p.proisstrict OR p.proleakproof) AND p.pronargs=0 AND p.pronargdefaults=0
        AND p.prorettype='pg_catalog.record'::regtype AND p.proargtypes=''::oidvector
        AND p.proallargtypes=ARRAY[25,25,16]::oid[] AND p.proargmodes=ARRAY['t','t','t']::"char"[]
        AND p.proargnames=ARRAY['tableName','columnName','exclusive']
        AND p.provariadic=0 AND p.prosupport=0
    ), registered_registry AS (
      SELECT oid,proacl
      FROM registry_routines
      WHERE body_sha='46e6f6acb43b69175637009a272eec11a945928f055272aeea13ea86c384a4a3'
        AND proconfig=ARRAY['search_path=pg_catalog, public, pg_temp']
    )
    SELECT CASE
      WHEN legacy_voucher AND num_nonnulls(voucher,funding,allocation,event,history,alias,guard,settlement_prior,settlement_reader)=0
        AND EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=registry AND p.proowner=owner
          AND pg_catalog.strpos(p.prosrc,'RegisteredPaymentVoucher')=0
          AND pg_catalog.strpos(p.prosrc,'jg_file_business_binding_columns_before_registered_payment')=0)
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid=file
          AND tgname='RegisteredPaymentVoucher_file_immutable')
        THEN 'absent'
      WHEN NOT legacy_voucher AND num_nonnulls(voucher,funding,allocation,event,history,alias,guard)=7
        AND (SELECT count(*) FROM pg_catalog.pg_class c WHERE c.oid IN (voucher,funding,allocation,event,history)
          AND c.relowner=owner AND c.relkind='r' AND c.relpersistence='p'
          AND NOT (c.relispartition OR c.relrowsecurity OR c.relforcerowsecurity))=5
        AND (SELECT count(*) FROM pg_catalog.pg_attribute a JOIN voucher_columns v
          ON v.name=a.attname AND v.type::oid=a.atttypid WHERE a.attrelid=voucher
          AND a.attnum>0 AND NOT a.attisdropped AND a.attnotnull)=5
        AND EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid=voucher
          AND k.conname='RegisteredPaymentVoucher_fileId_fkey' AND k.contype='f'
          AND k.confrelid=file AND k.convalidated AND NOT k.condeferrable
          AND k.confupdtype='r' AND k.confdeltype='r')
        AND EXISTS (SELECT 1 FROM pg_catalog.pg_proc predecessor WHERE predecessor.oid=alias AND predecessor.proowner=owner)
        AND (
          (settlement_prior IS NULL AND settlement_reader IS NULL AND EXISTS (
            SELECT 1 FROM registered_registry p WHERE p.oid=registry
          ))
          OR EXISTS (
            SELECT 1 FROM registry_routines p JOIN registered_registry prior ON prior.oid=settlement_prior
            JOIN pg_catalog.pg_proc reader ON reader.oid=settlement_reader
            JOIN pg_catalog.pg_language language ON language.oid=reader.prolang
            WHERE p.oid=registry AND p.oid<>prior.oid
              AND p.body_sha IN (
                '6d15e2b77fe89fbfa944d26522a9bf3a5c44636ecbfc1e99201e3e676502289f',
                '2a2b941651afd8763a7932f8ea110e845eb0851783ea86726b1da78ed20ded85'
              )
              AND p.proconfig=ARRAY['search_path=pg_catalog, public']
              AND reader.pronamespace=pg_catalog.to_regnamespace('public') AND reader.proowner=owner
              AND language.lanname='sql' AND reader.prokind='f' AND reader.prosecdef
              AND NOT (reader.proisstrict OR reader.proretset OR reader.proleakproof)
              AND reader.prorettype='pg_catalog.bool'::regtype AND reader.provolatile='s' AND reader.proparallel='u'
              AND reader.pronargs=1 AND reader.pronargdefaults=0 AND reader.proargtypes='25'::oidvector
              AND reader.proargnames=ARRAY['candidate'] AND reader.proargmodes IS NULL AND reader.proallargtypes IS NULL
              AND reader.provariadic=0 AND reader.prosupport=0
              AND reader.proconfig=ARRAY['search_path=pg_catalog, public']
              AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(reader.prosrc,'UTF8')),'hex')
                ='fdeab4bf7fe58fc59edc88ed38ce5b2950b3f8ce049983d8b3521f219ec8da14'
              /* reader 的 body/owner/search_path 已被上面的哈希钉住；ACL 只约束
                 可达范围：owner 保留 EXECUTE，禁止 PUBLIC、第三方 grantor 与
                 GRANT OPTION。受限 app 角色由 owner 授予非转授 EXECUTE 是产品
                 调用该只读旁路的正常授权，不得因此判定安装不可核验。 */
              AND EXISTS (
                SELECT FROM pg_catalog.aclexplode(coalesce(reader.proacl,pg_catalog.acldefault('f',owner))) a
                WHERE a.grantor=owner AND a.grantee=owner
                  AND a.privilege_type='EXECUTE' AND NOT a.is_grantable
              )
              AND NOT EXISTS (
                SELECT FROM pg_catalog.aclexplode(coalesce(reader.proacl,pg_catalog.acldefault('f',owner))) a
                WHERE a.grantee=0 OR a.grantor<>owner OR a.privilege_type<>'EXECUTE'
                  OR (a.grantee<>owner AND a.is_grantable)
              )
              AND NOT EXISTS (
                SELECT FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',owner))) a
                WHERE a.grantee=0 OR a.grantor<>owner OR a.privilege_type<>'EXECUTE'
                  OR (a.grantee<>owner AND a.is_grantable)
              )
              AND NOT EXISTS (
                WITH before_acl AS (SELECT * FROM pg_catalog.aclexplode(coalesce(prior.proacl,pg_catalog.acldefault('f',owner)))),
                     after_acl AS (SELECT * FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',owner))))
                (SELECT * FROM before_acl EXCEPT ALL SELECT * FROM after_acl)
                UNION ALL
                (SELECT * FROM after_acl EXCEPT ALL SELECT * FROM before_acl)
              )
          )
        )
        AND EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid
          WHERE t.tgrelid=file AND t.tgname='RegisteredPaymentVoucher_file_immutable'
          AND t.tgenabled='O' AND NOT t.tgisinternal AND t.tgtype=27
          AND p.oid=guard AND p.proowner=owner AND NOT p.prosecdef
          AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')
            ='91b57f66e67bb1d888d1d0e8803cabbe08c289b01d2a6e810bfa69fe82a48d62')
        AND EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
          WHERE t.tgrelid=voucher AND t.tgname='jg_efb_registered_payment_voucher'
          AND t.tgenabled='O' AND NOT t.tgisinternal AND t.tgtype=7
          AND t.tgfoid=pg_catalog.to_regprocedure('public.jg_enforce_exclusive_file_business_binding()'))
        THEN 'installed'
      ELSE 'unavailable'
    END AS state,
      settlement_reader IS NOT NULL AS "ownerSettlementVoucher"
      ${includeSignedContractFileBindings ? signedContractFileBindingState : Prisma.empty}
    FROM anchor
  `);
  if (!extra && (row?.state === "absent" || row?.state === "installed")) {
    if (row.signedContractFileBindings === "unavailable") {
      throw new ServiceUnavailableException("已签变更与结算文件绑定暂不可核验，请稍后重试");
    }
    return {
      registeredPayment: row.state === "installed",
      ownerSettlementVoucher: row.ownerSettlementVoucher === true,
      ...(includeSignedContractFileBindings ? { signedContractFileBindings: row.signedContractFileBindings === "installed" } : {})
    };
  }
  throw new ServiceUnavailableException("付款凭证文件绑定暂不可核验，请稍后重试");
}


export async function registeredPaymentInstalled(tx: Pick<Prisma.TransactionClient, "$queryRaw">): Promise<boolean> {
  return (await readFileBindingCatalog(tx)).registeredPayment;
}
