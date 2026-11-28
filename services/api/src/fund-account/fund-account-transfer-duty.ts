import type { Prisma } from "@prisma/client";
import type { RoleKey } from "@jiangkong/shared-domain";
import { currentPublicCashCustodian } from "./public-cash-custodian";

export const FUND_TRANSFER_FINANCE_ROLES = ["finance_staff", "finance_director"] as const;
export const FUND_TRANSFER_CASH_ROLES = ["comprehensive_director"] as const;
export const fundTransferRoles = (kind: string): readonly RoleKey[] => kind === "public_cash" ? FUND_TRANSFER_CASH_ROLES : FUND_TRANSFER_FINANCE_ROLES;
export const FUND_TRANSFER_TARGET = "/资金账户";

type Transfer = {
  status: string;
  createdByUserId: string;
  sourceAccount: {kind: string};
  destinationAccount: {kind: string};
};
type CashAccess = {custodian: string | null; previousCustodians: ReadonlySet<string>};

export async function fundTransferCashAccess(tx: Prisma.TransactionClient, actorId: string, cashAccountId: string | null): Promise<CashAccess> {
  const custodian = cashAccountId ? await currentPublicCashCustodian(tx, cashAccountId) : null;
  const previousCustodians = cashAccountId && custodian === actorId ? new Set(
    (await tx.publicCashHandover.findMany({
      where: {accountId: cashAccountId, fromCustodian: {isActive: false}, receipt: {isNot: null}},
      select: {fromCustodianId: true}
    })).map(row => row.fromCustodianId)
  ) : new Set<string>();
  return {custodian, previousCustodians};
}

export function currentFundTransferDuty(transfer: Transfer, actorId: string, roles: readonly RoleKey[], cash: CashAccess) {
  if (transfer.status === "pending_receipt") {
    const kind = transfer.destinationAccount.kind;
    if (fundTransferRoles(kind).some(role => roles.includes(role)) &&
      (kind !== "public_cash" || !cash.custodian || cash.custodian === actorId)) return "receive";
  }
  if (transfer.status === "rejected_held") {
    const kind = transfer.sourceAccount.kind;
    if (fundTransferRoles(kind).some(role => roles.includes(role)) &&
      (transfer.createdByUserId === actorId || (kind === "public_cash" && cash.custodian === actorId &&
        cash.previousCustodians.has(transfer.createdByUserId)))) return "resolve_rejection";
  }
  return null;
}

export function fundTransferDutyLabel(duty: "receive" | "resolve_rejection") {
  return duty === "receive" ? "核对转款实收" : "核对驳回转款并补证或登记退回";
}
