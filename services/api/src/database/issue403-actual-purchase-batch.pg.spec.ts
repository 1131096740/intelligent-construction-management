import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Prisma, PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

import { ActualPurchaseBatchService } from "../actual-purchase/actual-purchase-batch.service";
import { ActualPurchaseBatchNotificationService } from "../actual-purchase/actual-purchase-batch-notification.service";
import { apiJsonReplacer } from "../api-json-replacer";
import { AppModule } from "../app.module";
import { prepareProcurementPayment } from "../general-procurement/general-procurement-payment";
import { AuditService } from "../audit/audit.service";
import { PrivateFileStorage } from "../file/file.service";
import type { AppendOperatingFactInput, OperatingLedgerService } from "../operating-ledger/operating-ledger.service";
import { activeApprovalNodeIndexes } from "../approval/parallel-approval-protocol";
import { paymentApprovalNodes } from "../spot-procurement/spot-procurement-approval-nodes";
import { SpotProcurementBalanceService } from "../spot-procurement/spot-procurement-balance.service";
import { SpotProcurementPaymentService } from "../spot-procurement/spot-procurement-payment.service";
import { createApiValidationPipe } from "../validation/api-validation";

/**
 * #403 真库证据（真实 PostgreSQL 16）：
 * 1) 10k 批次首申 3k 通过后确认整批 10k 成本一次，后续付款不重复计成本；
 * 2) 同批多次付款、累计到批次总额；超批次总额由服务和数据库触发器双重拒绝；
 * 3) 财务主管确认更正 8k 后重算成本贡献（-2k）并暂停；退款 2k 后容量恢复、暂停解除；
 * 4) 批次创建、退款登记同键幂等，异内容冲突；退款累计不超原实付（服务 + 触发器）。
 *
 * 只允许本机一次性 PostgreSQL 16 专库。运行入口：
 *   node services/api/prisma/run-issue403-actual-purchase-local.cjs
 */
describe("issue 403 actual purchase batches and split payments PostgreSQL", () => {
  const integrationTest = process.env.ISSUE403_ACTUAL_PURCHASE_RUN === "1" ? it : it.skip;

  integrationTest("migrates a legacy pending spot payment atomically and accepts a finance signature through HTTP after reopening", async () => {
    const databaseUrl = assertDedicatedDatabase();
    if (process.env.NODE_ENV !== "test" || process.env.DATABASE_URL !== databaseUrl) {
      throw new Error("HTTP 验收仅允许连接同一本机 #403 专库");
    }
    const storageRoot = await mkdtemp(join(tmpdir(), "issue424-cutover-files-"));
    const objectKey = "signature.png";
    const financeObjectKey = "finance-signature.png";
    const financeRoleId = randomUUID();
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const environment = jest.replaceProperty(process, "env", {
      ...process.env,
      FILE_STORAGE_DRIVER: "local",
      FILE_STORAGE_ROOT: storageRoot,
      JWT_ACCESS_SECRET: randomUUID(),
      JWT_REFRESH_SECRET: randomUUID(),
      OPERATIONAL_WRITE_FREEZE_MODE: "modules",
      OPERATIONAL_WRITE_FREEZE_MODULES: "procurement"
    });
    let app: INestApplication | undefined;
    try {
      const fixture = await seedFixture(prisma, { includeGlobalApprovalRoles: false });
      process.env.SPOT_PROCUREMENT_PILOT_PROJECT_IDS = fixture.projectId;
      const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = module.createNestApplication({ logger: false });
      app.getHttpAdapter().getInstance().set("json replacer", apiJsonReplacer);
      app.useGlobalPipes(createApiValidationPipe());
      await app.listen(0, "127.0.0.1");
      const base = await app.getUrl();
      const storage = app.get(PrivateFileStorage);
      const audit = app.get(AuditService);
      const balances = app.get(SpotProcurementBalanceService);
      const service = app.get(SpotProcurementPaymentService);
      const supplierKey = `supplier-424-${fixture.prefix}`;
      await prisma.spotProcurementVersion.update({ where: { id: fixture.versionId }, data: { supplierKey } });
      const payment = await prisma.spotProcurementPayment.create({
        data: {
          code: `LXFK-424-${fixture.prefix}`,
          projectId: fixture.projectId,
          procurementId: fixture.procurementId,
          procurementVersionId: fixture.versionId,
          status: "approval_pending",
          handlerUserId: fixture.handlerUserId,
          createdByUserId: fixture.handlerUserId,
          payerCompanyEntityId: fixture.companyId,
          payerCompanyNameSnapshot: `合成费用公司 ${fixture.prefix}`,
          settlementAmountCents: 1000n,
          supplierBalanceAmountCents: 200n,
          companyPaymentAmountCents: 800n,
          approvalAmountCents: 1000n
        }
      });
      await prisma.spotProcurementPaymentMethodOption.create({
        data: { paymentId: payment.id, paymentMethod: "bank_transfer", sortOrder: 1 }
      });
      const account = await prisma.supplierBalanceAccount.create({
        data: { projectId: fixture.projectId, supplierKey, supplierNameSnapshot: "合成供应商", availableAmountCents: 500n }
      });
      await prisma.$transaction((tx) => balances.reserve(tx, {
        projectId: fixture.projectId,
        supplierKey,
        paymentId: payment.id,
        procurementId: fixture.procurementId,
        amountCents: payment.supplierBalanceAmountCents,
        actorUserId: fixture.handlerUserId
      }));
      const loadFunding = () => Promise.all([
        prisma.supplierBalanceAccount.findUniqueOrThrow({ where: { id: account.id } }),
        prisma.supplierBalanceReservation.findUniqueOrThrow({ where: { paymentId: payment.id } }),
        prisma.supplierBalanceEntry.findMany({ where: { paymentId: payment.id }, orderBy: { sequenceNo: "asc" } }),
        prisma.projectFundingAllocation.findMany({ where: { businessId: payment.id } }),
        prisma.operatingFact.findMany({ where: { sourceBusinessId: payment.id } })
      ]);
      const fundingBeforeCutover = await loadFunding();
      const frozenNodes = paymentApprovalNodes();
      frozenNodes[0].approvedRoleKeys = ["material_director"];
      const round = await prisma.approvalInstance.create({
        data: {
          flowType: "spot_procurement.payment.approve",
          businessType: "spot_procurement_payment",
          businessId: payment.id,
          status: "approval_pending",
          currentNodeIndex: 1,
          frozenNodes: frozenNodes as unknown as Prisma.InputJsonValue,
          applicantUserId: fixture.handlerUserId
        }
      });
      const signatureBytes = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=",
        "base64"
      );
      const contentSha256 = createHash("sha256").update(signatureBytes).digest("hex");
      const signer = await prisma.user.create({ data: { name: "签批时的物资部主管" } });
      const file = await prisma.fileObject.create({
        data: {
          bucket: storage.bucketName(),
          objectKey,
          originalName: "signature.png",
          mimeType: "image/png",
          sizeBytes: signatureBytes.length,
          uploadedByUserId: signer.id,
          contentSha256
        }
      });
      const signature = await prisma.handwrittenSignatureVersion.create({
        data: { userId: signer.id, fileId: file.id, contentSha256 }
      });
      const originalAction = await prisma.approvalActionLog.create({
        data: {
          approvalInstanceId: round.id,
          action: "approve",
          actorUserId: signer.id,
          approvedRoleKey: "material_director",
          signatureFileIdSnapshot: file.id,
          signatureVersionIdSnapshot: signature.id,
          signatureSha256Snapshot: contentSha256,
          metadata: { approverName: signer.name }
        }
      });
      const actorId = fixture.comprehensiveDirectorUserId;
      const reload = () => prisma.approvalInstance.findUniqueOrThrow({ where: { id: round.id } });
      const loadAuditRows = () => prisma.auditLog.findMany({
        where: { businessId: payment.id, action: "spot_procurement.payment.approval.legacy_cutover" }
      });

      await storage.write(objectKey, Buffer.from("corrupted"));
      await expect(service.migrateLegacyApprovalRound(payment.id, actorId)).rejects.toThrow("资料文件完整性校验失败");
      expect(await reload()).toEqual(round);
      expect(await loadAuditRows()).toEqual([]);

      await storage.write(objectKey, signatureBytes);
      const writeAudit = audit.record.bind(audit);
      const failAfterAudit = async (...args: Parameters<AuditService["record"]>) => {
        await writeAudit(...args);
        throw new Error("测试撤销迁移事务");
      };
      const failedAudit = jest.spyOn(audit, "record").mockImplementationOnce(failAfterAudit as never);
      await expect(service.migrateLegacyApprovalRound(payment.id, actorId)).rejects.toThrow("测试撤销迁移事务");
      failedAudit.mockRestore();
      expect(await reload()).toEqual(round);
      expect(await loadAuditRows()).toEqual([]);

      await expect(service.migrateLegacyApprovalRound(payment.id, actorId)).resolves.toEqual({
        status: "mapped", pendingNodeIndexes: [1, 2, 3]
      });
      const converted = await reload();
      expect(converted).toMatchObject({ currentNodeIndex: 1, status: "approval_pending" });
      const convertedNodes = frozenNodes.map(node => ({
        ...node, protocolVersion: 1, executionMode: "parallel", legacySerialCutover: true
      }));
      expect(converted.frozenNodes).toEqual(convertedNodes);
      expect(activeApprovalNodeIndexes(converted.frozenNodes, converted.currentNodeIndex)).toEqual([1, 2, 3]);
      await expect(service.migrateLegacyApprovalRound(payment.id, actorId)).resolves.toEqual({ status: "already_mapped" });
      expect(await prisma.approvalActionLog.findMany({ where: { approvalInstanceId: round.id } })).toEqual([originalAction]);
      expect(await prisma.spotProcurementPayment.findUnique({ where: { id: payment.id } })).toEqual(payment);
      expect(await loadAuditRows()).toEqual([expect.objectContaining({
        actorUserId: actorId,
        action: "spot_procurement.payment.approval.legacy_cutover",
        metadata: expect.objectContaining({ approvalInstanceId: round.id, completedActionIds: [originalAction.id] })
      })]);

      const financeUserId = fixture.financeDirectorUserId;
      const financePosition = await prisma.position.findUniqueOrThrow({ where: { key: "finance_director" } });
      await prisma.userPosition.create({ data: { id: financeRoleId, userId: financeUserId, positionId: financePosition.id } });
      const phone = "13900000424";
      const password = `Issue424-${randomUUID()}`;
      await prisma.user.update({
        where: { id: financeUserId },
        data: { phone, passwordHash: await hash(password, 4), mustChangePassword: false }
      });
      await storage.write(financeObjectKey, signatureBytes);
      const financeFile = await prisma.fileObject.create({
        data: {
          bucket: storage.bucketName(),
          objectKey: financeObjectKey,
          originalName: financeObjectKey,
          mimeType: "image/png",
          sizeBytes: signatureBytes.length,
          uploadedByUserId: financeUserId,
          contentSha256
        }
      });
      const financeSignature = await prisma.handwrittenSignatureVersion.create({
        data: { userId: financeUserId, fileId: financeFile.id, contentSha256 }
      });
      const post = async (path: string, body: object, token?: string) => {
        const response = await fetch(`${base}${path}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Connection: "close",
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          body: JSON.stringify(body)
        });
        return { status: response.status, body: await response.json() };
      };
      const approvalPath = `/spot-procurement-payments/${payment.id}/approval`;
      const login = await post("/auth/login", { phone, password });
      expect(login.status).toBe(201);
      const token = login.body.tokens.accessToken as string;
      await expect(post(approvalPath, { decision: "approve" }, token)).resolves.toMatchObject({
        status: 503,
        body: { code: "OPERATIONAL_WRITE_FREEZE_ACTIVE" }
      });
      expect(await reload()).toEqual(converted);
      expect(await prisma.approvalActionLog.findMany({ where: { approvalInstanceId: round.id } })).toEqual([originalAction]);
      expect(await prisma.spotProcurementPayment.findUnique({ where: { id: payment.id } })).toEqual(payment);
      expect(await loadFunding()).toEqual(fundingBeforeCutover);

      process.env.OPERATIONAL_WRITE_FREEZE_MODE = "off";
      delete process.env.OPERATIONAL_WRITE_FREEZE_MODULES;
      await expect(post(approvalPath, { decision: "approve" })).resolves.toMatchObject({ status: 401 });
      await expect(post(approvalPath, { decision: "approve" }, token)).resolves.toMatchObject({
        status: 201,
        body: { id: payment.id, status: "approval_pending" }
      });
      const afterReview = await reload();
      expect(afterReview).toMatchObject({ currentNodeIndex: 1, status: "approval_pending" });
      expect(afterReview.frozenNodes).toEqual(convertedNodes.map((node, index) =>
        index === 2 ? { ...node, approvedRoleKeys: ["finance_director"] } : node
      ));
      expect(activeApprovalNodeIndexes(afterReview.frozenNodes, afterReview.currentNodeIndex)).toEqual([1, 3]);

      await expect(post(approvalPath, { decision: "approve" }, token)).resolves.toMatchObject({
        status: 403
      });
      expect(await reload()).toEqual(afterReview);
      const actions = await prisma.approvalActionLog.findMany({ where: { approvalInstanceId: round.id } });
      expect(actions).toHaveLength(2);
      expect(actions).toEqual(expect.arrayContaining([
        originalAction,
        expect.objectContaining({
          action: "approve",
          actorUserId: financeUserId,
          approvedRoleKey: "finance_director",
          signatureFileIdSnapshot: financeFile.id,
          signatureVersionIdSnapshot: financeSignature.id,
          signatureSha256Snapshot: contentSha256,
          metadata: expect.objectContaining({ parallel: true, nodeIndex: 2 })
        })
      ]));
      expect(await prisma.spotProcurementPayment.findUnique({ where: { id: payment.id } })).toEqual(payment);
      expect(await loadFunding()).toEqual(fundingBeforeCutover);
      expect(await prisma.spotProcurementPaymentExecution.count({ where: { paymentId: payment.id } })).toBe(0);
    } finally {
      try {
        await app?.close();
      } finally {
        environment.restore();
        await Promise.all([
          prisma.userPosition.deleteMany({ where: { id: financeRoleId } }).finally(() => prisma.$disconnect()),
          Promise.all([objectKey, financeObjectKey].map(key => rm(join(storageRoot, key), { force: true })))
            .then(() => rmdir(storageRoot))
        ]);
      }
    }
  });

  integrationTest("confirms batch cost once, splits payments, corrects cost and restores capacity after refund", async () => {
    const databaseUrl = assertDedicatedDatabase();
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const fixture = await seedFixture(prisma);
    const appendCalls: Array<{ input: AppendOperatingFactInput; entryKind: string }> = [];
    const ledger = {
      appendConfirmedSourceInTransaction: async (
        _tx: unknown,
        input: AppendOperatingFactInput,
        _actorUserId: string,
        entryKind = "original"
      ) => {
        appendCalls.push({ input, entryKind });
        return { id: randomUUID() };
      }
    } as unknown as OperatingLedgerService;
    const notifications = new ActualPurchaseBatchNotificationService(
      prisma as never,
      { available: () => false, send: async () => ({ status: "failed", message: "用例未启用短信" }) } as never
    );
    const service = new ActualPurchaseBatchService(
      prisma as never,
      new AuditService(),
      ledger,
      { confirmPassword: async (_userId: string, password: string) => { if (password !== "current-password") throw new Error("密码错误"); } } as never,
      notifications
    );
    try {
      // 1) 10k 批次，实际明细 2 行。
      const batch = await service.create(fixture.handlerUserId, {
        kind: "spot_material",
        procurementId: fixture.procurementId,
        supplierName: "合成五金供应商",
        totalAmountCents: "1000000",
        idempotencyKey: `batch-${fixture.prefix}`,
        lines: [
          { materialName: "角钢", quantity: "8", unitPrice: "500", amountCents: "400000" },
          { materialName: "扎丝", quantity: "1", unitPrice: "5000", amountCents: "500000" }
        ]
      });
      expect(batch.totalAmountCents).toBe("1000000");
      expect(batch.lines).toHaveLength(2);
      // PUR-08：清单合计 900000 与用户明确填写的实际总额 1000000 不同，仅展示差异，不强制相等。
      expect(batch.lines.reduce((sum, line) => sum + BigInt(line.amountCents ?? "0"), 0n)).toBe(900000n);
      expect(batch.totalAmountCents).not.toBe("900000");
      // 同键幂等：同内容返回同一批次，异内容冲突。
      const replay = await service.create(fixture.handlerUserId, {
        kind: "spot_material",
        procurementId: fixture.procurementId,
        supplierName: "合成五金供应商",
        totalAmountCents: "1000000",
        idempotencyKey: `batch-${fixture.prefix}`,
        lines: [
          { materialName: "角钢", quantity: "8", unitPrice: "500", amountCents: "400000" },
          { materialName: "扎丝", quantity: "1", unitPrice: "5000", amountCents: "500000" }
        ]
      });
      expect(replay.id).toBe(batch.id);
      await expect(service.create(fixture.handlerUserId, {
        kind: "spot_material",
        procurementId: fixture.procurementId,
        supplierName: "合成五金供应商",
        totalAmountCents: "900000",
        idempotencyKey: `batch-${fixture.prefix}`,
        lines: [{ materialName: "角钢", quantity: "10", unitPrice: "500", amountCents: "900000" }]
      })).rejects.toThrow("内容不一致");

      // 2) 首笔付款申请 3k；审批通过确认整批 10k 成本一次。
      const firstPayment = await createSpotPayment(service, batch.id, "300000", fixture.handlerUserId);
      await prisma.spotProcurementPayment.update({ where: { id: firstPayment.id }, data: { status: "approval_pending", approvalAmountCents: 300000n } });
      await prisma.$transaction(async (tx) => {
        await service.confirmCostForSpotPaymentInTransaction(tx, firstPayment.id, fixture.handlerUserId, new Date("2026-11-20T02:00:00.000Z"));
        await service.confirmCostForSpotPaymentInTransaction(tx, firstPayment.id, fixture.handlerUserId, new Date("2026-11-20T02:00:00.000Z"));
      });
      expect(appendCalls).toHaveLength(1);
      expect(appendCalls[0]!.entryKind).toBe("original");
      expect(appendCalls[0]!.input.amountCents).toBe(1000000n);
      const costConfirmed = await prisma.actualPurchaseBatch.findUniqueOrThrow({ where: { id: batch.id } });
      expect(costConfirmed.costVersion).toBe(1);
      expect(costConfirmed.status).toBe("cost_confirmed");

      // 3) 首笔实付 3k，第二批 7k，正好用尽；第三批 1k 被服务拒绝。
      fixture.executionIds.push(await executeSpot(prisma, firstPayment.id, 300000n, "2026-11-20", "exec-1", fixture.handlerUserId));
      const secondPayment = await createSpotPayment(service, batch.id, "700000", fixture.handlerUserId);
      fixture.executionIds.push(await executeSpot(prisma, secondPayment.id, 700000n, "2026-11-21", "exec-2", fixture.handlerUserId));
      await expect(createSpotPayment(service, batch.id, "100000", fixture.handlerUserId))
        .rejects.toThrow("超过批次剩余可付金额");
      const afterTwo = await service.detail(fixture.handlerUserId, batch.id);
      expect(afterTwo.capacity.netPaidAmountCents).toBe("1000000");
      expect(afterTwo.capacity.availableAmountCents).toBe("0");
      expect(afterTwo.capacity.suspended).toBe(false);
      expect(afterTwo.payments).toHaveLength(2);
      // PUR-11：详情按商家/申请金额/已付/状态/累计实付聚合，原申请不拆重复需求。
      expect(afterTwo.payments.map(payment => payment.merchantName)).toEqual(["合成五金供应商", "合成五金供应商"]);
      expect(afterTwo.payments.map(payment => payment.requestedAmountCents)).toEqual(["300000", "700000"]);
      expect(afterTwo.payments.map(payment => payment.paidAmountCents)).toEqual(["300000", "700000"]);
      expect(afterTwo.payments.map(payment => payment.status)).toEqual(["paid", "paid"]);
      expect(afterTwo.capacity.paidAmountCents).toBe("1000000");
      expect(afterTwo.costContribution).toMatchObject({ originalTotalAmountCents: "1000000", effectiveTotalAmountCents: "1000000", confirmedCostAmountCents: "1000000" });

      // 4) 数据库层兜底：直接插入第三笔实付 1 分被触发器拒绝。
      await expect(prisma.spotProcurementPaymentExecution.create({
        data: { paymentId: secondPayment.id, amountCents: 1n, paidAt: new Date("2026-11-21T00:00:00.000Z"), paymentMethod: "bank_transfer", executedByUserId: fixture.handlerUserId, idempotencyKey: `exec-over-${fixture.prefix}` }
      })).rejects.toThrow(/actual_purchase_batch_overpay/u);

      // 5) 更正 8k：财务发起、财务主管确认；成本贡献追加 -2k，已付保留，批次暂停。
      const correction = await service.requestCorrection(fixture.financeStaffUserId, batch.id, {
        correctedTotalAmountCents: "800000",
        reason: "供应商折让，实际应为 8k",
        idempotencyKey: `correction-${fixture.prefix}`
      });
      expect(correction.status).toBe("pending_confirm");
      const pendingIntents = await prisma.approvalActionLog.findMany({
        where: { action: "system_notification", metadata: { path: ["kind"], equals: "actual_purchase_batch_correction" } }
      });
      expect(pendingIntents).toHaveLength(1);
      expect(pendingIntents[0]!.metadata).toMatchObject({
        event: "queued", phase: "correction", recipientId: fixture.financeDirectorUserId,
        correctionId: correction.id, correctedTotalAmountCents: "800000"
      });
      const correctionReplay = await service.requestCorrection(fixture.financeStaffUserId, batch.id, {
        correctedTotalAmountCents: "800000",
        reason: "供应商折让，实际应为 8k",
        idempotencyKey: `correction-${fixture.prefix}`
      });
      expect(correctionReplay.id).toBe(correction.id);
      const confirmed = await service.confirmCorrection(fixture.financeDirectorUserId, batch.id, correction.id, {
        confirmationKey: `confirm-${fixture.prefix}`,
        reviewNote: "核对折让后确认"
      });
      expect(confirmed.status).toBe("confirmed");
      expect(appendCalls).toHaveLength(2);
      expect(appendCalls[1]!.entryKind).toBe("correction");
      expect(appendCalls[1]!.input.amountCents).toBe(200000n);
      expect(appendCalls[1]!.input.direction).toBe("inflow");
      const correctedBatch = await prisma.actualPurchaseBatch.findUniqueOrThrow({ where: { id: batch.id } });
      expect(correctedBatch.effectiveTotalAmountCents).toBe(800000n);
      expect(correctedBatch.costVersion).toBe(2);
      expect(correctedBatch.totalAmountCents).toBe(1000000n);
      const suspended = await service.detail(fixture.financeStaffUserId, batch.id);
      expect(suspended.capacity.suspended).toBe(true);
      expect(suspended.capacity.overpaidAmountCents).toBe("200000");
      await expect(createSpotPayment(service, batch.id, "1", fixture.handlerUserId)).rejects.toThrow("暂停");

      // 6) 退款 2k：净实付 8k，暂停解除；同键重放不新增。
      const refund = await service.recordRefund(fixture.financeStaffUserId, batch.id, {
        executionType: "spot_procurement_payment_execution",
        executionId: fixture.executionIds[0]!,
        amountCents: "200000",
        receivedAt: "2026-11-22",
        reason: "供应商退回折让差额",
        accountId: fixture.accountId,
        idempotencyKey: `refund-${fixture.prefix}`
      });
      expect(refund.replayed).toBe(false);
      const refundReplay = await service.recordRefund(fixture.financeStaffUserId, batch.id, {
        executionType: "spot_procurement_payment_execution",
        executionId: fixture.executionIds[0]!,
        amountCents: "200000",
        receivedAt: "2026-11-22",
        reason: "供应商退回折让差额",
        accountId: fixture.accountId,
        idempotencyKey: `refund-${fixture.prefix}`
      });
      expect(refundReplay.replayed).toBe(true);
      const restored = await service.detail(fixture.financeStaffUserId, batch.id);
      expect(restored.capacity.paidAmountCents).toBe("1000000");
      expect(restored.capacity.refundedAmountCents).toBe("200000");
      expect(restored.capacity.netPaidAmountCents).toBe("800000");
      expect(restored.capacity.availableAmountCents).toBe("0");
      expect(restored.capacity.suspended).toBe(false);
      expect(restored.corrections).toHaveLength(1);
      expect(restored.payments.reduce((sum, payment) => sum + BigInt(payment.refundedAmountCents), 0n)).toBe(200000n);
      // 退款台账回原单：退款事实指向原实付/原付款，成本仍为更正后的 8k，不因多付退款再减。
      expect(restored.refunds).toHaveLength(1);
      expect(restored.refunds[0]).toMatchObject({
        executionType: "spot_procurement_payment_execution",
        executionId: fixture.executionIds[0],
        paymentId: firstPayment.id,
        amountCents: "200000"
      });
      expect(restored.costContribution.confirmedCostAmountCents).toBe("800000");
      expect(restored.costContribution.costVersion).toBe(2);

      // 7) 退款累计不得超过原实付（服务 + 数据库触发器）。
      await expect(service.recordRefund(fixture.financeStaffUserId, batch.id, {
        executionType: "spot_procurement_payment_execution",
        executionId: fixture.executionIds[0]!,
        amountCents: "100001",
        receivedAt: "2026-11-22",
        reason: "重复退款",
        accountId: fixture.accountId,
        idempotencyKey: `refund-over-${fixture.prefix}`
      })).rejects.toThrow("累计退款不得超过原实付");
      await expect(prisma.paymentExecutionRefund.create({
        data: {
          idempotencyKey: `refund-db-over-${fixture.prefix}`,
          executionType: "spot_procurement_payment_execution",
          spotProcurementPaymentExecutionId: fixture.executionIds[0]!,
          projectId: fixture.projectId,
          amountCents: 100001n,
          receivedAt: new Date("2026-11-22"),
          reason: "数据库兜底",
          recordedByUserId: fixture.financeStaffUserId,
          payloadFingerprint: "c".repeat(64)
        }
      })).rejects.toThrow(/payment_execution_refund_cap_exceeded/u);

      // 8) 更正状态机：已确认更正不可再次改金额，重复确认同键回放。
      const correctionReplayConfirm = await service.confirmCorrection(fixture.financeDirectorUserId, batch.id, correction.id, {
        confirmationKey: `confirm-${fixture.prefix}`
      });
      expect(correctionReplayConfirm.status).toBe("confirmed");
      await expect(prisma.actualPurchaseBatchCorrection.update({
        where: { id: correction.id },
        data: { correctedTotalAmountCents: 700000n, correctionDeltaCents: -300000n }
      })).rejects.toThrow(/actual_purchase_batch_correction_(invalid_transition|snapshot_immutable)/u);

      const secondSupplier = await service.create(fixture.handlerUserId, {
        kind: "spot_material",
        procurementId: fixture.procurementId,
        supplierName: "合成建材供应商",
        totalAmountCents: "100000",
        idempotencyKey: `second-supplier-${fixture.prefix}`,
        lines: [{ materialName: "水泥", amountCents: "100000" }]
      });
      const sameRequest = await service.list(fixture.handlerUserId, { procurementId: fixture.procurementId });
      expect(sameRequest.items).toHaveLength(2);
      expect(sameRequest.items).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: batch.id, supplierName: "合成五金供应商", totalAmountCents: "1000000" }),
        expect.objectContaining({ id: secondSupplier.id, supplierName: "合成建材供应商", totalAmountCents: "100000" })
      ]));
    } finally {
      await prisma.$disconnect();
    }
  });

  integrationTest("records a general procurement batch and rejects over-commitment before claim approval", async () => {
    const databaseUrl = assertDedicatedDatabase();
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const fixture = await seedFixture(prisma);
    const appendCalls: Array<{ amountCents: bigint }> = [];
    const ledger = {
      appendConfirmedSourceInTransaction: async (_tx: unknown, input: AppendOperatingFactInput) => {
        appendCalls.push({ amountCents: input.amountCents ?? 0n });
        return { id: randomUUID() };
      }
    } as unknown as OperatingLedgerService;
    const service = new ActualPurchaseBatchService(prisma as never, new AuditService(), ledger, { confirmPassword: async () => undefined } as never);
    try {
      const batch = await service.create(fixture.comprehensiveDirectorUserId, {
        kind: "general",
        procurementId: fixture.generalProcurementId,
        companyEntityId: fixture.companyId,
        supplierName: "合成办公用品供应商",
        totalAmountCents: "1000000",
        idempotencyKey: `general-batch-${fixture.prefix}`,
        lines: [{ materialName: "办公用品一批", amountCents: "1000000" }]
      });
      const claimInput = (requestKey: string, amountCents: string) => ({
        generalProcurementId: fixture.generalProcurementId,
        generalProcurementRequestKey: requestKey,
        actualPurchaseBatchId: batch.id,
        claimType: "incidental_expense" as const,
        incidentalExpenseCategory: "procurement_office_supplies",
        projectId: fixture.projectId,
        companyEntityId: fixture.companyId,
        reason: "办公用品实际采购",
        requestedAmountCents: amountCents,
        payeeName: "合成办公用品供应商"
      });
      await prisma.$transaction(async (tx) => {
        const prepared = await prepareProcurementPayment(tx, prisma as never, fixture.comprehensiveDirectorUserId,
          claimInput(`claim-1-${fixture.prefix}`, "300000") as never, 300000n,
          (client, batchInput) => service.assertClaimCommitInTransaction(client, batchInput));
        expect(prepared?.existing).toBeNull();
        const claim = await tx.expenseClaim.create({
          data: {
            code: `LXFY-403-1-${fixture.prefix}`,
            claimType: "incidental_expense",
            incidentalExpenseCategory: "procurement_office_supplies",
            status: "approved_pending_payment",
            companyEntityId: fixture.companyId,
            companyEntityNameSnapshot: "合成费用公司",
            projectId: fixture.projectId,
            applicantUserId: fixture.comprehensiveDirectorUserId,
            applicantNameSnapshot: "综合部主管",
            handledByUserId: fixture.comprehensiveDirectorUserId,
            handledByNameSnapshot: "综合部主管",
            reason: "办公用品实际采购",
            requestedAmountCents: 300000n,
            payeeNameSnapshot: "合成办公用品供应商",
            actualPurchaseBatchId: batch.id,
            approvedAt: new Date("2026-11-20T03:00:00.000Z")
          }
        });
        await service.confirmCostForClaimInTransaction(tx, claim.id, fixture.comprehensiveDirectorUserId, new Date("2026-11-20T03:00:00.000Z"));
        await service.confirmCostForClaimInTransaction(tx, claim.id, fixture.comprehensiveDirectorUserId, new Date("2026-11-20T03:00:00.000Z"));
      });
      expect(appendCalls).toHaveLength(1);
      expect(appendCalls[0]!.amountCents).toBe(1000000n);
      const detail = await service.detail(fixture.comprehensiveDirectorUserId, batch.id);
      expect(detail.capacity.outstandingCommittedAmountCents).toBe("300000");
      // 7k 仍可申请；同批第三笔 1 分被拒绝。
      await prisma.$transaction(async (tx) => {
        await prepareProcurementPayment(tx, prisma as never, fixture.comprehensiveDirectorUserId,
          claimInput(`claim-2-${fixture.prefix}`, "700000") as never, 700000n,
          (client, batchInput) => service.assertClaimCommitInTransaction(client, batchInput));
      });
      await prisma.expenseClaim.create({
        data: {
          code: `LXFY-403-2-${fixture.prefix}`,
          claimType: "incidental_expense",
          incidentalExpenseCategory: "procurement_office_supplies",
          status: "approval_pending",
          companyEntityId: fixture.companyId,
          companyEntityNameSnapshot: "合成费用公司",
          projectId: fixture.projectId,
          applicantUserId: fixture.comprehensiveDirectorUserId,
          applicantNameSnapshot: "综合部主管",
          handledByUserId: fixture.comprehensiveDirectorUserId,
          handledByNameSnapshot: "综合部主管",
          reason: "办公用品第二批",
          requestedAmountCents: 700000n,
          payeeNameSnapshot: "合成办公用品供应商",
          actualPurchaseBatchId: batch.id
        }
      });
      await expect(prisma.$transaction(async (tx) => {
        await prepareProcurementPayment(tx, prisma as never, fixture.comprehensiveDirectorUserId,
          claimInput(`claim-3-${fixture.prefix}`, "1") as never, 1n,
          (client, batchInput) => service.assertClaimCommitInTransaction(client, batchInput));
      })).rejects.toThrow("超过批次剩余可付金额");
    } finally {
      await prisma.$disconnect();
    }
  });
});

async function createSpotPayment(service: ActualPurchaseBatchService, batchId: string, requestedAmountCents: string, actorUserId: string) {
  return service.createSpotPayment(actorUserId, batchId, {
    requestedAmountCents,
    paymentType: "company_direct",
    payeeName: "合成五金供应商",
    paymentMethods: ["bank_transfer"],
    channels: [{ channelType: "bank_transfer", accountName: "合成五金供应商", accountNumber: "6222000000000001", bankName: "合成银行", isPrimary: true }],
    idempotencyKey: randomUUID()
  });
}

async function executeSpot(prisma: PrismaClient, paymentId: string, amountCents: bigint, paidOn: string, label: string, actorUserId: string) {
  const payment = await prisma.spotProcurementPayment.findUniqueOrThrow({ where: { id: paymentId } });
  const execution = await prisma.spotProcurementPaymentExecution.create({
    data: {
      paymentId,
      amountCents,
      paidAt: new Date(`${paidOn}T00:00:00.000Z`),
      paymentMethod: "bank_transfer",
      executedByUserId: actorUserId,
      idempotencyKey: `${label}-${randomUUID()}`
    }
  });
  const paidAmountCents = payment.paidAmountCents + amountCents;
  await prisma.spotProcurementPayment.update({
    where: { id: paymentId },
    data: {
      paidAmountCents,
      status: paidAmountCents >= payment.approvalAmountCents ? "paid" : "partially_paid"
    }
  });
  return execution.id;
}

function assertDedicatedDatabase(): string {
  const raw = process.env.ISSUE403_DATABASE_URL?.trim();
  if (!raw) throw new Error("ISSUE403_DATABASE_URL 未配置");
  const url = new URL(raw);
  if (process.env.NODE_ENV === "production" || url.hostname !== "127.0.0.1" || !url.pathname.includes("issue403")) {
    throw new Error("仅允许本机一次性 #403 专库");
  }
  return raw;
}

async function seedFixture(
  prisma: PrismaClient,
  { includeGlobalApprovalRoles = true } = {}
) {
  const prefix = randomUUID().slice(0, 8);
  const projectId = randomUUID();
  const companyId = randomUUID();
  const handlerUserId = randomUUID();
  const financeStaffUserId = randomUUID();
  const financeDirectorUserId = randomUUID();
  const comprehensiveDirectorUserId = randomUUID();
  const positionIds: Record<string, string> = {};
  const accountId = randomUUID();
  const openingId = randomUUID();
  const sourceBatchId = randomUUID();
  const procurementId = randomUUID();
  const versionId = randomUUID();

  await prisma.companyEntity.create({ data: { id: companyId, name: `合成费用公司 ${prefix}`, dataStatus: "complete" } });
  await prisma.project.create({
    data: {
      id: projectId,
      code: `P403-${prefix}`,
      name: `#403 真库项目 ${prefix}`,
      operatingLedgerEffectiveDate: new Date("2026-11-01")
    }
  });
  await prisma.user.createMany({
    data: [
      { id: handlerUserId, name: "物资经办" },
      { id: financeStaffUserId, name: "财务经办" },
      { id: financeDirectorUserId, name: "财务主管" },
      { id: comprehensiveDirectorUserId, name: "综合部主管" }
    ]
  });
  for (const [key, name] of [["material_staff", "物资员"], ["finance_staff", "财务人员"], ["finance_director", "财务主管"], ["comprehensive_director", "综合部主管"]] as const) {
    const existing = await prisma.position.findUnique({ where: { key } });
    positionIds[key] = existing?.id ?? (await prisma.position.create({ data: { key, name } })).id;
  }
  await prisma.userPosition.createMany({
    data: [
      { userId: handlerUserId, positionId: positionIds.material_staff!, projectId },
      ...(includeGlobalApprovalRoles ? [
        { userId: financeStaffUserId, positionId: positionIds.finance_staff! },
        { userId: financeDirectorUserId, positionId: positionIds.finance_director! },
        { userId: comprehensiveDirectorUserId, positionId: positionIds.comprehensive_director! }
      ] : [])
    ]
  });
  await prisma.projectMember.create({ data: { projectId, userId: handlerUserId, positionKey: "material_staff" } });
  const party = await prisma.businessParty.create({ data: { name: `合成施工企业 ${prefix}`, normalizedName: `party-403-${prefix}`, createdByUserId: handlerUserId } });
  const partyVersion = await prisma.businessPartyVersion.create({ data: { businessPartyId: party.id, versionNo: 1, snapshot: { name: party.name }, createdByUserId: handlerUserId } });
  await prisma.projectAffiliateAssignment.create({
    data: {
      projectId,
      businessPartyId: party.id,
      businessPartyVersionId: partyVersion.id,
      affiliateNameSnapshot: party.name,
      effectiveFrom: new Date("2020-01-01"),
      changeReason: "批量付款真库",
      assignedByUserId: handlerUserId
    }
  });
  const generalProcurementId = randomUUID();
  await prisma.generalProcurement.create({
    data: {
      id: generalProcurementId,
      code: `ZHCG-403-${prefix}`,
      requestKey: `general-403-${prefix}`,
      creationFingerprint: "e".repeat(64),
      projectId,
      companyEntityId: companyId,
      companyNameSnapshot: `合成费用公司 ${prefix}`,
      applicantUserId: comprehensiveDirectorUserId,
      applicantNameSnapshot: "综合部主管",
      category: "procurement_office_supplies",
      reason: "办公用品实际采购",
      requestProtocolVersion: 2,
      scope: "project",
      lines: [],
      status: "approved_pending_procurement"
    }
  });
  await prisma.spotProcurement.create({
    data: {
      id: procurementId,
      projectId,
      code: `LXCG-403-${prefix}`,
      applicantUserId: handlerUserId,
      handlerUserId,
      status: "approved_in_progress"
    }
  });
  await prisma.spotProcurementVersion.create({
    data: {
      id: versionId,
      procurementId,
      versionNo: 1,
      requestProtocolVersion: 2,
      status: "approved",
      reason: "真库实际采购批次",
      handlerUserId,
      applicationDepartmentSnapshot: "物资部",
      applicationNameSnapshot: "物资经办",
      purchaserNameSnapshot: "物资经办",
      purchaserDepartmentNameSnapshot: "物资部",
      createdByUserId: handlerUserId,
      approvedAt: new Date("2026-11-19T00:00:00.000Z")
    }
  });
  await prisma.spotProcurement.update({ where: { id: procurementId }, data: { currentVersionId: versionId } });
  await prisma.spotProcurementLine.create({
    data: { versionId, sortOrder: 1, materialName: "角钢", quantity: 10, unitPrice: 500, amountCents: 500000n }
  });
  await prisma.registeredFundAccount.create({ data: { id: accountId, scopeKey: `public_cash_403_${prefix}`, kind: "public_cash" } });
  await prisma.fundAccountBalanceRegistration.create({
    data: {
      id: openingId,
      accountId,
      version: 1,
      kind: "opening",
      status: "confirmed",
      balanceYuan: 5000,
      asOfDate: "2026-11-01",
      evidenceReference: `OPEN-403-${prefix}`,
      reconciliationNote: "真库期初",
      reason: "真库期初",
      idempotencyKey: `opening-403-${prefix}`,
      payloadFingerprint: "d".repeat(64),
      createdByUserId: financeStaffUserId,
      confirmedByUserId: financeStaffUserId,
      confirmedAt: new Date("2026-11-01T00:00:00.000Z")
    }
  });
  await prisma.fundAccountSourceBatch.create({
    data: {
      id: sourceBatchId,
      registrationId: openingId,
      lineNo: 1,
      amountYuan: 5000,
      sourceStatus: "known",
      sourceName: "期初",
      projectStatus: "project",
      projectId
    }
  });
  return {
    prefix,
    projectId,
    companyId,
    handlerUserId,
    financeStaffUserId,
    financeDirectorUserId,
    comprehensiveDirectorUserId,
    generalProcurementId,
    accountId,
    procurementId,
    versionId,
    executionIds: [] as string[]
  };
}
