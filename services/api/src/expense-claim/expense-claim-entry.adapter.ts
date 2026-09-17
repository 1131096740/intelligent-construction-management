import { ConflictException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { EXPENSE_CLAIM_ENTRY_DEFINITION } from "./expense-claim-entry.definition";
import { assertExpenseClaimEntrySubmission } from "./expense-claim-entry.policy";
import { formatMoneyCentsAsYuan } from "../money/decimal-money";

export async function freezeExpenseClaimEntryInTransaction(tx: Prisma.TransactionClient, claimId: string, actorUserId: string, approvalInstanceId: string) {
  const claim = await tx.expenseClaim.findUnique({ where: { id: claimId } });
  if (!claim) throw new ConflictException("费用申请不存在，请刷新后重试");
  assertExpenseClaimEntrySubmission(claim, actorUserId, approvalInstanceId);
  const lines = await tx.expenseClaimLine.findMany({ where: { expenseClaimId: claimId }, orderBy: { sortOrder: "asc" } });
  const attachments = await tx.expenseClaimAttachment.findMany({ where: { expenseClaimId: claimId, stage: "approval_frozen", removedAt: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, fileId: true, category: true, expenseCategory: true } });
  return tx.expenseClaimEntrySnapshot.create({ data: {
    expenseClaimId: claimId, sceneKey: EXPENSE_CLAIM_ENTRY_DEFINITION.key, businessAction: "expense_claim.submit", operationObjectType: "approval_instance", operationObjectId: approvalInstanceId, submissionRevision: approvalInstanceId,
    definitionVersion: EXPENSE_CLAIM_ENTRY_DEFINITION.version, definitionSnapshot: EXPENSE_CLAIM_ENTRY_DEFINITION as unknown as Prisma.InputJsonValue, frozenByUserId: actorUserId,
    valuesSnapshot: {
      claimType: claim.claimType, companyEntityId: claim.companyEntityId, companyEntityName: claim.companyEntityNameSnapshot, projectId: claim.projectId,
      applicantUserId: claim.applicantUserId, applicantName: claim.applicantNameSnapshot, applicantPhone: claim.applicantPhoneSnapshot, factWitnessUserId: claim.factWitnessUserId, factWitnessName: claim.factWitnessNameSnapshot,
      reason: claim.reason, requestedAmountCents: claim.requestedAmountCents.toString(), loanOffsetAmountCents: claim.loanOffsetAmountCents.toString(), companyPayableAmountCents: claim.companyPayableAmountCents.toString(),
      requestedAmountYuan: formatMoneyCentsAsYuan(claim.requestedAmountCents).replace(/,/g, ""),
      paymentMethod: claim.paymentMethod, payeeName: claim.payeeNameSnapshot, payeeAccountName: claim.payeeAccountNameSnapshot, payeeBankName: claim.payeeBankNameSnapshot, payeeBankAccount: claim.payeeBankAccountSnapshot, loanExpectedClearanceOn: claim.loanExpectedClearanceAt?.toISOString().slice(0, 10) ?? null, incidentalExpenseCategory: claim.incidentalExpenseCategory,
      lines: lines.map((line) => ({ expenseCategory: line.expenseCategory, occurredOn: line.occurredOn.toISOString().slice(0, 10), purpose: line.purpose, receiptCount: line.receiptCount, amountCents: line.amountCents.toString(), amountYuan: formatMoneyCentsAsYuan(line.amountCents).replace(/,/g, ""), evidenceType: line.evidenceType, noEvidenceReason: line.noEvidenceReason, remark: line.remark })),
      attachments
    }
  } });
}
