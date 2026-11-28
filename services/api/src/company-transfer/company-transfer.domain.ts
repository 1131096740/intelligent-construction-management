import type { ApprovalInstance, CompanyTransfer, Prisma } from "@prisma/client";
import type { RoleKey } from "@jiangkong/shared-domain";
import { resolveApprovalReviewIdentity, type FrozenApprovalNode } from "../approval/approval-review-identity";
import { BadRequestException } from "@nestjs/common";
import { createHash } from "node:crypto";
export const TRANSFER_KINDS = ["storage", "loan", "repayment"] as const;
export const TRANSFER_LABELS = { storage: "资金转存", loan: "临时借款调剂", repayment: "归还已有往来" };
export const TRANSFER_APPROVAL_NODES = [{ name: "董事长或总经理终审", mode: "any", roleKeys: ["chairman", "general_manager"] }];
export function accountIdentity(value: unknown) { if (typeof value !== "string") throw new BadRequestException("请填写完整银行账号"); const account = value.normalize("NFKC").replace(/[\s-]/gu, "").toLowerCase(); if (!/^[a-z0-9]{8,40}$/u.test(account)) throw new BadRequestException("银行账号格式不正确"); return { hash: createHash("sha256").update(account).digest("hex"), last4: account.slice(-4) }; }
export function transferTotals(events: ReadonlyArray<{ kind: string; amountCents: bigint; returnedIncomingEventId?: string | null }>) {
  const sum = (kind: string) => events.filter(e => e.kind === kind).reduce((n, e) => n + e.amountCents, 0n);
  const sent = sum("outgoing"), received = sum("incoming"), returned = sum("returned");
  const settledReturned = events.filter(e => e.returnedIncomingEventId).reduce((n, e) => n + e.amountCents, 0n);
  const netReceived = received - settledReturned;
  return { sent, received, returned, netReceived, inTransit: sent - netReceived - returned };
}
export function transferScope(kind: string, source: string | null, destination: string | null) { if (!TRANSFER_KINDS.includes(kind as never)) throw new BadRequestException("公司互转用途无效"); if (kind === "storage" && source !== destination) throw new BadRequestException("转存不能改变资金所属项目；跨项目使用请选择借款调剂"); }

export function lockCompanyTransfers(tx: Prisma.TransactionClient) {
  return tx.$executeRaw`SELECT pg_advisory_xact_lock(190731,91)`;
}

export function companyTransferFinalReviewer(
  transfer: Pick<CompanyTransfer,"id"|"status"|"approvalInstanceId"|"applicantUserId">,
  round: ApprovalInstance | null, actorId: string, roles: readonly string[]
) {
  if (transfer.status !== "submitted" || transfer.applicantUserId === actorId || !round ||
    round.id !== transfer.approvalInstanceId || round.businessId !== transfer.id || round.applicantUserId !== transfer.applicantUserId ||
    round.businessType !== "company_transfer" || round.flowType !== "company_transfer.approve" ||
    round.status !== "in_progress" || round.currentNodeIndex !== 0 ||
    !roles.some(role => role === "chairman" || role === "general_manager")) return null;
  const node = Array.isArray(round.frozenNodes) ? round.frozenNodes[0] : null;
  if (!node || typeof node !== "object" || Array.isArray(node)) return null;
  return resolveApprovalReviewIdentity({node:node as FrozenApprovalNode,actorUserId:actorId,actorRoleKeys:roles as RoleKey[]});
}

type TransferCashEvent = {returnedIncomingEventId?:string|null;id:string;kind:string;amountCents:bigint;outgoingEventId:string|null;recordedByUserId:string;createdAt:Date};
export function currentCompanyTransferCashDuties(
  transfer: Pick<CompanyTransfer,"status"|"amountCents"|"createdAt"|"approvedAt">,
  events: readonly TransferCashEvent[], actorId: string
) {
  if (transfer.status !== "approved") return [];
  const sent = events.filter(event=>event.kind === "outgoing");
  const outgoing = transfer.amountCents - sent.reduce((sum,event)=>sum+event.amountCents,0n);
  const result: Array<{key:string;amountCents:bigint;label:string;createdAt:Date}> = [];
  if (outgoing > 0n) result.push({key:"outgoing",amountCents:outgoing,label:"登记实际出款",createdAt:transfer.approvedAt ?? transfer.createdAt});
  for (const event of sent) {
    if (actorId === event.recordedByUserId) continue;
    const open = event.amountCents-events.filter(item=>item.outgoingEventId===event.id && !item.returnedIncomingEventId).reduce((sum,item)=>sum+item.amountCents,0n);
    if (open > 0n) result.push({key:event.id,amountCents:open,label:"独立核对该笔到账或退回",createdAt:event.createdAt});
  }
  return result;
}
