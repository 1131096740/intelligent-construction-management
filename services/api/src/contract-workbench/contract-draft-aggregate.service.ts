import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import { BusinessPartyService } from "../business-party/business-party.service";
import { ContractBillService } from "../contract-bill/contract-bill.service";
import { lockContractDraftMutationBoundary } from "../contract/contract-draft-lifecycle";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";
import { calculateContractDocumentContentFingerprint } from "./contract-document-content";
import { ContractWorkbenchService } from "./contract-workbench.service";
import { projectContractDraftOperationCapabilities } from "./contract-mutation-authority";
import type {
  SaveContractDraftAggregateDto,
  SaveContractDraftAttachmentDto
} from "./dto/contract-workbench.dto";

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

  async getWorkbench(contractVersionId: string, actorUserId: string) {
    const version = await this.prisma.contractVersion.findUnique({
      where: { id: contractVersionId }
    });
    if (!version) {
      throw new NotFoundException("未找到合同草稿版本，请刷新合同工作台后重试");
    }
    const legacyReadModel = await this.workbench.getDraftFromExactVersion(
      version,
      actorUserId
    );
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
        draftLifecycleKind: legacyReadModel.lifecycleKind
      },
      draft: version.draftData,
      attachments,
      draftOperationAvailableActions,
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
    input: SaveContractDraftAggregateDto
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
        await this.assertNegotiationReferences(tx, contractVersionId, input);
        await this.files.assertCanBindContractDraftAttachments(
          tx,
          contractVersionId,
          input.attachments.map((attachment) => attachment.fileId),
          actorUserId
        );

        const effectiveChangedSections = new Set<string>();
        const billRevisions: Record<string, number> = {};
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
          const result = await this.bills.replaceRowsInTransaction(
            tx,
            actorUserId,
            billVersionContext,
            bill,
            inputBillsByKey.get(bill.billKey)!
          );
          billRevisions[bill.billKey] = result.revision;
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
        const fieldResult =
          await this.workbench.prepareAggregateDraftFieldsInTransaction(
            tx,
            version,
            input
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
            layoutTemplateVersionId: input.draft.layoutTemplateVersionId ?? null,
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
        const isDirector = await this.isContractDirector(actorUserId);
        const response = {
          contractVersionId,
          draftRevision: resultRevision,
          serverRevision: resultRevision,
          documentContentRevision,
          documentContentFingerprint,
          documentContentChangedSections,
          savedAt: now.toISOString(),
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
              .toString()
          },
          billRevisions,
          issueCounts: {},
          readiness: null,
          documentsOutdated: documentContentChanged,
          availableActions: [],
          capability: {
            refreshRequired: false,
            draftOperationAvailableActions: this.projectDraftOperationCapabilities(
              version,
              true,
              isDirector,
              false
            )
          },
          invalidation: {
            status: documentContentChanged ? "document_invalidated" : "unchanged"
          }
        };
        await tx.contractDraftSaveRequest.create({
          data: {
            idempotencyKey: input.idempotencyKey,
            contractVersionId,
            expectedRevision: input.expectedRevision,
            resultRevision,
            saveKind: input.saveKind,
            requestSha256,
            responseSnapshot: response,
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
    },
    isOwner: boolean,
    isDirector: boolean
  ) {
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
        ...(version.status === "draft" ? ["submit_contract_draft"] : []),
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
