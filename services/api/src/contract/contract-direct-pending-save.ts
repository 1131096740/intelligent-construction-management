import { sumContractBillBusinessAmounts } from "../contract-bill/contract-bill-totals";
import { BadRequestException, ConflictException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma, type Contract, type ContractVersion } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import { normalizeBusinessAmount, normalizeTaxRatePercent } from "@jiangkong/shared-domain";
import type { SaveContractDraftAggregateDto } from "../contract-workbench/dto/contract-workbench.dto";
import { BusinessPartyService } from "../business-party/business-party.service";
import { FileService } from "../file/file.service";
import { AuditService } from "../audit/audit.service";
import { assertDirectPendingSourceQualification, assertDirectPendingSourceContinuity } from "./contract-direct-pending-source";

function record(value: unknown): Record<string, unknown> | null { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
const roles = new Set(["party_a", "party_b", "party_c", "guarantor", "consortium_member", "other"]);
function locator(value: unknown) {
  if (value === null) return null;
  const item = record(value);
  if (!item || Object.keys(item).sort().join(",") !== "displayOrder,roleKey" || typeof item.roleKey !== "string" || !roles.has(item.roleKey)
    || typeof item.displayOrder !== "number" || !Number.isSafeInteger(item.displayOrder) || item.displayOrder < 0) throw new BadRequestException("签约双方位置格式不正确");
  return { roleKey: item.roleKey, displayOrder: item.displayOrder };
}
function signedDay(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u.test(value)) throw new BadRequestException("签订日期应为有效年月日或空值");
  const [year, month, day] = value.split("-").map(Number);
  const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month-1]) throw new BadRequestException("签订日期不是有效年月日");
  return value;
}
export async function readDirectPendingInput(tx: Prisma.TransactionClient, versionId: string) {
  const rows = await tx.$queryRaw<unknown[]>(Prisma.sql`SELECT public.jg_contract_direct_pending_input_v1(${versionId}::text) AS "input"`);
  const value = rows.length === 1 ? record(record(rows[0])?.input) : null;
  if (!value || value.protocolVersion !== 1 || value.sourceKind !== "direct_signed_pending" || !["complete", "incomplete", "invalid"].includes(String(value.state))
    || !Number.isSafeInteger(value.sourceRevision) || (value.state === "complete" ? !record(value.Q) || typeof value.inputSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(value.inputSha256) : value.Q !== null || value.inputSha256 !== null)) throw new ServiceUnavailableException("已签合同来源暂时无法核对，请保留资料稍后重试");
  if (value.state === "complete") {
    const q = record(value.Q), locator = record(q?.locator), source = record(q?.source);
    if (!q || !locator || !source || q.inputProtocolVersion !== 1 || source.kind !== "direct_signed" || source.relationship !== "outside" || locator.contractVersionId !== versionId || locator.draftRevision !== value.sourceRevision || locator.changeType !== "original" || !Number.isSafeInteger(locator.versionNo) || typeof locator.contractId !== "string" || typeof locator.projectId !== "string" || !Array.isArray(q.signedFiles) || !q.signedFiles.length) throw new ServiceUnavailableException("已签合同来源坐标尚未核对，请保留资料稍后重试");
  }
  return value;
}

/** Direct originals use aggregate R; generated-document R/F are inapplicable. */
export async function saveDirectPendingAggregate(tx: Prisma.TransactionClient, contract: Contract, version: ContractVersion,
  actorUserId: string, input: SaveContractDraftAggregateDto, requestSha256: string, audit: AuditService, parties: BusinessPartyService, files: FileService, transportFingerprint?: string) {
  const qualification = await assertDirectPendingSourceQualification(tx);
  if (version.numericProtocolVersion !== 2 || version.changeType !== "original" || input.draft.numericProtocolVersion !== 2) throw new ConflictException("已签合同来源格式不匹配，请保留资料刷新后重试");
  const current = record(version.draftData), old = record(current?.directSigningInput), desired = record(input.draft.draftData.directSigningInput);
  if (!current || !old || !desired || Object.keys(old).sort().join(",") !== "counterpartyParty,enterpriseParty,fixedPaymentTermsVersionId,protocolVersion,relationship,signedOn,source" || Object.keys(desired).sort().join(",") !== "counterpartyParty,enterpriseParty,fixedPaymentTermsVersionId,protocolVersion,relationship,signedOn,source"
    || old.source !== "direct_signed" || old.relationship !== "outside" || old.protocolVersion !== 1
    || desired.source !== old.source || desired.relationship !== old.relationship || desired.protocolVersion !== old.protocolVersion || desired.fixedPaymentTermsVersionId !== old.fixedPaymentTermsVersionId) throw new BadRequestException("已签合同办理来源由系统维护，不能通过保存切换");
  const basics = record(input.draft.draftData.contractBasics);
  if (!basics || basics.relationship !== "outside" || !["material_purchase", "equipment_rental", "labor_subcontract", "professional_subcontract", "other"].includes(String(basics.businessType))) throw new BadRequestException("已签合同关系或业务类型不正确");
  if (input.bills.length || input.draft.clauses.length
    || input.draft.layoutTemplateVersionId || input.negotiationDocuments.referencedGeneratedDocumentIds.length) throw new BadRequestException("此已签资料分区尚未完整核对，请保留原件稍后办理");
  if (input.draft.companyEntityId !== undefined || input.draft.manualAmountCents !== undefined || input.draft.estimatedAmountCents !== undefined) throw new BadRequestException("表外已签登记请使用实际签约单位和四位金额资料");
  const project = await tx.project.findUnique({ where: { id: contract.projectId } });
  if (!project?.isActive) throw new ConflictException("项目已停用，不能继续保存已签合同登记");
  const allowedDraftKeys = new Set(["contractName", "contractBasics", "directSigningInput", "fieldValues", "partyValues"]);
  if (Object.keys(input.draft.draftData).some(key => !allowedDraftKeys.has(key))) throw new BadRequestException("已签合同登记包含不支持的正文或模板字段");
  if (typeof input.draft.draftData.contractName !== "string" || Object.keys(basics).some(key => !["relationship", "businessType", "amountBasis", "invoiceStatus", "settlementText"].includes(key))
    || !["tax_inclusive", "tax_exclusive"].includes(String(basics.amountBasis)) || !["pending", "none", "vat_general", "vat_special"].includes(String(basics.invoiceStatus)) || typeof basics.settlementText !== "string") throw new BadRequestException("合同名称、金额税务口径或结算原文不正确");
  if (input.parties.some(party => !roles.has(party.roleKey))) throw new BadRequestException("签约主体位置不正确");
  const enterpriseParty = locator(desired.enterpriseParty), counterpartyParty = locator(desired.counterpartyParty);
  if (enterpriseParty && counterpartyParty && isDeepStrictEqual(enterpriseParty, counterpartyParty)) throw new BadRequestException("签约双方不能使用同一位置");
  const persistedBills = input.draft.amountSource === "bill_sum" ? await tx.contractBill.findMany({ where: { contractVersionId: version.id } }) : [];
  let amount: string | null;
  let taxRate: string | null;
  try {
    amount = input.draft.amountSource === "bill_sum" ? sumContractBillBusinessAmounts(persistedBills) : input.draft.manualAmountYuan === undefined ? version.amountYuan?.toFixed(4) ?? null : normalizeBusinessAmount(input.draft.manualAmountYuan);
    taxRate = input.draft.taxFacts.defaultTaxRatePercent === null ? null : new Prisma.Decimal(normalizeTaxRatePercent(input.draft.taxFacts.defaultTaxRatePercent)).toFixed(6);
  } catch { throw new BadRequestException("合同金额或税率格式不正确，请保留原文后核对"); }
  await assertDirectPendingSourceContinuity(tx, qualification);
  const partyResult = await parties.replaceContractPartiesInTransaction(tx, version.id, input.parties);
  const savedParties = await tx.contractPartySnapshot.findMany({ where: { contractVersionId: version.id } });
  const enterprise = enterpriseParty ? savedParties.find(row => row.roleKey === enterpriseParty.roleKey && row.displayOrder === enterpriseParty.displayOrder) : null;
  const enterpriseVersion = enterprise?.businessPartyVersionId ? await tx.businessPartyVersion.findUnique({ where: { id: enterprise.businessPartyVersionId } }) : null;
  const counterparty = counterpartyParty ? savedParties.find(row => row.roleKey === counterpartyParty.roleKey && row.displayOrder === counterpartyParty.displayOrder) : null;
  const counterpartyVersion = counterparty?.businessPartyVersionId ? await tx.businessPartyVersion.findUnique({ where: { id: counterparty.businessPartyVersionId } }) : null;
  if (enterpriseVersion && counterpartyVersion && enterpriseVersion.businessPartyId === counterpartyVersion.businessPartyId) {
    throw new BadRequestException("签约双方不能是同一单位，请重新选择");
  }
  const assignments = enterpriseVersion ? await tx.projectAffiliateAssignment.findMany({ where: { projectId: contract.projectId, endedAt: null, businessPartyVersionId: enterpriseVersion.id } }) : [];
  const assignment = assignments.length === 1 && assignments[0].businessPartyId === enterpriseVersion?.businessPartyId && assignments[0].effectiveFrom <= new Date() ? assignments[0] : null;
  const signing = { signingSubjectType: assignment ? "affiliate" : "draft_unconfirmed", affiliateAssignmentId: assignment?.id ?? null, affiliateBusinessPartyVersionId: assignment?.businessPartyVersionId ?? null,
    affiliateNameSnapshot: assignment?.affiliateNameSnapshot ?? null, affiliateCreditCodeSnapshot: assignment?.affiliateCreditCodeSnapshot ?? null };
  if (input.attachments.length > 20 || input.attachments.some((file,index) => file.slotKey !== "direct_signed_originals_v1" || file.displayOrder !== index) || new Set(input.attachments.map(file => file.fileId)).size !== input.attachments.length) throw new BadRequestException("签章原件应按连续顺序保存至专用位置，最多二十份且不能重复");
  await files.assertCanBindContractDraftAttachments(tx, version.id, input.attachments.map(file => file.fileId), actorUserId);
  const otherSlots = input.attachments.length ? await tx.contractDraftAttachment.findMany({ where: { contractVersionId: version.id, fileId: { in: input.attachments.map(file => file.fileId) }, slotKey: { not: "direct_signed_originals_v1" } } }) : [];
  if (otherSlots.length) throw new ConflictException("该原件已用于本合同其他资料位置，请选择独立原件");
  const fileRows = input.attachments.length ? await tx.fileObject.findMany({ where: { id: { in: input.attachments.map(file => file.fileId) } } }) : [];
  for (const file of fileRows) if (!["application/pdf", "image/jpeg", "image/png"].includes(file.mimeType) || file.sizeBytes <= 0 || !file.contentSha256 || !/^[a-f0-9]{64}$/u.test(file.contentSha256) || file.storageStatus !== "active" || file.purgeReceiptId || file.supersedesFileObjectId || await tx.fileObject.findFirst({ where: { supersedesFileObjectId: file.id } })) throw new BadRequestException("签章原件的格式或保留状态不允许绑定");
  const previousAttachments = await tx.contractDraftAttachment.findMany({ where: { contractVersionId: version.id, slotKey: "direct_signed_originals_v1" }, orderBy: { displayOrder: "asc" } });
  const attachmentChanged = !isDeepStrictEqual(previousAttachments.map(row => ({ slotKey: row.slotKey, fileId: row.fileId, displayOrder: row.displayOrder })), input.attachments.map(row => ({ slotKey: row.slotKey, fileId: row.fileId, displayOrder: row.displayOrder })));
  if (attachmentChanged) {
    await tx.contractDraftAttachment.deleteMany({ where: { contractVersionId: version.id, slotKey: "direct_signed_originals_v1" } });
    if (input.attachments.length) await tx.contractDraftAttachment.createMany({ data: input.attachments.map(row => ({ ...row, contractVersionId: version.id, createdByUserId: actorUserId })) });
  }
  if (input.paymentTerms && (typeof input.paymentTerms.originalText !== "string" || input.paymentTerms.stages.length)) throw new BadRequestException("已签合同只保存实际付款原文");
  const termCandidates = await tx.paymentTermsVersion.findMany({ where: { contractVersionId: version.id }, orderBy: { versionNo: "asc" } });
  if ((old.fixedPaymentTermsVersionId === null && termCandidates.length > 1) || (old.fixedPaymentTermsVersionId !== null && (typeof old.fixedPaymentTermsVersionId !== "string" || !termCandidates.some(row => row.id === old.fixedPaymentTermsVersionId && row.contractId === contract.id)))) throw new ConflictException("付款约定来源不唯一或已变化，请核对后保存");
  let terms = old.fixedPaymentTermsVersionId === null ? termCandidates.length === 1 ? termCandidates[0] : null : termCandidates.find(row => row.id === old.fixedPaymentTermsVersionId) ?? null;
  let paymentChanged = false;
  if (terms) {
    const stages = await tx.paymentTermsStage.findMany({ where: { paymentTermsVersionId: terms.id } });
    const text = input.paymentTerms === null ? "" : input.paymentTerms.originalText;
    if (terms.originalText !== text || stages.length) {
      terms = await tx.paymentTermsVersion.update({ where: { id: terms.id }, data: { originalText: text } });
      await tx.paymentTermsStage.deleteMany({ where: { paymentTermsVersionId: terms.id } }); paymentChanged = true;
    }
  } else if (input.paymentTerms !== null) {
    terms = await tx.paymentTermsVersion.create({ data: { contractId: contract.id, contractVersionId: version.id, versionNo: 1, status: "draft", originalText: input.paymentTerms.originalText } }); paymentChanged = true;
  }
  const marker = { protocolVersion: 1, source: "direct_signed", relationship: "outside", signedOn: signedDay(desired.signedOn), enterpriseParty, counterpartyParty, fixedPaymentTermsVersionId: terms?.id ?? null };
  const rows = await tx.$queryRaw<unknown[]>(Prisma.sql`SELECT "id", "originalSignedNumber" FROM public."ContractVersion" WHERE "id" = ${version.id} AND "contractId" = ${contract.id}`);
  const stored = rows.length === 1 ? record(rows[0]) : null;
  if (!stored || Object.keys(stored).length !== 2 || stored.id !== version.id || !("originalSignedNumber" in stored) || (stored.originalSignedNumber !== null && typeof stored.originalSignedNumber !== "string")) throw new ServiceUnavailableException("原合同编号暂时无法核对");
  const originalSignedNumber = input.draft.originalSignedNumber === undefined ? stored.originalSignedNumber : input.draft.originalSignedNumber === "" ? null : input.draft.originalSignedNumber;
  const draftData = { ...input.draft.draftData, directSigningInput: marker };
  const tax = { invoiceType: input.draft.taxFacts.invoiceType, taxMode: input.draft.taxFacts.taxMode, defaultTaxRatePercent: taxRate === null ? null : new Prisma.Decimal(taxRate) };
  const changed = basics.businessType !== contract.contractTypeKey || input.draft.taxFacts.invoiceType !== version.invoiceType || input.draft.taxFacts.taxMode !== version.taxMode || taxRate !== (version.defaultTaxRatePercent?.toFixed(6) ?? null) || paymentChanged || partyResult.changed || attachmentChanged || Object.entries(signing).some(([key,value]) => record(version)?.[key] !== value) || originalSignedNumber !== stored.originalSignedNumber || !isDeepStrictEqual(draftData, current) || input.draft.pricingNature !== version.pricingNature
    || input.draft.amountSource !== version.amountSource || amount !== (version.amountYuan?.toFixed(4) ?? null);
  await assertDirectPendingSourceContinuity(tx, qualification);
  if (changed) {
    await tx.contract.update({ where: { id: contract.id }, data: { contractTypeKey: String(basics.businessType), name: typeof input.draft.draftData.contractName === "string" ? input.draft.draftData.contractName : "" } });
    await tx.contractVersion.update({ where: { id: version.id }, data: { ...tax, ...signing, draftData: draftData as Prisma.InputJsonObject, draftRevision: { increment: 1 }, pricingNature: input.draft.pricingNature, amountSource: input.draft.amountSource, amountYuan: amount === null ? null : new Prisma.Decimal(amount) } });
    const written = await tx.$queryRaw<unknown[]>(Prisma.sql`UPDATE public."ContractVersion" SET "originalSignedNumber" = ${originalSignedNumber} WHERE "id" = ${version.id} AND "contractId" = ${contract.id} RETURNING "id", "originalSignedNumber"`);
    const row = written.length === 1 ? record(written[0]) : null;
    if (!row || Object.keys(row).length !== 2 || row.id !== version.id || row.originalSignedNumber !== originalSignedNumber) throw new ServiceUnavailableException("原合同编号写入结果尚未核对");
    if (input.saveKind === "manual") await audit.record(tx, { actorUserId, action: "contract.draft.save", businessType: "contract_version", businessId: version.id, metadata: { revisionBefore: version.draftRevision, revisionAfter: version.draftRevision+1, sourceKind: "direct_signed_pending" } });
  }
  const directSigningInput = await readDirectPendingInput(tx, version.id);
  const revision = version.draftRevision + (changed ? 1 : 0);
  if (directSigningInput.sourceRevision !== revision) throw new ServiceUnavailableException("已签合同来源修订尚未核对");
  const response = { contractVersionId: version.id, draftRevision: revision, serverRevision: revision, documentContentRevision: null, documentContentFingerprint: null,
    savedAt: new Date().toISOString(), ...(transportFingerprint ? { requestFingerprint: transportFingerprint } : {}), originalSignedNumber, directSigningInput, effectiveChangedSections: changed ? ["draft"] : [], availableActions: [], documentsOutdated: false };
  await tx.contractDraftSaveRequest.create({ data: { idempotencyKey: input.idempotencyKey, contractVersionId: version.id, expectedRevision: input.expectedRevision, resultRevision: revision,
    saveKind: input.saveKind, requestSha256, responseSnapshot: response as Prisma.InputJsonObject, createdByUserId: actorUserId, expiresAt: new Date(Date.now()+7*86400000) } });
  await assertDirectPendingSourceContinuity(tx, qualification);
  return response;
}
