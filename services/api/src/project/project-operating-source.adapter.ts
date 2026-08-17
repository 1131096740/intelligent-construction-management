import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import {
  frozenAffiliateFromJson,
  occurredBeforeEffectiveDate,
  optionalJsonText,
  readAffiliateSnapshot,
  readOperatingLedgerEffectiveDate,
  requiredJsonDate,
  requiredJsonMoney,
  requiredJsonRecord,
  requiredJsonText,
  sourceJson,
  stableNamedSubjectId
} from "../operating-ledger/formal-operating-source.helpers";
import type { AppendOperatingFactInput } from "../operating-ledger/operating-ledger.service";
import type {
  OperatingSourceAdapter,
  OperatingSourceFactInput,
  OperatingSourceLocator,
  OperatingSourceSnapshot
} from "../operating-ledger/operating-source-adapter";

export const PROJECT_UPSTREAM_SETTLEMENT_SOURCE_TYPE =
  "project_upstream_settlement";
export const PROJECT_PROXY_PAYMENT_SOURCE_TYPE = "project_proxy_payment";
export const PROJECT_UPSTREAM_FUND_SOURCE_TYPE = "project_upstream_fund_fact";
export const PROJECT_AFFILIATE_CONTRACT_FACT_SOURCE_TYPE =
  "project_affiliate_contract_fact";
export const PROJECT_AFFILIATE_SETTLEMENT_FACT_SOURCE_TYPE =
  "project_affiliate_settlement_fact";
export const PROJECT_AFFILIATE_PAYMENT_FACT_SOURCE_TYPE =
  "project_affiliate_payment_fact";

type ConstructionEnterpriseSourceRow = {
  id: string;
  projectId: string;
  entryKind: string;
  adjustsFactId: string | null;
  effectDirection: string;
  amountCents: bigint;
  counterpartyName: string;
  affiliateAssignmentId: string;
  affiliateBusinessPartyVersionId: string;
  affiliateNameSnapshot: string;
  description: string | null;
  evidenceFileId: string | null;
  documentVersion: number;
  recordedByUserId: string;
  confirmedByUserId: string | null;
  confirmedAt: Date | null;
  occurredAt?: Date;
  factType?: string;
  deductionCategory?: string | null;
  upstreamSettlementId?: string | null;
  companyEntityId?: string | null;
  affiliateCompanyContractId?: string | null;
  affiliateSettlementFactId?: string | null;
  invoiceRecordId?: string | null;
  ledgerId?: string;
  contractLedgerId?: string;
  settlementLedgerId?: string | null;
  paymentRequestId?: string | null;
  paidAt?: Date;
  settledAt?: Date;
  paymentKind?: string;
  externalPaymentReference?: string | null;
  createdAt?: Date;
};

type ConstructionEnterpriseSnapshotRow = Omit<
  ConstructionEnterpriseSourceRow,
  "amountCents"
> & {
  amountCents: bigint | null;
};

function sourceEntryKind(value: string): OperatingSourceFactInput["entryKind"] {
  if (value === "reversal") return "reversal";
  if (value === "original") return "original";
  if (value === "correction" || value === "reclassification") return "correction";
  throw new BadRequestException("经营来源登记类型不正确，请刷新后重试");
}

function sourceDirection(value: string): "increase" | "decrease" {
  if (value === "increase") return "increase";
  if (value === "decrease") return "decrease";
  throw new BadRequestException("经营来源影响方向不正确，请刷新后重试");
}

function absoluteMoney(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function signedSettlementAmount(fact: {
  effectDirection: string;
  amountCents: bigint;
}): bigint {
  return fact.effectDirection === "decrease"
    ? -fact.amountCents
    : fact.amountCents;
}

function sourceCore(
  snapshot: OperatingSourceSnapshot,
  source: Record<string, Prisma.InputJsonValue>,
  affiliate: ReturnType<typeof frozenAffiliateFromJson>,
  input: Pick<AppendOperatingFactInput, "factKind" | "operatingLevel" | "direction" | "amountCents" | "subjects" | "impacts" | "basisSnapshot">,
  label: string
): AppendOperatingFactInput {
  const occurredAt = requiredJsonDate(source, "occurredAt", label);
  const confirmedAt = requiredJsonDate(source, "confirmedAt", label);
  const effectiveDate = requiredJsonDate(
    source,
    "operatingLedgerEffectiveDate",
    label
  );
  return {
    projectId: snapshot.projectId,
    sourceType: snapshot.sourceType,
    sourceBusinessId: snapshot.sourceBusinessId,
    sourceBusinessCode: snapshot.sourceBusinessCode,
    sourceVersion: snapshot.sourceVersion,
    idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}`,
    occurredAt,
    confirmedAt,
    confirmedByUserId: requiredJsonText(source, "confirmedByUserId", label),
    factKind: input.factKind,
    operatingLevel: input.operatingLevel,
    evidenceLevel: "A",
    amountCents: input.amountCents,
    currencyCode: "CNY",
    direction: input.direction,
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
    sourceSnapshot: snapshot.sourceSnapshot,
    ...(input.basisSnapshot ? { basisSnapshot: input.basisSnapshot } : {}),
    subjects: input.subjects,
    impacts: input.impacts,
    ...(sourceEntryKind(requiredJsonText(source, "entryKind", label)) !== "original"
      ? { adjustsFactId: requiredJsonText(source, "adjustsFactId", label) }
      : {})
  };
}

function sourceSnapshot(
  row: ConstructionEnterpriseSnapshotRow,
  sourceType: string,
  sourceBusinessCode: string,
  effectiveDate: Date,
  affiliate: ReturnType<typeof frozenAffiliateFromJson>,
  extra: Record<string, unknown>
): OperatingSourceSnapshot {
  const occurredAt = row.occurredAt ?? row.settledAt ?? row.paidAt;
  if (!occurredAt) throw new BadRequestException("正式来源缺少业务发生时间");
  return {
    projectId: row.projectId,
    sourceType,
    sourceBusinessId: row.id,
    sourceBusinessCode,
    sourceVersion: row.documentVersion,
    status: "confirmed",
    sourceSnapshot: sourceJson({
      formalStatus: "confirmed",
      entryKind: row.entryKind,
      adjustsFactId: row.adjustsFactId,
      effectDirection: row.effectDirection,
      amountCents: row.amountCents?.toString() ?? null,
      counterpartyName: row.counterpartyName,
      description: row.description,
      evidenceFileId: row.evidenceFileId,
      recordedByUserId: row.recordedByUserId,
      confirmedByUserId: row.confirmedByUserId,
      confirmedAt: row.confirmedAt?.toISOString(),
      ...(row.createdAt ? { recordedAt: row.createdAt.toISOString() } : {}),
      occurredAt: occurredAt.toISOString(),
      operatingLedgerEffectiveDate: effectiveDate.toISOString(),
      affiliate,
      ...extra
    })
  };
}

export class ProjectUpstreamFundFactOperatingSourceAdapter
  implements OperatingSourceAdapter
{
  readonly sourceType = PROJECT_UPSTREAM_FUND_SOURCE_TYPE;

  async readProjectSnapshots(
    tx: Parameters<OperatingSourceAdapter["readProjectSnapshots"]>[0],
    projectId: string
  ): Promise<readonly OperatingSourceSnapshot[]> {
    const rows = await tx.projectUpstreamFundFact.findMany({
      where: {
        projectId,
        status: "confirmed",
        confirmedByUserId: { not: null },
        confirmedAt: { not: null }
      },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }]
    });
    return Promise.all(rows.map((row) => this.snapshot(tx, row)));
  }

  async readSourceSnapshot(
    tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],
    locator: OperatingSourceLocator
  ): Promise<OperatingSourceSnapshot | null> {
    const row = await tx.projectUpstreamFundFact.findFirst({
      where: {
        id: locator.sourceBusinessId,
        projectId: locator.projectId,
        status: "confirmed",
        confirmedByUserId: { not: null },
        confirmedAt: { not: null }
      }
    });
    return row ? this.snapshot(tx, row) : null;
  }

  toOperatingFactInput(snapshot: OperatingSourceSnapshot): OperatingSourceFactInput {
    const source = requiredJsonRecord(snapshot.sourceSnapshot, "上游资金正式来源");
    const affiliate = frozenAffiliateFromJson(source, "上游资金");
    const amountCents = absoluteMoney(requiredJsonMoney(source, "amountCents", "上游资金"));
    if (amountCents <= 0n) throw new BadRequestException("上游资金正式金额必须大于 0");
    const entryKind = sourceEntryKind(requiredJsonText(source, "entryKind", "上游资金"));
    const effectDirection = sourceDirection(requiredJsonText(source, "effectDirection", "上游资金"));
    const enterprise = {
      kind: "construction_enterprise" as const,
      id: affiliate.businessPartyVersionId
    };
    const factType = requiredJsonText(source, "factType", "上游资金");
    const counterparty = requiredJsonText(source, "counterpartyName", "上游资金");
    const impacts: AppendOperatingFactInput["impacts"] = [];
    let factKind: AppendOperatingFactInput["factKind"];
    let operatingLevel: AppendOperatingFactInput["operatingLevel"];
    let direction: AppendOperatingFactInput["direction"];
    let subjects: AppendOperatingFactInput["subjects"];
    let remittancePayableAmountCents: bigint | null = null;
    if (factType === "owner_payment_to_affiliate") {
      factKind = "owner_payment";
      operatingLevel = "project";
      direction = "inflow";
      const creditor = enterprise;
      subjects = {
        actualPayer: { kind: "owner", id: stableNamedSubjectId("owner", counterparty) },
        payee: creditor
      };
      impacts.push({
        idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}:funds`,
        sourceImpactKey: "construction_enterprise_funds_increase",
        impactKind: "construction_enterprise_funds_increase",
        amountCents,
        direction: effectDirection,
        subjectRole: "creditor",
        subject: creditor,
        description: "业主实际付款增加施工企业项目资金"
      });
      if (optionalJsonText(source, "upstreamSettlementId")) {
        impacts.push({
          idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}:receivable`,
          sourceImpactKey: "receivable_decrease",
          impactKind: "receivable_decrease",
          amountCents,
          direction: effectDirection,
          subjectRole: "creditor",
          subject: creditor,
          description: "业主实际付款冲减施工企业应收"
        });
      }
    } else if (factType === "affiliate_remittance_to_company") {
      factKind = "fund_movement";
      operatingLevel = "participating_company";
      direction = "outflow";
      const company = {
        kind: "participating_company" as const,
        id:
          optionalJsonText(source, "companyEntityId") ??
          stableNamedSubjectId("participating_company", counterparty)
      };
      const payableAmountCents = requiredJsonMoney(
        source,
        "payableAmountCents",
        "施工企业向我方公司拨款"
      );
      if (payableAmountCents <= 0n) {
        throw new BadRequestException("施工企业向我方公司拨款的应付金额必须大于 0");
      }
      remittancePayableAmountCents = payableAmountCents;
      subjects = { actualPayer: enterprise, payee: company };
      impacts.push(
        {
          idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}:enterprise-funds`,
          sourceImpactKey: "construction_enterprise_funds_decrease",
          impactKind: "construction_enterprise_funds_decrease",
          amountCents,
          direction: effectDirection === "increase" ? "decrease" : "increase",
          subjectRole: "debtor",
          subject: enterprise,
          description: "施工企业向我方公司实际拨款减少施工企业项目资金"
        },
        {
          idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}:company-funds`,
          sourceImpactKey: "company_project_funds_increase",
          impactKind: "company_project_funds_increase",
          amountCents,
          direction: effectDirection,
          subjectRole: "creditor",
          subject: company,
          description: "施工企业向我方公司实际拨款增加公司项目资金"
        }
      );
    } else if (factType === "affiliate_deduction") {
      factKind = "construction_enterprise_deduction";
      operatingLevel = "construction_enterprise";
      direction = "outflow";
      subjects = { costBearingCompany: enterprise };
      impacts.push(
        {
          idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}:funds`,
          sourceImpactKey: "construction_enterprise_funds_decrease",
          impactKind: "construction_enterprise_funds_decrease",
          amountCents,
          direction: effectDirection === "increase" ? "decrease" : "increase",
          subjectRole: "debtor",
          subject: enterprise,
          description: "施工企业最终扣费减少施工企业项目资金"
        }
      );
    } else {
      throw new BadRequestException("待核对到账差额不能进入正式经营账");
    }
    const input = sourceCore(
      snapshot,
      source,
      affiliate,
      {
        factKind,
        operatingLevel,
        direction,
        amountCents,
        subjects,
        impacts,
        basisSnapshot: sourceJson({
          authority: "confirmed_project_upstream_fund_fact",
          factType,
          deductionCategory: optionalJsonText(source, "deductionCategory"),
          ...(factType === "affiliate_remittance_to_company"
            ? {
                affiliateCompanyContractId: requiredJsonText(
                  source,
                  "affiliateCompanyContractId",
                  "施工企业向我方公司拨款"
                ),
                affiliateSettlementFactId: requiredJsonText(
                  source,
                  "affiliateSettlementFactId",
                  "施工企业向我方公司拨款"
                ),
                invoiceRecordId: requiredJsonText(
                  source,
                  "invoiceRecordId",
                  "施工企业向我方公司拨款"
                ),
                payableAmountCents: remittancePayableAmountCents!.toString(),
                actualPaymentAmountCents: amountCents.toString(),
                companyUnpaidAmountCents: (
                  remittancePayableAmountCents! - amountCents
                ).toString(),
                companyDifferenceAmountCents: (
                  amountCents - remittancePayableAmountCents!
                ).toString()
              }
            : {})
        })
      },
      "上游资金"
    );
    return { entryKind, input };
  }

  private async snapshot(
    tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],
    row: ConstructionEnterpriseSourceRow
  ): Promise<OperatingSourceSnapshot> {
    if (!row.confirmedByUserId || !row.confirmedAt) {
      throw new BadRequestException("上游资金缺少正式确认人或确认时间");
    }
    if (!row.occurredAt) {
      throw new BadRequestException("上游资金缺少业务发生时间");
    }
    const [effectiveDate, affiliate, remittanceSettlement, frozenRemittanceFact] =
      await Promise.all([
        readOperatingLedgerEffectiveDate(tx, row.projectId),
        readAffiliateSnapshot(tx, {
          projectId: row.projectId,
          occurredAt: row.occurredAt,
          assignmentId: row.affiliateAssignmentId,
          businessPartyVersionId: row.affiliateBusinessPartyVersionId
        }),
        row.factType === "affiliate_remittance_to_company" &&
          row.affiliateSettlementFactId
          ? tx.projectAffiliateSettlementFact.findFirst({
              where: {
                id: row.affiliateSettlementFactId,
                projectId: row.projectId,
                status: "confirmed"
              },
              select: { ledgerId: true }
            })
          : Promise.resolve(null),
        row.factType === "affiliate_remittance_to_company"
          ? tx.operatingFact.findUnique({
              where: {
                sourceType_sourceBusinessId: {
                  sourceType: this.sourceType,
                  sourceBusinessId: row.id
                }
              },
              select: { sourceSnapshot: true }
            })
          : Promise.resolve(null)
      ]);
    const frozenRemittancePayableAmountCents = frozenRemittanceFact
      ? requiredJsonMoney(
          requiredJsonRecord(
            frozenRemittanceFact.sourceSnapshot as Prisma.InputJsonValue,
            "施工企业向我方公司拨款"
          ),
          "payableAmountCents",
          "施工企业向我方公司拨款"
        )
      : null;
    const remittanceSettlementFacts =
      remittanceSettlement && frozenRemittancePayableAmountCents === null
        ? await tx.projectAffiliateSettlementFact.findMany({
            where: {
              projectId: row.projectId,
              ledgerId: remittanceSettlement.ledgerId,
              status: "confirmed"
            },
            select: { effectDirection: true, amountCents: true }
          })
        : [];
    const remittancePayableAmountCents =
      frozenRemittancePayableAmountCents ??
      remittanceSettlementFacts.reduce(
        (total, fact) => total + signedSettlementAmount(fact),
        0n
      );
    if (
      row.factType === "affiliate_remittance_to_company" &&
      (!row.affiliateCompanyContractId ||
        !row.affiliateSettlementFactId ||
        !row.invoiceRecordId ||
        !remittanceSettlement ||
        remittancePayableAmountCents <= 0n)
    ) {
      throw new BadRequestException("施工企业向我方公司拨款缺少完整业务链路");
    }
    const companyEntityId =
      row.factType === "affiliate_remittance_to_company"
        ? await resolveHistoricalCompanyEntityId(tx, row)
        : row.companyEntityId;
    return sourceSnapshot(
      row,
      this.sourceType,
      `上游资金/${row.id}`,
      effectiveDate,
      affiliate,
      {
        factType: row.factType,
        deductionCategory: row.deductionCategory,
        upstreamSettlementId: row.upstreamSettlementId,
        companyEntityId,
        affiliateCompanyContractId: row.affiliateCompanyContractId,
        affiliateSettlementFactId: row.affiliateSettlementFactId,
        invoiceRecordId: row.invoiceRecordId,
        ...(remittanceSettlement
          ? { payableAmountCents: remittancePayableAmountCents.toString() }
          : {})
      }
    );
  }
}

async function resolveHistoricalCompanyEntityId(
  tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],
  row: ConstructionEnterpriseSourceRow
): Promise<string> {
  if (row.companyEntityId) return row.companyEntityId;
  const occurredAt = row.occurredAt;
  if (!occurredAt) throw new BadRequestException("施工企业拨款缺少业务发生时间");
  const participants = await tx.projectParticipatingCompany.findMany({
    where: {
      projectId: row.projectId,
      companyNameSnapshot: row.counterpartyName,
      effectiveFrom: { lte: occurredAt },
      OR: [{ endedAt: null }, { endedAt: { gt: occurredAt } }]
    },
    select: { companyEntityId: true }
  });
  if (participants.length !== 1) {
    throw new BadRequestException(
      "历史施工企业拨款缺少可核验的我方参与公司映射，不能虚构公司主体"
    );
  }
  return participants[0]!.companyEntityId;
}

export class ProjectAffiliateContractFactOperatingSourceAdapter
  implements OperatingSourceAdapter
{
  readonly sourceType = PROJECT_AFFILIATE_CONTRACT_FACT_SOURCE_TYPE;

  async readProjectSnapshots(
    tx: Parameters<OperatingSourceAdapter["readProjectSnapshots"]>[0],
    projectId: string
  ): Promise<readonly OperatingSourceSnapshot[]> {
    const rows = await tx.projectAffiliateContractFact.findMany({
      where: {
        projectId,
        status: "confirmed",
        confirmedByUserId: { not: null },
        confirmedAt: { not: null }
      },
      orderBy: [{ signedAt: "asc" }, { id: "asc" }]
    });
    return Promise.all(rows.map((row) => this.snapshot(tx, row)));
  }

  async readSourceSnapshot(
    tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],
    locator: OperatingSourceLocator
  ): Promise<OperatingSourceSnapshot | null> {
    const row = await tx.projectAffiliateContractFact.findFirst({
      where: {
        id: locator.sourceBusinessId,
        projectId: locator.projectId,
        status: "confirmed",
        confirmedByUserId: { not: null },
        confirmedAt: { not: null }
      }
    });
    return row ? this.snapshot(tx, row) : null;
  }

  toOperatingFactInput(snapshot: OperatingSourceSnapshot): OperatingSourceFactInput {
    const source = requiredJsonRecord(snapshot.sourceSnapshot, "施工企业合同正式来源");
    const affiliate = frozenAffiliateFromJson(source, "施工企业合同");
    const amountCents = optionalJsonText(source, "amountCents")
      ? BigInt(requiredJsonText(source, "amountCents", "施工企业合同"))
      : 0n;
    if (amountCents < 0n) {
      throw new BadRequestException("施工企业合同金额不能为负数");
    }
    const creditor = {
      kind: "downstream_counterparty" as const,
      id: stableNamedSubjectId(
        "downstream",
        requiredJsonText(source, "counterpartyName", "施工企业合同")
      )
    };
    const debtor = {
      kind: "construction_enterprise" as const,
      id: affiliate.businessPartyVersionId
    };
    const input = sourceCore(
      snapshot,
      source,
      affiliate,
      {
        factKind: "downstream_contract",
        operatingLevel: "project",
        direction: "neutral",
        amountCents,
        subjects: { debtor, creditor },
        impacts: [
          {
            idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}:commitment`,
            sourceImpactKey: "contract_commitment_reference",
            impactKind: "contract_commitment_reference",
            amountCents: 0n,
            direction: "notice",
            subjectRole: "creditor",
            subject: creditor,
            description: "施工企业下游合同正式承诺引用，不直接形成成本或结算应付"
          }
        ],
        basisSnapshot: sourceJson({
          authority: "confirmed_project_affiliate_contract_fact",
          contractType: requiredJsonText(source, "contractType", "施工企业合同"),
          externalContractReference: requiredJsonText(
            source,
            "externalContractReference",
            "施工企业合同"
          ),
          amountNature: requiredJsonText(source, "amountNature", "施工企业合同"),
          advanceAllowed: source.advanceAllowed === true,
          advanceLimitCents: optionalJsonText(source, "advanceLimitCents")
        })
      },
      "施工企业合同"
    );
    return { entryKind: sourceEntryKind(requiredJsonText(source, "entryKind", "施工企业合同")), input };
  }

  private async snapshot(
    tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],
    row: ConstructionEnterpriseSnapshotRow & {
      contractType: string;
      externalContractReference: string;
      signedAt: Date;
      amountNature: string;
      amountCents: bigint | null;
      advanceAllowed: boolean;
      advanceLimitCents: bigint | null;
      advanceTermsSummary: string | null;
    }
  ): Promise<OperatingSourceSnapshot> {
    if (!row.confirmedByUserId || !row.confirmedAt) {
      throw new BadRequestException("施工企业合同缺少正式确认人或确认时间");
    }
    const [effectiveDate, affiliate] = await Promise.all([
      readOperatingLedgerEffectiveDate(tx, row.projectId),
      readAffiliateSnapshot(tx, {
        projectId: row.projectId,
        occurredAt: row.signedAt,
        assignmentId: row.affiliateAssignmentId,
        businessPartyVersionId: row.affiliateBusinessPartyVersionId
      })
    ]);
    return sourceSnapshot(
      { ...row, occurredAt: row.signedAt },
      this.sourceType,
      `施工企业合同/${row.ledgerId ?? row.id}`,
      effectiveDate,
      affiliate,
      {
        signedAt: row.signedAt.toISOString(),
        contractType: row.contractType,
        externalContractReference: row.externalContractReference,
        amountNature: row.amountNature,
        amountCents: row.amountCents?.toString() ?? null,
        advanceAllowed: row.advanceAllowed,
        advanceLimitCents: row.advanceLimitCents?.toString() ?? null,
        advanceTermsSummary: row.advanceTermsSummary
      }
    );
  }
}

export class ProjectAffiliateSettlementFactOperatingSourceAdapter
  implements OperatingSourceAdapter
{
  readonly sourceType = PROJECT_AFFILIATE_SETTLEMENT_FACT_SOURCE_TYPE;

  async readProjectSnapshots(
    tx: Parameters<OperatingSourceAdapter["readProjectSnapshots"]>[0],
    projectId: string
  ): Promise<readonly OperatingSourceSnapshot[]> {
    const rows = await tx.projectAffiliateSettlementFact.findMany({
      where: {
        projectId,
        status: "confirmed",
        confirmedByUserId: { not: null },
        confirmedAt: { not: null }
      },
      orderBy: [{ settledAt: "asc" }, { id: "asc" }]
    });
    return Promise.all(rows.map((row) => this.snapshot(tx, row)));
  }

  async readSourceSnapshot(
    tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],
    locator: OperatingSourceLocator
  ): Promise<OperatingSourceSnapshot | null> {
    const row = await tx.projectAffiliateSettlementFact.findFirst({
      where: {
        id: locator.sourceBusinessId,
        projectId: locator.projectId,
        status: "confirmed",
        confirmedByUserId: { not: null },
        confirmedAt: { not: null }
      }
    });
    return row ? this.snapshot(tx, row) : null;
  }

  toOperatingFactInput(snapshot: OperatingSourceSnapshot): OperatingSourceFactInput {
    const source = requiredJsonRecord(snapshot.sourceSnapshot, "施工企业结算正式来源");
    const affiliate = frozenAffiliateFromJson(source, "施工企业结算");
    const amountCents = absoluteMoney(requiredJsonMoney(source, "amountCents", "施工企业结算"));
    if (amountCents <= 0n) throw new BadRequestException("施工企业结算正式金额必须大于 0");
    const entryKind = sourceEntryKind(requiredJsonText(source, "entryKind", "施工企业结算"));
    const effectDirection = sourceDirection(requiredJsonText(source, "effectDirection", "施工企业结算"));
    const affiliateCompanyContractId = optionalJsonText(
      source,
      "affiliateCompanyContractId"
    );
    const debtor = { kind: "construction_enterprise" as const, id: affiliate.businessPartyVersionId };
    const creditor = affiliateCompanyContractId
      ? {
          kind: "participating_company" as const,
          id: requiredJsonText(source, "companyEntityId", "施工企业—我方结算")
        }
      : {
          kind: "downstream_counterparty" as const,
          id: stableNamedSubjectId(
            "downstream",
            requiredJsonText(source, "counterpartyName", "施工企业结算")
          )
        };
    const impacts: AppendOperatingFactInput["impacts"] = affiliateCompanyContractId
      ? [
          {
            idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}:internal-settlement-reference`,
            sourceImpactKey: "contract_commitment_reference",
            impactKind: "contract_commitment_reference",
            amountCents: 0n,
            direction: "notice",
            subjectRole: "creditor",
            subject: creditor,
            description: "施工企业与我方公司的内部结算仅保留业务链路，不形成项目成本或应付"
          }
        ]
      : [
          {
            idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}:cost`,
            sourceImpactKey: "confirmed_cost",
            impactKind: "confirmed_cost",
            amountCents,
            direction: effectDirection,
            subjectRole: "debtor",
            subject: debtor,
            costCategoryCode: settlementCostCategory(
              requiredJsonText(source, "contractType", "施工企业结算")
            ),
            description: "施工企业下游结算确认项目成本"
          },
          {
            idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}:payable`,
            sourceImpactKey: "payable_increase",
            impactKind: "payable_increase",
            amountCents,
            direction: effectDirection,
            subjectRole: "creditor",
            subject: creditor,
            description: "施工企业下游结算形成下游应付"
          }
        ];
    const input = sourceCore(
      snapshot,
      source,
      affiliate,
      {
        factKind: "downstream_settlement",
        operatingLevel: "project",
        direction: "neutral",
        amountCents,
        subjects: { debtor, creditor },
        impacts,
        basisSnapshot: sourceJson({
          authority: "confirmed_project_affiliate_settlement_fact",
          ...(affiliateCompanyContractId
            ? {
                affiliateCompanyContractId,
                companyEntityId: requiredJsonText(
                  source,
                  "companyEntityId",
                  "施工企业—我方结算"
                )
              }
            : {})
        })
      },
      "施工企业结算"
    );
    return { entryKind, input };
  }

  private async snapshot(
    tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],
    row: ConstructionEnterpriseSourceRow & { settledAt: Date }
  ): Promise<OperatingSourceSnapshot> {
    if (!row.confirmedByUserId || !row.confirmedAt) {
      throw new BadRequestException("施工企业结算缺少正式确认人或确认时间");
    }
    const contract = await tx.projectAffiliateContractFact.findFirst({
      where: {
        projectId: row.projectId,
        ledgerId: row.contractLedgerId,
        status: "confirmed"
      },
      select: { contractType: true }
    });
    if (!contract) throw new BadRequestException("施工企业结算缺少已确认的下游合同");
    const [effectiveDate, affiliate, companyContract] = await Promise.all([
      readOperatingLedgerEffectiveDate(tx, row.projectId),
      readAffiliateSnapshot(tx, {
        projectId: row.projectId,
        occurredAt: row.settledAt,
        assignmentId: row.affiliateAssignmentId,
        businessPartyVersionId: row.affiliateBusinessPartyVersionId
      }),
      row.affiliateCompanyContractId
        ? tx.projectAffiliateCompanyContract.findFirst({
            where: {
              id: row.affiliateCompanyContractId,
              projectId: row.projectId,
              status: "confirmed"
            },
            select: { companyEntityId: true }
          })
        : Promise.resolve(null)
    ]);
    if (row.affiliateCompanyContractId && !companyContract) {
      throw new BadRequestException("施工企业—我方结算缺少已确认的内部合同链路");
    }
    return sourceSnapshot(
      { ...row, occurredAt: row.settledAt, factType: undefined },
      this.sourceType,
      `施工企业结算/${row.ledgerId ?? row.id}`,
      effectiveDate,
      affiliate,
      {
        contractLedgerId: row.contractLedgerId,
        contractType: contract.contractType,
        settledAt: row.settledAt.toISOString(),
        affiliateCompanyContractId: row.affiliateCompanyContractId,
        companyEntityId: companyContract?.companyEntityId
      }
    );
  }
}

export class ProjectAffiliatePaymentFactOperatingSourceAdapter
  implements OperatingSourceAdapter
{
  readonly sourceType = PROJECT_AFFILIATE_PAYMENT_FACT_SOURCE_TYPE;

  async readProjectSnapshots(
    tx: Parameters<OperatingSourceAdapter["readProjectSnapshots"]>[0],
    projectId: string
  ): Promise<readonly OperatingSourceSnapshot[]> {
    const rows = await tx.projectAffiliatePaymentFact.findMany({
      where: {
        projectId,
        status: "confirmed",
        confirmedByUserId: { not: null },
        confirmedAt: { not: null }
      },
      orderBy: [{ paidAt: "asc" }, { id: "asc" }]
    });
    return Promise.all(rows.map((row) => this.snapshot(tx, row)));
  }

  async readSourceSnapshot(
    tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],
    locator: OperatingSourceLocator
  ): Promise<OperatingSourceSnapshot | null> {
    const row = await tx.projectAffiliatePaymentFact.findFirst({
      where: {
        id: locator.sourceBusinessId,
        projectId: locator.projectId,
        status: "confirmed",
        confirmedByUserId: { not: null },
        confirmedAt: { not: null }
      }
    });
    return row ? this.snapshot(tx, row) : null;
  }

  toOperatingFactInput(snapshot: OperatingSourceSnapshot): OperatingSourceFactInput {
    const source = requiredJsonRecord(snapshot.sourceSnapshot, "施工企业付款正式来源");
    const affiliate = frozenAffiliateFromJson(source, "施工企业付款");
    const amountCents = absoluteMoney(requiredJsonMoney(source, "amountCents", "施工企业付款"));
    if (amountCents <= 0n) throw new BadRequestException("施工企业付款正式金额必须大于 0");
    const entryKind = sourceEntryKind(requiredJsonText(source, "entryKind", "施工企业付款"));
    const effectDirection = sourceDirection(requiredJsonText(source, "effectDirection", "施工企业付款"));
    const actualPayer = { kind: "construction_enterprise" as const, id: affiliate.businessPartyVersionId };
    const payee = {
      kind: "downstream_counterparty" as const,
      id: stableNamedSubjectId("downstream", requiredJsonText(source, "counterpartyName", "施工企业付款"))
    };
    const impacts: AppendOperatingFactInput["impacts"] = [];
    const payableSourceId =
      optionalJsonText(source, "settlementLedgerId") ??
      optionalJsonText(source, "contractLedgerId");
    if (!payableSourceId) {
      throw new BadRequestException("施工企业付款缺少合同或结算应付来源");
    }
    impacts.push({
      idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}:payable`,
      sourceImpactKey: `payable_decrease:${payableSourceId}`,
      impactKind: "payable_decrease",
      amountCents,
      direction: effectDirection === "increase" ? "decrease" : "increase",
      subjectRole: "payee",
      subject: payee,
      description: optionalJsonText(source, "settlementLedgerId")
        ? "施工企业实际付款清偿下游结算应付"
        : "施工企业实际付款清偿合同付款义务"
    });
    impacts.push({
      idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}:funds`,
      sourceImpactKey: "construction_enterprise_funds_decrease",
      impactKind: "construction_enterprise_funds_decrease",
      amountCents,
      direction: effectDirection === "increase" ? "decrease" : "increase",
      subjectRole: "actual_payer",
      subject: actualPayer,
      description: "施工企业实际付款减少施工企业项目资金"
    });
    const input = sourceCore(
      snapshot,
      source,
      affiliate,
      {
        factKind: "downstream_payment",
        operatingLevel: "construction_enterprise",
        direction: "outflow",
        amountCents,
        subjects: {
          approvedPayer: actualPayer,
          actualPayer,
          payee
        },
        impacts,
        basisSnapshot: sourceJson({
          authority: "confirmed_project_affiliate_payment_fact",
          paymentRequestId: optionalJsonText(source, "paymentRequestId")
        })
      },
      "施工企业付款"
    );
    return { entryKind, input };
  }

  private async snapshot(
    tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],
    row: ConstructionEnterpriseSourceRow
  ): Promise<OperatingSourceSnapshot> {
    if (!row.confirmedByUserId || !row.confirmedAt || !row.paidAt) {
      throw new BadRequestException("施工企业付款缺少正式确认人、确认时间或付款日期");
    }
    const [effectiveDate, affiliate] = await Promise.all([
      readOperatingLedgerEffectiveDate(tx, row.projectId),
      readAffiliateSnapshot(tx, {
        projectId: row.projectId,
        occurredAt: row.paidAt,
        assignmentId: row.affiliateAssignmentId,
        businessPartyVersionId: row.affiliateBusinessPartyVersionId
      })
    ]);
    return sourceSnapshot(
      { ...row, occurredAt: row.paidAt },
      this.sourceType,
      `施工企业付款/${row.ledgerId ?? row.id}`,
      effectiveDate,
      affiliate,
      {
        contractLedgerId: row.contractLedgerId,
        settlementLedgerId: row.settlementLedgerId,
        paymentRequestId: row.paymentRequestId,
        paidAt: row.paidAt.toISOString(),
        paymentKind: row.paymentKind,
        externalPaymentReference: row.externalPaymentReference
      }
    );
  }
}

function settlementCostCategory(contractType: string): "material" | "crew_and_labor" | "professional_subcontract" | "machinery_and_rental" | "other_project_cost" {
  if (contractType === "material_purchase") return "material";
  if (contractType === "equipment_rental") return "machinery_and_rental";
  if (contractType === "labor_subcontract") return "crew_and_labor";
  if (contractType === "professional_subcontract") return "professional_subcontract";
  return "other_project_cost";
}

export class ProjectUpstreamSettlementOperatingSourceAdapter
  implements OperatingSourceAdapter
{
  readonly sourceType = PROJECT_UPSTREAM_SETTLEMENT_SOURCE_TYPE;

  async readProjectSnapshots(
    tx: Parameters<OperatingSourceAdapter["readProjectSnapshots"]>[0],
    projectId: string
  ): Promise<readonly OperatingSourceSnapshot[]> {
    const rows = await tx.projectUpstreamSettlement.findMany({
      where: {
        projectId,
        status: "confirmed",
        confirmedByUserId: { not: null },
        confirmedAt: { not: null },
        voidedAt: null
      },
      orderBy: [{ settledAt: "asc" }, { id: "asc" }]
    });
    return Promise.all(rows.map((row) => this.snapshot(tx, row)));
  }

  async readSourceSnapshot(
    tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],
    locator: OperatingSourceLocator
  ): Promise<OperatingSourceSnapshot | null> {
    const row = await tx.projectUpstreamSettlement.findFirst({
      where: {
        id: locator.sourceBusinessId,
        projectId: locator.projectId,
        status: "confirmed",
        confirmedByUserId: { not: null },
        confirmedAt: { not: null },
        voidedAt: null
      }
    });
    return row ? this.snapshot(tx, row) : null;
  }

  toOperatingFactInput(snapshot: OperatingSourceSnapshot): OperatingSourceFactInput {
    const source = requiredJsonRecord(
      snapshot.sourceSnapshot,
      "业主结算正式来源"
    );
    const affiliate = frozenAffiliateFromJson(source, "业主结算");
    const ownerName = requiredJsonText(source, "approvingPartyName", "业主结算");
    const occurredAt = requiredJsonDate(source, "settledAt", "业主结算");
    const confirmedAt = requiredJsonDate(source, "confirmedAt", "业主结算");
    const effectiveDate = requiredJsonDate(
      source,
      "operatingLedgerEffectiveDate",
      "业主结算"
    );
    const amountCents = requiredJsonMoney(
      source,
      "approvedAmountCents",
      "业主结算"
    );
    if (amountCents <= 0n) {
      throw new BadRequestException("业主结算正式金额必须大于 0");
    }
    const creditor = {
      kind: "construction_enterprise" as const,
      id: affiliate.businessPartyVersionId
    };
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
        "业主结算"
      ),
      factKind: "owner_settlement",
      operatingLevel: "project",
      evidenceLevel: "A",
      amountCents,
      currencyCode: "CNY",
      direction: "inflow",
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
      sourceSnapshot: snapshot.sourceSnapshot,
      basisSnapshot: sourceJson({
        authority: "confirmed_project_upstream_settlement",
        voucherFileId: requiredJsonText(source, "voucherFileId", "业主结算")
      }),
      subjects: {
        debtor: {
          kind: "owner",
          id: stableNamedSubjectId("owner", ownerName)
        },
        creditor
      },
        impacts: [
        {
          idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}:confirmed_income`,
          sourceImpactKey: "confirmed_income",
          impactKind: "confirmed_income",
          amountCents,
          direction: "increase",
          subjectRole: "creditor",
          subject: creditor,
          description: "生效业主结算确认项目收入"
        },
        {
          idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}:receivable_increase`,
          sourceImpactKey: "receivable_increase",
          impactKind: "receivable_increase",
          amountCents,
          direction: "increase",
          subjectRole: "creditor",
          subject: creditor,
          description: "生效业主结算增加项目应收"
        }
        ]
      }
    };
  }

  private async snapshot(
    tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],
    row: {
      id: string;
      projectId: string;
      settledAt: Date;
      approvedAmountCents: bigint;
      approvingPartyName: string;
      periodLabel: string;
      isFinal: boolean;
      affiliateAssignmentId: string | null;
      affiliateBusinessPartyVersionId: string | null;
      description: string | null;
      voucherFileId: string;
      documentVersion: number;
      confirmedByUserId: string | null;
      confirmedAt: Date | null;
    }
  ): Promise<OperatingSourceSnapshot> {
    if (!row.confirmedByUserId || !row.confirmedAt) {
      throw new BadRequestException("业主结算缺少正式确认人或确认时间");
    }
    const [effectiveDate, affiliate] = await Promise.all([
      readOperatingLedgerEffectiveDate(tx, row.projectId),
      readAffiliateSnapshot(tx, {
        projectId: row.projectId,
        occurredAt: row.settledAt,
        assignmentId: row.affiliateAssignmentId,
        businessPartyVersionId: row.affiliateBusinessPartyVersionId
      })
    ]);
    return {
      projectId: row.projectId,
      sourceType: this.sourceType,
      sourceBusinessId: row.id,
      sourceBusinessCode: `业主结算/${row.periodLabel}/${row.id}`,
      sourceVersion: row.documentVersion,
      status: "confirmed",
      sourceSnapshot: sourceJson({
        formalStatus: "confirmed",
        settledAt: row.settledAt.toISOString(),
        approvedAmountCents: row.approvedAmountCents.toString(),
        approvingPartyName: row.approvingPartyName,
        periodLabel: row.periodLabel,
        isFinal: row.isFinal,
        description: row.description,
        voucherFileId: row.voucherFileId,
        confirmedByUserId: row.confirmedByUserId,
        confirmedAt: row.confirmedAt.toISOString(),
        operatingLedgerEffectiveDate: effectiveDate.toISOString(),
        affiliate
      })
    };
  }
}

export class ProjectProxyPaymentOperatingSourceAdapter
  implements OperatingSourceAdapter
{
  readonly sourceType = PROJECT_PROXY_PAYMENT_SOURCE_TYPE;

  async readProjectSnapshots(
    tx: Parameters<OperatingSourceAdapter["readProjectSnapshots"]>[0],
    projectId: string
  ): Promise<readonly OperatingSourceSnapshot[]> {
    const rows = await tx.projectProxyPayment.findMany({
      where: { projectId, voidedAt: null },
      orderBy: [{ paidAt: "asc" }, { id: "asc" }]
    });
    return Promise.all(rows.map((row) => this.snapshot(tx, row)));
  }

  async readSourceSnapshot(
    tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],
    locator: OperatingSourceLocator
  ): Promise<OperatingSourceSnapshot | null> {
    const row = await tx.projectProxyPayment.findFirst({
      where: {
        id: locator.sourceBusinessId,
        projectId: locator.projectId,
        voidedAt: null
      }
    });
    return row ? this.snapshot(tx, row) : null;
  }

  toOperatingFactInput(snapshot: OperatingSourceSnapshot): OperatingSourceFactInput {
    const source = requiredJsonRecord(
      snapshot.sourceSnapshot,
      "施工企业付款正式来源"
    );
    const affiliate = frozenAffiliateFromJson(source, "施工企业付款");
    const occurredAt = requiredJsonDate(source, "paidAt", "施工企业付款");
    const confirmedAt = requiredJsonDate(source, "confirmedAt", "施工企业付款");
    const effectiveDate = requiredJsonDate(
      source,
      "operatingLedgerEffectiveDate",
      "施工企业付款"
    );
    const amountCents = requiredJsonMoney(
      source,
      "amountCents",
      "施工企业付款"
    );
    if (amountCents <= 0n) {
      throw new BadRequestException("施工企业付款金额必须大于 0");
    }
    const debtor = projectProxyPayerSubject(source, "debtor", "债务");
    const approvedPayer = projectProxyPayerSubject(
      source,
      "approvedPayer",
      "批准付款"
    );
    const actualPayer = projectProxyPayerSubject(
      source,
      "actualPayer",
      "实际付款"
    );
    const payee = {
      kind: "downstream_counterparty" as const,
      id: requiredJsonText(source, "payeeId", "施工企业付款")
    };
    const impacts: AppendOperatingFactInput["impacts"] = [];
    const payableSourceId = optionalJsonText(source, "payableSourceId");
    if (payableSourceId) {
      impacts.push({
        idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}:payable`,
        sourceImpactKey: `payable:${payableSourceId}`,
        impactKind: "payable_decrease",
        amountCents,
        direction: "decrease",
        subjectRole: "payee",
        subject: payee,
        description: "施工企业实际付款清偿下游应付"
      });
    }
    impacts.push({
      idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}:funds`,
      sourceImpactKey: "construction_enterprise_funds_decrease",
      impactKind: "construction_enterprise_funds_decrease",
      amountCents,
      direction: "decrease",
      subjectRole: "actual_payer",
      subject: actualPayer,
      description: "施工企业实际付款减少施工企业项目资金"
    });
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
        "recordedByUserId",
        "施工企业付款"
      ),
      factKind: "downstream_payment",
      operatingLevel: "construction_enterprise",
      evidenceLevel: "A",
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
      sourceSnapshot: snapshot.sourceSnapshot,
      basisSnapshot: sourceJson({
        authority: "project_proxy_payment_with_voucher",
        financeRecordRole: "financial_evidence_only",
        voucherFileId: requiredJsonText(
          source,
          "voucherFileId",
          "施工企业付款"
        )
      }),
      subjects: {
        debtor,
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
    row: {
      id: string;
      projectId: string;
      paidAt: Date;
      amountCents: bigint;
      generalContractorName: string;
      paidTargetName: string;
      paymentType: string;
      paymentSubjectType: string;
      affiliateAssignmentId: string | null;
      affiliateBusinessPartyVersionId: string | null;
      description: string | null;
      voucherFileId: string;
      recordedByUserId: string;
      contractId: string | null;
      settlementId: string | null;
      createdAt: Date;
    }
  ): Promise<OperatingSourceSnapshot> {
    if (row.paymentSubjectType !== "affiliate") {
      throw new BadRequestException("施工企业付款来源的实际付款主体类型不正确");
    }
    const [effectiveDate, affiliate, settlement] = await Promise.all([
      readOperatingLedgerEffectiveDate(tx, row.projectId),
      readAffiliateSnapshot(tx, {
        projectId: row.projectId,
        occurredAt: row.paidAt,
        assignmentId: row.affiliateAssignmentId,
        businessPartyVersionId: row.affiliateBusinessPartyVersionId
      }),
      row.settlementId
        ? tx.settlement.findUnique({
            where: { id: row.settlementId },
            select: { contractVersionId: true }
          })
        : null
    ]);
    if (row.settlementId && !settlement) {
      throw new BadRequestException("施工企业付款关联结算不存在");
    }
    const contractVersion = settlement?.contractVersionId
      ? await tx.contractVersion.findUnique({
          where: { id: settlement.contractVersionId },
          select: {
            id: true,
            signingSubjectType: true,
            affiliateAssignmentId: true,
            affiliateBusinessPartyVersionId: true
          }
        })
      : row.contractId
        ? await tx.contractVersion.findFirst({
            where: { contractId: row.contractId, status: "effective" },
            select: {
              id: true,
              signingSubjectType: true,
              affiliateAssignmentId: true,
              affiliateBusinessPartyVersionId: true
            },
            orderBy: { versionNo: "desc" }
          })
        : null;
    if ((row.contractId || row.settlementId) && !contractVersion) {
      throw new BadRequestException("施工企业付款关联的生效合同版本不存在");
    }
    if (
      contractVersion &&
      (contractVersion.signingSubjectType !== "affiliate" ||
        contractVersion.affiliateAssignmentId !== affiliate.assignmentId ||
        contractVersion.affiliateBusinessPartyVersionId !==
          affiliate.businessPartyVersionId)
    ) {
      throw new BadRequestException(
        "施工企业付款关联的合同签约主体与冻结施工企业不一致"
      );
    }
    const contractVersionId = contractVersion?.id;
    const counterparty = contractVersionId
      ? await tx.contractPartySnapshot.findFirst({
          where: { contractVersionId, roleKey: "party_b" },
          select: { businessPartyVersionId: true },
          orderBy: { displayOrder: "asc" }
        })
      : null;
    const payeeId =
      counterparty?.businessPartyVersionId ??
      stableNamedSubjectId("downstream", row.paidTargetName);
    return {
      projectId: row.projectId,
      sourceType: this.sourceType,
      sourceBusinessId: row.id,
      sourceBusinessCode: `施工企业付款/${row.id}`,
      sourceVersion: 1,
      status: "confirmed",
      sourceSnapshot: sourceJson({
        formalStatus: "confirmed",
        paymentType: row.paymentType,
        generalContractorName: row.generalContractorName,
        paidTargetName: row.paidTargetName,
        payeeId,
        amountCents: row.amountCents.toString(),
        paidAt: row.paidAt.toISOString(),
        confirmedAt: row.createdAt.toISOString(),
        recordedByUserId: row.recordedByUserId,
        voucherFileId: row.voucherFileId,
        debtorType: "affiliate",
        debtorId: affiliate.businessPartyVersionId,
        approvedPayerType: "affiliate",
        approvedPayerId: affiliate.businessPartyVersionId,
        actualPayerType: "affiliate",
        actualPayerId: affiliate.businessPartyVersionId,
        contractId: row.contractId,
        settlementId: row.settlementId,
        payableSourceId: row.settlementId ?? row.contractId,
        description: row.description,
        operatingLedgerEffectiveDate: effectiveDate.toISOString(),
        affiliate
      })
    };
  }
}

function projectProxyPayerSubject(
  source: Record<string, import("@prisma/client").Prisma.InputJsonValue>,
  field: "debtor" | "approvedPayer" | "actualPayer",
  label: string
) {
  const type = requiredJsonText(source, `${field}Type`, `施工企业付款${label}主体`);
  const id = requiredJsonText(source, `${field}Id`, `施工企业付款${label}主体`);
  if (type === "affiliate") {
    return { kind: "construction_enterprise" as const, id };
  }
  if (type === "our_company") {
    return { kind: "participating_company" as const, id };
  }
  throw new BadRequestException(`施工企业付款${label}主体类型不正确`);
}
