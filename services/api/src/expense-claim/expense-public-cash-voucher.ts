import { ConflictException, ForbiddenException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

type CashVoucherPayment = {
  claimId: string;
  actorUserId: string;
  amountCents: bigint;
  paidAt: Date;
  paymentMethod: string;
  voucherFileId: string;
  note: string | null;
  previousRegistrationId: string;
};

export async function recordExpensePublicCashVoucher(tx: Prisma.TransactionClient, payment: CashVoucherPayment) {
  const secret = process.env.OPERATING_LEDGER_DB_WRITE_SECRET?.trim();
  if (!secret) throw new ServiceUnavailableException("费用公共现金付款暂不可办理，请联系管理员");
  let rows: { id: string }[];
  try {
    rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT public.jg_record_expense_public_cash_voucher(
        ${payment.claimId}, ${payment.actorUserId}, ${payment.amountCents}::bigint,
        ${payment.paidAt}::timestamptz AT TIME ZONE 'UTC', ${payment.paymentMethod}, ${payment.voucherFileId},
        ${payment.note}::text, ${payment.previousRegistrationId}, ${secret}
      ) AS id
    `);
  } catch (error) {
    const failure = error !== null && typeof error === "object"
      ? error as { code?: unknown; meta?: { code?: unknown; message?: unknown } }
      : undefined;
    if (failure?.code === "P2010") {
      const code = failure.meta?.code;
      const text = failure.meta?.message;
      const message = typeof text === "string" ? text.replace(/^ERROR: /u, "") : undefined;
      if ((code === "P0A24" && message === "EXPENSE_PUBLIC_CASH_VOUCHER_COLLISION") ||
          (code === "23505" && (message === "该文件已绑定其他业务记录，不能重复使用" ||
            message === "该文件已接入文件替换链，不能再绑定独占业务事实" ||
            message?.startsWith('duplicate key value violates unique constraint "ExpenseClaimPaymentExecution_voucherFileId_key"')))) {
        throw new ConflictException("该文件已绑定其他业务记录，不能重复使用");
      }
      if (code === "42501" && message === "EXPENSE_PUBLIC_CASH_VOUCHER_KEEPER") {
        throw new ForbiddenException("只有当前具名公共现金保管人可以登记本笔付款");
      }
      if (code === "23514" && message === "EXPENSE_PUBLIC_CASH_VOUCHER_FILE") {
        throw new ConflictException("付款凭证已变化，请刷新后重试");
      }
      if (code === "23514" && message === "EXPENSE_PUBLIC_CASH_VOUCHER_CLAIM") {
        throw new ConflictException("费用或审批已变化，请刷新后重试");
      }
    }
    throw error;
  }
  if (rows.length !== 1 || !rows[0]?.id) {
    throw new ServiceUnavailableException("费用公共现金付款结果暂无法核对，请稍后查询");
  }
  return rows[0];
}
