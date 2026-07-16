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
  supplierKey: string;
  availableAmountCents: bigint;
  reservedAmountCents: bigint;
};

type ReservationLockRow = {
  id: string;
  accountId: string;
  paymentId: string;
  amountCents: bigint;
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

type BalanceReadClient = Pick<
  PrismaService,
  "supplierBalanceAccount"
>;

const RESERVATION_STATE_ERROR =
  "供应商余额预留状态异常，请联系财务处理";

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
    paymentId: string,
    expectedAmountCents: bigint,
    actorUserId: string,
    reason: string
  ): Promise<{ released: boolean; amountCents: bigint }> {
    const preflight = await tx.supplierBalanceReservation.findUnique({
      where: { paymentId },
      select: { accountId: true, status: true }
    });
    if (expectedAmountCents === 0n) {
      if (preflight) {
        throw new ConflictException(RESERVATION_STATE_ERROR);
      }
      return { released: false, amountCents: 0n };
    }
    if (
      expectedAmountCents < 0n ||
      !preflight ||
      preflight.status !== "reserved"
    ) {
      throw new ConflictException(RESERVATION_STATE_ERROR);
    }
    const account = await this.requireLockedAccountById(
      tx,
      preflight.accountId
    );
    const payment = await tx.spotProcurementPayment.findUnique({
      where: { id: paymentId },
      select: { procurementId: true }
    });
    const reservation = await this.lockReservation(tx, paymentId);
    if (
      !reservation ||
      reservation.status !== "reserved" ||
      reservation.accountId !== preflight.accountId ||
      reservation.accountId !== account.id ||
      reservation.amountCents !== expectedAmountCents
    ) {
      throw new ConflictException(RESERVATION_STATE_ERROR);
    }
    if (account.reservedAmountCents < expectedAmountCents) {
      throw new ConflictException(RESERVATION_STATE_ERROR);
    }
    const released = await tx.supplierBalanceReservation.updateMany({
      where: { id: reservation.id, status: "reserved" },
      data: {
        status: "released",
        releasedAt: new Date(),
        releasedByUserId: actorUserId,
        releaseReason: reason
      }
    });
    if (released.count !== 1) {
      throw new ConflictException(RESERVATION_STATE_ERROR);
    }
    const reservedAfter =
      account.reservedAmountCents - reservation.amountCents;
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
        paymentId,
        procurementId: payment?.procurementId,
        entryType: "release",
        availableDeltaCents: 0n,
        reservedDeltaCents: -reservation.amountCents,
        availableAmountAfterCents: account.availableAmountCents,
        reservedAmountAfterCents: reservedAfter,
        actorUserId,
        reason
      }
    });
    await this.audit.record(tx, {
      actorUserId,
      action: "spot_procurement.balance.release",
      businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.payment,
      businessId: paymentId,
      metadata: {
        accountId: account.id,
        reservationId: reservation.id,
        procurementId: payment?.procurementId,
        amountCents: reservation.amountCents.toString(),
        reason,
        reservedAmountAfterCents: reservedAfter.toString()
      }
    });
    return { released: true, amountCents: reservation.amountCents };
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
        "supplierKey",
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
        "supplierKey",
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
