import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

export const EDITABLE_STATUSES = ["draft", "approval_rejected"];

// 共享的“清单所有者 + 草稿可编辑状态 + 未作废”校验，供行 CRUD 与 Excel 导入复用，避免并行实现。
export async function loadOwnedEditableBill(
  tx: Prisma.TransactionClient,
  billId: string,
  actorUserId: string
) {
  const bill = await tx.contractBill.findUnique({ where: { id: billId } });
  if (!bill) throw new NotFoundException("Contract bill not found");
  if (bill.pricingMode !== "tax_inclusive" && bill.pricingMode !== "tax_exclusive") {
    throw new BadRequestException("Contract bill pricing mode is invalid");
  }
  const version = await tx.contractVersion.findUnique({
    where: { id: bill.contractVersionId }
  });
  if (!version) throw new NotFoundException("Contract draft version not found");
  const contract = await tx.contract.findUnique({ where: { id: version.contractId } });
  if (!contract) throw new NotFoundException("Contract draft not found");
  if (contract.ownerUserId !== actorUserId) {
    throw new ForbiddenException("Only the contract draft owner may edit");
  }
  if (!EDITABLE_STATUSES.includes(version.status)) {
    throw new BadRequestException("Contract draft is not editable");
  }
  if (contract.voidedAt) throw new BadRequestException("Contract draft is voided");
  return { bill, version };
}
