import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createBusinessEntryDefinitionRegistry, type BusinessEntrySceneDefinition, type BusinessEntryValidationResult, type RoleKey } from "@jiangkong/shared-domain";
import { AuditService } from "../audit/audit.service";

const fields = (entries: Array<[string, string, "text" | "long_text" | "date"]>, roles: readonly RoleKey[]) => entries.map(([key, label, type]) => ({
  key, label, type, description: `请填写${label}`, example: `${label}示例`, scope: "header" as const,
  unit: "", precision: 0, required: true,
  permissions: { view: roles, edit: roles },
  display: { formHint: `请填写${label}`, gridColumn: label, mobilePriority: 1, readonlyText: label },
  excel: { column: label, paste: "single" as const, errorLocation: "cell" as const },
  bulk: { enabled: false, strategy: "replace" as const }
}));

export const PROJECT_CREATE_DEFINITION: BusinessEntrySceneDefinition = {
  key: "project_create", entityType: "project", name: "新建项目", version: 1,
  description: "项目编号和名称，沿用项目创建岗位及原事务。",
  fields: fields([["code", "项目编号", "text"], ["name", "项目名称", "text"]], ["chairman", "general_manager"]), rules: []
};
export const PARTICIPANT_DEACTIVATION_DEFINITION: BusinessEntrySceneDefinition = {
  key: "project_participating_company_deactivate", entityType: "project_participating_company",
  name: "停止新增业务", version: 1, description: "沿用项目参与公司停止规则。",
  fields: fields([["endedOn", "停止新增业务日期", "date"], ["changeReason", "停止新增业务原因", "long_text"]], ["finance_staff", "finance_director"]), rules: []
};
const registry = createBusinessEntryDefinitionRegistry([PROJECT_CREATE_DEFINITION, PARTICIPANT_DEACTIVATION_DEFINITION]);

export function validateParticipantDeactivation(participantId: string, values: Record<string, unknown>, definitionVersion = PARTICIPANT_DEACTIVATION_DEFINITION.version) {
  return registry.validateDraft({ sceneKey: PARTICIPANT_DEACTIVATION_DEFINITION.key, definitionVersion,
    target: { entityType: "project_participating_company", entityId: participantId }, values }, ["finance_staff", "finance_director"]);
}

export async function freezeParticipantDeactivation(tx: Prisma.TransactionClient, audit: AuditService, actorUserId: string,
  participant: { id: string; projectId: string; companyEntityId: string; companyEntityVersionId: string },
  values: Record<string, unknown>, definitionVersion = PARTICIPANT_DEACTIVATION_DEFINITION.version) {
  const validation = validateParticipantDeactivation(participant.id, values, definitionVersion);
  if (!validation.valid) throw new BadRequestException(validation);
  const snapshot = registry.freezeSubmissionSnapshot({ sceneKey: PARTICIPANT_DEACTIVATION_DEFINITION.key, definitionVersion,
    target: { entityType: "project_participating_company", entityId: participant.id }, values }, ["finance_staff", "finance_director"]);
  const stored = await tx.businessEntrySubmissionSnapshot.create({ data: {
    projectId: participant.projectId, sceneKey: snapshot.sceneKey, entityType: "project_participating_company", entityId: participant.id,
    revision: 1, definitionVersion, definitionSnapshot: JSON.parse(JSON.stringify(snapshot.definition)) as Prisma.InputJsonValue,
    valuesSnapshot: JSON.parse(JSON.stringify(snapshot.values)) as Prisma.InputJsonValue,
    frozenAt: new Date(snapshot.frozenAt), frozenByUserId: actorUserId
  } });
  await audit.record(tx, { actorUserId, action: "business_entry.freeze", businessType: "project_participating_company", businessId: participant.id,
    metadata: { projectId: participant.projectId, companyEntityId: participant.companyEntityId,
      companyEntityVersionId: participant.companyEntityVersionId, sceneKey: snapshot.sceneKey, snapshotId: stored.id, revision: 1, definitionVersion } });
  return { ...snapshot, revision: 1 };
}

export function validateProjectCreation(values: Record<string, unknown>, definitionVersion = PROJECT_CREATE_DEFINITION.version): BusinessEntryValidationResult {
  // Original ProjectService normalization is authoritative for the two fields.
  const errors: BusinessEntryValidationResult["errors"] = [];
  if (definitionVersion !== PROJECT_CREATE_DEFINITION.version) {
    errors.push({ code: "stale_definition_version", message: "字段定义已经更新，请刷新后重新填写" });
  }
  return { valid: errors.length === 0, sceneKey: PROJECT_CREATE_DEFINITION.key,
    definitionVersion: PROJECT_CREATE_DEFINITION.version, values, errors };
}

export async function freezeProjectCreation(tx: Prisma.TransactionClient, audit: AuditService, actorUserId: string,
  project: { id: string; code: string; name: string }, definitionVersion = PROJECT_CREATE_DEFINITION.version) {
  const values = { code: project.code, name: project.name };
  const validation = validateProjectCreation(values, definitionVersion);
  if (!validation.valid) throw new BadRequestException(validation);
  const snapshot = registry.freezeSubmissionSnapshot({
    sceneKey: PROJECT_CREATE_DEFINITION.key, definitionVersion,
    target: { entityType: "project", entityId: project.id }, values
  }, ["chairman", "general_manager"]);
  const stored = await tx.businessEntrySubmissionSnapshot.create({ data: {
    projectId: project.id, sceneKey: snapshot.sceneKey, entityType: "project", entityId: project.id,
    revision: 1, definitionVersion,
    definitionSnapshot: JSON.parse(JSON.stringify(snapshot.definition)) as Prisma.InputJsonValue,
    valuesSnapshot: values, frozenAt: new Date(snapshot.frozenAt), frozenByUserId: actorUserId
  } });
  await audit.record(tx, { actorUserId, action: "business_entry.freeze", businessType: "project", businessId: project.id,
    metadata: { sceneKey: snapshot.sceneKey, snapshotId: stored.id, revision: 1, definitionVersion } });
  return { ...snapshot, revision: 1 };
}
