import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { Prisma, type FundAccountBalanceRegistration } from "@prisma/client";
import { createHash } from "node:crypto";
import type { ConfirmFundBalanceDto } from "./fund-account.dto";
export const FUND_REVIEW_COMMAND_KIND = "fund_account_balance_review_v1";
export type FundReviewDecision = "approve" | "reject" | "withdraw";
export type FundReviewReceipt = {
  id: string; version: number; kind: "correction"; status: "confirmed" | "returned" | "withdrawn";
  balanceYuan: string | null; previousRegistrationId: string | null; approvalInstanceId: string;
  commandKey: string; reason: string; reviewNote: string; closeReason: string | null;
  actorUserId: string; representedUserId: string; signed: boolean; signatureVersionId: string | null;
};
function jsonObject(value: unknown): Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
export function normalizeFundReviewCommand(registrationId: string, input: ConfirmFundBalanceDto, action: FundReviewDecision) {
  const fields = new Set(["idempotencyKey", "expectedApprovalInstanceId", "reviewNote", "selfReviewReason", "confirmationPassword"]);
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !fields.has(key)) || typeof input.idempotencyKey !== "string" || !input.idempotencyKey.trim() || input.idempotencyKey.length > 100 || typeof input.expectedApprovalInstanceId !== "string" || !input.expectedApprovalInstanceId || input.expectedApprovalInstanceId.length > 200 || typeof input.reviewNote !== "string" || !input.reviewNote.trim() || input.reviewNote.length > 1000 || (input.selfReviewReason !== undefined && (typeof input.selfReviewReason !== "string" || input.selfReviewReason.length > 1000)) || (input.confirmationPassword !== undefined && (typeof input.confirmationPassword !== "string" || input.confirmationPassword.length > 200))) throw new BadRequestException("办理凭据或复核内容格式不正确，请保留输入后重试");
  return { registrationId, approvalInstanceId: input.expectedApprovalInstanceId, action, reviewNote: input.reviewNote.trim(), selfReviewReason: input.selfReviewReason?.trim() || null };
}
export function fundReviewFingerprint(id: string, input: ConfirmFundBalanceDto, action: FundReviewDecision) {
  // Credentials are admission evidence, never business payload or stored hashes.
  return createHash("sha256").update(JSON.stringify(normalizeFundReviewCommand(id, input, action))).digest("hex");
}
export function makeFundReviewReceipt(row: FundAccountBalanceRegistration, actorUserId: string, representedUserId: string, input: ConfirmFundBalanceDto, action: FundReviewDecision, signatureVersionId: string | null): FundReviewReceipt {
  if (!row.approvalInstanceId || (action === "approve" && !signatureVersionId)) throw new ConflictException("复核签批证据不完整，不能确认余额");
  return { id: row.id, version: row.version, kind: "correction", status: action === "approve" ? "confirmed" : action === "reject" ? "returned" : "withdrawn", balanceYuan: row.balanceYuan?.toFixed(4) ?? null, previousRegistrationId: row.previousRegistrationId, approvalInstanceId: row.approvalInstanceId, commandKey: input.idempotencyKey, reason: row.reason, reviewNote: input.reviewNote.trim(), closeReason: action === "approve" ? null : input.reviewNote.trim(), actorUserId, representedUserId, signed: action === "approve", signatureVersionId };
}
export function fundReviewReceiptMetadata(rowId: string, input: ConfirmFundBalanceDto, action: FundReviewDecision, receipt: FundReviewReceipt): Prisma.InputJsonObject {
  return { fundReviewCommandKind: FUND_REVIEW_COMMAND_KIND, fundReviewCommandKey: input.idempotencyKey, fundReviewPayloadFingerprint: fundReviewFingerprint(rowId, input, action), fundReviewReceipt: receipt as unknown as Prisma.InputJsonObject };
}
async function commandLog(tx: Prisma.TransactionClient, key: string) {
  const logs = await tx.approvalActionLog.findMany({ where: { AND: [{ metadata: { path: ["fundReviewCommandKind"], equals: FUND_REVIEW_COMMAND_KIND } }, { metadata: { path: ["fundReviewCommandKey"], equals: key } }] }, take: 2 });
  if (logs.length > 1) throw new ConflictException("办理回执重复，请停止重试并核对原记录");
  return logs[0] ?? null;
}
export async function readFundReviewReceipt(tx: Prisma.TransactionClient, actorUserId: string, registrationId: string, input: ConfirmFundBalanceDto, action: FundReviewDecision): Promise<FundReviewReceipt | null> {
  const fingerprint = fundReviewFingerprint(registrationId, input, action);
  const actor = await tx.user.findUnique({ where: { id: actorUserId }, select: { isActive: true } });
  if (!actor?.isActive) throw new ForbiddenException("当前账号已停用，不能读取办理回执");
  const log = await commandLog(tx, input.idempotencyKey);
  if (!log) return null;
  const metadata = jsonObject(log.metadata); const receipt = jsonObject(metadata.fundReviewReceipt);
  if (log.actorUserId !== actorUserId || log.approvalInstanceId !== input.expectedApprovalInstanceId || log.action !== action || metadata.fundReviewPayloadFingerprint !== fingerprint || receipt.id !== registrationId || receipt.approvalInstanceId !== input.expectedApprovalInstanceId || receipt.commandKey !== input.idempotencyKey || receipt.actorUserId !== actorUserId || receipt.representedUserId !== log.representedUserId) throw new ConflictException("同一办理凭据不能用于其他人、其他事项或不同内容，请核对原回执");
  const row = await tx.fundAccountBalanceRegistration.findUnique({ where: { id: registrationId } });
  const status = action === "approve" ? "confirmed" : action === "reject" ? "returned" : "withdrawn";
  if (!row || row.approvalInstanceId !== log.approvalInstanceId || row.status !== status || receipt.status !== status || receipt.version !== row.version || receipt.balanceYuan !== (row.balanceYuan?.toFixed(4) ?? null) || (action === "approve" ? row.confirmedByUserId !== actorUserId : row.closedByUserId !== actorUserId) || (action === "approve" && (!log.signatureVersionIdSnapshot || !log.signatureSha256Snapshot || !log.signatureFileIdSnapshot || receipt.signatureVersionId !== log.signatureVersionIdSnapshot))) throw new ConflictException("办理回执与已提交事实不一致，请停止重试并核对");
  return receipt as unknown as FundReviewReceipt;
}
/** The only guard exception: exact frozen readback of the same actor's command.
 * No match conveys authority to start or repeat a review. JWT remains earlier. */
export async function matchesOwnFundReviewReceipt(tx: Prisma.TransactionClient, actor: string, id: string, body: Record<string, unknown> | undefined, action: FundReviewDecision) {
  if (!body) return false;
  try { normalizeFundReviewCommand(id, body as unknown as ConfirmFundBalanceDto, action); } catch { return false; }
  const log = await commandLog(tx, body.idempotencyKey as string);
  if (!log || log.actorUserId !== actor || log.approvalInstanceId !== body.expectedApprovalInstanceId || log.action !== action || jsonObject(jsonObject(log.metadata).fundReviewReceipt).id !== id) return false;
  return Boolean(await readFundReviewReceipt(tx, actor, id, body as unknown as ConfirmFundBalanceDto, action));
}
