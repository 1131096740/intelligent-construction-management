import { BadRequestException, ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import { paymentApprovalNodes } from "./spot-procurement-approval-nodes";
import { SpotProcurementPaymentService } from "./spot-procurement-payment.service";

const signatureBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=",
  "base64"
);
const signatureSha256 = createHash("sha256").update(signatureBytes).digest("hex");

function fixture() {
  const originalNodes = paymentApprovalNodes().map((node, index) => index === 0
    ? { ...node, approvedRoleKeys: ["material_director"] }
    : node);
  const approval = {
    id: "approval-1",
    applicantUserId: "applicant-1",
    status: "approval_pending",
    currentNodeIndex: 1,
    frozenNodes: originalNodes as unknown as Prisma.JsonValue
  };
  const historicalAction = {
    id: "approval-action-1",
    action: "approve",
    actorUserId: "material-1",
    approvedRoleKey: "material_director",
    signatureFileIdSnapshot: "signature-file-1",
    signatureVersionIdSnapshot: "signature-version-1",
    signatureSha256Snapshot: signatureSha256,
    metadata: { approverName: "原审批人" }
  };
  const tx = {
    $queryRaw: jest.fn(async (sql: Prisma.Sql) => {
      const query = sql.strings.join("?");
      if (query.includes('FOR UPDATE OF p, v')) {
        return [{
          id: "version-1",
          procurementId: "procurement-1",
          projectId: "project-1",
          currentVersionId: "version-1",
          rootStatus: "approved_in_progress",
          versionStatus: "approved"
        }];
      }
      if (query.includes('FROM "SpotProcurementPayment"')) {
        return [{
          id: "payment-1",
          status: "approval_pending",
          projectId: "project-1",
          procurementId: "procurement-1",
          procurementVersionId: "version-1",
          payerCompanyEntityId: "company-1",
          payerCompanyNameSnapshot: "原付款主体"
        }];
      }
      if (query.includes('FROM "ApprovalInstance"')) return [approval];
      throw new Error("Unexpected SQL in cutover fixture");
    }),
    user: { findUnique: jest.fn().mockResolvedValue({ id: "operator-1", isActive: true }) },
    spotProcurementPayment: {
      findUnique: jest.fn().mockResolvedValue({ actualPurchaseBatchId: null }),
      update: jest.fn()
    },
    spotProcurementPaymentMethodOption: { count: jest.fn().mockResolvedValue(1) },
    approvalInstance: {
      count: jest.fn().mockResolvedValue(1),
      update: jest.fn(async ({ data }: { data: Partial<typeof approval> }) => {
        Object.assign(approval, data);
        return approval;
      })
    },
    approvalActionLog: {
      findMany: jest.fn().mockResolvedValue([historicalAction]),
      create: jest.fn(),
      updateMany: jest.fn()
    },
    handwrittenSignatureVersion: {
      findUnique: jest.fn().mockResolvedValue({
        id: historicalAction.signatureVersionIdSnapshot,
        fileId: historicalAction.signatureFileIdSnapshot,
        userId: historicalAction.actorUserId,
        contentSha256: signatureSha256,
        source: "canvas"
      })
    },
    auditLog: { create: jest.fn() }
  };
  const db = { $transaction: jest.fn(async (operation: (client: typeof tx) => Promise<unknown>) => operation(tx)) };
  const files = {
    getFileBuffer: jest.fn().mockResolvedValue({
      file: { id: "signature-file-1", storageStatus: "active", contentSha256: signatureSha256 },
      buffer: signatureBytes
    })
  };
  const service = new SpotProcurementPaymentService(
    db as never,
    new AuditService(),
    { assertEnabled: jest.fn() } as never,
    {} as never,
    {} as never,
    files as never,
    {} as never,
    {} as never,
    {} as never
  );
  return { tx, db, files, service, originalNodes, historicalAction };
}

describe("apply legacy spot payment approval cutover", () => {
  it("validates signed bytes and enables the remaining duties without rewriting payment or signature history", async () => {
    const { tx, db, files, service, originalNodes, historicalAction } = fixture();
    const historical = { ...historicalAction };

    await expect(service.migrateLegacyApprovalRound("payment-1", "operator-1")).resolves.toMatchObject({
      status: "mapped",
      pendingNodeIndexes: [1, 2, 3]
    });
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable
    });
    const lockSequence = tx.$queryRaw.mock.calls.map(([sql]) => sql.strings.join("?"))
      .filter((sql) => sql.includes('FOR UPDATE OF p, v') ||
        sql.includes('FROM "SpotProcurementPayment"') || sql.includes('FROM "ApprovalInstance"'));
    expect(lockSequence).toEqual([
      expect.stringContaining('FOR UPDATE OF p, v'),
      expect.stringContaining('FROM "SpotProcurementPayment"'),
      expect.stringContaining('FROM "ApprovalInstance"')
    ]);
    expect(files.getFileBuffer).toHaveBeenCalledWith("signature-file-1", tx);
    expect(tx.approvalInstance.update).toHaveBeenCalledWith({
      where: { id: "approval-1" },
      data: {
        currentNodeIndex: 1,
        frozenNodes: originalNodes.map((node) => ({
          ...node,
          protocolVersion: 1,
          executionMode: "parallel",
          legacySerialCutover: true
        }))
      }
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "spot_procurement.payment.approval.legacy_cutover",
        actorUserId: "operator-1",
        businessId: "payment-1",
        metadata: {
          approvalInstanceId: "approval-1",
          previousNodeIndex: 1,
          completedActionIds: ["approval-action-1"],
          pendingNodeIndexes: [1, 2, 3]
        }
      })
    });
    expect(historicalAction).toEqual(historical);
    expect(tx.approvalActionLog.updateMany).not.toHaveBeenCalled();
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
    expect(tx.spotProcurementPayment.update).not.toHaveBeenCalled();

    await expect(service.migrateLegacyApprovalRound("payment-1", "operator-1")).resolves.toMatchObject({
      status: "already_mapped"
    });
    expect(files.getFileBuffer).toHaveBeenCalledTimes(1);
    expect(tx.approvalInstance.update).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it("rejects changed signature bytes before any approval or audit write", async () => {
    const { tx, files, service } = fixture();
    files.getFileBuffer.mockResolvedValue({
      file: { id: "signature-file-1", storageStatus: "active", contentSha256: signatureSha256 },
      buffer: Buffer.concat([signatureBytes, Buffer.from([0])])
    });
    await expect(service.migrateLegacyApprovalRound("payment-1", "operator-1")).rejects.toBeInstanceOf(BadRequestException);
    expect(files.getFileBuffer).toHaveBeenCalledTimes(1);
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("rejects a signature version belonging to a different signer before reading the file", async () => {
    const { tx, files, service } = fixture();
    tx.handwrittenSignatureVersion.findUnique.mockResolvedValue({
      id: "signature-version-1",
      fileId: "signature-file-1",
      userId: "another-signer",
      contentSha256: signatureSha256,
      source: "canvas"
    });
    await expect(service.migrateLegacyApprovalRound("payment-1", "operator-1")).rejects.toBeInstanceOf(BadRequestException);
    expect(files.getFileBuffer).not.toHaveBeenCalled();
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("rejects missing payer methods before reading signature data or writing the round", async () => {
    const { tx, files, service } = fixture();
    tx.spotProcurementPaymentMethodOption.count.mockResolvedValue(0);
    await expect(service.migrateLegacyApprovalRound("payment-1", "operator-1")).rejects.toBeInstanceOf(ConflictException);
    expect(files.getFileBuffer).not.toHaveBeenCalled();
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("rejects duplicate open rounds before mapping or writing either round", async () => {
    const { tx, files, service } = fixture();
    tx.approvalInstance.count.mockResolvedValue(2);
    await expect(service.migrateLegacyApprovalRound("payment-1", "operator-1")).rejects.toBeInstanceOf(ConflictException);
    expect(files.getFileBuffer).not.toHaveBeenCalled();
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});
