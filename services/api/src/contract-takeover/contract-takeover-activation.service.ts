import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { dbMoneyToBigInt } from "../money/decimal-money";
import {
  OperatingSourceReplayService,
  missingOperatingSourceReplayService,
  type OperatingSourceAppendPort
} from "../operating-ledger/operating-source-replay.service";
import {
  CONTRACT_TAKEOVER_HISTORICAL_PAYMENT_SOURCE_TYPE
} from "./contract-takeover-operating-source.adapter";
import {
  allocateHistoricalTakeoverPayments,
  type HistoricalTakeoverExcessTreatment
} from "../payment/settlement-payment-capacity";

const SETTLEMENT_CONTRACT_TYPE_KEYS = new Set([
  "material_purchase",
  "equipment_rental",
  "labor_subcontract",
  "professional_subcontract"
]);

interface PreparedTakeover {
  id: string;
  projectId: string;
  contractId: string;
  contractVersionId: string;
  paymentTermsVersionId: string;
  takeoverLevel: string;
}

interface PreparedContractFacts {
  historicalSettledCents: bigint;
  zeroSettlementDeclared: boolean;
}

interface PreparedFinanceFacts {
  zeroPaymentDeclared: boolean;
  excessTreatment: string | null;
}

interface PreparedHistoricalPayment {
  id: string;
  amountCents: bigint;
  status: string;
}

interface PreparedHistoricalPaymentVoucher {
  historicalPaymentId: string;
}

interface PreparedContract {
  contractTypeKey: string | null;
  companyEntityId: string | null;
  companyEntityIsActive: boolean | null;
  companyEntityDataStatus: string | null;
  companyEntityVersionId: string | null;
  companyEntityVersionName: string | null;
  companyEntityCreditCode: string | null;
  companyEntityRegisteredAddress: string | null;
}

interface PreparedContractVersion {
  amountCents: bigint;
  amountLimitType: string;
}

interface PreparedContractTakeoverActivation {
  takeover: PreparedTakeover;
  contractFacts: PreparedContractFacts;
  financeFacts: PreparedFinanceFacts | null;
  payments: PreparedHistoricalPayment[];
  vouchers: PreparedHistoricalPaymentVoucher[];
  contract: PreparedContract;
  contractVersion: PreparedContractVersion;
}

export interface ContractTakeoverActivationResult {
  activated: true;
  activationStatus: "activated";
  activatedAt: string;
  activationIdempotencyKey: string;
  historicalInitialSettlementId: string | null;
}

@Injectable()
export class ContractTakeoverActivationService {
  constructor(
    private readonly audit: AuditService,
    @Inject(OperatingSourceReplayService)
    private readonly operatingSources: OperatingSourceAppendPort =
      missingOperatingSourceReplayService()
  ) {}

  async executePreparedActivation(
    tx: Prisma.TransactionClient,
    prepared: PreparedContractTakeoverActivation,
    actorUserId: string,
    idempotencyKey: string
  ): Promise<ContractTakeoverActivationResult> {
    const {
      takeover,
      contractFacts,
      financeFacts,
      payments,
      vouchers,
      contract
    } = prepared;
    if (!financeFacts) {
      throw new ConflictException("财务侧资料尚未保存，不能激活");
    }
    if (takeover.takeoverLevel === "C") {
      throw new ConflictException(
        "C级历史接管只能进入资料缺口，不能激活正式合同接管"
      );
    }
    if (takeover.takeoverLevel !== "A" && takeover.takeoverLevel !== "B") {
      throw new ConflictException("历史接管等级不在正式经营账支持范围内");
    }
    const takeoverId = takeover.id;
    if (payments.some((payment) => payment.status !== "draft")) {
      throw new ConflictException(
        "历史实付明细状态异常，暂不能重复或部分激活"
      );
    }
    if (financeFacts.zeroPaymentDeclared !== (payments.length === 0)) {
      throw new ConflictException(
        "财务零实付声明与历史实付明细不一致"
      );
    }
    const voucherPaymentIds = new Set(
      vouchers.map((voucher) => voucher.historicalPaymentId)
    );
    if (
      payments.some((payment) => !voucherPaymentIds.has(payment.id))
    ) {
      throw new ConflictException(
        "每笔历史实付都必须保留至少一份付款凭证"
      );
    }

    const isSettlementContract = SETTLEMENT_CONTRACT_TYPE_KEYS.has(
      contract.contractTypeKey ?? ""
    );
    const historicalSettledCents = dbMoneyToBigInt(
      contractFacts.historicalSettledCents,
      "历史累计结算金额"
    );
    if (
      historicalSettledCents === 0n &&
      !contractFacts.zeroSettlementDeclared
    ) {
      throw new ConflictException(
        "历史累计结算为零时必须保留零结算声明"
      );
    }
    if (isSettlementContract && historicalSettledCents > 0n) {
      const settlementEvidenceCount =
        await tx.contractTakeoverSettlementEvidence.count({
          where: { takeoverId }
        });
      if (settlementEvidenceCount === 0) {
        throw new ConflictException(
          "历史累计结算金额大于零时必须保留结算依据"
        );
      }
    }

    const capacityCents = isSettlementContract ? historicalSettledCents : 0n;
    const requestedExcessTreatment =
      financeFacts.excessTreatment === "historical_advance" ||
      financeFacts.excessTreatment === "abnormal_overpay"
        ? financeFacts.excessTreatment
        : undefined;
    const excessTreatment: HistoricalTakeoverExcessTreatment | undefined =
      !isSettlementContract
        ? requestedExcessTreatment ?? "historical_advance"
        : requestedExcessTreatment;
    const allocation = allocateHistoricalTakeoverPayments({
      payments: payments.map((payment) => ({
        id: payment.id,
        amountCents: payment.amountCents
      })),
      capacityCents,
      excessTreatment
    });
    if (allocation.excessAllocatedCents > 0n) {
      const excessEvidenceCount =
        await tx.contractTakeoverExcessEvidence.count({
          where: { takeoverId }
        });
      if (excessEvidenceCount === 0) {
        throw new ConflictException(
          "历史实付存在超额款项时必须保留认定依据"
        );
      }
    }

    const activatedAt = new Date();
    let historicalInitialSettlementId: string | null = null;
    if (isSettlementContract && historicalSettledCents > 0n) {
      const settlement = await tx.settlement.create({
        data: {
          projectId: takeover.projectId,
          contractId: takeover.contractId,
          contractVersionId: takeover.contractVersionId,
          paymentTermsVersionId: takeover.paymentTermsVersionId,
          code: `HT-OPEN-${takeover.id}`,
          periodLabel: "历史期初",
          status: "effective",
          amountCents: historicalSettledCents,
          payableAmountCents: historicalSettledCents,
          paidAmountCents: allocation.normalAllocatedCents,
          sourceType: "historical_takeover",
          sourceTakeoverId: takeover.id,
          isFinal: false
        },
        select: { id: true }
      });
      historicalInitialSettlementId = settlement.id;
    }

    const paymentIds = payments.map((payment) => payment.id);
    if (paymentIds.length > 0) {
      await tx.contractTakeoverHistoricalPaymentAllocation.deleteMany({
        where: { historicalPaymentId: { in: paymentIds } }
      });
      const allocationRows = allocation.payments.flatMap((payment) =>
        payment.allocations.map((row) => ({
          historicalPaymentId: payment.historicalPaymentId,
          allocationType: row.allocationType,
          amountCents: row.amountCents,
          allocationOrder: row.allocationOrder
        }))
      );
      if (allocationRows.length > 0) {
        await tx.contractTakeoverHistoricalPaymentAllocation.createMany({
          data: allocationRows
        });
      }
      const activatedPayments =
        await tx.contractTakeoverHistoricalPayment.updateMany({
          where: { takeoverId, status: "draft" },
          data: { status: "activated", activatedAt }
        });
      if (activatedPayments.count !== payments.length) {
        throw new ConflictException(
          "历史实付明细并发变化，激活已中止"
        );
      }
    }

    const contractVersionUpdated = await tx.contractVersion.updateMany({
      where: { id: takeover.contractVersionId },
      data: {
        status: "effective",
        effectiveAt: activatedAt,
        settlementMode: isSettlementContract ? "settlement_required" : "direct_payment",
        settlementModeSource: "backfill",
        settlementModeConfirmedByUserId: actorUserId,
        settlementModeConfirmedAt: activatedAt,
        ...(contract.companyEntityId &&
        contract.companyEntityIsActive === true &&
        contract.companyEntityDataStatus === "complete" &&
        contract.companyEntityVersionId &&
        contract.companyEntityVersionName &&
        contract.companyEntityCreditCode
          ? {
              companyEntityIdSnapshot: contract.companyEntityId,
              companyEntityVersionId: contract.companyEntityVersionId,
              companyEntityNameSnapshot: contract.companyEntityVersionName,
              companyEntityCreditCodeSnapshot: contract.companyEntityCreditCode,
              companyEntityRegisteredAddressSnapshot:
                contract.companyEntityRegisteredAddress
            }
          : {})
      }
    });
    const paymentTermsUpdated =
      await tx.paymentTermsVersion.updateMany({
        where: { id: takeover.paymentTermsVersionId },
        data: { status: "effective" }
      });
    if (
      contractVersionUpdated.count !== 1 ||
      paymentTermsUpdated.count !== 1
    ) {
      throw new ConflictException(
        "合同版本状态并发变化，历史接管激活已中止"
      );
    }

    if (allocation.excessAllocatedCents > 0n && excessTreatment) {
      const balanceAccount =
        await tx.contractTakeoverBalanceAccount.create({
          data: {
            takeoverId,
            balanceType: excessTreatment,
            openingCents: allocation.excessAllocatedCents,
            balanceCents: allocation.excessAllocatedCents
          },
          select: { id: true }
        });
      await tx.contractTakeoverBalanceEntry.create({
        data: {
          accountId: balanceAccount.id,
          entryKind: "opening",
          amountCents: allocation.excessAllocatedCents,
          settlementId: historicalInitialSettlementId,
          idempotencyKey: `${idempotencyKey}:opening:${excessTreatment}`,
          createdByUserId: actorUserId
        }
      });
    }

    const activated = await tx.contractTakeover.updateMany({
      where: { id: takeoverId, activatedAt: null },
      data: {
        takeoverStatus: "confirmed",
        confirmedByUserId: actorUserId,
        confirmedAt: activatedAt,
        historicalPaidCents: allocation.totalPaidCents,
        historicalAdvancePaidCents:
          excessTreatment === "historical_advance"
            ? allocation.excessAllocatedCents
            : 0n,
        historicalBalanceConfirmedByUserId: actorUserId,
        historicalBalanceConfirmedAt: activatedAt,
        activationIdempotencyKey: idempotencyKey,
        activatedAt,
        activatedByUserId: actorUserId,
        historicalInitialSettlementId
      }
    });
    if (activated.count !== 1) {
      throw new ConflictException(
        "历史接管激活状态并发变化，请刷新后重试"
      );
    }

    if (historicalInitialSettlementId) {
      await this.operatingSources.appendConfirmedSourceIfEnabledInTransaction(
        tx,
        {
          projectId: takeover.projectId,
          sourceType: "settlement",
          sourceBusinessId: historicalInitialSettlementId
        },
        actorUserId
      );
    }
    for (const payment of payments) {
      await this.operatingSources.appendConfirmedSourceIfEnabledInTransaction(
        tx,
        {
          projectId: takeover.projectId,
          sourceType: CONTRACT_TAKEOVER_HISTORICAL_PAYMENT_SOURCE_TYPE,
          sourceBusinessId: payment.id
        },
        actorUserId
      );
    }

    await this.audit.record(tx, {
      actorUserId,
      action: "contract_takeover.activate",
      businessType: "contract_takeover",
      businessId: takeoverId,
      metadata: {
        idempotencyKey,
        historicalInitialSettlementId,
        historicalPaymentCount: payments.length,
        totalPaidCents: allocation.totalPaidCents.toString(),
        normalAllocatedCents:
          allocation.normalAllocatedCents.toString(),
        excessAllocatedCents:
          allocation.excessAllocatedCents.toString(),
        excessTreatment: excessTreatment ?? null,
        voucherBindingsPreserved: vouchers.length
      }
    });

    return {
      activated: true,
      activationStatus: "activated",
      activatedAt: activatedAt.toISOString(),
      activationIdempotencyKey: idempotencyKey,
      historicalInitialSettlementId
    };
  }
}
