import { randomUUID } from "node:crypto";
import {
  ConflictException,
  Injectable
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { SPOT_PROCUREMENT_BUSINESS_TYPES } from "./spot-procurement.constants";

type BalanceAccountLockRow = {
  id: string;
  projectId: string;
  supplierPartyId: string | null;
  supplierKey: string;
  supplierNameSnapshot: string;
  availableAmountCents: bigint;
  reservedAmountCents: bigint;
};

type ReservationLockRow = {
  id: string;
  accountId: string;
  paymentId: string;
  amountCents: bigint;
  releasedAmountCents: bigint;
  status: string;
};

type ReserveInput = {
  projectId: string;
  supplierKey: string;
  paymentId: string;
  procurementId: string;
  amountCents: bigint;
  actorUserId: string;
};

type ReleaseReservationInput = {
  paymentId: string;
  expectedAmountCents: bigint;
  expectedProjectId: string;
  expectedSupplierKey: string;
  actorUserId: string;
  reason: string;
};

export type CreditFromDiscrepancyInput = {
  discrepancyId: string;
  projectId: string;
  supplierPartyId: string | null;
  supplierKey: string;
  supplierNameSnapshot: string;
  procurementId: string;
  amountCents: bigint;
  actorUserId: string;
  reason?: string;
};

export type ReleaseForShortageInput = {
  paymentId: string;
  expectedReservedAmountCents: bigint;
  releaseAmountCents: bigint;
  expectedProjectId: string;
  expectedSupplierKey: string;
  actorUserId: string;
  reason: string;
};

export type ExecuteReservationInput = {
  paymentId: string;
  expectedAmountCents: bigint;
  expectedProjectId: string;
  expectedSupplierKey: string;
  expectedProcurementId: string;
  actorUserId: string;
  reason?: string;
};

type BalanceReadClient = Pick<
  PrismaService,
  "supplierBalanceAccount"
>;

const RESERVATION_STATE_ERROR =
  "供应商余额预留状态异常，请联系财务处理";
const CREDIT_AMOUNT_ERROR =
  "供应商余额转入金额异常，请刷新后重试";
const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;

@Injectable()
export class SpotProcurementBalanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  suggestion(
    projectId: string,
    supplierKey: string,
    settlementAmountCents: bigint
  ) {
    return this.suggestionWithClient(
      this.prisma,
      projectId,
      supplierKey,
      settlementAmountCents
    );
  }

  async suggestionWithClient(
    client: BalanceReadClient,
    projectId: string,
    supplierKey: string,
    settlementAmountCents: bigint
  ) {
    const account = await client.supplierBalanceAccount.findUnique({
      where: {
        projectId_supplierKey: { projectId, supplierKey }
      },
      select: {
        availableAmountCents: true,
        reservedAmountCents: true
      }
    });
    const available = account
      ? nonnegative(account.availableAmountCents - account.reservedAmountCents)
      : 0n;
    const suggested =
      available < settlementAmountCents ? available : settlementAmountCents;
    return {
      availableBalanceAmountCents: available.toString(),
      suggestedBalanceAmountCents: suggested.toString()
    };
  }

  async creditFromDiscrepancy(
    tx: Prisma.TransactionClient,
    input: CreditFromDiscrepancyInput
  ): Promise<{
    accountId: string;
    entryId: string;
    amountCents: bigint;
  }> {
    if (input.amountCents <= 0n) {
      throw new ConflictException(CREDIT_AMOUNT_ERROR);
    }
    const candidateAccountId = randomUUID();
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "SupplierBalanceAccount" (
        "id",
        "projectId",
        "supplierPartyId",
        "supplierKey",
        "supplierNameSnapshot",
        "availableAmountCents",
        "reservedAmountCents",
        "createdAt",
        "updatedAt"
      )
      VALUES (
        ${candidateAccountId},
        ${input.projectId},
        ${input.supplierPartyId},
        ${input.supplierKey},
        ${input.supplierNameSnapshot},
        0,
        0,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
      ON CONFLICT ("projectId", "supplierKey") DO NOTHING
    `);
    const account = await this.requireLockedAccount(
      tx,
      input.projectId,
      input.supplierKey
    );
    if (account.supplierPartyId !== input.supplierPartyId) {
      throw new ConflictException(
        "供应商余额账户坐标异常，请刷新后重试"
      );
    }
    const availableAfter =
      account.availableAmountCents + input.amountCents;
    if (availableAfter > POSTGRES_BIGINT_MAX) {
      throw new ConflictException(CREDIT_AMOUNT_ERROR);
    }
    await tx.supplierBalanceAccount.update({
      where: { id: account.id },
      data: { availableAmountCents: availableAfter }
    });
    const sequenceNo = await this.nextSequenceNo(tx, account.id);
    const entry = await tx.supplierBalanceEntry.create({
      data: {
        accountId: account.id,
        sequenceNo,
        procurementId: input.procurementId,
        entryType: "credit_from_discrepancy",
        availableDeltaCents: input.amountCents,
        reservedDeltaCents: 0n,
        availableAmountAfterCents: availableAfter,
        reservedAmountAfterCents: account.reservedAmountCents,
        actorUserId: input.actorUserId,
        reason: input.reason ?? "零星采购真实多付整笔转供应商余额"
      }
    });
    await this.audit.record(tx, {
      actorUserId: input.actorUserId,
      action: "spot_procurement.balance.credit_from_discrepancy",
      businessType: "spot_procurement_discrepancy",
      businessId: input.discrepancyId,
      metadata: {
        procurementId: input.procurementId,
        projectId: input.projectId,
        supplierKey: input.supplierKey,
        accountId: account.id,
        entryId: entry.id,
        amountCents: input.amountCents.toString(),
        availableAmountAfterCents: availableAfter.toString(),
        reservedAmountAfterCents:
          account.reservedAmountCents.toString()
      }
    });
    return {
      accountId: account.id,
      entryId: entry.id,
      amountCents: input.amountCents
    };
  }

  async reserve(
    tx: Prisma.TransactionClient,
    input: ReserveInput
  ): Promise<{ reservationId: string | null; amountCents: bigint }> {
    if (input.amountCents === 0n) {
      return { reservationId: null, amountCents: 0n };
    }
    const account = await this.requireLockedAccount(
      tx,
      input.projectId,
      input.supplierKey
    );
    const usable =
      account.availableAmountCents - account.reservedAmountCents;
    if (usable < input.amountCents) {
      throw new ConflictException(
        "供应商可用余额已变化，请将抵扣金额调整为最新系统建议后重新提交"
      );
    }
    const reservedAfter =
      account.reservedAmountCents + input.amountCents;
    const reservation = await tx.supplierBalanceReservation.create({
      data: {
        accountId: account.id,
        paymentId: input.paymentId,
        amountCents: input.amountCents,
        status: "reserved",
        reservedByUserId: input.actorUserId
      }
    });
    await tx.supplierBalanceAccount.update({
      where: { id: account.id },
      data: { reservedAmountCents: reservedAfter }
    });
    const sequenceNo = await this.nextSequenceNo(tx, account.id);
    await tx.supplierBalanceEntry.create({
      data: {
        accountId: account.id,
        sequenceNo,
        reservationId: reservation.id,
        paymentId: input.paymentId,
        procurementId: input.procurementId,
        entryType: "reserve",
        availableDeltaCents: 0n,
        reservedDeltaCents: input.amountCents,
        availableAmountAfterCents: account.availableAmountCents,
        reservedAmountAfterCents: reservedAfter,
        actorUserId: input.actorUserId,
        reason: "零星采购付款提交审批时预留供应商余额"
      }
    });
    await this.audit.record(tx, {
      actorUserId: input.actorUserId,
      action: "spot_procurement.balance.reserve",
      businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.payment,
      businessId: input.paymentId,
      metadata: {
        procurementId: input.procurementId,
        accountId: account.id,
        reservationId: reservation.id,
        amountCents: input.amountCents.toString(),
        availableAmountAfterCents:
          account.availableAmountCents.toString(),
        reservedAmountAfterCents: reservedAfter.toString()
      }
    });
    return {
      reservationId: reservation.id,
      amountCents: input.amountCents
    };
  }

  async releaseReservation(
    tx: Prisma.TransactionClient,
    input: ReleaseReservationInput
  ): Promise<{ released: boolean; amountCents: bigint }> {
    const preflight = await tx.supplierBalanceReservation.findUnique({
      where: { paymentId: input.paymentId },
      select: { accountId: true, status: true }
    });
    if (input.expectedAmountCents === 0n) {
      if (preflight) {
        throw new ConflictException(RESERVATION_STATE_ERROR);
      }
      return { released: false, amountCents: 0n };
    }
    if (
      input.expectedAmountCents < 0n ||
      !preflight ||
      preflight.status !== "reserved"
    ) {
      throw new ConflictException(RESERVATION_STATE_ERROR);
    }
    const result = await this.releaseLockedReservation(tx, {
      paymentId: input.paymentId,
      expectedReservedAmountCents: input.expectedAmountCents,
      releaseAmountCents: null,
      expectedProjectId: input.expectedProjectId,
      expectedSupplierKey: input.expectedSupplierKey,
      actorUserId: input.actorUserId,
      reason: input.reason,
      preflightAccountId: preflight.accountId
    });
    return { released: true, amountCents: result.releasedAmountCents };
  }

  async releaseForShortage(
    tx: Prisma.TransactionClient,
    input: ReleaseForShortageInput
  ): Promise<{
    releasedAmountCents: bigint;
    remainingAmountCents: bigint;
    status: "reserved" | "released";
  }> {
    if (
      input.expectedReservedAmountCents <= 0n ||
      input.releaseAmountCents <= 0n ||
      !input.reason.trim()
    ) {
      throw new ConflictException(RESERVATION_STATE_ERROR);
    }
    const preflight = await tx.supplierBalanceReservation.findUnique({
      where: { paymentId: input.paymentId },
      select: { accountId: true, status: true }
    });
    if (!preflight || preflight.status !== "reserved") {
      throw new ConflictException(RESERVATION_STATE_ERROR);
    }
    return this.releaseLockedReservation(tx, {
      ...input,
      preflightAccountId: preflight.accountId
    });
  }

  async executeReservation(
    tx: Prisma.TransactionClient,
    input: ExecuteReservationInput
  ): Promise<{
    accountId: string;
    reservationId: string;
    entryId: string;
    amountCents: bigint;
  }> {
    if (input.expectedAmountCents <= 0n) {
      throw new ConflictException(RESERVATION_STATE_ERROR);
    }
    const preflight = await tx.supplierBalanceReservation.findUnique({
      where: { paymentId: input.paymentId },
      select: { accountId: true, status: true }
    });
    if (!preflight || preflight.status !== "reserved") {
      throw new ConflictException(RESERVATION_STATE_ERROR);
    }
    const account = await this.requireLockedAccountById(
      tx,
      preflight.accountId
    );
    if (
      account.projectId !== input.expectedProjectId ||
      account.supplierKey !== input.expectedSupplierKey
    ) {
      throw new ConflictException(RESERVATION_STATE_ERROR);
    }
    const reservation = await this.lockReservation(tx, input.paymentId);
    if (
      !reservation ||
      reservation.status !== "reserved" ||
      reservation.accountId !== preflight.accountId ||
      reservation.accountId !== account.id ||
      reservation.paymentId !== input.paymentId ||
      reservation.releasedAmountCents < 0n ||
      reservation.releasedAmountCents >= reservation.amountCents
    ) {
      throw new ConflictException(RESERVATION_STATE_ERROR);
    }
    const payment = await tx.spotProcurementPayment.findUnique({
      where: { id: input.paymentId },
      select: {
        projectId: true,
        procurementId: true,
        supplierBalanceAmountCents: true,
        canceledSupplierBalanceAmountCents: true,
        executedSupplierBalanceAmountCents: true
      }
    });
    const effectiveAmountCents =
      reservation.amountCents - reservation.releasedAmountCents;
    if (
      !payment ||
      payment.projectId !== input.expectedProjectId ||
      payment.procurementId !== input.expectedProcurementId ||
      payment.supplierBalanceAmountCents !== reservation.amountCents ||
      payment.canceledSupplierBalanceAmountCents !==
        reservation.releasedAmountCents ||
      payment.executedSupplierBalanceAmountCents !== 0n ||
      effectiveAmountCents !== input.expectedAmountCents ||
      account.availableAmountCents < effectiveAmountCents ||
      account.reservedAmountCents < effectiveAmountCents
    ) {
      throw new ConflictException(RESERVATION_STATE_ERROR);
    }
    const executed =
      await tx.supplierBalanceReservation.updateMany({
        where: {
          id: reservation.id,
          status: "reserved",
          releasedAmountCents: reservation.releasedAmountCents
        },
        data: {
          status: "executed",
          executedAt: new Date(),
          executedByUserId: input.actorUserId
        }
      });
    if (executed.count !== 1) {
      throw new ConflictException(RESERVATION_STATE_ERROR);
    }
    const availableAfter =
      account.availableAmountCents - effectiveAmountCents;
    const reservedAfter =
      account.reservedAmountCents - effectiveAmountCents;
    await tx.supplierBalanceAccount.update({
      where: { id: account.id },
      data: {
        availableAmountCents: availableAfter,
        reservedAmountCents: reservedAfter
      }
    });
    const sequenceNo = await this.nextSequenceNo(tx, account.id);
    const entry = await tx.supplierBalanceEntry.create({
      data: {
        accountId: account.id,
        sequenceNo,
        reservationId: reservation.id,
        paymentId: input.paymentId,
        procurementId: input.expectedProcurementId,
        entryType: "execute",
        availableDeltaCents: -effectiveAmountCents,
        reservedDeltaCents: -effectiveAmountCents,
        availableAmountAfterCents: availableAfter,
        reservedAmountAfterCents: reservedAfter,
        actorUserId: input.actorUserId,
        reason:
          input.reason ?? "财务主管确认执行零星采购供应商余额抵扣"
      }
    });
    await this.audit.record(tx, {
      actorUserId: input.actorUserId,
      action: "spot_procurement.balance.execute",
      businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.payment,
      businessId: input.paymentId,
      metadata: {
        procurementId: input.expectedProcurementId,
        accountId: account.id,
        reservationId: reservation.id,
        entryId: entry.id,
        amountCents: effectiveAmountCents.toString(),
        availableAmountAfterCents: availableAfter.toString(),
        reservedAmountAfterCents: reservedAfter.toString()
      }
    });
    return {
      accountId: account.id,
      reservationId: reservation.id,
      entryId: entry.id,
      amountCents: effectiveAmountCents
    };
  }

  private async releaseLockedReservation(
    tx: Prisma.TransactionClient,
    input: {
      paymentId: string;
      expectedReservedAmountCents: bigint;
      releaseAmountCents: bigint | null;
      expectedProjectId: string;
      expectedSupplierKey: string;
      actorUserId: string;
      reason: string;
      preflightAccountId: string;
    }
  ): Promise<{
    releasedAmountCents: bigint;
    remainingAmountCents: bigint;
    status: "reserved" | "released";
  }> {
    const reason = input.reason.trim();
    if (!reason) {
      throw new ConflictException(RESERVATION_STATE_ERROR);
    }
    const account = await this.requireLockedAccountById(
      tx,
      input.preflightAccountId
    );
    if (
      account.projectId !== input.expectedProjectId ||
      account.supplierKey !== input.expectedSupplierKey
    ) {
      throw new ConflictException(RESERVATION_STATE_ERROR);
    }
    const reservation = await this.lockReservation(tx, input.paymentId);
    if (
      !reservation ||
      reservation.status !== "reserved" ||
      reservation.accountId !== input.preflightAccountId ||
      reservation.accountId !== account.id ||
      reservation.paymentId !== input.paymentId ||
      reservation.amountCents !== input.expectedReservedAmountCents ||
      reservation.releasedAmountCents < 0n ||
      reservation.releasedAmountCents >= reservation.amountCents
    ) {
      throw new ConflictException(RESERVATION_STATE_ERROR);
    }
    const currentRemaining =
      reservation.amountCents - reservation.releasedAmountCents;
    const releaseAmountCents =
      input.releaseAmountCents ?? currentRemaining;
    if (
      releaseAmountCents <= 0n ||
      releaseAmountCents > currentRemaining ||
      account.reservedAmountCents < releaseAmountCents
    ) {
      throw new ConflictException(RESERVATION_STATE_ERROR);
    }
    const payment = await tx.spotProcurementPayment.findUnique({
      where: { id: input.paymentId },
      select: { procurementId: true }
    });
    if (!payment) {
      throw new ConflictException(RESERVATION_STATE_ERROR);
    }
    const releasedAmountAfter =
      reservation.releasedAmountCents + releaseAmountCents;
    const remainingAmountCents =
      reservation.amountCents - releasedAmountAfter;
    const status =
      remainingAmountCents === 0n ? "released" : "reserved";
    const released =
      await tx.supplierBalanceReservation.updateMany({
        where: {
          id: reservation.id,
          status: "reserved",
          releasedAmountCents: reservation.releasedAmountCents
        },
        data: {
          releasedAmountCents: releasedAmountAfter,
          status,
          releasedAt: new Date(),
          releasedByUserId: input.actorUserId,
          releaseReason: reason
        }
      });
    if (released.count !== 1) {
      throw new ConflictException(RESERVATION_STATE_ERROR);
    }
    const reservedAfter =
      account.reservedAmountCents - releaseAmountCents;
    await tx.supplierBalanceAccount.update({
      where: { id: account.id },
      data: { reservedAmountCents: reservedAfter }
    });
    const sequenceNo = await this.nextSequenceNo(tx, account.id);
    const entryType =
      status === "released" ? "release" : "partial_release";
    const entry = await tx.supplierBalanceEntry.create({
      data: {
        accountId: account.id,
        sequenceNo,
        reservationId: reservation.id,
        paymentId: input.paymentId,
        procurementId: payment.procurementId,
        entryType,
        availableDeltaCents: 0n,
        reservedDeltaCents: -releaseAmountCents,
        availableAmountAfterCents: account.availableAmountCents,
        reservedAmountAfterCents: reservedAfter,
        actorUserId: input.actorUserId,
        reason
      }
    });
    await this.audit.record(tx, {
      actorUserId: input.actorUserId,
      action:
        status === "released"
          ? "spot_procurement.balance.release"
          : "spot_procurement.balance.partial_release",
      businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.payment,
      businessId: input.paymentId,
      metadata: {
        accountId: account.id,
        reservationId: reservation.id,
        entryId: entry.id,
        procurementId: payment.procurementId,
        amountCents: releaseAmountCents.toString(),
        releasedAmountAfterCents: releasedAmountAfter.toString(),
        remainingAmountCents: remainingAmountCents.toString(),
        reason,
        reservedAmountAfterCents: reservedAfter.toString()
      }
    });
    return {
      releasedAmountCents: releaseAmountCents,
      remainingAmountCents,
      status
    };
  }

  private async requireLockedAccount(
    tx: Prisma.TransactionClient,
    projectId: string,
    supplierKey: string
  ) {
    const rows = await tx.$queryRaw<Array<BalanceAccountLockRow>>(Prisma.sql`
      SELECT
        "id",
        "projectId",
        "supplierPartyId",
        "supplierKey",
        "supplierNameSnapshot",
        "availableAmountCents",
        "reservedAmountCents"
      FROM "SupplierBalanceAccount"
      WHERE "projectId" = ${projectId}
        AND "supplierKey" = ${supplierKey}
      LIMIT 1
      FOR UPDATE
    `);
    const account = rows[0];
    if (!account) {
      throw new ConflictException(
        "供应商余额账户不存在或不可用，请刷新后重试"
      );
    }
    return account;
  }

  private async requireLockedAccountById(
    tx: Prisma.TransactionClient,
    accountId: string
  ) {
    const rows = await tx.$queryRaw<Array<BalanceAccountLockRow>>(Prisma.sql`
      SELECT
        "id",
        "projectId",
        "supplierPartyId",
        "supplierKey",
        "supplierNameSnapshot",
        "availableAmountCents",
        "reservedAmountCents"
      FROM "SupplierBalanceAccount"
      WHERE "id" = ${accountId}
      LIMIT 1
      FOR UPDATE
    `);
    const account = rows[0];
    if (!account) {
      throw new ConflictException(RESERVATION_STATE_ERROR);
    }
    return account;
  }

  private async lockReservation(
    tx: Prisma.TransactionClient,
    paymentId: string
  ) {
    const rows = await tx.$queryRaw<Array<ReservationLockRow>>(Prisma.sql`
      SELECT
        "id",
        "accountId",
        "paymentId",
        "amountCents",
        "releasedAmountCents",
        "status"
      FROM "SupplierBalanceReservation"
      WHERE "paymentId" = ${paymentId}
      LIMIT 1
      FOR UPDATE
    `);
    return rows[0] ?? null;
  }

  private async nextSequenceNo(
    tx: Prisma.TransactionClient,
    accountId: string
  ) {
    const latest = await tx.supplierBalanceEntry.findFirst({
      where: { accountId },
      orderBy: { sequenceNo: "desc" },
      select: { sequenceNo: true }
    });
    return (latest?.sequenceNo ?? 0n) + 1n;
  }
}

function nonnegative(value: bigint) {
  return value < 0n ? 0n : value;
}
