import { resolveContractDraftBusinessType } from "./contract-draft-basics";
import { assertSelectableLayoutVersion } from "../contract-template/layout-selection-policy";
import { assertContractDraftNumericProtocol, CONTRACT_PRECISE_SUBMISSION_REASON } from "./contract-draft-numeric-protocol";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { Prisma, type ContractBillRow } from "@prisma/client";
import { readDeletedDraftRow, deletedRowPublicOriginalValues } from "../contract-bill/contract-bill-row-undo";
import type { BusinessEntrySceneDefinition } from "@jiangkong/shared-domain";
import { businessAmountFromLegacyCents, contractPricingPolicy, normalizeBusinessAmount, sumBusinessAmounts } from "@jiangkong/shared-domain";
import { createHash } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import { BusinessPartyService } from "../business-party/business-party.service";
import { ContractBillService } from "../contract-bill/contract-bill.service";
import { sumContractBillBusinessAmounts, compatibleBillCents } from "../contract-bill/contract-bill-totals";
import { lockContractDraftMutationBoundary } from "../contract/contract-draft-lifecycle";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";
import { calculateContractDocumentContentFingerprint } from "./contract-document-content";
import { ContractWorkbenchService } from "./contract-workbench.service";
import { CONTRACT_BASIC_ENTRY_DEFINITION, CONTRACT_SETTLEMENT_MODE_ENTRY_DEFINITION, contractBasicEntryValues, resolveContractTemplateEntry, resolveContractBillEntries } from "./contract-business-entry-definition";
import { projectContractDraftOperationCapabilities } from "./contract-mutation-authority";
import { mappedLayoutSourceForVersion } from "../contract-template/layout-field-mapping";
import { REVIEWED_ORIGINAL_MECHANICAL_SOURCE_SHA256, REVIEWED_ORIGINAL_MECHANICAL_PAGE_NUMBER_VERSION, assertReviewedOriginalMechanicalPageSource, CONTRACT_BODY_RENDER_PROFILE_KEY, REVIEWED_MATERIAL_SIGNATURE_DATE_VERSION, REVIEWED_MATERIAL_SOURCE_SHA256, REVIEWED_MATERIAL_TYPOGRAPHY_V4_VERSION, REVIEWED_MECHANICAL_SOURCE_SHA256, REVIEWED_MECHANICAL_TYPOGRAPHY_VERSION, assertReviewedTypographySource, REVIEWED_LABOR_SOURCE_SHA256, REVIEWED_LABOR_TAX_BINDING_VERSION, REVIEWED_LABOR_TYPOGRAPHY_VERSION, REVIEWED_GENERIC_SOURCE_SHA256, REVIEWED_GENERIC_TYPOGRAPHY_VERSION, readContractBodyRenderProfile, upgradeReviewedLaborTaxPlan, normalizeContractBodyPlan } from "../contract-document/contract-body-document";
import type {
  SaveContractDraftAggregateDto,
  SaveContractDraftAttachmentDto
} from "./dto/contract-workbench.dto";

function publicSaveSnapshot(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const snapshot = { ...value as Record<string, unknown> };
  delete snapshot["_rowUndo"];
  return snapshot;
}

const EDITABLE_CONTRACT_DRAFT_STATUSES = new Set(["draft"]);

interface ContractDraftPrivateFileUploadInput {
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  buffer: Buffer;
  idempotencyKey?: string;
}

@Injectable()
export class ContractDraftAggregateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workbench: ContractWorkbenchService,
    private readonly bills: ContractBillService,
    private readonly parties: BusinessPartyService,
    private readonly files: FileService,
    private readonly audit: AuditService
  ) {}

  async getSaveResult(contractVersionId: string, actorUserId: string, idempotencyKey: string, numericProtocol?: string) {
    return this.prisma.$transaction(async tx => {
      const version = await tx.contractVersion.findUnique({ where: { id: contractVersionId } });
      if (!version) throw new NotFoundException("未找到合同草稿，不能核对保存结果");
      const contract = await tx.contract.findUnique({ where: { id: version.contractId } });
      if (!contract || contract.ownerUserId !== actorUserId) throw new ForbiddenException("只有当前合同经办人可以核对该草稿的保存结果");
      assertContractDraftNumericProtocol(version, numericProtocol);
      const receipt = await tx.contractDraftSaveRequest.findUnique({ where: { idempotencyKey } });
      if (!receipt || receipt.contractVersionId !== contractVersionId || receipt.createdByUserId !== actorUserId) {
        // Absence cannot prove that a disconnected write is not still in flight.
        return { status: "unknown" as const };
      }
      return { status: "saved" as const, result: publicSaveSnapshot(receipt.responseSnapshot), latestRevision: version.draftRevision };
    });
  }

  async getWorkbench(contractVersionId: string, actorUserId: string, numericProtocol?: string) {
    const { version, templateEntry, billEntries, layoutTemplateSelection } = await this.prisma.$transaction(async (tx) => {
      const version = await tx.contractVersion.findUnique({ where: { id: contractVersionId } });
      if (!version) throw new NotFoundException("未找到合同草稿版本，请刷新合同工作台后重试");
      const layout = version.layoutTemplateVersionId ? await tx.contractLayoutTemplateVersion.findUnique({ where: { id: version.layoutTemplateVersionId } }) : null;
      const layoutTemplate = layout ? await tx.contractLayoutTemplate.findUnique({ where: { id: layout.layoutTemplateId } }) : null;
      const layoutTemplateSelection = layout && layoutTemplate ? { id: layout.id, name: layoutTemplate.name, versionNo: layout.versionNo, status: layout.status } : null;
      return { version, templateEntry: await resolveContractTemplateEntry(tx, version), billEntries: await resolveContractBillEntries(tx, version), layoutTemplateSelection };
    });
    if (!version) {
      throw new NotFoundException("未找到合同草稿版本，请刷新合同工作台后重试");
    }
    const legacyReadModel = await (numericProtocol === undefined ? this.workbench.getDraftFromExactVersion(version, actorUserId)
      : this.workbench.getDraftFromExactVersion(version, actorUserId, numericProtocol));
    if (numericProtocol !== undefined && numericProtocol !== "2") {
      throw new BadRequestException("金额读取格式不受支持，请刷新页面后重试");
    }
    if (version.numericProtocolVersion === 2 && numericProtocol !== "2") {
      throw new ConflictException("合同金额精度已升级，请刷新页面后重新读取");
    }
    const settlementModeHistory = version.settlementModeConfirmedAt
      ? await this.prisma.businessEntrySubmissionSnapshot.findMany({
          where: { projectId: legacyReadModel.contract.projectId, sceneKey: "contract_settlement_mode", entityType: "contract_version", entityId: version.id },
          orderBy: { revision: "asc" }
        })
      : [];
    const [attachments, lease] = await Promise.all([
      this.prisma.contractDraftAttachment.findMany({
        where: { contractVersionId },
        orderBy: [{ slotKey: "asc" }, { displayOrder: "asc" }]
      }),
      this.prisma.contractDraftEditLease.findUnique({
        where: { contractVersionId }
      })
    ]);
    const now = new Date();
    const leaseExpired = lease ? lease.expiresAt.getTime() <= now.getTime() : false;
    const holder = lease && !leaseExpired
      ? await this.prisma.user.findUnique({
          where: { id: lease.holderUserId },
          select: { name: true }
        })
      : null;
    const leaseState = !lease
      ? "available"
      : leaseExpired
        ? "expired"
      : lease.holderUserId === actorUserId
        ? "held_by_me"
        : "held_by_other";
    const isDirector = await this.isContractDirector(actorUserId);
    const canTakeOver = leaseState === "held_by_other" && isDirector;
    const isOwner = legacyReadModel.contract.ownerUserId === actorUserId;
    const draftOperationAvailableActions = this.projectDraftOperationCapabilities(
      version,
      isOwner,
      isDirector,
      canTakeOver
    );
    const legacyWithoutCheckpoints = { ...legacyReadModel };
    Reflect.deleteProperty(legacyWithoutCheckpoints, "checkpoints");
    return {
      ...legacyWithoutCheckpoints,
      version: {
        ...legacyReadModel.version,
        layoutTemplateSelection,
        ...(version.numericProtocolVersion === 2 && legacyReadModel.version.amountYuan == null ? { amountCents: null } : {}),
        draftLifecycleKind: legacyReadModel.lifecycleKind
      },
      draft: version.draftData,
      templateEntry,
      billEntries,
      settlementModeEntry: {
        definition: CONTRACT_SETTLEMENT_MODE_ENTRY_DEFINITION,
        values: { settlementMode: version.settlementMode },
        history: settlementModeHistory.map((record) => ({
          sceneKey: record.sceneKey,
          target: { projectId: record.projectId, entityType: record.entityType, entityId: record.entityId },
          revision: record.revision,
          definitionVersion: record.definitionVersion,
          definition: record.definitionSnapshot as unknown as BusinessEntrySceneDefinition,
          values: record.valuesSnapshot,
          frozenAt: record.frozenAt.toISOString()
        }))
      },
      bills: legacyReadModel.bills.map((bill) => ({
        ...bill,
        ...(bill.numericProtocolVersion === 2 ? {
          taxInclusiveAmountCents: bill.taxInclusiveAmountYuan == null ? null : bill.taxInclusiveAmountCents,
          taxExclusiveAmountCents: bill.taxExclusiveAmountYuan == null ? null : bill.taxExclusiveAmountCents,
          taxAmountCents: bill.taxAmountYuan == null ? null : bill.taxAmountCents,
          rows: bill.rows.map(row => ({ ...row, ...(row.numericProtocolVersion === 2 ? {
            taxInclusiveAmountCents: row.taxInclusiveAmountYuan == null ? null : row.taxInclusiveAmountCents,
            taxExclusiveAmountCents: row.taxExclusiveAmountYuan == null ? null : row.taxExclusiveAmountCents,
            taxAmountCents: row.taxAmountYuan == null ? null : row.taxAmountCents
          } : {}) }))
        } : {}),
        businessEntryDefinition: billEntries.find((entry) => entry.billId === bill.id)?.definition
      })),
      businessEntry: {
        definition: CONTRACT_BASIC_ENTRY_DEFINITION,
        values: contractBasicEntryValues(version.draftData)
      },
      attachments,
      draftOperationAvailableActions,
      ...(version.numericProtocolVersion === 2 ? { draftSubmissionUnavailableReason: CONTRACT_PRECISE_SUBMISSION_REASON } : {}),
      lease: {
        state: leaseState,
        holderDisplayName: holder?.name ?? null,
        expiresAt: lease?.expiresAt.toISOString() ?? null,
        canTakeOver
      }
    };
  }

  async uploadPrivateFile(
    contractVersionId: string,
    actorUserId: string,
    input: ContractDraftPrivateFileUploadInput
  ) {
    await this.prisma.$transaction(async (tx) => {
      const mutationBoundary = await lockContractDraftMutationBoundary(
        tx,
        contractVersionId
      );
      if (!mutationBoundary) {
        throw new NotFoundException("未找到合同草稿版本，请刷新后重试");
      }
      const [contract, version] = await Promise.all([
        tx.contract.findUnique({ where: { id: mutationBoundary.contractId } }),
        tx.contractVersion.findUnique({ where: { id: contractVersionId } })
      ]);
      if (!contract || !version) {
        throw new NotFoundException("未找到合同草稿版本，请刷新后重试");
      }
      if (contract.ownerUserId !== actorUserId) {
        throw new ForbiddenException("只有当前合同经办人可以上传合同草稿文件");
      }
      if (
        mutationBoundary.formalBlockers.length > 0 ||
        contract.voidedAt ||
        !EDITABLE_CONTRACT_DRAFT_STATUSES.has(version.status)
      ) {
        throw new ConflictException({
          statusCode: 409,
          code: "DRAFT_NOT_EDITABLE",
          message: "合同草稿当前不可编辑，请刷新后重试"
        });
      }
    });

    return this.files.uploadPrivateFile({
      ...input,
      uploadedByUserId: actorUserId
    });
  }

  private async isContractDirector(actorUserId: string) {
    const assignments = await this.prisma.userPosition.findMany({
      where: { userId: actorUserId, projectId: null }
    });
    if (!assignments.length) return false;
    const positions = await this.prisma.position.findMany({
      where: {
        id: { in: assignments.map((assignment) => assignment.positionId) }
      }
    });
    return positions.some((position) => position.key === "contract_director");
  }

  async saveAggregate(
    contractVersionId: string,
    actorUserId: string,
    rawLeaseToken: string,
    input: SaveContractDraftAggregateDto,
    transportFingerprint?: string
  ) {
    const requestSha256 = this.sha256(this.stableJson(input));
    try {
      return await this.prisma.$transaction(async (tx) => {
        const mutationBoundary = await lockContractDraftMutationBoundary(
          tx,
          contractVersionId
        );
        if (!mutationBoundary) {
          throw new NotFoundException("未找到合同草稿版本，请刷新后重试");
        }
        const [contract, version] = await Promise.all([
          tx.contract.findUnique({ where: { id: mutationBoundary.contractId } }),
          tx.contractVersion.findUnique({ where: { id: contractVersionId } })
        ]);
        if (!contract || !version) {
          throw new NotFoundException("未找到合同草稿版本，请刷新后重试");
        }
        const receipt = await tx.contractDraftSaveRequest.findUnique({
          where: { idempotencyKey: input.idempotencyKey }
        });
        if (receipt) {
          if (
            receipt.contractVersionId !== contractVersionId ||
            receipt.createdByUserId !== actorUserId ||
            receipt.requestSha256 !== requestSha256
          ) {
            throw new ConflictException({
              statusCode: 409,
              code: "IDEMPOTENCY_KEY_REUSED",
              message: "保存幂等键已用于另一份合同草稿请求，请重新保存"
            });
          }
          return this.completeIdempotentSaveReceipt(
            receipt.responseSnapshot,
            receipt.resultRevision,
            version,
            contract.ownerUserId === actorUserId,
            await this.isContractDirector(actorUserId)
          );
        }
        if (version.numericProtocolVersion === 2 && input.draft.amountSource === "manual" && input.draft.numericProtocolVersion !== 2) {
          throw new ConflictException("合同金额精度已升级，请刷新页面并保留四位合同金额后重试");
        }
        await tx.$queryRaw(Prisma.sql`
          SELECT "contractVersionId" FROM "ContractDraftEditLease"
          WHERE "contractVersionId" = ${contractVersionId}
          FOR UPDATE
        `);
        if (mutationBoundary.formalBlockers.length > 0) {
          throw new ConflictException({
            statusCode: 409,
            code: "DRAFT_NOT_EDITABLE",
            message: "合同已存在正式业务事实，不能继续编辑草稿"
          });
        }
        const lease = await tx.contractDraftEditLease.findUnique({
          where: { contractVersionId }
        });
        if (!EDITABLE_CONTRACT_DRAFT_STATUSES.has(version.status) || contract.voidedAt) {
          throw new ConflictException({
            statusCode: 409,
            code: "DRAFT_NOT_EDITABLE",
            message: "合同草稿当前不可编辑，请刷新后重试"
          });
        }
        if (contract.ownerUserId !== actorUserId) {
          throw new ForbiddenException("只有当前合同经办人可以保存合同草稿");
        }
        if (version.draftRevision !== input.expectedRevision) {
          throw new ConflictException({
            statusCode: 409,
            code: "DRAFT_REVISION_CONFLICT",
            message: "合同资料已变化，请刷新后重试",
            latestRevision: version.draftRevision,
            conflictReason: "draft_revision_changed",
            canReacquireLease: this.canReacquireLease(lease, new Date())
          });
        }
        const now = new Date();
        if (!rawLeaseToken || !lease) {
          throw new ConflictException({
            statusCode: 409,
            code: "EDIT_LEASE_REQUIRED",
            message: "请先取得合同草稿编辑权"
          });
        }
        if (
          lease.holderUserId !== actorUserId ||
          lease.tokenHash !== this.sha256(rawLeaseToken) ||
          lease.expiresAt.getTime() <= now.getTime()
        ) {
          const conflictReason = lease.expiresAt.getTime() <= now.getTime()
            ? "lease_expired"
            : lease.holderUserId !== actorUserId
              ? "lease_taken_over"
              : "lease_token_mismatch";
          throw new ConflictException({
            statusCode: 409,
            code: "EDIT_LEASE_LOST",
            message: "合同草稿编辑权已失效，请保留当前内容并重新取得编辑权",
            latestRevision: version.draftRevision,
            conflictReason,
            canReacquireLease: conflictReason === "lease_expired"
          });
        }

        const currentDraftBusinessType = version.status === "draft"
          ? resolveContractDraftBusinessType(input.draft.draftData, contract.contractTypeKey, version.signingSubjectType)
          : contract.contractTypeKey;
        const effectiveLayoutTemplateVersionId = input.draft.layoutTemplateVersionId === undefined
          ? version.layoutTemplateVersionId : input.draft.layoutTemplateVersionId;
        if (effectiveLayoutTemplateVersionId && effectiveLayoutTemplateVersionId !== version.layoutTemplateVersionId) {
          await assertSelectableLayoutVersion(tx, this.files, effectiveLayoutTemplateVersionId, currentDraftBusinessType);
        }
        const draftDataForSave = { ...input.draft.draftData };
        const currentDraftData = version.draftData && typeof version.draftData === "object" && !Array.isArray(version.draftData) ? version.draftData : {};
        const currentBodyRenderProfile = readContractBodyRenderProfile(currentDraftData); // Unknown persisted profiles never fall back.
        if (Object.hasOwn(draftDataForSave, CONTRACT_BODY_RENDER_PROFILE_KEY) &&
          this.stableJson(draftDataForSave[CONTRACT_BODY_RENDER_PROFILE_KEY]) !== this.stableJson(currentDraftData[CONTRACT_BODY_RENDER_PROFILE_KEY])) {
          throw new BadRequestException("合同文书呈现资料由系统维护，请刷新后重新保存");
        }
        delete draftDataForSave[CONTRACT_BODY_RENDER_PROFILE_KEY];
        let reviewedLaborTaxBindingVersion: typeof REVIEWED_LABOR_TAX_BINDING_VERSION | undefined;
        let typographyVersion: typeof REVIEWED_MATERIAL_TYPOGRAPHY_V4_VERSION | typeof REVIEWED_MECHANICAL_TYPOGRAPHY_VERSION | typeof REVIEWED_LABOR_TYPOGRAPHY_VERSION | typeof REVIEWED_GENERIC_TYPOGRAPHY_VERSION | undefined;
        if (effectiveLayoutTemplateVersionId && (input.draft.numericProtocolVersion === 2 || version.numericProtocolVersion === 2)) {
          const selected = await tx.contractLayoutTemplateVersion.findUnique({ where: { id: effectiveLayoutTemplateVersionId } });
          if (!selected) throw new BadRequestException("原已选合同模板不存在，请保留当前正文并重新选择模板");
          const selectedSource = await this.files.getFileBuffer(selected.docxFileId);
          const selectedSourceSha256 = createHash("sha256").update(selectedSource.buffer).digest("hex");
          if (selectedSourceSha256 === REVIEWED_LABOR_SOURCE_SHA256) {
            assertReviewedTypographySource(selectedSource.buffer, REVIEWED_LABOR_TYPOGRAPHY_VERSION);
            reviewedLaborTaxBindingVersion = REVIEWED_LABOR_TAX_BINDING_VERSION;
            typographyVersion = REVIEWED_LABOR_TYPOGRAPHY_VERSION;
            draftDataForSave[CONTRACT_BODY_RENDER_PROFILE_KEY] = { reviewedLaborTaxBindingVersion, typographyVersion };
          } else if (selectedSourceSha256 === REVIEWED_MATERIAL_SOURCE_SHA256) {
            assertReviewedTypographySource(selectedSource.buffer, REVIEWED_MATERIAL_TYPOGRAPHY_V4_VERSION);
            typographyVersion = REVIEWED_MATERIAL_TYPOGRAPHY_V4_VERSION;
            draftDataForSave[CONTRACT_BODY_RENDER_PROFILE_KEY] = { typographyVersion, signatureDateVersion: REVIEWED_MATERIAL_SIGNATURE_DATE_VERSION };
          } else if (selectedSourceSha256 === REVIEWED_MECHANICAL_SOURCE_SHA256) {
            assertReviewedTypographySource(selectedSource.buffer, REVIEWED_MECHANICAL_TYPOGRAPHY_VERSION);
            typographyVersion = REVIEWED_MECHANICAL_TYPOGRAPHY_VERSION;
            draftDataForSave[CONTRACT_BODY_RENDER_PROFILE_KEY] = { typographyVersion };
          } else if (selectedSourceSha256 === REVIEWED_ORIGINAL_MECHANICAL_SOURCE_SHA256) {
            assertReviewedOriginalMechanicalPageSource(selectedSource.buffer);
            draftDataForSave[CONTRACT_BODY_RENDER_PROFILE_KEY] = { pageNumberVersion: REVIEWED_ORIGINAL_MECHANICAL_PAGE_NUMBER_VERSION };
          } else if (selectedSourceSha256 === REVIEWED_GENERIC_SOURCE_SHA256) {
            assertReviewedTypographySource(selectedSource.buffer, REVIEWED_GENERIC_TYPOGRAPHY_VERSION);
            typographyVersion = REVIEWED_GENERIC_TYPOGRAPHY_VERSION;
            draftDataForSave[CONTRACT_BODY_RENDER_PROFILE_KEY] = { typographyVersion };
          }
        }
        const bodyAction = draftDataForSave.documentBodyAction;
        const bodyActionRecord = bodyAction && typeof bodyAction === "object" && !Array.isArray(bodyAction) ? bodyAction as Record<string, unknown> : null;
        delete draftDataForSave.documentBodyAction;
        const regenerateBody = bodyActionRecord?.kind === "regenerate";
        const deleteSavedAddition = bodyActionRecord?.kind === "delete_saved_addition";
        if ((bodyAction !== undefined && !regenerateBody && !deleteSavedAddition) ||
          (regenerateBody && (!bodyActionRecord || Object.keys(bodyActionRecord).some(key => !["kind", "confirmOverwrite"].includes(key)) || bodyActionRecord.confirmOverwrite !== true))) {
          throw new ConflictException("重新生成将覆盖手工正文，请先确认覆盖影响，原内容已保留");
        }
        if (deleteSavedAddition && (!bodyActionRecord || Object.keys(bodyActionRecord).some(key => !["kind", "additionId"].includes(key)) ||
          typeof bodyActionRecord.additionId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/u.test(bodyActionRecord.additionId) ||
          version.numericProtocolVersion !== 2 || input.draft.numericProtocolVersion !== 2)) {
          throw new ConflictException("删除新增条款的信息已变化，请保留当前输入并重新读取后重试");
        }
        let provedSoleAdditionDeletion = false;
        const bodyHasManualChanges = (value: unknown) => {
          if (!value || typeof value !== "object" || Array.isArray(value)) return false;
          const body = value as Record<string, unknown>;
          return [body.edits, body.additions, body.deletedPositionIds, body.paragraphOrder].some(items => Array.isArray(items) && items.length > 0);
        };
        const hadManualBody = bodyHasManualChanges(currentDraftData.documentBody);
        if (hadManualBody && effectiveLayoutTemplateVersionId !== version.layoutTemplateVersionId && !regenerateBody) throw new ConflictException("重新生成或更换模板将覆盖手工正文，请先确认覆盖影响，原内容已保留");
        if (!regenerateBody && draftDataForSave.documentBody === undefined && currentDraftData.documentBody !== undefined) {
          draftDataForSave.documentBody = currentDraftData.documentBody;
        }
        if (draftDataForSave.documentBody !== undefined) {
          if (!effectiveLayoutTemplateVersionId) throw new BadRequestException("请先选择合同模板，再保存正文");
          // Retaining the already selected immutable source is not a new selection.
          // A business-type-only save may keep its manual body until the operator
          // confirms a replacement; generation still enforces selection policy.
          const layout = effectiveLayoutTemplateVersionId === version.layoutTemplateVersionId
            ? await tx.contractLayoutTemplateVersion.findUnique({ where: { id: effectiveLayoutTemplateVersionId } })
            : await assertSelectableLayoutVersion(tx, this.files, effectiveLayoutTemplateVersionId, currentDraftBusinessType);
          if (!layout) throw new BadRequestException("原已选合同模板不存在，请保留当前正文并重新选择模板");
          const source = await this.files.getFileBuffer(layout.docxFileId);
          const mapped = mappedLayoutSourceForVersion(source.buffer, layout);
          const upgradeLaborTaxOrder = currentBodyRenderProfile?.reviewedLaborTaxBindingVersion === undefined && reviewedLaborTaxBindingVersion === REVIEWED_LABOR_TAX_BINDING_VERSION;
          const normalizeSavedBody = (value: unknown) => upgradeLaborTaxOrder
            ? upgradeReviewedLaborTaxPlan(value, source.buffer, mapped, layout.id)
            : normalizeContractBodyPlan(value, source.buffer, mapped, layout.id, reviewedLaborTaxBindingVersion);
          draftDataForSave.documentBody = normalizeSavedBody(draftDataForSave.documentBody);
          if (deleteSavedAddition) {
            const old = normalizeSavedBody(currentDraftData.documentBody);
            const additionId = bodyActionRecord!.additionId;
            if (effectiveLayoutTemplateVersionId !== version.layoutTemplateVersionId || old.edits.length || old.deletedPositionIds?.length ||
              old.paragraphOrder?.length || old.additions?.length !== 1 || old.additions[0].id !== additionId) {
              throw new ConflictException("删除新增条款的信息已变化，请保留当前输入并重新读取后重试");
            }
            const expected = normalizeContractBodyPlan({ ...old, additions: old.additions.filter(addition => addition.id !== additionId) }, source.buffer, mapped, layout.id, reviewedLaborTaxBindingVersion);
            if (this.stableJson(draftDataForSave.documentBody) !== this.stableJson(expected)) {
              throw new ConflictException("删除操作与当前正文不一致，请保留当前输入并重新读取后重试");
            }
            provedSoleAdditionDeletion = true;
          }
        }
        if (deleteSavedAddition && !provedSoleAdditionDeletion) throw new ConflictException("删除新增条款的信息已变化，请保留当前输入并重新读取后重试");
        // Judge the resulting document semantics, never operation-shaped metadata.
        // An unchanged order is normalized away and cannot hide an implicit reset.
        if (hadManualBody && !bodyHasManualChanges(draftDataForSave.documentBody) && !regenerateBody && !provedSoleAdditionDeletion) throw new ConflictException("重新生成或更换模板将覆盖手工正文，请先确认覆盖影响，原内容已保留");
        if (regenerateBody && bodyHasManualChanges(draftDataForSave.documentBody)) throw new BadRequestException("重新生成须使用当前填写资料，不能同时覆盖为另一份手工正文");
        if (regenerateBody && hadManualBody) {
          const existing = await tx.contractDraftCheckpoint.findMany({ where: { contractVersionId }, orderBy: { sequenceNo: "desc" } });
          const checkpoint = await tx.contractDraftCheckpoint.create({ data: {
            contractVersionId, sequenceNo: Math.max(0, ...existing.map(row => row.sequenceNo)) + 1,
            name: "正文重新生成前", createdByUserId: actorUserId,
            snapshot: { kind: "contract_body", protocolVersion: 1, documentBody: currentDraftData.documentBody!, layoutTemplateVersionId: version.layoutTemplateVersionId,
              documentContentRevision: version.documentContentRevision, documentContentFingerprint: version.documentContentFingerprint }
          } });
          await this.audit.record(tx, { actorUserId, action: "contract.draft.checkpoint.create", businessType: "contract_version", businessId: contractVersionId,
            metadata: { checkpointId: checkpoint.id, sequenceNo: checkpoint.sequenceNo, reason: "document_body_regenerate" } });
        }

        await tx.$queryRaw(Prisma.sql`
          SELECT "id" FROM "ContractBill"
          WHERE "contractVersionId" = ${contractVersionId}
          ORDER BY "id"
          FOR UPDATE
        `);
        await tx.$queryRaw(Prisma.sql`
          SELECT r."id" FROM "ContractBillRow" r
          JOIN "ContractBill" b ON b."id" = r."contractBillId"
          WHERE b."contractVersionId" = ${contractVersionId}
          ORDER BY r."id"
          FOR UPDATE
        `);
        await tx.$queryRaw(Prisma.sql`
          SELECT "id" FROM "ContractPartySnapshot"
          WHERE "contractVersionId" = ${contractVersionId}
          ORDER BY "id"
          FOR UPDATE
        `);
        await tx.$queryRaw(Prisma.sql`
          SELECT "id" FROM "PaymentTermsVersion"
          WHERE "contractVersionId" = ${contractVersionId}
          ORDER BY "id"
          FOR UPDATE
        `);
        await tx.$queryRaw(Prisma.sql`
          SELECT s."id" FROM "PaymentTermsStage" s
          JOIN "PaymentTermsVersion" t ON t."id" = s."paymentTermsVersionId"
          WHERE t."contractVersionId" = ${contractVersionId}
          ORDER BY s."id"
          FOR UPDATE
        `);
        const currentBills = await tx.contractBill.findMany({
          where: { contractVersionId },
          orderBy: { id: "asc" }
        });
        const inputBillsByKey = new Map(
          input.bills.map((bill) => [bill.billKey, bill])
        );
        if (
          currentBills.length !== input.bills.length ||
          currentBills.some((bill) => !inputBillsByKey.has(bill.billKey))
        ) {
          throw new BadRequestException("合同清单集合已变化，请刷新后重试");
        }
        // Validate the version-level default even when an empty bill has no rows
        // through which the four-place line calculator could validate it.
        if (input.draft.numericProtocolVersion === 2 || version.numericProtocolVersion === 2 ||
          currentBills.some((bill) => bill.numericProtocolVersion === 2) ||
          input.bills.some((bill) => bill.numericProtocolVersion === 2)) {
          const rate = input.draft.taxFacts.defaultTaxRatePercent;
          const storedRate = version.defaultTaxRatePercent?.toString();
          const unchangedStoredRate = storedRate !== undefined &&
            (storedRate.split(".")[1]?.length ?? 0) > 4 &&
            rate === storedRate;
          if (!unchangedStoredRate && rate !== null) {
            try {
              if (normalizeBusinessAmount(rate) === null) throw new Error("empty tax rate transport");
            } catch {
              throw new BadRequestException("默认税率须填写规范数字，最多保留4位小数；请保留原输入后修改");
            }
          }
        }
        await this.assertNegotiationReferences(tx, contractVersionId, input);
        await this.files.assertCanBindContractDraftAttachments(
          tx,
          contractVersionId,
          input.attachments.map((attachment) => attachment.fileId),
          actorUserId
        );

        const effectiveChangedSections = new Set<string>();
        const billRevisions: Record<string, number> = {};
        const billRowKeys: Record<string, Array<{ clientRowKey: string; rowKey: string }>> = {};
        const deletedRows: Record<string, Prisma.InputJsonObject[]> = {};
        const restoreSources = new Map<string, { snapshot: Record<string, unknown>; undo: { version: number; deletedRows: Record<string, unknown[]>; restoredKeys: string[]; pricingModes: Record<string, string> } }>();
        const billVersionContext = {
          ...version,
          pricingNature: input.draft.pricingNature,
          amountSource: input.draft.amountSource,
          defaultTaxRatePercent:
            input.draft.taxFacts.defaultTaxRatePercent === null
              ? null
              : new Prisma.Decimal(
                  input.draft.taxFacts.defaultTaxRatePercent
                ),
          taxMode: input.draft.taxFacts.taxMode
        };
        for (const bill of currentBills) {
          const billInput = inputBillsByKey.get(bill.billKey)!;
          const trustedRestores = new Map<string, ContractBillRow>();
          for (const row of billInput.rows) {
            const ref = row.restoreRef;
            if (!ref) continue;
            if (billInput.numericProtocolVersion !== 2 || row.rowKey !== undefined || typeof ref !== "object" || Array.isArray(ref) || Object.keys(ref).length !== 2 ||
              typeof ref.saveIntentKey !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(ref.saveIntentKey) ||
              typeof ref.oldRowKey !== "string" || !ref.oldRowKey || ref.oldRowKey.length > 128) throw new BadRequestException("撤销来源格式不正确，请保留输入并核对原保存结果");
            let source = restoreSources.get(ref.saveIntentKey);
            if (!source) {
              const receipt = await tx.contractDraftSaveRequest.findUnique({ where: { idempotencyKey: ref.saveIntentKey } });
              if (!receipt || receipt.contractVersionId !== contractVersionId || receipt.createdByUserId !== actorUserId || receipt.expiresAt <= now || !receipt.responseSnapshot || typeof receipt.responseSnapshot !== "object" || Array.isArray(receipt.responseSnapshot)) throw new BadRequestException("原删除记录不属于当前经办人的合同草稿或已过期");
              const snapshot = receipt.responseSnapshot as Record<string, unknown>;
              const undo = snapshot["_rowUndo"] as { version?: unknown; deletedRows?: unknown; restoredKeys?: unknown; pricingModes?: unknown } | undefined;
              if (!undo || undo.version !== 1 || !undo.deletedRows || typeof undo.deletedRows !== "object" || Array.isArray(undo.deletedRows) || !Array.isArray(undo.restoredKeys) || undo.restoredKeys.some(key => typeof key !== "string")) throw new BadRequestException("原保存记录没有可核对的删除事实，不能恢复该行");
              if (!undo.pricingModes || typeof undo.pricingModes !== "object" || Array.isArray(undo.pricingModes)) {
                throw new BadRequestException("原删除记录的金额口径缺少可核对依据，请保留草稿并联系合同部核对后恢复");
              }
              source = { snapshot, undo: { version: 1, deletedRows: undo.deletedRows as Record<string, unknown[]>, restoredKeys: [...undo.restoredKeys], pricingModes: undo.pricingModes as Record<string, string> } };
              restoreSources.set(ref.saveIntentKey, source);
            }
            const requestedBasics = input.draft.draftData.contractBasics;
            const targetPricingMode = requestedBasics && typeof requestedBasics === "object" && !Array.isArray(requestedBasics)
              ? (requestedBasics as Record<string, unknown>).amountBasis ?? bill.pricingMode : bill.pricingMode;
            if (source.undo.pricingModes[bill.billKey] !== bill.pricingMode || source.undo.pricingModes[bill.billKey] !== targetPricingMode) {
              throw new BadRequestException("原删除记录的金额口径与当前草稿不一致，请保留草稿并先核对口径，不能直接恢复原行");
            }
            const consumedKey = JSON.stringify([bill.billKey, ref.oldRowKey]);
            if (source.undo.restoredKeys.includes(consumedKey)) throw new BadRequestException("该删除记录已经恢复，不能重复恢复");
            const candidates = source.undo.deletedRows[bill.billKey];
            if (!Array.isArray(candidates)) throw new BadRequestException("原删除记录不属于当前清单");
            const matches = candidates.filter(fact => fact && typeof fact === "object" && !Array.isArray(fact) && (fact as Record<string, unknown>)["rowKey"] === ref.oldRowKey);
            if (matches.length !== 1) throw new BadRequestException("原删除记录不包含该行，不能恢复");
            trustedRestores.set(row.clientRowKey, readDeletedDraftRow(matches[0], bill.id));
            source.undo.restoredKeys.push(consumedKey);
          }
          const result = await this.bills.replaceRowsInTransaction(
            tx,
            actorUserId,
            billVersionContext,
            bill,
            { ...billInput, ...(
              input.draft.draftData.contractBasics && typeof input.draft.draftData.contractBasics === "object" &&
              ["tax_inclusive", "tax_exclusive"].includes((input.draft.draftData.contractBasics as Record<string, unknown>).amountBasis as string)
                ? { pricingMode: (input.draft.draftData.contractBasics as { amountBasis: "tax_inclusive" | "tax_exclusive" }).amountBasis } : {}) },
            trustedRestores
          );
          billRevisions[bill.billKey] = result.revision;
          billRowKeys[bill.billKey] = result.rowKeys ?? [];
          deletedRows[bill.billKey] = result.deletedRows ?? [];
          for (const row of billInput.rows) if (row.restoreRef) {
            const restored = result.rowKeys?.find(binding => binding.clientRowKey === row.clientRowKey);
            if (!restored) throw new BadRequestException("恢复行回执不完整，请核对保存结果");
            await this.audit.record(tx, { actorUserId, action: "contract.draft.row.restore", businessType: "contract_version", businessId: contractVersionId,
              metadata: { billKey: bill.billKey, originalSaveIntentKey: row.restoreRef.saveIntentKey, oldRowKey: row.restoreRef.oldRowKey, newRowKey: restored.rowKey, restoreSaveIntentKey: input.idempotencyKey } });
          }
          if (result.changed) effectiveChangedSections.add("bills");
        }
        const partyResult = await this.parties.replaceContractPartiesInTransaction(
          tx,
          contractVersionId,
          input.parties
        );
        if (partyResult.changed) effectiveChangedSections.add("parties");
        const paymentResult = await this.workbench.replacePaymentTermsInTransaction(
          tx,
          contract,
          version,
          input.paymentTerms
        );
        if (paymentResult.changed) {
          effectiveChangedSections.add("payment_terms");
        }
        const attachmentResult = await this.replaceAttachmentsInTransaction(
          tx,
          contractVersionId,
          actorUserId,
          input.attachments
        );
        if (attachmentResult.changed) {
          effectiveChangedSections.add("attachments");
        }
        const fieldInput = { ...input, draft: { ...input.draft, draftData: draftDataForSave,
          ...(input.draft.layoutTemplateVersionId === undefined ? { layoutTemplateVersionId: version.layoutTemplateVersionId ?? undefined } : {}) } };
        const fieldResult =
          await this.workbench.prepareAggregateDraftFieldsInTransaction(
            tx,
            version,
            fieldInput
          );
        if (fieldResult.changed) effectiveChangedSections.add("draft");
        if (fieldResult.workbenchReferencesChanged) {
          effectiveChangedSections.add("negotiation_documents");
        }

        const [
          documentParties,
          documentPaymentTerms,
          documentAttachments,
          documentBills
        ] = await Promise.all([
          tx.contractPartySnapshot.findMany({
            where: { contractVersionId },
            orderBy: [{ roleKey: "asc" }, { displayOrder: "asc" }]
          }),
          tx.paymentTermsVersion.findFirst({
            where: { contractVersionId },
            orderBy: { versionNo: "desc" }
          }),
          tx.contractDraftAttachment.findMany({
            where: { contractVersionId },
            orderBy: [{ slotKey: "asc" }, { displayOrder: "asc" }]
          }),
          tx.contractBill.findMany({
            where: { contractVersionId },
            orderBy: { billKey: "asc" }
          })
        ]);
        const [documentPaymentStages, documentBillRows] = await Promise.all([
          documentPaymentTerms
            ? tx.paymentTermsStage.findMany({
                where: { paymentTermsVersionId: documentPaymentTerms.id },
                orderBy: [{ createdAt: "asc" }, { id: "asc" }]
              })
            : Promise.resolve([]),
          documentBills.length
            ? tx.contractBillRow.findMany({
                where: {
                  contractBillId: { in: documentBills.map((bill) => bill.id) }
                },
                orderBy: [{ contractBillId: "asc" }, { sortOrder: "asc" }]
              })
            : Promise.resolve([])
        ]);

        const numericProtocolVersion = input.draft.numericProtocolVersion === 2 || version.numericProtocolVersion === 2 || documentBills.some(bill => bill.numericProtocolVersion === 2) ? 2 : 1;
        const pricingPolicy = contractPricingPolicy({ pricingNature: input.draft.pricingNature, amountLimitType: version.amountLimitType, hasPricedRows: documentBillRows.length > 0 });
        const frameworkAmountUnknown = pricingPolicy.kind === "unlimited_framework" || (input.draft.pricingNature === "framework" && documentBills.length === 0);
        const amountYuan = numericProtocolVersion === 2
          ? frameworkAmountUnknown ? null : input.draft.amountSource === "bill_sum" ? sumContractBillBusinessAmounts(documentBills)
            : input.draft.numericProtocolVersion === 2 ? normalizeBusinessAmount(input.draft.manualAmountYuan ?? null)
              : businessAmountFromLegacyCents(fieldResult.amountCents)
          : null;
        if (numericProtocolVersion === 2) Object.assign(fieldResult.data, { numericProtocolVersion, amountYuan, amountCents: compatibleBillCents(amountYuan) ?? 0n });

        const changed = effectiveChangedSections.size > 0;
        const documentContentChangedSections = [...effectiveChangedSections]
          .filter((section) => section !== "negotiation_documents")
          .sort();
        const documentContentChanged = documentContentChangedSections.length > 0;
        const documentContentRevisionBefore =
          version.documentContentRevision ?? 1;
        const documentContentRevision = documentContentChanged
          ? documentContentRevisionBefore + 1
          : documentContentRevisionBefore;
        const calculatedDocumentContentFingerprint =
          calculateContractDocumentContentFingerprint({
            templateSnapshot: version.templateSnapshot,
            layoutTemplateVersionId: effectiveLayoutTemplateVersionId ?? null,
            parties: documentParties.map((party) => ({
              roleKey: party.roleKey,
              displayOrder: party.displayOrder,
              businessPartyVersionId: party.businessPartyVersionId,
              snapshot: party.snapshot
            })),
            subjectAndScope: fieldResult.storedDraftData,
            amountAndTax: {
              pricingNature: input.draft.pricingNature,
              amountSource: input.draft.amountSource,
              amountCents: fieldResult.amountCents.toString(),
              ...(numericProtocolVersion === 2 ? { numericProtocolVersion, amountYuan } : {}),
              estimatedAmountCents:
                fieldResult.estimatedAmountCents?.toString() ?? null,
              amountAdjustmentReason: input.draft.amountAdjustmentReason ?? null,
              taxFacts: fieldResult.normalizedTaxFacts,
              bills: documentBills.map((bill) => ({
                billKey: bill.billKey,
                name: bill.name,
                amountRole: bill.amountRole,
                pricingMode: bill.pricingMode,
                quantityScale: bill.quantityScale,
                unitPriceScale: bill.unitPriceScale,
                schemaSnapshot: bill.schemaSnapshot,
                sourceExcelFileId: bill.sourceExcelFileId,
                taxInclusiveAmountCents: bill.taxInclusiveAmountCents.toString(),
                ...(bill.numericProtocolVersion === 2 ? { numericProtocolVersion: 2,
                  taxInclusiveAmountYuan: bill.taxInclusiveAmountYuan?.toFixed(4) ?? null,
                  taxExclusiveAmountYuan: bill.taxExclusiveAmountYuan?.toFixed(4) ?? null, taxAmountYuan: bill.taxAmountYuan?.toFixed(4) ?? null } : {}),
                taxExclusiveAmountCents: bill.taxExclusiveAmountCents.toString(),
                taxAmountCents: bill.taxAmountCents.toString(),
                rows: documentBillRows
                  .filter((row) => row.contractBillId === bill.id)
                  .map((row) => ({
                    rowKey: row.rowKey,
                    sortOrder: row.sortOrder,
                    itemCode: row.itemCode,
                    itemName: row.itemName,
                    specification: row.specification,
                    unit: row.unit,
                    quantity: row.quantity?.toString() ?? null,
                    unitPrice: row.unitPrice?.toString() ?? null,
                    taxRate: row.taxRate?.toString() ?? null,
                    taxRateSource: row.taxRateSource,
                    pricingFactStatus: row.pricingFactStatus,
                    precisionPolicy: row.precisionPolicy,
                    ...(row.numericProtocolVersion === 2 ? { numericProtocolVersion: 2, numericSource: row.numericSource, numericReviewStatus: row.numericReviewStatus,
                      taxInclusiveAmountYuan: row.taxInclusiveAmountYuan?.toFixed(4) ?? null,
                      taxExclusiveAmountYuan: row.taxExclusiveAmountYuan?.toFixed(4) ?? null, taxAmountYuan: row.taxAmountYuan?.toFixed(4) ?? null } : {}),
                    taxInclusiveAmountCents:
                      row.taxInclusiveAmountCents?.toString() ?? null,
                    taxExclusiveAmountCents:
                      row.taxExclusiveAmountCents?.toString() ?? null,
                    taxAmountCents: row.taxAmountCents?.toString() ?? null,
                    taxExclusiveUnitPrice:
                      row.taxExclusiveUnitPrice?.toString() ?? null,
                    isProvisional: row.isProvisional,
                    settlementBasis: row.settlementBasis,
                    customData: row.customData
                  }))
              }))
            },
            paymentTerms: documentPaymentTerms
              ? {
                  originalText: documentPaymentTerms.originalText,
                  stages: documentPaymentStages.map((stage) => ({
                    name: stage.name,
                    stageType: stage.stageType,
                    basis: stage.basis,
                    ratioBps: stage.ratioBps,
                    fixedAmountCents: stage.fixedAmountCents?.toString() ?? null,
                    triggerAnchor: stage.triggerAnchor,
                    triggerEvent: stage.triggerEvent,
                    dueDays: stage.dueDays,
                    advanceDeductionMode: stage.advanceDeductionMode,
                    advanceDeductionRatioBps: stage.advanceDeductionRatioBps,
                    advanceDeductionStartRatioBps:
                      stage.advanceDeductionStartRatioBps,
                    requiresInvoice: stage.requiresInvoice,
                    allowsEarlyPayment: stage.allowsEarlyPayment,
                    allowsInstallments: stage.allowsInstallments,
                    retentionBps: stage.retentionBps,
                    originalText: stage.originalText
                  }))
                }
              : null,
            clauses: fieldResult.data.clauseSnapshot,
            attachments: documentAttachments.map((attachment) => ({
              slotKey: attachment.slotKey,
              fileId: attachment.fileId,
              displayOrder: attachment.displayOrder
            }))
          });
        const documentContentFingerprint = documentContentChanged ||
          !version.documentContentFingerprint
          ? calculatedDocumentContentFingerprint
          : version.documentContentFingerprint;
        const documentContentWriteRequired = documentContentChanged ||
          !version.documentContentFingerprint;
        const resultRevision = changed
          ? version.draftRevision + 1
          : version.draftRevision;
        if (changed || documentContentWriteRequired) {
          if (changed) {
            const parentGate = await tx.contract.updateMany({
              where: {
                id: contract.id,
                ownerUserId: actorUserId,
                voidedAt: null
              },
              data: {
                ownerUserId: actorUserId,
                ...(fieldResult.companySelection
                  ? {
                      companyEntityId: fieldResult.companySelection.id,
                      companyEntityName: fieldResult.companySelection.name
                    }
                  : {})
              }
            });
            if (parentGate.count !== 1) {
              throw new ConflictException({
                statusCode: 409,
                code: "DRAFT_REVISION_CONFLICT",
                message: "合同资料已变化，请刷新后重试",
                latestRevision: version.draftRevision,
                conflictReason: "parent_contract_changed",
                canReacquireLease: false
              });
            }
          }
          const versionGate = await tx.contractVersion.updateMany({
            where: {
              id: contractVersionId,
              draftRevision: input.expectedRevision,
              status: { in: [...EDITABLE_CONTRACT_DRAFT_STATUSES] }
            },
            data: {
              ...(changed
                ? {
                    ...fieldResult.data,
                    draftRevision: { increment: 1 }
                  }
                : {}),
              // draftRevision remains the aggregate concurrency coordinate;
              // document consumers use the independently frozen content facts.
              ...(documentContentChanged
                ? { documentContentRevision: { increment: 1 } }
                : {}),
              ...(documentContentChanged || !version.documentContentFingerprint
                ? { documentContentFingerprint }
                : {})
            }
          });
          if (versionGate.count !== 1) {
            throw new ConflictException({
              statusCode: 409,
              code: "DRAFT_REVISION_CONFLICT",
              message: "合同资料已变化，请刷新后重试",
              latestRevision: version.draftRevision,
              conflictReason: "draft_revision_changed",
              canReacquireLease: false
            });
          }
          if (documentContentChanged) {
            await tx.contractGeneratedDocument.updateMany({
              where: {
                contractVersionId,
                status: { in: ["queued", "processing", "success"] }
              },
              data: { status: "stale" }
            });
          }
          if (input.saveKind === "manual" && (changed || documentContentWriteRequired)) {
            await this.audit.record(tx, {
              actorUserId,
              action: "contract.draft.save",
              businessType: "contract_version",
              businessId: contractVersionId,
              metadata: {
                revisionBefore: input.expectedRevision,
                revisionAfter: resultRevision,
                effectiveChangedSections: [...effectiveChangedSections].sort(),
                documentContentRevisionBefore,
                documentContentRevisionAfter: documentContentRevision,
                documentContentFingerprint,
                documentContentChangedSections
              }
            });
          }
        }
        const refreshedBills = await tx.contractBill.findMany({
          where: { contractVersionId },
          orderBy: { billKey: "asc" }
        });
        for (const bill of refreshedBills) {
          billRevisions[bill.billKey] = bill.revision;
        }
        const decimalAmounts = numericProtocolVersion === 2 ? Object.fromEntries(
          (["taxInclusiveAmount", "taxExclusiveAmount", "taxAmount"] as const).flatMap(kind => {
            const amount = sumBusinessAmounts(refreshedBills.filter(bill => bill.amountRole === "included" || bill.amountRole === "provisional")
              .map(bill => bill.numericProtocolVersion === 2 ? bill[`${kind}Yuan`]?.toFixed(4) ?? null : businessAmountFromLegacyCents(bill[`${kind}Cents`])));
            return [[`${kind}Yuan`, amount], [`${kind}Cents`, compatibleBillCents(amount)?.toString() ?? null]];
          })) : {};
        const isDirector = await this.isContractDirector(actorUserId);
        const response = {
          contractVersionId,
          draftRevision: resultRevision,
          serverRevision: resultRevision,
          documentContentRevision,
          documentContentFingerprint,
          documentContentChangedSections,
          savedAt: now.toISOString(),
          ...(numericProtocolVersion === 2 ? {
            ...(transportFingerprint ? { requestFingerprint: transportFingerprint } : {}),
            billRowKeys,
            deletedRowRestoreRefs: Object.fromEntries(Object.entries(deletedRows).map(([billKey, rows]) => [billKey, rows.map(row => ({ saveIntentKey: input.idempotencyKey, oldRowKey: row["rowKey"], originalValues: deletedRowPublicOriginalValues(row) }))])),
            versionAmount: { numericProtocolVersion: 2, amountYuan, amountCents: compatibleBillCents(amountYuan)?.toString() ?? null },
            billAmounts: refreshedBills.filter(bill => bill.numericProtocolVersion === 2).map(bill => ({ billKey: bill.billKey, numericProtocolVersion: 2,
              taxInclusiveAmountYuan: bill.taxInclusiveAmountYuan?.toFixed(4) ?? null, taxExclusiveAmountYuan: bill.taxExclusiveAmountYuan?.toFixed(4) ?? null, taxAmountYuan: bill.taxAmountYuan?.toFixed(4) ?? null,
              taxInclusiveAmountCents: bill.taxInclusiveAmountYuan == null ? null : bill.taxInclusiveAmountCents.toString(),
              taxExclusiveAmountCents: bill.taxExclusiveAmountYuan == null ? null : bill.taxExclusiveAmountCents.toString(),
              taxAmountCents: bill.taxAmountYuan == null ? null : bill.taxAmountCents.toString() }))
          } : {}),
          effectiveChangedSections: [...effectiveChangedSections].sort(),
          amounts: {
            taxInclusiveAmountCents: refreshedBills
              .filter((bill) =>
                bill.amountRole === "included" ||
                bill.amountRole === "provisional"
              )
              .reduce((sum, bill) => sum + bill.taxInclusiveAmountCents, 0n)
              .toString(),
            taxExclusiveAmountCents: refreshedBills
              .filter((bill) =>
                bill.amountRole === "included" ||
                bill.amountRole === "provisional"
              )
              .reduce((sum, bill) => sum + bill.taxExclusiveAmountCents, 0n)
              .toString(),
            taxAmountCents: refreshedBills
              .filter((bill) =>
                bill.amountRole === "included" ||
                bill.amountRole === "provisional"
              )
              .reduce((sum, bill) => sum + bill.taxAmountCents, 0n)
              .toString(),
            ...(numericProtocolVersion === 2 ? { numericProtocolVersion: 2, ...decimalAmounts } : {})
          },
          billRevisions,
          issueCounts: {},
          readiness: null,
          documentsOutdated: documentContentChanged,
          availableActions: [],
          capability: {
            refreshRequired: false,
            draftOperationAvailableActions: this.projectDraftOperationCapabilities(
              { ...version, numericProtocolVersion },
              true,
              isDirector,
              false
            )
          },
          invalidation: {
            status: documentContentChanged ? "document_invalidated" : "unchanged"
          }
        };
        for (const [idempotencyKey, source] of restoreSources) await tx.contractDraftSaveRequest.update({
          where: { idempotencyKey }, data: { responseSnapshot: { ...source.snapshot, _rowUndo: source.undo } as Prisma.InputJsonObject }
        });
        await tx.contractDraftSaveRequest.create({
          data: {
            idempotencyKey: input.idempotencyKey,
            contractVersionId,
            expectedRevision: input.expectedRevision,
            resultRevision,
            saveKind: input.saveKind,
            requestSha256,
            responseSnapshot: numericProtocolVersion === 2 ? { ...response, _rowUndo: { version: 1, deletedRows, restoredKeys: [], pricingModes: Object.fromEntries(currentBills.map(bill => [bill.billKey, bill.pricingMode])) } } : response,
            createdByUserId: actorUserId,
            expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
          }
        });
        return response;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof ConflictException) {
        throw new ConflictException(
          await this.conflictReceipt(contractVersionId, input.expectedRevision, error)
        );
      }
      const prismaSerializationFailure =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (
          error.code === "P2034" ||
          (
            error.code === "P2010" &&
            error.meta !== null &&
            typeof error.meta === "object" &&
            "code" in error.meta &&
            error.meta.code === "40001"
          )
        );
      if (
        prismaSerializationFailure ||
        (error instanceof Error &&
          (error as Error & { code?: string }).code === "40001")
      ) {
        const conflict = await this.loadConflictSnapshot(
          contractVersionId,
          input.expectedRevision
        );
        throw new ConflictException({
          statusCode: 409,
          code: "DRAFT_REVISION_CONFLICT",
          message: "合同资料已变化，请刷新后重试",
          latestRevision: conflict.latestRevision,
          serverRevision: conflict.latestRevision,
          conflictReason: "serialization_failure",
          canReacquireLease: conflict.canReacquireLease,
          capability: {
            refreshRequired: true,
            draftOperationAvailableActions: []
          },
          invalidation: { status: "refresh_required" }
        });
      }
      if (error instanceof BadRequestException) {
        const response = error.getResponse();
        if (
          typeof response === "object" &&
          response !== null &&
          "code" in response &&
          (
            response.code === "DRAFT_VALIDATION_FAILED" ||
            response.code === "HISTORICAL_TAKEOVER_WORKBENCH_REQUIRED"
          )
        ) {
          throw error;
        }
        const message = typeof response === "string"
          ? response
          : typeof response === "object" &&
              response !== null &&
              "message" in response &&
              typeof response.message === "string"
            ? response.message
            : "合同草稿校验未通过，请检查后重试";
        const errors = typeof response === "object" &&
          response !== null &&
          "errors" in response &&
          Array.isArray(response.errors) &&
          response.errors.every((item) => typeof item === "string")
          ? response.errors
          : undefined;
        throw new BadRequestException({
          statusCode: 400,
          code: "DRAFT_VALIDATION_FAILED",
          message,
          ...(errors ? { errors } : {})
        });
      }
      throw error;
    }
  }

  private canReacquireLease(
    lease: { expiresAt: Date } | null,
    now: Date
  ) {
    return !lease || lease.expiresAt.getTime() <= now.getTime();
  }

  private completeIdempotentSaveReceipt(
    responseSnapshot: unknown,
    resultRevision: number,
    version: {
      status: string;
      changeType: string;
      baseVersionId: string | null;
      contractGovernanceVersion: number | null;
      numericProtocolVersion?: number;
    },
    isOwner: boolean,
    isDirector: boolean
  ) {
    responseSnapshot = publicSaveSnapshot(responseSnapshot);
    if (this.hasCompleteSaveReceipt(responseSnapshot, resultRevision)) {
      return responseSnapshot;
    }
    const snapshot: Record<string, unknown> = typeof responseSnapshot === "object" &&
      responseSnapshot !== null &&
      !Array.isArray(responseSnapshot)
      ? responseSnapshot as Record<string, unknown>
      : {};
    return {
      ...snapshot,
      draftRevision: resultRevision,
      serverRevision: resultRevision,
      capability: {
        refreshRequired: false,
        draftOperationAvailableActions: this.projectDraftOperationCapabilities(
          version,
          isOwner,
          isDirector,
          false
        )
      },
      invalidation: {
        status: snapshot.documentsOutdated === true
          ? "document_invalidated"
          : "unchanged"
      }
    };
  }

  private hasCompleteSaveReceipt(
    responseSnapshot: unknown,
    resultRevision: number
  ): responseSnapshot is Record<string, unknown> {
    if (
      typeof responseSnapshot !== "object" ||
      responseSnapshot === null ||
      Array.isArray(responseSnapshot)
    ) {
      return false;
    }
    const snapshot = responseSnapshot as Record<string, unknown>;
    if (snapshot.serverRevision !== resultRevision) {
      return false;
    }
    const capability = snapshot.capability;
    const invalidation = snapshot.invalidation;
    const capabilityFields = capability as Record<string, unknown>;
    const invalidationFields = invalidation as Record<string, unknown>;
    return typeof capability === "object" &&
      capability !== null &&
      !Array.isArray(capability) &&
      capabilityFields.refreshRequired === false &&
      Array.isArray(capabilityFields.draftOperationAvailableActions) &&
      capabilityFields.draftOperationAvailableActions.every(
        (action) => typeof action === "string"
      ) &&
      typeof invalidation === "object" &&
      invalidation !== null &&
      !Array.isArray(invalidation) &&
      (invalidationFields.status === "document_invalidated" ||
        invalidationFields.status === "unchanged");
  }

  private projectDraftOperationCapabilities(
    version: {
      status: string;
      changeType: string;
      baseVersionId: string | null;
      contractGovernanceVersion: number | null;
      numericProtocolVersion?: number;
    },
    isOwner: boolean,
    isDirector: boolean,
    canTakeOver: boolean
  ) {
    const isOriginalDraft = version.changeType !== "change" &&
      version.changeType !== "supplement";
    const isEditableDraft = EDITABLE_CONTRACT_DRAFT_STATUSES.has(version.status);
    return projectContractDraftOperationCapabilities([
      ...(isOwner && isEditableDraft ? [
        "acquire_contract_draft_edit_lease",
        ...(isOriginalDraft ? ["apply_contract_type_change"] : []),
        "check_contract_submission_readiness",
        "close_contract_negotiation_round",
        "dispose_contract_document_difference",
        "heartbeat_contract_draft_edit_lease",
        "open_contract_negotiation_round",
        "open_contract_revision_preview",
        "preview_contract_draft_bill_excel_import",
        ...(isOriginalDraft ? ["preview_contract_type_change"] : []),
        "queue_contract_document",
        "queue_contract_draft_preview",
        "release_contract_draft_edit_lease",
        "retry_contract_document",
        "retry_contract_offline_revision",
        ...(version.baseVersionId ? [
          "discard_contract_bill_transitions",
          "save_contract_bill_transitions"
        ] : []),
        "save_contract_draft",
        ...(version.contractGovernanceVersion === 1 ? [
          "set_contract_authorization"
        ] : []),
        ...(version.status === "draft" && version.numericProtocolVersion !== 2 ? ["submit_contract_draft"] : []),
        ...(version.contractGovernanceVersion === 1 ? [
          "upload_contract_formal_approval_file",
          "upload_contract_counterparty_signed_files",
          "confirm_contract_counterparty_signed_files"
        ] : []),
        "upload_contract_negotiation_revision",
        "upload_contract_workbench_private_file"
      ] : []),
      ...(isDirector ? [
        ...(version.baseVersionId ? ["confirm_contract_bill_transitions"] : []),
        "confirm_contract_settlement_mode",
        "transfer_contract_draft"
      ] : []),
      ...(canTakeOver ? ["take_over_contract_draft_edit_lease"] : [])
    ]);
  }

  private async loadConflictSnapshot(
    contractVersionId: string,
    fallbackRevision: number
  ) {
    try {
      const [version, lease] = await Promise.all([
        this.prisma.contractVersion.findUnique({
          where: { id: contractVersionId },
          select: { draftRevision: true }
        }),
        this.prisma.contractDraftEditLease.findUnique({
          where: { contractVersionId },
          select: { expiresAt: true }
        })
      ]);
      return {
        latestRevision: version?.draftRevision ?? fallbackRevision,
        canReacquireLease: this.canReacquireLease(lease, new Date())
      };
    } catch {
      return {
        latestRevision: fallbackRevision,
        canReacquireLease: false
      };
    }
  }

  private async conflictReceipt(
    contractVersionId: string,
    fallbackRevision: number,
    error: ConflictException
  ) {
    const response = error.getResponse();
    const body = typeof response === "object" && response !== null
      ? response
      : { message: response };
    const conflict = await this.loadConflictSnapshot(
      contractVersionId,
      fallbackRevision
    );
    return {
      ...body,
      statusCode: 409,
      latestRevision: conflict.latestRevision,
      serverRevision: conflict.latestRevision,
      canReacquireLease: conflict.canReacquireLease,
      capability: {
        refreshRequired: true,
        draftOperationAvailableActions: []
      },
      invalidation: { status: "refresh_required" }
    };
  }

  private async replaceAttachmentsInTransaction(
    tx: Prisma.TransactionClient,
    contractVersionId: string,
    actorUserId: string,
    input: SaveContractDraftAttachmentDto[]
  ) {
    const existing = await tx.contractDraftAttachment.findMany({
      where: { contractVersionId },
      orderBy: [{ slotKey: "asc" }, { displayOrder: "asc" }]
    });
    const key = (attachment: { slotKey: string; displayOrder: number }) =>
      `${attachment.slotKey}:${attachment.displayOrder}`;
    const desiredByKey = new Map(input.map((attachment) => [key(attachment), attachment]));
    const existingByKey = new Map(
      existing.map((attachment) => [key(attachment), attachment])
    );
    const removed = existing.filter(
      (attachment) => !desiredByKey.has(key(attachment))
    );
    const added = input.filter(
      (attachment) => !existingByKey.has(key(attachment))
    );
    const updated = input.filter((attachment) => {
      const current = existingByKey.get(key(attachment));
      return current !== undefined && current.fileId !== attachment.fileId;
    });
    const replaced = updated.map(
      (attachment) => existingByKey.get(key(attachment))!
    );
    if (removed.length || replaced.length) {
      await tx.contractDraftAttachment.deleteMany({
        where: {
          id: {
            in: [...removed, ...replaced].map((attachment) => attachment.id)
          }
        }
      });
    }
    if (added.length || updated.length) {
      await tx.contractDraftAttachment.createMany({
        data: [...added, ...updated].map((attachment) => ({
          contractVersionId,
          createdByUserId: actorUserId,
          ...attachment
        }))
      });
    }
    return {
      changed: removed.length > 0 || added.length > 0 || updated.length > 0
    };
  }

  private async assertNegotiationReferences(
    tx: Prisma.TransactionClient,
    contractVersionId: string,
    input: SaveContractDraftAggregateDto
  ) {
    const selection = input.negotiationDocuments;
    if (selection.selectedNegotiationRoundId) {
      const round = await tx.contractNegotiationRound.findFirst({
        where: {
          id: selection.selectedNegotiationRoundId,
          contractVersionId
        },
        select: { id: true }
      });
      if (!round) {
        throw new BadRequestException("所选磋商轮次不属于当前合同版本");
      }
    }
    if (selection.selectedOfflineRevisionId) {
      const revision = await tx.contractOfflineRevision.findFirst({
        where: {
          id: selection.selectedOfflineRevisionId,
          contractVersionId
        },
        select: { id: true }
      });
      if (!revision) {
        throw new BadRequestException("所选线下修订不属于当前合同版本");
      }
    }
    if (selection.referencedGeneratedDocumentIds.length) {
      const documents = await tx.contractGeneratedDocument.findMany({
        where: {
          id: { in: selection.referencedGeneratedDocumentIds },
          contractVersionId
        },
        select: { id: true }
      });
      if (
        documents.length !== selection.referencedGeneratedDocumentIds.length
      ) {
        throw new BadRequestException("引用生成文档不属于当前合同版本");
      }
    }
  }

  private sha256(value: string) {
    return createHash("sha256").update(value).digest("hex");
  }

  private stableJson(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableJson(item)).join(",")}]`;
    }
    if (value !== null && typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) =>
          `${JSON.stringify(key)}:${this.stableJson(item)}`
        );
      return `{${entries.join(",")}}`;
    }
    return JSON.stringify(value);
  }
}
