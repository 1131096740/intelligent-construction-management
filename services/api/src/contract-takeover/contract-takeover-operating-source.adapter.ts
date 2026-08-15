import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import {
  frozenAffiliateFromJson,
  occurredBeforeEffectiveDate,
  readAffiliateSnapshot,
  readOperatingLedgerEffectiveDate,
  requiredJsonDate,
  requiredJsonMoney,
  requiredJsonRecord,
  requiredJsonText,
  sourceJson
} from "../operating-ledger/formal-operating-source.helpers";
import type {
  AppendOperatingFactInput,
  OperatingSubjectReference
} from "../operating-ledger/operating-ledger.service";
import type {
  OperatingSourceAdapter,
  OperatingSourceFactInput,
  OperatingSourceLocator,
  OperatingSourceSnapshot
} from "../operating-ledger/operating-source-adapter";
import {
  buildOperatingCorrectionInput,
  parseContractTakeoverOperatingCorrectionSnapshot,
  readContractTakeoverCorrectionSnapshot,
  readContractTakeoverCorrectionSnapshots
} from "./contract-takeover-operating-correction";

export const CONTRACT_TAKEOVER_HISTORICAL_PAYMENT_SOURCE_TYPE =
  "contract_takeover_historical_payment";

const FORMAL_TAKEOVER_LEVELS = ["A", "B"] as const;

export class ContractTakeoverHistoricalPaymentOperatingSourceAdapter
  implements OperatingSourceAdapter
{
  readonly sourceType = CONTRACT_TAKEOVER_HISTORICAL_PAYMENT_SOURCE_TYPE;

  async readProjectSnapshots(
    tx: Parameters<OperatingSourceAdapter["readProjectSnapshots"]>[0],
    projectId: string
  ): Promise<readonly OperatingSourceSnapshot[]> {
    const takeovers = await tx.contractTakeover.findMany({
      where: {
        projectId,
        takeoverStatus: "confirmed",
        activatedAt: { not: null },
        takeoverLevel: { in: [...FORMAL_TAKEOVER_LEVELS] }
      },
      select: { id: true }
    });
    if (!takeovers.length) return [];
    const rows = await tx.contractTakeoverHistoricalPayment.findMany({
      where: {
        takeoverId: { in: takeovers.map((takeover) => takeover.id) },
        status: "activated"
      },
      orderBy: [{ paidAt: "asc" }, { id: "asc" }]
    });
    const snapshots = await Promise.all(rows.map((row) => this.snapshot(tx, row)));
    const originalSnapshots = snapshots.filter(
      (snapshot): snapshot is OperatingSourceSnapshot => snapshot !== null
    );
    const correctionSnapshots = await readContractTakeoverCorrectionSnapshots(
      tx,
      projectId,
      this.sourceType,
      ["historical_payment", "historical_advance", "abnormal_overpay"],
      resolveHistoricalPaymentSourceBusinessId
    );
    return [...originalSnapshots, ...correctionSnapshots];
  }

  async readSourceSnapshot(
    tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],
    locator: OperatingSourceLocator
  ): Promise<OperatingSourceSnapshot | null> {
    const row = await tx.contractTakeoverHistoricalPayment.findUnique({
      where: { id: locator.sourceBusinessId }
    });
    if (row && row.status === "activated") {
      return this.snapshot(tx, row, locator.projectId);
    }
    return readContractTakeoverCorrectionSnapshot(
      tx,
      locator,
      ["historical_payment", "historical_advance", "abnormal_overpay"],
      resolveHistoricalPaymentSourceBusinessId
    );
  }

  toOperatingFactInput(
    snapshot: OperatingSourceSnapshot
  ): OperatingSourceFactInput {
    const correction = parseContractTakeoverOperatingCorrectionSnapshot(
      snapshot.sourceSnapshot
    );
    if (correction) {
      const original = this.toOperatingFactInput(correction.originalSnapshot);
      if (original.entryKind !== "original") {
        throw new BadRequestException("历史更正原经营来源不能是更正事实");
      }
      return {
        entryKind: correction.entryKind,
        input: buildOperatingCorrectionInput(
          original.input,
          correction.originalSnapshot,
          correction.projection,
          correction.entryKind
        )
      };
    }
    const source = requiredJsonRecord(
      snapshot.sourceSnapshot,
      "历史接管实付正式来源"
    );
    const affiliate = frozenAffiliateFromJson(source, "历史接管实付");
    const occurredAt = requiredJsonDate(source, "paidAt", "历史接管实付");
    const confirmedAt = requiredJsonDate(
      source,
      "confirmedAt",
      "历史接管实付"
    );
    const effectiveDate = requiredJsonDate(
      source,
      "operatingLedgerEffectiveDate",
      "历史接管实付"
    );
    const amountCents = requiredJsonMoney(
      source,
      "amountCents",
      "历史接管实付"
    );
    if (amountCents <= 0n) {
      throw new BadRequestException("历史接管实付金额必须大于 0");
    }

    const approvedPayer = payerSubject(
      requiredJsonText(source, "approvedPayerType", "历史接管实付"),
      requiredJsonText(source, "approvedPayerId", "历史接管实付")
    );
    const actualPayer = payerSubject(
      requiredJsonText(source, "actualPayerType", "历史接管实付"),
      requiredJsonText(source, "actualPayerId", "历史接管实付")
    );
    const sameApprovedPayer = sameSubject(approvedPayer, actualPayer);
    const payee: OperatingSubjectReference = {
      kind: "downstream_counterparty",
      id: requiredJsonText(source, "payeeVersionId", "历史接管实付")
    };
    const allocations = paymentAllocations(source);
    const evidenceLevel = requiredJsonText(
      source,
      "takeoverLevel",
      "历史接管实付"
    );
    if (evidenceLevel !== "A" && evidenceLevel !== "B") {
      throw new BadRequestException("历史接管实付只有 A/B 级可以进入正式经营账");
    }
    const impacts: AppendOperatingFactInput["impacts"] = [];
    for (const allocation of allocations) {
      if (allocation.allocationType !== "settlement") continue;
      impacts.push({
        idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}:payable:${allocation.sourceId}`,
        sourceImpactKey: `payable:${allocation.sourceId}`,
        impactKind: "payable_decrease",
        amountCents: allocation.amountCents,
        direction: "decrease",
        subjectRole: "payee",
        subject: payee,
        description: "历史逐笔实付清偿期初结算应付"
      });
      if (!sameApprovedPayer) {
        impacts.push({
          idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}:inter_subject_balance:${allocation.sourceId}`,
          sourceImpactKey: `inter_subject_balance:${allocation.sourceId}`,
          impactKind: "inter_subject_balance_increase",
          amountCents: allocation.amountCents,
          direction: "increase",
          subjectRole: "actual_payer",
          subject: actualPayer,
          description: "历史代付清偿原债务并形成主体间往来"
        });
      }
    }

    const fundsImpactKind =
      actualPayer.kind === "construction_enterprise"
        ? "construction_enterprise_funds_decrease"
        : "company_project_funds_decrease";
    impacts.push({
      idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}:funds`,
      sourceImpactKey: fundsImpactKind,
      impactKind: fundsImpactKind,
      amountCents,
      direction: "decrease",
      subjectRole: "actual_payer",
      subject: actualPayer,
      description: "历史逐笔实付减少实际付款主体项目资金"
    });

    const advance = allocations.find(
      (allocation) => allocation.allocationType === "historical_advance"
    );
    if (advance) {
      const advanceImpactKind =
        sameApprovedPayer && actualPayer.kind === "participating_company"
          ? "company_advance_for_project_increase"
          : "inter_subject_balance_increase";
      impacts.push({
        idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}:historical_advance`,
        sourceImpactKey: "historical_advance",
        impactKind: advanceImpactKind,
        amountCents: advance.amountCents,
        direction: "increase",
        subjectRole: "actual_payer",
        subject: actualPayer,
        description: "历史实付超出累计结算形成历史预付款余额"
      });
    }
    const abnormalOverpay = allocations.find(
      (allocation) => allocation.allocationType === "abnormal_overpay"
    );
    if (abnormalOverpay) {
      const abnormalImpactKind =
        sameApprovedPayer && actualPayer.kind === "participating_company"
          ? "company_returnable_to_project_increase"
          : "inter_subject_balance_increase";
      impacts.push({
        idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}:abnormal_overpay`,
        sourceImpactKey: "abnormal_overpay",
        impactKind: abnormalImpactKind,
        amountCents: abnormalOverpay.amountCents,
        direction: "increase",
        subjectRole: "actual_payer",
        subject: actualPayer,
        description: "历史异常超付形成待返还或主体间往来余额"
      });
    }

    return {
      entryKind: "original",
      input: {
        projectId: snapshot.projectId,
        sourceType: snapshot.sourceType,
        sourceBusinessId: snapshot.sourceBusinessId,
        sourceBusinessCode: snapshot.sourceBusinessCode,
        sourceVersion: snapshot.sourceVersion,
        idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}`,
        occurredAt,
        confirmedAt,
        confirmedByUserId: requiredJsonText(
          source,
          "confirmedByUserId",
          "历史接管实付"
        ),
        factKind: "downstream_payment",
        operatingLevel: sameSubject(approvedPayer, actualPayer)
          ? "project"
          : "inter_subject",
        evidenceLevel,
        amountCents,
        currencyCode: "CNY",
        direction: "outflow",
        isBeforeOperatingLedgerEffectiveDate: occurredBeforeEffectiveDate(
          occurredAt,
          effectiveDate
        ),
        affiliateAssignmentId: affiliate.assignmentId,
        affiliateBusinessPartyVersionId: affiliate.businessPartyVersionId,
        affiliateNameSnapshot: affiliate.name,
        ...(affiliate.creditCode
          ? { affiliateCreditCodeSnapshot: affiliate.creditCode }
          : {}),
        ...(optionalJsonText(source, "takeoverBatchId")
          ? {
              historicalTakeoverBatchId: optionalJsonText(
                source,
                "takeoverBatchId"
              )
            }
          : {}),
        sourceSnapshot: snapshot.sourceSnapshot,
        basisSnapshot: sourceJson({
          authority: "activated_historical_payment_with_voucher",
          voucherFileIds: requiredJsonTextList(
            source,
            "voucherFileIds",
            "历史接管实付"
          )
        }),
        subjects: {
          debtor: approvedPayer,
          approvedPayer,
          actualPayer,
          payee
        },
        impacts
      }
    };
  }

  private async snapshot(
    tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],
    row: HistoricalPaymentRow,
    projectId?: string
  ): Promise<OperatingSourceSnapshot | null> {
    const takeover = await tx.contractTakeover.findFirst({
      where: {
        id: row.takeoverId,
        ...(projectId ? { projectId } : {}),
        takeoverStatus: "confirmed",
        activatedAt: { not: null },
        takeoverLevel: { in: [...FORMAL_TAKEOVER_LEVELS] }
      },
      select: {
        id: true,
        projectId: true,
        takeoverBatchId: true,
        contractId: true,
        contractVersionId: true,
        paymentTermsVersionId: true,
        takeoverLevel: true,
        activatedAt: true,
        activatedByUserId: true,
        confirmedByUserId: true,
        historicalInitialSettlementId: true
      }
    });
    if (!takeover) {
      return null;
    }
    const [contract, version, counterparty, allocations, vouchers, effectiveDate] =
      await Promise.all([
        tx.contract.findUnique({
          where: { id: takeover.contractId },
          select: { code: true, name: true, counterparty: true }
        }),
        tx.contractVersion.findUnique({
          where: { id: takeover.contractVersionId },
          select: {
            signingSubjectType: true,
            companyEntityIdSnapshot: true,
            companyEntityVersionId: true,
            companyEntityNameSnapshot: true,
            affiliateAssignmentId: true,
            affiliateBusinessPartyVersionId: true,
            affiliateNameSnapshot: true
          }
        }),
        tx.contractPartySnapshot.findFirst({
          where: {
            contractVersionId: takeover.contractVersionId,
            roleKey: "party_b"
          },
          select: { businessPartyVersionId: true, snapshot: true },
          orderBy: { displayOrder: "asc" }
        }),
        tx.contractTakeoverHistoricalPaymentAllocation.findMany({
          where: { historicalPaymentId: row.id },
          select: { allocationType: true, amountCents: true, allocationOrder: true },
          orderBy: { allocationOrder: "asc" }
        }),
        tx.contractTakeoverHistoricalPaymentVoucher.findMany({
          where: { historicalPaymentId: row.id },
          select: { fileId: true },
          orderBy: { displayOrder: "asc" }
        }),
        readOperatingLedgerEffectiveDate(tx, takeover.projectId)
      ]);
    if (
      !contract ||
      !version ||
      !counterparty?.businessPartyVersionId ||
      !takeover.activatedAt ||
      !(takeover.activatedByUserId ?? takeover.confirmedByUserId)
    ) {
      throw new BadRequestException("历史接管实付缺少合同、主体或激活确认快照");
    }
    const affiliate = await readAffiliateSnapshot(tx, {
      projectId: takeover.projectId,
      occurredAt: row.paidAt,
      assignmentId: version.affiliateAssignmentId,
      businessPartyVersionId: version.affiliateBusinessPartyVersionId
    });
    if (!occurredBeforeEffectiveDate(row.paidAt, effectiveDate)) {
      throw new BadRequestException(
        "生效日后的我方付款必须走正式付款流程，不能通过历史接管进入经营账"
      );
    }
    const approvedPayer = approvedPayerIdentity(version);
    const actualPayer = await actualPayerIdentity(
      tx,
      takeover.projectId,
      row.paidAt,
      row.payerName,
      approvedPayer
    );
    return {
      projectId: takeover.projectId,
      sourceType: this.sourceType,
      sourceBusinessId: row.id,
      sourceBusinessCode: `${contract.code ?? contract.name}/历史实付/${row.sequenceNo}`,
      sourceVersion: 1,
      status: "confirmed",
      sourceSnapshot: sourceJson({
        formalStatus: "confirmed",
        takeoverId: takeover.id,
        takeoverBatchId: takeover.takeoverBatchId,
        takeoverLevel: takeover.takeoverLevel,
        contractId: takeover.contractId,
        contractVersionId: takeover.contractVersionId,
        paymentTermsVersionId: takeover.paymentTermsVersionId,
        contractCode: contract.code,
        contractName: contract.name,
        counterparty: contract.counterparty,
        paymentId: row.id,
        rowKey: row.rowKey,
        sequenceNo: row.sequenceNo,
        amountCents: row.amountCents.toString(),
        paidAt: row.paidAt.toISOString(),
        payerName: row.payerName,
        payeeName: row.payeeName,
        bankReference: row.bankReference,
        paymentMethod: row.paymentMethod,
        note: row.note,
        confirmedByUserId: takeover.activatedByUserId ?? takeover.confirmedByUserId,
        confirmedAt: takeover.activatedAt.toISOString(),
        approvedPayerType: approvedPayer.type,
        approvedPayerId: approvedPayer.id,
        actualPayerType: actualPayer.type,
        actualPayerId: actualPayer.id,
        actualPayerEvidence:
          actualPayer.id === approvedPayer.id &&
          actualPayer.type === approvedPayer.type
            ? "payer_name_matches_approved_subject_snapshot"
            : "payer_name_matches_project_subject_snapshot",
        payeeVersionId: counterparty.businessPartyVersionId,
        historicalInitialSettlementId: takeover.historicalInitialSettlementId,
        allocationRows: allocations.map((allocation) => ({
          allocationType: allocation.allocationType,
          amountCents: allocation.amountCents.toString(),
          allocationOrder: allocation.allocationOrder,
          sourceId:
            allocation.allocationType === "settlement"
              ? takeover.historicalInitialSettlementId
              : null
        })),
        voucherFileIds: vouchers.map((voucher) => voucher.fileId),
        operatingLedgerEffectiveDate: effectiveDate.toISOString(),
        affiliate
      })
    };
  }
}

interface HistoricalPaymentRow {
  id: string;
  takeoverId: string;
  rowKey: string;
  sequenceNo: number;
  amountCents: bigint;
  paidAt: Date;
  payerName: string | null;
  payeeName: string | null;
  bankReference: string | null;
  paymentMethod: string | null;
  note: string | null;
  status: string;
}

function approvedPayerIdentity(version: {
  signingSubjectType: string;
  companyEntityIdSnapshot: string | null;
  companyEntityVersionId: string | null;
  companyEntityNameSnapshot: string | null;
  affiliateBusinessPartyVersionId: string | null;
  affiliateNameSnapshot: string | null;
}): { type: "affiliate" | "our_company"; id: string; displayName: string } {
  if (version.signingSubjectType === "affiliate") {
    if (!version.affiliateBusinessPartyVersionId || !version.affiliateNameSnapshot?.trim()) {
      throw new BadRequestException("历史接管实付缺少施工企业付款主体快照");
    }
    return {
      type: "affiliate",
      id: version.affiliateBusinessPartyVersionId,
      displayName: version.affiliateNameSnapshot
    };
  }
  const id = version.companyEntityIdSnapshot ?? version.companyEntityVersionId;
  if (
    version.signingSubjectType !== "our_company" ||
    !id ||
    !version.companyEntityNameSnapshot?.trim()
  ) {
    throw new BadRequestException("历史接管实付缺少我方公司付款主体快照");
  }
  return {
    type: "our_company",
    id,
    displayName: version.companyEntityNameSnapshot
  };
}

async function actualPayerIdentity(
  tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],
  projectId: string,
  paidAt: Date,
  payerName: string | null,
  approvedPayer: { type: "affiliate" | "our_company"; id: string; displayName: string }
): Promise<{ type: "affiliate" | "our_company"; id: string; displayName: string }> {
  const normalizedName = payerName?.trim();
  if (!normalizedName) {
    throw new BadRequestException(
      "历史接管实付缺少可验证的实际付款主体，不能进入正式经营账"
    );
  }
  if (normalizedName === approvedPayer.displayName.trim()) return approvedPayer;

  const [affiliate, company] = await Promise.all([
    tx.projectAffiliateAssignment.findFirst({
      where: {
        projectId,
        affiliateNameSnapshot: normalizedName,
        effectiveFrom: { lte: paidAt },
        OR: [{ endedAt: null }, { endedAt: { gt: paidAt } }]
      },
      select: {
        businessPartyVersionId: true,
        affiliateNameSnapshot: true
      },
      orderBy: { effectiveFrom: "desc" }
    }),
    tx.projectParticipatingCompany.findFirst({
      where: {
        projectId,
        companyNameSnapshot: normalizedName,
        effectiveFrom: { lte: paidAt },
        OR: [{ endedAt: null }, { endedAt: { gt: paidAt } }]
      },
      select: { companyEntityId: true, companyNameSnapshot: true },
      orderBy: { effectiveFrom: "desc" }
    })
  ]);
  if (affiliate) {
    return {
      type: "affiliate",
      id: affiliate.businessPartyVersionId,
      displayName: affiliate.affiliateNameSnapshot
    };
  }
  if (company) {
    return {
      type: "our_company",
      id: company.companyEntityId,
      displayName: company.companyNameSnapshot
    };
  }
  throw new BadRequestException(
    "历史接管实付实际付款主体未匹配项目已冻结主体，不能进入正式经营账"
  );
}

async function resolveHistoricalPaymentSourceBusinessId(
  tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],
  row: { takeoverId: string; targetHistoricalPaymentId: string | null; correctionScope: string | null }
): Promise<string | null> {
  if (row.targetHistoricalPaymentId) return row.targetHistoricalPaymentId;
  const rows = await tx.$queryRaw<Array<{ historicalPaymentId: string }>>(
    Prisma.sql`
      SELECT allocation."historicalPaymentId"
      FROM "ContractTakeoverHistoricalPaymentAllocation" allocation
      JOIN "ContractTakeoverHistoricalPayment" payment
        ON payment."id" = allocation."historicalPaymentId"
      WHERE payment."takeoverId" = ${row.takeoverId}
        AND payment."status" = 'activated'
        AND allocation."allocationType" = ${row.correctionScope}
      ORDER BY payment."sequenceNo", allocation."allocationOrder"
      LIMIT 2
    `
  );
  if (rows.length > 1) {
    throw new BadRequestException(
      "历史余额更正必须引用唯一的历史实付来源，不能自动选择首笔付款"
    );
  }
  return rows[0]?.historicalPaymentId ?? null;
}

function payerSubject(type: string, id: string): OperatingSubjectReference {
  if (type === "affiliate") return { kind: "construction_enterprise", id };
  if (type === "our_company") return { kind: "participating_company", id };
  throw new BadRequestException("历史接管实付付款主体类型不正确");
}

function paymentAllocations(source: Record<string, Prisma.InputJsonValue>) {
  const value = source.allocationRows;
  if (!Array.isArray(value)) {
    throw new BadRequestException("历史接管实付快照缺少分配明细");
  }
  return value.map((entry) => {
    const allocation = requiredJsonRecord(entry, "历史接管实付分配");
    const allocationType = requiredJsonText(
      allocation,
      "allocationType",
      "历史接管实付分配"
    );
    const amountCents = requiredJsonMoney(
      allocation,
      "amountCents",
      "历史接管实付分配"
    );
    if (amountCents <= 0n) {
      throw new BadRequestException("历史接管实付分配金额必须大于 0");
    }
    const sourceId = optionalJsonText(allocation, "sourceId");
    if (allocationType === "settlement" && !sourceId) {
      throw new BadRequestException("历史接管结算分配缺少期初结算来源");
    }
    return {
      allocationType,
      amountCents,
      sourceId
    };
  });
}

function requiredJsonTextList(
  source: Record<string, Prisma.InputJsonValue>,
  key: string,
  label: string
): string[] {
  const value = source[key];
  if (!Array.isArray(value)) {
    throw new BadRequestException(`${label}快照缺少${key}`);
  }
  if (value.length === 0) {
    throw new BadRequestException(`${label}快照${key}不能为空`);
  }
  return value.map((entry) => {
    if (typeof entry !== "string" || !entry.trim()) {
      throw new BadRequestException(`${label}快照${key}格式不正确`);
    }
    return entry.trim();
  });
}

function optionalJsonText(
  source: Record<string, Prisma.InputJsonValue>,
  key: string
): string | undefined {
  const value = source[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function sameSubject(
  left: OperatingSubjectReference,
  right: OperatingSubjectReference
): boolean {
  return left.kind === right.kind && left.id === right.id;
}
