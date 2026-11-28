import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaService } from "../database/prisma.service";
import { FileService, PrivateFileStorage } from "../file/file.service";
import { inspectPendingPaymentApprovalCutover, inspectPendingPaymentApprovalInventory } from "./payment-approval-cutover";

// Run by path with ISSUE424_PAYMENT_REHEARSAL_URL pointing to a disposable
// PostgreSQL database initialized from the current Prisma schema.
const rehearse = process.env.ISSUE424_PAYMENT_REHEARSAL_URL ? it : it.skip;

rehearse("retains effective historical signatures, original pending roles and assignments without modifying payment state", async () => {
  const url = new URL(process.env.ISSUE424_PAYMENT_REHEARSAL_URL!);
  if (process.env.NODE_ENV !== "test" || url.protocol !== "postgresql:" ||
      url.hostname !== "127.0.0.1" || !url.port || url.pathname !== "/jiangkong_issue424_payment") {
    throw new Error("普通付款切换验收只允许本机独占测试库");
  }
  const root = await mkdtemp(join(tmpdir(), "issue424-payment-signatures-"));
  const env = jest.replaceProperty(process, "env", {
    ...process.env, FILE_STORAGE_DRIVER: "local", FILE_STORAGE_ROOT: root
  });
  const prisma = new PrismaService({ datasources: { db: { url: url.href } } });
  const storage = new PrivateFileStorage();
  const files = new FileService(prisma, undefined, storage);
  try {
    const payment = await prisma.paymentRequest.create({ data: {
      code: `TEST-424-${randomUUID()}`, status: "approval_pending", projectId: randomUUID(),
      contractId: randomUUID(), contractVersionId: randomUUID(), paymentTermsVersionId: randomUUID(),
      sourceType: "contract_due", requestedAmountCents: 456700n
    } });
    const applicant = randomUUID();
    const chair = randomUUID();
    const representative = randomUUID();
    const round = await prisma.approvalInstance.create({ data: {
      flowType: "payment.approve", businessType: "payment_request", businessId: payment.id,
      status: "in_progress", applicantUserId: applicant, currentNodeIndex: 2, frozenNodes: [
        { name: "原项目岗", mode: "any", roleKeys: ["project_manager"], approvedRoleKeys: ["project_manager"] },
        { name: "原财务岗", mode: "any", roleKeys: ["finance_director"], approvedRoleKeys: ["finance_director"] },
        { name: "原终审岗", mode: "any", roleKeys: ["chairman", "general_manager"], assignments: [
          { kind: "transfer", fromUserId: chair, fromRoleKey: "chairman", toUserId: representative }
        ] },
        { name: "原合同岗", mode: "any", roleKeys: ["contract_director"] }
      ]
    } });
    const time = (n: number) => new Date(Date.UTC(2026, 10, 24, 0, 0, n));
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=", "base64");
    const digest = createHash("sha256").update(png).digest("hex");
    const append = (at: number, action: string, actorUserId: string, data: Partial<Prisma.ApprovalActionLogUncheckedCreateInput> = {}) =>
      prisma.approvalActionLog.create({ data: {
        approvalInstanceId: round.id, createdAt: time(at), action, actorUserId, ...data
      } });
    const signed = async (at: number, role: string) => {
      const actor = await prisma.user.create({ data: { name: `虚构审批人 ${at}` } });
      const file = await prisma.fileObject.create({ data: {
        bucket: storage.bucketName(), objectKey: `${randomUUID()}.png`, originalName: "signature.png",
        mimeType: "image/png", sizeBytes: png.length, uploadedByUserId: actor.id, contentSha256: digest
      } });
      await storage.write(file.objectKey, png);
      const version = await prisma.handwrittenSignatureVersion.create({ data: {
        source: "canvas", userId: actor.id, fileId: file.id, contentSha256: digest
      } });
      const action = await append(at, "approve", actor.id, {
        approvedRoleKey: role, representedUserId: actor.id, signatureFileIdSnapshot: file.id,
        signatureSha256Snapshot: digest, signatureVersionIdSnapshot: version.id,
        metadata: { approverName: actor.name }
      });
      return { action, file };
    };

    const initialNotice = await append(1, "system_notification", applicant, { metadata: {
      kind: "payment_approval_duty_notification", event: "queued", paymentId: payment.id, projectId: payment.projectId,
      anchorId: round.id, recipientId: randomUUID(), nodeIndex: 0, roundRevision: time(1).toISOString()
    } });
    await append(2, "system_notification", applicant, { metadata: {
      kind: "payment_approval_duty_notification", event: "dispatch_claimed", intentId: initialNotice.id
    } });
    await append(3, "system_notification", applicant, { metadata: {
      kind: "payment_approval_duty_notification", event: "accepted", intentId: initialNotice.id
    } });
    const kept = await signed(4, "project_manager");
    const revoked = await signed(5, "finance_director");
    const rewind = await append(6, "reject_previous", chair, { approvedRoleKey: "chairman", representedUserId: chair });
    await append(6, "system_notification", applicant, { metadata: {
      kind: "payment_approval_duty_notification", event: "queued", paymentId: payment.id, projectId: payment.projectId,
      anchorId: rewind.id, recipientId: randomUUID(), nodeIndex: 1, roundRevision: time(6).toISOString()
    } });
    const replacement = await signed(7, "finance_director");
    await append(8, "transfer", chair, { approvedRoleKey: "chairman", representedUserId: chair, metadata: {
      kind: "transfer", fromUserId: chair, fromRoleKey: "chairman", toUserId: representative
    } });
    await storage.write(revoked.file.objectKey, Buffer.from("historical revoked bytes unavailable"));
    const inspect = () => inspectPendingPaymentApprovalCutover(prisma, files, payment.id);
    const inventory = () => inspectPendingPaymentApprovalInventory(prisma, files);
    const actionsBefore = await prisma.approvalActionLog.findMany({
      where: { approvalInstanceId: round.id }, orderBy: { id: "asc" }
    });
    await expect(inspect()).resolves.toEqual({
      roundId: round.id,
      completedActionIds: [kept.action.id, replacement.action.id],
      pendingDuties: [
        { nodeIndex: 2, name: "原终审岗", mode: "any", roleKeys: ["chairman", "general_manager"], assignments: [
          { kind: "transfer", fromUserId: chair, fromRoleKey: "chairman", toUserId: representative }
        ] },
        { nodeIndex: 3, name: "原合同岗", mode: "any", roleKeys: ["contract_director"] }
      ]
    });

    await expect(inventory()).resolves.toEqual({ total: 1, replayed: 1, blocked: 0, blockedByReason: {} });

    await storage.write(replacement.file.objectKey, Buffer.from("effective bytes corrupted"));
    await expect(inspect()).rejects.toThrow("资料文件完整性校验失败");
    await expect(inventory()).resolves.toEqual({
      total: 1, replayed: 0, blocked: 1, blockedByReason: { signature_file_unavailable: 1 }
    });
    await storage.write(replacement.file.objectKey, png);
    const unknown = await append(9, "system_notification", applicant, { metadata: {
      kind: "unknown_notice", event: "queued"
    } });
    await expect(inspect()).rejects.toThrow("原付款审批通知记录不一致");
    await expect(inventory()).resolves.toEqual({
      total: 1, replayed: 0, blocked: 1, blockedByReason: { invalid_notification_history: 1 }
    });
    await prisma.approvalActionLog.delete({ where: { id: unknown.id } });
    const unbound = await append(9, "system_notification", applicant, { metadata: {
      kind: "payment_approval_duty_notification", event: "queued", paymentId: payment.id, projectId: payment.projectId,
      anchorId: rewind.id, recipientId: randomUUID(), nodeIndex: 2, roundRevision: time(6).toISOString()
    } });
    await expect(inspect()).rejects.toThrow("原付款审批通知记录不一致");
    await prisma.approvalActionLog.delete({ where: { id: unbound.id } });
    expect(await prisma.paymentRequest.findUnique({ where: { id: payment.id } })).toEqual(payment);
    expect(await prisma.approvalInstance.findUnique({ where: { id: round.id } })).toEqual(round);
    expect(await prisma.approvalActionLog.findMany({
      where: { approvalInstanceId: round.id }, orderBy: { id: "asc" }
    })).toEqual(actionsBefore);
    await prisma.approvalInstance.update({ where: { id: round.id }, data: { currentNodeIndex: 1 } });
    await expect(inspect()).rejects.toThrow("原付款审批操作记录与岗位快照不一致");
    await prisma.paymentRequest.update({ where: { id: payment.id }, data: { status: "draft" } });
    await expect(inspect()).rejects.toThrow("只有在途普通付款");
  } finally {
    await prisma.$disconnect();
    env.restore();
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
