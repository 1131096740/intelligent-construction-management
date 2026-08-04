import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { lockContractDraftMutationBoundary } from "../contract/contract-draft-lifecycle";

export const EDITABLE_STATUSES = ["draft", "approval_rejected"];

// 共享的“清单所有者 + 草稿可编辑状态 + 未作废”校验，供行 CRUD 与 Excel 导入复用，避免并行实现。
export async function loadOwnedEditableBill(
  tx: Prisma.TransactionClient,
  billId: string,
  actorUserId: string
) {
  const bill = await tx.contractBill.findUnique({ where: { id: billId } });
  if (!bill) throw new NotFoundException("合同清单不存在");
  if (bill.pricingMode !== "tax_inclusive" && bill.pricingMode !== "tax_exclusive") {
    throw new BadRequestException("合同清单计价模式无效");
  }
  const mutationBoundary =
    await lockContractDraftMutationBoundary<
      NonNullable<
        Awaited<ReturnType<typeof tx.contractVersion.findUnique>>
      >
    >(tx, bill.contractVersionId);
  if (!mutationBoundary) throw new NotFoundException("合同草稿版本不存在");
  const version = mutationBoundary.version;
  const contract = await tx.contract.findUnique({ where: { id: version.contractId } });
  if (!contract) throw new NotFoundException("合同草稿不存在");
  if (contract.ownerUserId !== actorUserId) {
    throw new ForbiddenException("只有合同草稿经办人可以编辑清单");
  }
  if (!EDITABLE_STATUSES.includes(version.status)) {
    throw new BadRequestException("当前合同草稿状态不可编辑清单");
  }
  if (version.changeType === "historical_takeover") {
    throw new BadRequestException("历史接管草稿必须在历史接管工作台办理");
  }
  if (mutationBoundary.formalBlockers.length > 0) {
    throw new BadRequestException("合同已存在正式业务事实，不能编辑草稿清单");
  }
  if (contract.voidedAt) {
    throw new BadRequestException("合同草稿已作废，不能编辑清单");
  }
  return { bill, version };
}
