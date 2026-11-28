import { PrismaClient } from "@prisma/client";
import type { ApprovalSmsService } from "./approval-sms.service";
import type { PrismaService } from "../database/prisma.service";
import { ContractDutyNotificationService } from "../contract/contract-duty-notification.service";
import { PaymentApprovalNotificationService } from "../payment/payment-approval-notification.service";

// #419 NTF-04: contract/payment final rejection and return-to-applicant must
// enqueue exactly one correction SMS intent inside the business transaction and
// dispatch it afterwards, with the same failed/unknown/retry contract as duty SMS.
// Runs only against an owned disposable PostgreSQL when the URL is supplied.
const diagnosticUrl = process.env.ISSUE419_CORRECTION_DATABASE_URL;
const pgCase = diagnosticUrl ? test : test.skip;
const contractKind = "contract_v2_inside_duty_notification";

pgCase("真实 PG：合同/付款退回修改短信在业务事务内逐人一次入队、回滚不留痕、失败可重试、未知不重发", async () => {
  const url = new URL(diagnosticUrl!);
  expect(url.hostname).toBe("127.0.0.1");
  expect(url.pathname).toBe("/jiangkong_issue419_correction");
  const client = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const suffix = Date.now().toString(36);
  const phoneBase = String(Date.now()).slice(-8);
  const applicantPhone = `139${phoneBase}`;
  const authorPhone = `138${phoneBase}`;
  const outsiderPhone = `137${phoneBase}`;
  const outcomes = { current: { status: "failed" } as { status: string } };
  const sends: Array<{ phone: string; intent: Record<string, unknown>; label?: string }> = [];
  const outcome = () => outcomes.current.status === "throw"
    ? Promise.reject(new Error("simulated gateway timeout")) : Promise.resolve(outcomes.current);
  const sms = {
    available: () => true,
    sendDutyIntent: jest.fn(async (phone: string, intent: Record<string, unknown>) => {
      sends.push({ phone, intent });
      return outcome();
    }),
    send: jest.fn(async (phone: string, label?: string, dutyName?: string, code?: string) => {
      sends.push({ phone, label, intent: { businessLabel: label, dutyName, businessCode: code } });
      return outcome();
    })
  } as unknown as ApprovalSmsService;

  try {
    const project = await client.project.create({ data: { code: `NTF419-${suffix}`, name: "短信验证项目" } });
    const applicant = await client.user.create({ data: { name: "合同经办人", phone: applicantPhone } });

    // ---------- 合同退回修改 ----------
    const contract = await client.contract.create({ data: {
      code: `NTF419-HT-${suffix}`, name: "退回修改短信合同", counterparty: "相对方",
      projectId: project.id, ownerUserId: applicant.id
    } });
    const version = await client.contractVersion.create({ data: {
      contractId: contract.id, versionNo: 1, changeType: "original", status: "draft", amountCents: 100n,
      amountYuan: "1.0000", numericProtocolVersion: 2, signingSubjectType: "our_company",
      draftData: {}, templateSnapshot: {}, clauseSnapshot: []
    } });
    const round = await client.approvalInstance.create({ data: {
      flowType: "contract.approve", businessType: "contract_version", businessId: version.id,
      status: "rejected", applicantUserId: applicant.id, currentNodeIndex: 1, frozenNodes: [{
        name: "合同主管", executionMode: "parallel", protocolVersion: 1, mode: "any",
        roleKeys: ["contract_director"], approvedRoleKeys: []
      }]
    } });
    const contractService = new ContractDutyNotificationService(client as unknown as PrismaService, sms);
    const contractWhere = { businessType: contractKind, businessId: round.id };

    const rollback = new Error("synthetic rollback");
    await expect(client.$transaction(async tx => {
      await contractService.queueCorrection(tx, contract, version, round, contract.code!);
      await contractService.queueCorrection(tx, contract, version, round, contract.code!);
      expect(await tx.auditLog.count({ where: contractWhere })).toBe(1);
      throw rollback;
    })).rejects.toThrow(rollback);
    expect(await client.auditLog.count({ where: contractWhere })).toBe(0);

    await client.$transaction(async tx => {
      await contractService.queueCorrection(tx, contract, version, round, contract.code!);
      await contractService.queueCorrection(tx, contract, version, round, contract.code!);
    });
    const contractIntents = await client.auditLog.findMany({ where: contractWhere });
    expect(contractIntents).toHaveLength(1);
    expect(contractIntents[0].metadata).toMatchObject({ stage: "correction", recipientId: applicant.id,
      dutyName: "审批退回，请修改后重新提交", contractVersionId: version.id });
    expect(sends).toHaveLength(0);

    outcomes.current = { status: "failed" };
    await contractService.afterCommit();
    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({ phone: applicantPhone, intent: {
      businessLabel: "合同退回修改", dutyName: "审批退回，请修改后重新提交",
      businessCode: contract.code, subject: contract.name, targetPath: `/合同管理/${contract.code}`
    } });
    const [contractFailed] = await contractService.notificationStatus(version.id, applicant.id);
    expect(contractFailed).toMatchObject({ status: "failed", canRetry: true });

    outcomes.current = { status: "accepted" };
    const contractRetried = await contractService.retry(version.id, applicant.id, contractFailed.attemptId);
    await contractService.afterCommit(contractRetried.attemptId);
    expect(await contractService.notificationStatus(version.id, applicant.id)).toEqual([
      expect.objectContaining({ attemptId: contractRetried.attemptId, status: "accepted", canRetry: false })
    ]);

    // 未知结果不得自动重发
    const unknownContract = await client.contract.create({ data: {
      code: `NTF419-HT-UNKNOWN-${suffix}`, name: "未知结果合同", counterparty: "相对方",
      projectId: project.id, ownerUserId: applicant.id
    } });
    const unknownVersion = await client.contractVersion.create({ data: {
      contractId: unknownContract.id, versionNo: 1, changeType: "original", status: "draft", amountCents: 100n,
      amountYuan: "1.0000", numericProtocolVersion: 2, signingSubjectType: "our_company",
      draftData: {}, templateSnapshot: {}, clauseSnapshot: []
    } });
    const unknownRound = await client.approvalInstance.create({ data: {
      flowType: "contract.approve", businessType: "contract_version", businessId: unknownVersion.id,
      status: "rejected", applicantUserId: applicant.id, currentNodeIndex: 1, frozenNodes: [{
        name: "合同主管", executionMode: "parallel", protocolVersion: 1, mode: "any",
        roleKeys: ["contract_director"], approvedRoleKeys: []
      }]
    } });
    await client.$transaction(tx => contractService.queueCorrection(tx, unknownContract, unknownVersion, unknownRound, unknownContract.code!));
    outcomes.current = { status: "throw" };
    const beforeUnknown = sends.length;
    await contractService.afterCommit();
    await contractService.afterCommit();
    expect(sends).toHaveLength(beforeUnknown + 1);
    expect(await contractService.notificationStatus(unknownVersion.id, applicant.id)).toEqual([
      expect.objectContaining({ status: "unknown", canRetry: false })
    ]);

    // 重提后旧轮未派发提醒取消
    const cancelContract = await client.contract.create({ data: {
      code: `NTF419-HT-CANCEL-${suffix}`, name: "重提取消合同", counterparty: "相对方",
      projectId: project.id, ownerUserId: applicant.id
    } });
    const cancelVersion = await client.contractVersion.create({ data: {
      contractId: cancelContract.id, versionNo: 1, changeType: "original", status: "draft", amountCents: 100n,
      amountYuan: "1.0000", numericProtocolVersion: 2, signingSubjectType: "our_company",
      draftData: {}, templateSnapshot: {}, clauseSnapshot: []
    } });
    const cancelRound = await client.approvalInstance.create({ data: {
      flowType: "contract.approve", businessType: "contract_version", businessId: cancelVersion.id,
      status: "rejected", applicantUserId: applicant.id, currentNodeIndex: 1, frozenNodes: [{
        name: "合同主管", executionMode: "parallel", protocolVersion: 1, mode: "any",
        roleKeys: ["contract_director"], approvedRoleKeys: []
      }]
    } });
    await client.$transaction(tx => contractService.queueCorrection(tx, cancelContract, cancelVersion, cancelRound, cancelContract.code!));
    await client.contractVersion.update({ where: { id: cancelVersion.id }, data: { status: "in_approval" } });
    await client.approvalInstance.update({ where: { id: cancelRound.id }, data: { status: "in_progress" } });
    outcomes.current = { status: "accepted" };
    const beforeCancel = sends.length;
    await contractService.afterCommit();
    expect(sends).toHaveLength(beforeCancel);
    expect(await client.auditLog.count({ where: { businessType: contractKind, businessId: cancelRound.id, action: "cancelled" } })).toBe(1);

    // ---------- 付款退回修改 ----------
    const author = await client.user.create({ data: { name: "付款申请人", phone: authorPhone } });
    const outsider = await client.user.create({ data: { name: "无关人员", phone: outsiderPhone } });
    const seedPayment = async (code: string) => {
      const payment = await client.paymentRequest.create({ data: {
        projectId: project.id, contractId: contract.id, contractVersionId: version.id,
        paymentTermsVersionId: version.id, code, status: "approval_rejected", requestedAmountCents: 100n
      } });
      const paymentRound = await client.approvalInstance.create({ data: {
        flowType: "payment.approve", businessType: "payment_request", businessId: payment.id,
        status: "rejected", applicantUserId: author.id, currentNodeIndex: 1, frozenNodes: []
      } });
      const anchor = await client.approvalActionLog.create({ data: {
        approvalInstanceId: paymentRound.id, action: "reject", actorUserId: "reviewer"
      } });
      return { payment, paymentRound, anchor };
    };
    const paymentService = new PaymentApprovalNotificationService(client as unknown as PrismaService, sms, {} as never);
    const first = await seedPayment(`NTF419-FK-${suffix}`);
    const paymentWhere = { approvalInstanceId: first.paymentRound.id, action: "system_notification" };

    await expect(client.$transaction(async tx => {
      await paymentService.queueCorrection(tx, first.payment, first.paymentRound, first.anchor);
      await paymentService.queueCorrection(tx, first.payment, first.paymentRound, first.anchor);
      expect(await tx.approvalActionLog.count({ where: paymentWhere })).toBe(1);
      throw rollback;
    })).rejects.toThrow(rollback);
    expect(await client.approvalActionLog.count({ where: paymentWhere })).toBe(0);

    await client.$transaction(async tx => {
      await paymentService.queueCorrection(tx, first.payment, first.paymentRound, first.anchor);
      await paymentService.queueCorrection(tx, first.payment, first.paymentRound, first.anchor);
    });
    const paymentIntents = await client.approvalActionLog.findMany({ where: paymentWhere });
    expect(paymentIntents).toHaveLength(1);
    expect(paymentIntents[0].metadata).toMatchObject({ phase: "correction", recipientId: author.id, paymentId: first.payment.id });
    expect(await paymentService.status(first.payment.id, outsider.id)).toEqual({ notice: null });

    outcomes.current = { status: "failed" };
    await paymentService.afterCommit(first.payment.id);
    expect(sends.at(-1)).toMatchObject({ phone: authorPhone });
    const paymentNotice = (await paymentService.status(first.payment.id, author.id)).notice;
    expect(paymentNotice).toMatchObject({ status: "failed", canRetry: true });

    outcomes.current = { status: "accepted" };
    const paymentRetried = await paymentService.retry(first.payment.id, author.id, paymentNotice!.attemptId);
    expect(paymentRetried).toMatchObject({ status: "accepted", canRetry: false });
    expect(await paymentService.status(first.payment.id, author.id)).toEqual({
      notice: expect.objectContaining({ status: "accepted", canRetry: false })
    });

    const unknown = await seedPayment(`NTF419-FK-UNKNOWN-${suffix}`);
    await client.$transaction(tx => paymentService.queueCorrection(tx, unknown.payment, unknown.paymentRound, unknown.anchor));
    outcomes.current = { status: "throw" };
    const beforePaymentUnknown = sends.length;
    await paymentService.afterCommit(unknown.payment.id);
    await paymentService.afterCommit(unknown.payment.id);
    expect(sends).toHaveLength(beforePaymentUnknown + 1);
    expect((await paymentService.status(unknown.payment.id, author.id)).notice).toMatchObject({ status: "unknown", canRetry: false });

    process.stdout.write(JSON.stringify({ phase: "issue419_correction_outbox",
      contractQueuedAfterRollback: 0, contractQueued: 1, contractRetried: "accepted",
      contractUnknownResends: 0, contractResubmitCancelled: 1, paymentQueuedAfterRollback: 0,
      paymentQueued: 1, paymentRetried: "accepted", paymentUnknownResends: 0, externalSends: 0 }) + "\n");
  } finally {
    await client.$disconnect();
  }
}, 60_000);
