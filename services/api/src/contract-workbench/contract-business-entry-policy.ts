import { canPerform, resolveEffectiveRoleKeys, type RoleKey } from "@jiangkong/shared-domain";
import type { BusinessEntryTransactionResolverContext, BusinessEntryTransactionScenePolicy } from "../business-entry-definition/business-entry-transaction-scene-registry";
import { BadRequestException } from "@nestjs/common";
import { resolveContractTemplateEntry, resolveContractBillEntries } from "./contract-business-entry-definition";
import { hasGlobalContractDirector } from "./contract-workbench-authority";

export const CONTRACT_BASIC_ENTRY_POLICY: BusinessEntryTransactionScenePolicy = {
  sceneKey: "contract_basic", targetKind: "project_owned_entity",
  entityType: "contract_version", action: "contract.submit",
  resolveOwnership: async ({ tx, target }) => {
    const version = await tx.contractVersion.findUnique({
      where: { id: target.entityId }, select: { contractId: true }
    });
    if (!version) return [];
    return tx.contract.findMany({ where: { id: version.contractId }, select: { projectId: true }, take: 2 });
  },
  resolveAuthorization: async ({ tx, target, actorUserId }) => {
    const actor = await tx.user.findUnique({ where: { id: actorUserId }, select: { isActive: true } });
    const version = await tx.contractVersion.findUnique({ where: { id: target.entityId } });
    const contract = version ? await tx.contract.findUnique({ where: { id: version.contractId } }) : null;
    // Preserve the pre-existing ownerless historical-draft exception only.
    // It still requires contract.submit below and again in the transaction service.
    if (!actor?.isActive || !contract || (contract.ownerUserId && contract.ownerUserId !== actorUserId) || contract.voidedAt ||
        contract.projectId !== target.projectId || version?.status !== "draft") return [];
    const assignments = await tx.userPosition.findMany({
      where: { userId: actorUserId, OR: [{ projectId: null }, { projectId: target.projectId }] }
    });
    const positions = await tx.position.findMany({
      where: { id: { in: assignments.map((assignment) => assignment.positionId) } }
    });
    const members = await tx.projectMember.findMany({ where: { userId: actorUserId, projectId: target.projectId } });
    const roleKeys = (projectId: string | null) => assignments
      .filter((assignment) => assignment.projectId === projectId)
      .flatMap((assignment) => positions.filter((position) => position.id === assignment.positionId)
        .map((position) => position.key as RoleKey));
    const effectiveRoleKeys = resolveEffectiveRoleKeys(roleKeys(null), [
      ...roleKeys(target.projectId), ...members.map((member) => member.positionKey as RoleKey)
    ]);
    return canPerform("contract.submit", effectiveRoleKeys) ? effectiveRoleKeys : [];
  }
};

export const CONTRACT_TEMPLATE_ENTRY_POLICY: BusinessEntryTransactionScenePolicy = {
  ...CONTRACT_BASIC_ENTRY_POLICY,
  sceneKey: "contract_template_fields",
  resolveDefinition: async ({ tx, target }) => {
    const version = await tx.contractVersion.findUnique({ where: { id: target.entityId } });
    const entry = version ? await resolveContractTemplateEntry(tx, version) : null;
    if (!entry) throw new BadRequestException("合同模板版本不存在，请刷新后重试");
    return entry.definition;
  }
};

export const CONTRACT_SETTLEMENT_MODE_ENTRY_POLICY: BusinessEntryTransactionScenePolicy = {
  sceneKey: "contract_settlement_mode", targetKind: "project_owned_entity",
  entityType: "contract_version", action: "contract.create",
  resolveOwnership: CONTRACT_BASIC_ENTRY_POLICY.resolveOwnership,
  resolveAuthorization: async ({ tx, target, actorUserId }) => {
    const version = await tx.contractVersion.findUnique({ where: { id: target.entityId } });
    if (version?.status !== "draft" || !(await hasGlobalContractDirector(tx, actorUserId))) return [];
    return ["contract_director"];
  }
};

async function billVersionContext(context: BusinessEntryTransactionResolverContext) {
  const row = await context.tx.contractBillRow.findUnique({ where: { id: context.target.entityId } });
  const bill = row ? await context.tx.contractBill.findUnique({ where: { id: row.contractBillId } }) : null;
  if (!bill) throw new BadRequestException("合同清单行不存在，请刷新后重试");
  return { ...context, target: { ...context.target, entityType: "contract_version", entityId: bill.contractVersionId }, bill };
}

export const CONTRACT_BILL_ENTRY_POLICY: BusinessEntryTransactionScenePolicy = {
  sceneKey: "contract_bill_row", targetKind: "project_owned_entity",
  entityType: "contract_bill_row", action: "contract.submit",
  resolveOwnership: async (context) => CONTRACT_BASIC_ENTRY_POLICY.resolveOwnership(await billVersionContext(context)),
  resolveAuthorization: async (context) => CONTRACT_BASIC_ENTRY_POLICY.resolveAuthorization(await billVersionContext(context)),
  resolveDefinition: async (context) => {
    const scoped = await billVersionContext(context);
    const version = await context.tx.contractVersion.findUnique({ where: { id: scoped.target.entityId } });
    const entry = version ? (await resolveContractBillEntries(context.tx, version)).find((candidate) => candidate.billId === scoped.bill.id) : null;
    if (!entry) throw new BadRequestException("合同清单定义不存在，请刷新后重试");
    return entry.definition;
  }
};
