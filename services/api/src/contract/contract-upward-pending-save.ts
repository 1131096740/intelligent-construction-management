import { BadRequestException, ConflictException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma, type Contract, type ContractVersion } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import { chinaDateOnly, normalizeBusinessAmount, normalizeTaxRatePercent } from "@jiangkong/shared-domain";
import type { AuditService } from "../audit/audit.service";
import type { BusinessPartyService } from "../business-party/business-party.service";
import type { FileService } from "../file/file.service";
import type { SaveContractDraftAggregateDto } from "../contract-workbench/dto/contract-workbench.dto";
import { readUpwardDirectPending } from "./contract-upward-pending-read";
import { assertUpwardPendingSaveContinuity, qualifyUpwardPendingSave } from "./contract-upward-pending-save-profile";

export const UPWARD_PENDING_SAVE_ACTIONS = [
  "acquire_contract_draft_edit_lease", "heartbeat_contract_draft_edit_lease", "release_contract_draft_edit_lease",
  "save_contract_draft", "upload_contract_workbench_private_file"
] as const;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function position(value: unknown) {
  const item = record(value);
  if (!item || Object.keys(item).length !== 2 || (item.roleKey !== "party_a" && item.roleKey !== "party_b") || item.displayOrder !== 0) {
    throw new BadRequestException("请选择双方实际签署的甲乙位置");
  }
  return { roleKey: item.roleKey, displayOrder: 0 };
}

function signedDate(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !/^(?!0000)\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new BadRequestException("签订日期应为有效年月日或空值");
  }
  const date = new Date(value + "T00:00:00.000Z");
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException("签订日期不是有效年月日");
  }
  return value;
}

export async function saveUpwardPendingAggregate(
  tx: Prisma.TransactionClient, contract: Contract, version: ContractVersion,
  actor: string, input: SaveContractDraftAggregateDto, requestSha256: string,
  audit: AuditService, parties: BusinessPartyService, files: FileService, transportFingerprint?: string
) {
  const qualification = await qualifyUpwardPendingSave(tx);
  const current = record(record(version.draftData)?.directSigningInput);
  const desired = record(input.draft.draftData.directSigningInput);
  const basics = record(input.draft.draftData.contractBasics);
  const name = input.draft.draftData.contractName;
  if (version.numericProtocolVersion !== 2 || version.versionNo !== 1 || version.changeType !== "original"
    || version.status !== "draft" || version.firstSubmittedAt || version.effectiveAt || version.endedAt
    || current?.protocolVersion !== 2 || current.source !== "direct_signed" || current.relationship !== "upward"
    || !desired || Object.keys(desired).sort().join(",") !== "companyParticipationId,companyParty,enterpriseParty,fixedPaymentTermsVersionId,protocolVersion,relationship,signedOn,source"
    || desired.protocolVersion !== 2 || desired.source !== "direct_signed" || desired.relationship !== "upward"
    || desired.companyParticipationId !== current.companyParticipationId || desired.fixedPaymentTermsVersionId !== current.fixedPaymentTermsVersionId
    || basics?.relationship !== "upward" || basics.businessType !== contract.contractTypeKey || typeof name !== "string" || !name.trim()
    || Object.keys(basics).some(key => !["relationship", "businessType", "amountBasis", "invoiceStatus", "settlementText"].includes(key))
    || !["tax_inclusive", "tax_exclusive"].includes(String(basics.amountBasis)) || !["pending", "none", "vat_general", "vat_special"].includes(String(basics.invoiceStatus))
    || typeof basics.settlementText !== "string" || input.draft.numericProtocolVersion !== 2 || !input.draft.companyEntityId
    || input.draft.manualAmountCents !== undefined || input.draft.estimatedAmountCents !== undefined
    || input.bills.length || input.draft.clauses.length || input.draft.layoutTemplateVersionId
    || input.negotiationDocuments.referencedGeneratedDocumentIds.length
    || ["fieldValues", "partyValues"].some(key => Object.hasOwn(input.draft.draftData, key)
      && Object.keys(record(input.draft.draftData[key]) ?? { invalid: true }).length)
    || Object.keys(input.draft.draftData).some(key => !["contractName", "contractBasics", "directSigningInput", "fieldValues", "partyValues"].includes(key))) {
    throw new BadRequestException("对上待登记资料的来源、签约主体或填写范围不正确");
  }
  const companyParty = position(desired.companyParty);
  const enterpriseParty = position(desired.enterpriseParty);
  const [enterpriseInput] = input.parties;
  if (companyParty.roleKey === enterpriseParty.roleKey || input.parties.length !== 1 || !enterpriseInput.businessPartyVersionId
    || enterpriseInput.roleKey !== enterpriseParty.roleKey || enterpriseInput.displayOrder !== enterpriseParty.displayOrder) {
    throw new BadRequestException("签约双方必须分别绑定我方参与公司与施工企业");
  }
  const signedOn = signedDate(desired.signedOn);
  if (!input.attachments.length || input.attachments.length > 20
    || input.attachments.some((file, index) => file.slotKey !== "direct_signed_originals_v1" || file.displayOrder !== index)
    || new Set(input.attachments.map(file => file.fileId)).size !== input.attachments.length) {
    throw new BadRequestException("签章原件须为一至二十份有序、无重复的PDF或照片");
  }

  const now = new Date();
  const businessDay = new Date(chinaDateOnly(now) + "T00:00:00.000Z");
  const projects = await tx.$queryRaw<Array<{ id: string; isActive: boolean }>>(Prisma.sql`
    SELECT "id", "isActive" FROM "Project" WHERE "id" = ${contract.projectId} FOR UPDATE
  `);
  if (projects.length !== 1 || projects[0].id !== contract.projectId || projects[0].isActive !== true) {
    throw new ConflictException("项目已停用，不能保存对上签章资料");
  }
  const assignments = await tx.projectAffiliateAssignment.findMany({ where: {
    projectId: contract.projectId, effectiveFrom: { lte: now }, OR: [{ endedAt: null }, { endedAt: { gt: now } }]
  } });
  const enterprise = await tx.businessPartyVersion.findUnique({ where: { id: enterpriseInput.businessPartyVersionId } });
  if (assignments.length !== 1 || !enterprise || assignments[0].businessPartyId !== enterprise.businessPartyId
    || assignments[0].businessPartyVersionId !== enterprise.id) throw new ConflictException("签约施工企业不是本项目当前有效的受控主体");
  const assignment = assignments[0];
  const retainedEnterprise = await tx.contractPartySnapshot.findFirst({
    where: { contractVersionId: version.id, roleKey: enterpriseParty.roleKey, displayOrder: enterpriseParty.displayOrder },
    select: { businessPartyVersionId: true }
  });
  if (retainedEnterprise?.businessPartyVersionId !== enterprise.id) {
    // Match the aggregate writer's lock order for new controlled references.
    const [lockedEnterprise] = await tx.$queryRaw<Array<{ id: string; status: string }>>(Prisma.sql`
      SELECT "id", "status" FROM "BusinessParty" WHERE "id" IN (${assignment.businessPartyId}) ORDER BY "id" FOR UPDATE
    `);
    if (lockedEnterprise?.id !== assignment.businessPartyId || lockedEnterprise.status !== "active") {
      throw new BadRequestException("合作单位已停用，请选择启用中的单位；已有合同引用仍保留");
    }
  }
  const selectedCompanyId = input.draft.companyEntityId;
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "CompanyEntity" WHERE "id" = ${selectedCompanyId} FOR UPDATE`);
  const company = await tx.companyEntity.findUnique({ where: { id: selectedCompanyId } });
  if (!company?.isActive || company.dataStatus !== "complete") throw new ConflictException("所选我方公司不是当前有效的签约主体");
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ProjectParticipatingCompany" WHERE "projectId" = ${contract.projectId} AND "companyEntityId" = ${selectedCompanyId} ORDER BY "id" FOR SHARE`);
  const [companyVersion, participation] = await Promise.all([
    tx.companyEntityVersion.findUnique({ where: { companyEntityId_versionNo: { companyEntityId: company.id, versionNo: company.currentVersionNo } } }),
    tx.projectParticipatingCompany.findMany({ where: { projectId: contract.projectId, companyEntityId: company.id,
      effectiveFrom: { lte: businessDay }, OR: [{ endedAt: null }, { endedAt: { gt: businessDay } }] } })
  ]);
  const joined = participation.length === 1 ? await tx.companyEntityVersion.findUnique({ where: { id: participation[0].companyEntityVersionId } }) : null;
  const creditCode = companyVersion?.unifiedSocialCreditCode?.trim().toUpperCase();
  if (!companyVersion?.isActive || !creditCode || !joined || joined.companyEntityId !== company.id
    || creditCode === assignment.affiliateCreditCodeSnapshot?.trim().toUpperCase()) {
    throw new ConflictException("我方公司当前版本、项目参与资格或签约身份不符");
  }
  const filesToBind = input.attachments.map(file => file.fileId);
  await files.assertCanBindContractDraftAttachments(tx, version.id, filesToBind, actor);
  const fileRows = await tx.fileObject.findMany({ where: { id: { in: filesToBind } } });
  if (fileRows.length !== filesToBind.length || fileRows.some(file => !["application/pdf", "image/jpeg", "image/png"].includes(file.mimeType)
    || file.sizeBytes <= 0 || !file.contentSha256 || !/^[a-f0-9]{64}$/u.test(file.contentSha256)
    || file.storageStatus !== "active" || file.uploadedByUserId !== actor || file.purgeReceiptId || file.supersedesFileObjectId)) {
    throw new BadRequestException("签章原件格式、归属或保留状态不正确");
  }
  const filesById = new Map(fileRows.map(file => [file.id, file]));
  const signedFiles = filesToBind.map((fileId, displayOrder) => {
    const file = filesById.get(fileId);
    if (!file) throw new BadRequestException("签章原件格式、归属或保留状态不正确");
    return { fileId, displayOrder, mimeType: file.mimeType, sizeBytes: file.sizeBytes, contentSha256: file.contentSha256 };
  });
  for (const fileId of filesToBind) {
    if (await tx.fileObject.findFirst({ where: { supersedesFileObjectId: fileId } })) throw new ConflictException("原件已被替换");
  }

  const stored = await tx.$queryRaw<Array<{ id: string; originalSignedNumber: string | null }>>(Prisma.sql`
    SELECT "id", "originalSignedNumber" FROM public."ContractVersion" WHERE "id" = ${version.id} AND "contractId" = ${contract.id}
  `);
  if (stored.length !== 1 || stored[0].id !== version.id || (stored[0].originalSignedNumber !== null && typeof stored[0].originalSignedNumber !== "string")) {
    throw new ServiceUnavailableException("原合同编号暂时无法核对");
  }
  const number = input.draft.originalSignedNumber === undefined ? stored[0].originalSignedNumber : input.draft.originalSignedNumber || null;
  let amount: string | null;
  let taxRate: string | null;
  try {
    amount = input.draft.amountSource === "bill_sum" ? null
      : input.draft.manualAmountYuan === undefined ? version.amountYuan?.toFixed(4) ?? null : normalizeBusinessAmount(input.draft.manualAmountYuan);
    taxRate = input.draft.taxFacts.defaultTaxRatePercent === null ? null : normalizeTaxRatePercent(input.draft.taxFacts.defaultTaxRatePercent);
  } catch {
    throw new BadRequestException("合同金额或税率格式不正确");
  }
  const fixedTerms = await tx.paymentTermsVersion.findMany({ where: { contractVersionId: version.id } });
  if (fixedTerms.length > 1 || (fixedTerms[0]?.id ?? null) !== current.fixedPaymentTermsVersionId
    || input.paymentTerms?.stages.length) throw new ConflictException("付款约定来源不唯一或不匹配");
  await assertUpwardPendingSaveContinuity(tx, qualification);
  const terms = fixedTerms[0]
    ? await tx.paymentTermsVersion.update({ where: { id: fixedTerms[0].id }, data: { originalText: input.paymentTerms?.originalText ?? "" } })
    : input.paymentTerms ? await tx.paymentTermsVersion.create({ data: { contractId: contract.id, contractVersionId: version.id,
      versionNo: 1, status: "draft", originalText: input.paymentTerms.originalText } }) : null;

  await parties.replaceContractPartiesInTransaction(tx, version.id, input.parties);
  await tx.contractDraftAttachment.deleteMany({ where: { contractVersionId: version.id, slotKey: "direct_signed_originals_v1" } });
  await tx.contractDraftAttachment.createMany({ data: input.attachments.map(file => ({
    ...file, contractVersionId: version.id, createdByUserId: actor
  })) });
  await tx.contract.update({ where: { id: contract.id }, data: { name, companyEntityId: company.id, companyEntityName: companyVersion.name } });
  const draft = { contractName: name, contractBasics: basics, fieldValues: {}, partyValues: {},
    directSigningInput: { ...desired, signedOn, companyParty, enterpriseParty, companyParticipationId: participation[0].id,
      fixedPaymentTermsVersionId: terms?.id ?? null } };
  const rate = taxRate === null ? null : new Prisma.Decimal(taxRate);
  const result = await tx.$queryRaw<Array<{ id: string; draftRevision: number }>>(Prisma.sql`
    /* contract_upward_pending_save_update_v1 */
    UPDATE public."ContractVersion" SET "draftData"=${JSON.stringify(draft)}::jsonb,
      "draftRevision"="draftRevision"+1, "originalSignedNumber"=${number},
      "signingSubjectType"='upward', "companyEntityIdSnapshot"=${company.id}, "companyEntityVersionId"=${companyVersion.id},
      "companyEntityNameSnapshot"=${companyVersion.name}, "companyEntityCreditCodeSnapshot"=${companyVersion.unifiedSocialCreditCode},
      "companyEntityRegisteredAddressSnapshot"=${companyVersion.registeredAddress}, "affiliateAssignmentId"=${assignment.id},
      "affiliateBusinessPartyVersionId"=${enterprise.id}, "affiliateNameSnapshot"=${assignment.affiliateNameSnapshot},
      "affiliateCreditCodeSnapshot"=${assignment.affiliateCreditCodeSnapshot}, "amountYuan"=${amount}::numeric, "amountCents"=0,
      "pricingNature"=${input.draft.pricingNature}, "amountSource"=${input.draft.amountSource}, "invoiceType"=${input.draft.taxFacts.invoiceType},
      "taxMode"=${input.draft.taxFacts.taxMode}, "defaultTaxRatePercent"=${rate}, "updatedAt"=${now}
    WHERE "id"=${version.id} AND "contractId"=${contract.id} AND "status"='draft' AND "draftRevision"=${version.draftRevision}
    RETURNING "id", "draftRevision"
  `);
  const revision = version.draftRevision + 1;
  if (result.length !== 1 || result[0].id !== version.id || result[0].draftRevision !== revision) throw new ConflictException("对上草稿已变化，请刷新");
  const fresh = await tx.contractVersion.findUnique({ where: { id: version.id } });
  if (!fresh) throw new ServiceUnavailableException("已保存的对上来源暂时无法核对");
  const proof = await readUpwardDirectPending(tx, { ...fresh, projectId: contract.projectId }, actor, true, qualification);
  const q = record(proof.source.Q);
  const subjects = record(q?.subjects);
  // A qualified reader's digest is a durable receipt only when its input still
  // matches the paper facts and original metadata locked by this save.
  if (proof.source.state !== "complete" || proof.source.sourceRevision !== revision || proof.originalSignedNumber !== number
    || !isDeepStrictEqual(q?.contract, { businessType: contract.contractTypeKey, name, originalSignedNumber: number, signedOn })
    || !isDeepStrictEqual(q?.money, { numericProtocolVersion: 2, amountYuan: amount, amountLimitType: version.amountLimitType,
      pricingNature: input.draft.pricingNature, amountSource: input.draft.amountSource })
    || !isDeepStrictEqual(q?.tax, { amountBasis: basics.amountBasis, invoiceType: input.draft.taxFacts.invoiceType,
      taxMode: input.draft.taxFacts.taxMode, defaultTaxRatePercent: rate?.toFixed(6) ?? null })
    || !isDeepStrictEqual(q?.terms, { settlementText: basics.settlementText, paymentTerms: terms
      ? { id: terms.id, versionNo: terms.versionNo, originalText: input.paymentTerms?.originalText ?? "" } : null })
    || record(subjects?.enterprise)?.businessPartyId !== assignment.businessPartyId
    || record(subjects?.company)?.joinedCompanyEntityVersionId !== joined.id
    || !isDeepStrictEqual(q?.signedFiles, signedFiles)) {
    throw new ServiceUnavailableException("已保存的对上来源暂时无法核对");
  }
  if (input.saveKind === "manual") {
    await audit.record(tx, { actorUserId: actor, action: "contract.draft.save", businessType: "contract_version", businessId: version.id,
      metadata: { revisionBefore: version.draftRevision, revisionAfter: revision, sourceKind: "upward_direct_signed_pending" } });
  }
  const response = { contractVersionId: version.id, draftRevision: revision, serverRevision: revision, documentContentRevision: null,
    documentContentFingerprint: null, savedAt: now.toISOString(), ...(transportFingerprint ? { requestFingerprint: transportFingerprint } : {}),
    originalSignedNumber: number, directSigningInput: proof.source, effectiveChangedSections: ["draft", "parties", "attachments"],
    availableActions: [], documentChanges: [], documentsOutdated: false,
    capability: { refreshRequired: false, draftOperationAvailableActions: [...UPWARD_PENDING_SAVE_ACTIONS] },
    invalidation: { status: "unchanged" },
    versionAmount: { numericProtocolVersion: 2, amountYuan: amount, amountCents: null } };
  await tx.contractDraftSaveRequest.create({ data: { idempotencyKey: input.idempotencyKey, contractVersionId: version.id,
    expectedRevision: input.expectedRevision, resultRevision: revision, saveKind: input.saveKind, requestSha256,
    responseSnapshot: response as Prisma.InputJsonObject, createdByUserId: actor, expiresAt: new Date(now.getTime() + 7 * 86400000) } });
  await assertUpwardPendingSaveContinuity(tx, qualification);
  return response;
}
