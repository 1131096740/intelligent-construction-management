import { ConflictException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { dbMoneyToBigInt } from "../money/decimal-money";
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

interface LockedTakeover {
  id: string;
  projectId: string;
  contractId: string;
  contractVersionId: string;
  paymentTermsVersionId: string;
  activatedAt: Date | null;
  activationIdempotencyKey: string | null;
  historicalInitialSettlementId: string | null;
}

interface LockedContractFacts {
  takeoverId: string;
  revision: number;
  financeBasisRevision: number;
  historicalSettledCents: bigint;
  zeroSettlementDeclared: boolean;
  confirmedRevision: number | null;
}

interface LockedFinanceFacts {
  takeoverId: string;
  revision: number;
  confirmedRevision: number | null;
  confirmedFinanceBasisRevision: number | null;
  zeroPaymentDeclared: boolean;
  excessTreatment: string | null;
}

interface LockedHistoricalPayment {
  id: string;
  takeoverId: string;
  sequenceNo: number;
  amountCents: bigint;
  status: string;
}

interface LockedHistoricalPaymentVoucher {
  id: string;
  historicalPaymentId: string;
  fileId: string;
}

interface LockedContract {
  id: string;
  contractTypeKey: string | null;
  companyEntityId: string | null;
  companyEntityName: string | null;
  companyEntityIsActive: boolean | null;
  companyEntityDataStatus: string | null;
  companyEntityVersionId: string | null;
  companyEntityVersionName: string | null;
  companyEntityCreditCode: string | null;
  companyEntityRegisteredAddress: string | null;
}

interface LockedContractVersion {
  id: string;
  amountCents: bigint;
  amountLimitType: string;
  pricingNature: string;
  status: string;
}

interface LockedPaymentTermsVersion {
  id: string;
  status: string;
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
  constructor(private readonly audit: AuditService) {}

  async tryActivateInTransaction(
    tx: Prisma.TransactionClient,
    takeoverId: string,
    actorUserId: string,
    idempotencyKey: string
  ): Promise<ContractTakeoverActivationResult> {
    const [takeover] = await tx.$queryRaw<LockedTakeover[]>(Prisma.sql`
      SELECT
        "id",
        "projectId",
        "contractId",
        "contractVersionId",
        "paymentTermsVersionId",
        "activatedAt",
        "activationIdempotencyKey",
        "historicalInitialSettlementId"
      FROM "ContractTakeover"
      WHERE "id" = ${takeoverId}
      FOR UPDATE
    `);
    if (!takeover) {
      throw new ConflictException("历史接管记录不存在");
    }
    if (takeover.activatedAt) {
      return {
        activated: true,
        activationStatus: "activated",
        activatedAt: takeover.activatedAt.toISOString(),
        activationIdempotencyKey:
          takeover.activationIdempotencyKey ?? idempotencyKey,
        historicalInitialSettlementId:
          takeover.historicalInitialSettlementId
      };
    }

    const [contractFacts] = await tx.$queryRaw<LockedContractFacts[]>(Prisma.sql`
      SELECT *
      FROM "ContractTakeoverContractFacts"
      WHERE "takeoverId" = ${takeoverId}
      FOR UPDATE
    `);
    const [financeFacts] = await tx.$queryRaw<LockedFinanceFacts[]>(Prisma.sql`
      SELECT *
      FROM "ContractTakeoverFinanceFacts"
      WHERE "takeoverId" = ${takeoverId}
      FOR UPDATE
    `);
    const payments = await tx.$queryRaw<LockedHistoricalPayment[]>(Prisma.sql`
      SELECT *
      FROM "ContractTakeoverHistoricalPayment"
      WHERE "takeoverId" = ${takeoverId}
      ORDER BY "sequenceNo"
      FOR UPDATE
    `);
    const vouchers =
      await tx.$queryRaw<LockedHistoricalPaymentVoucher[]>(Prisma.sql`
        SELECT voucher.*
        FROM "ContractTakeoverHistoricalPaymentVoucher" voucher
        JOIN "ContractTakeoverHistoricalPayment" payment
          ON payment."id" = voucher."historicalPaymentId"
        WHERE payment."takeoverId" = ${takeoverId}
        ORDER BY payment."sequenceNo", voucher."displayOrder"
        FOR UPDATE OF voucher
      `);
    const [contract] = await tx.$queryRaw<LockedContract[]>(Prisma.sql`
      SELECT
        c."id",
        c."contractTypeKey",
        c."companyEntityId",
        c."companyEntityName",
        entity."isActive" AS "companyEntityIsActive",
        entity."dataStatus" AS "companyEntityDataStatus",
        entityVersion."id" AS "companyEntityVersionId",
        entityVersion."name" AS "companyEntityVersionName",
        entityVersion."unifiedSocialCreditCode" AS "companyEntityCreditCode",
        entityVersion."registeredAddress" AS "companyEntityRegisteredAddress"
      FROM "Contract" c
      LEFT JOIN "CompanyEntity" entity
        ON entity."id" = c."companyEntityId"
      LEFT JOIN "CompanyEntityVersion" entityVersion
        ON entityVersion."companyEntityId" = entity."id"
       AND entityVersion."versionNo" = entity."currentVersionNo"
      WHERE c."id" = ${takeover.contractId}
      FOR UPDATE OF c
    `);
    const [contractVersion] =
      await tx.$queryRaw<LockedContractVersion[]>(Prisma.sql`
        SELECT
          "id",
          "amountCents",
          "amountLimitType",
          "pricingNature",
          "status"
        FROM "ContractVersion"
        WHERE "id" = ${takeover.contractVersionId}
        FOR UPDATE
      `);
    const [paymentTermsVersion] =
      await tx.$queryRaw<LockedPaymentTermsVersion[]>(Prisma.sql`
        SELECT "id", "status"
        FROM "PaymentTermsVersion"
        WHERE "id" = ${takeover.paymentTermsVersionId}
        FOR UPDATE
      `);

    if (
      !contractFacts ||
      !financeFacts ||
      !contract ||
      !contractVersion ||
      !paymentTermsVersion
    ) {
      throw new ConflictException(
        "历史接管关联资料不完整，暂不能激活"
      );
    }
    if (contractFacts.confirmedRevision !== contractFacts.revision) {
      throw new ConflictException("合同侧当前修订尚未确认");
    }
    if (financeFacts.confirmedRevision !== financeFacts.revision) {
      throw new ConflictException("财务侧当前修订尚未确认");
    }
    if (
      financeFacts.confirmedFinanceBasisRevision !==
      contractFacts.financeBasisRevision
    ) {
      throw new ConflictException(
        "财务确认所依据的合同基线已过期，请重新保存并确认"
      );
    }
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

    const isUnlimitedDirectContract =
      !isSettlementContract &&
      contractVersion.amountLimitType === "unlimited";
    const capacityCents = isSettlementContract
      ? historicalSettledCents
      : isUnlimitedDirectContract
        ? null
        : dbMoneyToBigInt(contractVersion.amountCents, "合同金额");
    const requestedExcessTreatment =
      financeFacts.excessTreatment === "historical_advance" ||
      financeFacts.excessTreatment === "abnormal_overpay"
        ? financeFacts.excessTreatment
        : undefined;
    const excessTreatment: HistoricalTakeoverExcessTreatment | undefined =
      !isSettlementContract && !isUnlimitedDirectContract
        ? "abnormal_overpay"
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
    if (isSettlementContract) {
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
