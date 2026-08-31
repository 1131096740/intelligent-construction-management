import { ConflictException, ForbiddenException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";

import { PrismaService } from "../database/prisma.service";
import { fundExecutionCommandFingerprint } from "./fund-execution-command-receipt";

export type RecordVerifiedBankTransactionObservationInput = Readonly<{
  reference: string;
  payerVerificationId: string;
  transactionSourceType: string;
  transactionSourceId: string;
  transactionSourceIdentity: string;
  transactionEvidenceFileId: string;
  transactionExecutedByUserId: string;
  amountCents: bigint;
  currencyCode: "CNY";
  direction: "inflow" | "outflow";
  occurredAt: Date;
  createdByUserId: string;
  auditRequestId: string;
}>;

@Injectable()
export class VerifiedBankTransactionObservationService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: RecordVerifiedBankTransactionObservationInput) {
    return this.prisma.$transaction(
      async (tx) => {
        await this.authorizeContext(tx, input);
        const [verification, evidence, executedBy] = await Promise.all([
          tx.paymentExecutionPayerVerification.findUnique({
            where: { id: input.payerVerificationId }
          }),
          tx.fileObject.findUnique({
            where: { id: input.transactionEvidenceFileId }
          }),
          tx.user.findUnique({
            where: { id: input.transactionExecutedByUserId },
            select: { id: true, isActive: true }
          })
        ]);
        if (
          !verification ||
          verification.status !== "verified" ||
          !evidence ||
          evidence.storageStatus !== "active" ||
          !evidence.contentSha256 ||
          !executedBy?.isActive ||
          input.amountCents <= 0n ||
          !input.reference.trim() ||
          !input.transactionSourceType.trim() ||
          !input.transactionSourceId.trim() ||
          !input.transactionSourceIdentity.trim()
        ) {
          throw new ConflictException("银行流水观察的服务端核验事实不完整");
        }
        const payloadFingerprint = fundExecutionCommandFingerprint(
          "create_case",
          {
            reference: input.reference,
            payerVerification: {
              id: verification.id,
              reference: verification.reference,
              holderCompanyEntityId: verification.holderCompanyEntityId,
              holderNameSnapshot: verification.holderNameSnapshot,
              holderCreditCodeSnapshot: verification.holderCreditCodeSnapshot,
              verificationReference: verification.verificationReference,
              verifiedByUserId: verification.verifiedByUserId,
              verifiedAt: verification.verifiedAt,
              verificationEvidenceFileId:
                verification.verificationEvidenceFileId,
              verificationEvidenceContentSha256:
                verification.verificationEvidenceContentSha256,
              sourceType: verification.sourceType,
              sourceRecordId: verification.sourceRecordId,
              issuedByDatabaseRole: verification.issuedByDatabaseRole
            },
            transaction: {
              sourceType: input.transactionSourceType,
              sourceId: input.transactionSourceId,
              sourceIdentity: input.transactionSourceIdentity,
              evidenceFileId: evidence.id,
              evidenceContentSha256: evidence.contentSha256,
              executedByUserId: input.transactionExecutedByUserId,
              amountCents: input.amountCents,
              currencyCode: input.currencyCode,
              direction: input.direction,
              occurredAt: input.occurredAt
            }
          }
        );
        return tx.verifiedBankTransactionObservation.create({
          data: {
            id: randomUUID(),
            reference: input.reference.trim(),
            payerVerificationId: verification.id,
            payerVerificationReference: verification.reference,
            holderCompanyEntityId: verification.holderCompanyEntityId,
            holderNameSnapshot: verification.holderNameSnapshot,
            holderCreditCodeSnapshot: verification.holderCreditCodeSnapshot,
            verificationReference: verification.verificationReference,
            verifiedByUserId: verification.verifiedByUserId,
            verifiedAt: verification.verifiedAt,
            verificationEvidenceFileId:
              verification.verificationEvidenceFileId,
            verificationEvidenceContentSha256:
              verification.verificationEvidenceContentSha256,
            verificationSourceType: verification.sourceType,
            verificationSourceRecordId: verification.sourceRecordId,
            verificationIssuedByDatabaseRole:
              verification.issuedByDatabaseRole,
            transactionSourceType: input.transactionSourceType.trim(),
            transactionSourceId: input.transactionSourceId.trim(),
            transactionSourceIdentity: input.transactionSourceIdentity.trim(),
            transactionEvidenceFileId: evidence.id,
            transactionEvidenceContentSha256: evidence.contentSha256,
            transactionExecutedByUserId: input.transactionExecutedByUserId,
            amountCents: input.amountCents,
            currencyCode: input.currencyCode,
            direction: input.direction,
            occurredAt: input.occurredAt,
            payloadFingerprint,
            createdByUserId: input.createdByUserId,
            auditAction: "observe",
            auditRequestId: input.auditRequestId,
            createdTransactionId: 0n,
            createdBackendPid: 0
          }
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  private async authorizeContext(
    tx: Prisma.TransactionClient,
    input: RecordVerifiedBankTransactionObservationInput
  ) {
    const secret = process.env.OPERATING_LEDGER_DB_WRITE_SECRET?.trim();
    if (!secret) throw new ForbiddenException("资金执行受控写入密钥未配置");
    await tx.$executeRaw(
      Prisma.sql`SELECT public."authorizeOperatingLedgerWrite"(${input.createdByUserId}, ${secret})`
    );
    await tx.$executeRaw(
      Prisma.sql`SELECT set_config('app.fund_execution_actor', ${input.createdByUserId}, true)`
    );
    await tx.$executeRaw(
      Prisma.sql`SELECT set_config('app.fund_execution_request_id', ${input.auditRequestId}, true)`
    );
    await tx.$executeRaw(
      Prisma.sql`SELECT set_config('app.fund_execution_action', 'observe', true)`
    );
  }
}
