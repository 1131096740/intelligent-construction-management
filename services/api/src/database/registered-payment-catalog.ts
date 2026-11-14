import { ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

/** Recognize the atomic registered-payment installation on the caller’s transaction. */
export async function registeredPaymentInstalled(tx: Pick<Prisma.TransactionClient, "$queryRaw">): Promise<boolean> {
  const [row, extra] = await tx.$queryRaw<Array<{ state: string }>>(Prisma.sql`
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
        pg_catalog.to_regprocedure('public.jg_registered_payment_voucher_file_immutable()')::oid AS guard
    ), voucher_columns(name, type) AS (VALUES
      ('executionId',25), ('fileId',25), ('uploadedByUserId',25), ('contentSha256',25), ('createdAt',1114)
    ), anchor AS (
      SELECT scope.*, p.relowner AS owner, a.attnotnull AS legacy_voucher
      FROM scope JOIN pg_catalog.pg_class p ON p.oid=payment AND p.relkind='r'
      JOIN pg_catalog.pg_class f ON f.oid=file AND f.relkind='r' AND f.relowner=p.relowner
      JOIN pg_catalog.pg_attribute a ON a.attrelid=p.oid AND a.attname='voucherFileId'
        AND a.attnum>0 AND NOT a.attisdropped AND a.atttypid='pg_catalog.text'::regtype
    )
    SELECT CASE
      WHEN legacy_voucher AND num_nonnulls(voucher,funding,allocation,event,history,alias,guard)=0
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
        AND EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_proc predecessor ON predecessor.oid=alias
          WHERE p.oid=registry AND p.proowner=owner AND predecessor.proowner=owner AND NOT p.prosecdef
          AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')
            ='46e6f6acb43b69175637009a272eec11a945928f055272aeea13ea86c384a4a3')
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
    END AS state FROM anchor
  `);
  if (!extra && row?.state === "absent") return false;
  if (!extra && row?.state === "installed") return true;
  throw new ServiceUnavailableException("付款凭证文件绑定暂不可核验，请稍后重试");
}
