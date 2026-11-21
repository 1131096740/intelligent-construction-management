import type { PrismaClient } from "@prisma/client";

const signature = "public.jg_check_registered_payment_voucher_binding_v1(text,text,text)";

export async function activateOwned281VoucherCheck(
  owner: PrismaClient, runId: string, executionId: string, paymentId: string,
  projectId: string, actorId: string, fileId: string, digest: string, size: number
) {
  await owner.$transaction(async tx => {
    const installed = await tx.$executeRaw`
      INSERT INTO public.jg_registered_payment_voucher_check_binding_v1 (
        database_oid, system_identifier, server_port, runtime_role_oid,
        execution_id, payment_id, project_id, actor_id, file_id, content_sha256, size_bytes, mime_type
      )
      SELECT d.oid, (SELECT system_identifier::text FROM pg_catalog.pg_control_system()), inet_server_port(),
        runtime.oid, execution.id, payment.id, payment."projectId", actor.id, file.id,
        file."contentSha256", file."sizeBytes", file."mimeType"
      FROM pg_catalog.pg_database d
      JOIN pg_catalog.pg_roles runtime ON runtime.rolname='jg_task01_runtime'
      JOIN public."PaymentExecution" execution ON execution.id=${executionId} AND execution."voucherFileId" IS NULL
      JOIN public."RegisteredPaymentFunding" funding ON funding."executionId"=execution.id
      JOIN public."PaymentRequest" payment ON payment.id=${paymentId} AND payment.id=execution."paymentRequestId"
        AND payment."projectId"=${projectId}
      JOIN public."User" actor ON actor.id=${actorId} AND actor."isActive"
      JOIN public."FileObject" file ON file.id=${fileId} AND file."uploadedByUserId"=actor.id
        AND file."storageStatus"='active' AND file."contentSha256"=${digest}
        AND file."sizeBytes"=${size} AND file."mimeType"='image/png'
      WHERE d.datname=current_database() AND d.datname=${`jg_task01_${runId}`} AND d.datdba=10
        AND current_user=session_user AND current_user='jg_task01_owner'
        AND current_user::regrole::oid=10 AND inet_client_addr() = '127.0.0.1'::inet
        AND inet_server_addr() = '127.0.0.1'::inet
        AND EXISTS(SELECT FROM pg_catalog.pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl)
        AND EXISTS(SELECT FROM public._prisma_migrations WHERE migration_name='20261118230000_registered_payment_voucher_fixed_binding'
          AND checksum='257ea44623aee810067756893d93ba84769f1fce1581375e64457812fcd42ee2'
          AND finished_at IS NOT NULL AND rolled_back_at IS NULL)
        AND NOT EXISTS(SELECT FROM public."RegisteredPaymentVoucher" prior WHERE prior."executionId"=execution.id)
        AND NOT has_function_privilege(runtime.oid,'public.jg_project_owner_settlement_voucher_bound(text)','EXECUTE')
        AND NOT has_function_privilege(runtime.oid,${signature},'EXECUTE');
    `;
    if (installed !== 1) throw new Error("TASK398_VOUCHER281_ACTIVATION");
    await tx.$executeRawUnsafe(
      "GRANT EXECUTE ON FUNCTION public.jg_check_registered_payment_voucher_binding_v1(text,text,text) TO jg_task01_runtime"
    );
  });
}

export async function releaseOwned281VoucherCheck(owner: PrismaClient, executionId: string, fileId: string) {
  await owner.$transaction(async tx => {
    await tx.$executeRawUnsafe(
      "REVOKE EXECUTE ON FUNCTION public.jg_read_registered_payment_voucher_binding_v1(text,text,text) FROM jg_task01_runtime"
    );
    await tx.$executeRawUnsafe(
      "REVOKE EXECUTE ON FUNCTION public.jg_check_registered_payment_voucher_binding_v1(text,text,text) FROM jg_task01_runtime"
    );
    const removed = await tx.$executeRaw`
      DELETE FROM public.jg_registered_payment_voucher_check_binding_v1
      WHERE singleton AND execution_id=${executionId} AND file_id=${fileId};
    `;
    if (removed !== 1) throw new Error("TASK398_VOUCHER281_RELEASE");
  });
}


export async function activateOwned282VoucherRead(owner: PrismaClient, executionId: string, fileId: string, actorId: string) {
  await owner.$transaction(async tx => {
    const [witness] = await tx.$queryRaw<Array<{ verified: boolean }>>`
      SELECT EXISTS(
        SELECT FROM public.jg_registered_payment_voucher_check_binding_v1 binding
        JOIN public."RegisteredPaymentVoucher" voucher ON voucher."executionId"=binding.execution_id
          AND voucher."fileId"=binding.file_id AND voucher."uploadedByUserId"=binding.actor_id
          AND voucher."contentSha256"=binding.content_sha256
        WHERE binding.singleton AND binding.execution_id=${executionId}
          AND binding.file_id=${fileId} AND binding.actor_id=${actorId}
          AND binding.runtime_role_oid='jg_task01_runtime'::regrole::oid
          AND binding.database_oid=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database() AND datdba=10)
          AND binding.server_port=inet_server_port()
          AND binding.system_identifier=(SELECT system_identifier::text FROM pg_catalog.pg_control_system())
          AND current_user=session_user AND current_user='jg_task01_owner'
          AND EXISTS(SELECT FROM pg_catalog.pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl)
          AND NOT has_function_privilege(binding.runtime_role_oid,'public.jg_project_owner_settlement_voucher_bound(text)','EXECUTE')
          AND NOT has_function_privilege(binding.runtime_role_oid,'public.jg_read_registered_payment_voucher_binding_v1(text,text,text)','EXECUTE')
      ) AS verified
    `;
    if (witness?.verified !== true) throw new Error("TASK398_VOUCHER282_READ_ACTIVATION");
    await tx.$executeRawUnsafe(
      "REVOKE EXECUTE ON FUNCTION public.jg_check_registered_payment_voucher_binding_v1(text,text,text) FROM jg_task01_runtime"
    );
    await tx.$executeRawUnsafe(
      "GRANT EXECUTE ON FUNCTION public.jg_read_registered_payment_voucher_binding_v1(text,text,text) TO jg_task01_runtime"
    );
  });
}
