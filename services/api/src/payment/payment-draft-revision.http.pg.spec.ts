import { hash } from "bcryptjs";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apiJsonReplacer } from "../api-json-replacer";
import { AppModule } from "../app.module";
import { BusinessEntryTransactionService } from "../business-entry-definition/business-entry-transaction.service";
import { PrivateFileStorage } from "../file/file.service";
import { createApiValidationPipe } from "../validation/api-validation";
import { PAYMENT_APPROVAL_AMOUNT_ENTRY_DEFINITION } from "./payment-approval-amount-business-entry-definition";
import { PaymentRequestService } from "./payment-request.service";

const run = process.env.ISSUE424_PAYMENT_REHEARSAL_URL ? it : it.skip;

run.each(["contract_advance", "contract_due", "settlement", "signed_settlement"] as const)(
  "the original applicant can correct a %s draft after return or withdrawal and submit a fresh round",
  async sourceType => {
  const url = new URL(process.env.ISSUE424_PAYMENT_REHEARSAL_URL!);
  if (process.env.NODE_ENV !== "test" || process.env.DATABASE_URL !== url.href ||
      url.hostname !== "127.0.0.1" || url.pathname !== "/jiangkong_issue424_payment") {
    throw new Error("普通付款退回重提验收只允许本机独占测试库");
  }
  const prisma = new PrismaClient();
  const storageRoot = await mkdtemp(join(tmpdir(), "issue424-revision-"));
  const environment = jest.replaceProperty(process, "env", { ...process.env, FILE_STORAGE_DRIVER: "local", FILE_STORAGE_ROOT: storageRoot });
  let app: INestApplication | undefined;
  try {
    const applicant = `payment-revise-applicant-${sourceType}`;
    const reviewer = `payment-revise-reviewer-${sourceType}`;
    const prefix = ["contract_advance", "contract_due", "settlement", "signed_settlement"].indexOf(sourceType) + 1;
    const phone = `139000042${prefix}1`;
    const reviewerPhone = `139000042${prefix}2`;
    const password = "Fixture-424-revision-only";
    const passwordHash = await hash(password, 4);
    await prisma.user.createMany({ data: [
      { id: applicant, phone, passwordHash, mustChangePassword: false, name: "虚构制单人" },
      { id: reviewer, phone: reviewerPhone, passwordHash, mustChangePassword: false, name: "虚构审批人" }
    ] });
    const project = await prisma.project.create({ data: { code: `R-424-${sourceType}`, name: "虚构付款项目" } });
    const company = await prisma.companyEntity.create({ data: { name: "虚构付款公司" } });
    await prisma.projectMember.createMany({ data: [
      { projectId: project.id, userId: applicant, positionKey: "contract_staff" },
      { projectId: project.id, userId: reviewer, positionKey: "project_manager" }
    ] });
    for (const role of ["comprehensive_director", "finance_director", "contract_director", "chairman"]) {
      const position = await prisma.position.upsert({ where: { key: role }, create: { key: role, name: role }, update: {} });
      await prisma.userPosition.create({ data: { userId: reviewer, positionId: position.id } });
    }
    const contract = await prisma.contract.create({ data: {
      code: `R-424-C-${sourceType}`, projectId: project.id, name: "虚构合同", counterparty: "虚构供应商",
      contractTypeKey: sourceType === "settlement" || sourceType === "signed_settlement" ? "material_purchase" : "generic_contract"
    } });
    const version = await prisma.contractVersion.create({ data: {
      contractId: contract.id, versionNo: 1, changeType: "initial", status: "effective", amountCents: 1000n,
      draftData: {}, templateSnapshot: {}, clauseSnapshot: {}, effectiveAt: new Date("2026-10-01"),
      signingSubjectType: "our_company", companyEntityIdSnapshot: company.id,
      companyEntityNameSnapshot: company.name, companyEntityCreditCodeSnapshot: "91310000TEST000001",
      ...(sourceType === "contract_due" ? { settlementMode: "direct_payment", settlementModeConfirmedAt: new Date("2026-10-01") } : {})
    } });
    const terms = await prisma.paymentTermsVersion.create({ data: {
      contractId: contract.id, contractVersionId: version.id, versionNo: 1, status: "effective", originalText: "预付一半"
    } });
    const stage = sourceType !== "signed_settlement" ? await prisma.paymentTermsStage.create({ data: {
      paymentTermsVersionId: terms.id,
      name: sourceType === "contract_advance" ? "预付" : "合同约定付款",
      stageType: sourceType === "contract_advance" ? "advance" : "progress",
      basis: sourceType === "settlement" ? "current_settlement" : "contract_amount",
      ratioBps: sourceType === "settlement" ? 10000 : 5000,
      triggerAnchor: sourceType === "settlement" ? "settlement_effective" : "contract_effective",
      triggerEvent: sourceType === "settlement" ? "settlement_effective" : "contract_effective",
      dueDays: 0,
      originalText: "按约付款"
    } }) : null;
    const legacySettlement = sourceType === "settlement" ? await prisma.settlement.create({ data: {
      projectId: project.id, contractId: contract.id, contractVersionId: version.id, paymentTermsVersionId: terms.id,
      code: "JS-424-REV", periodLabel: "虚构结算", amountCents: 500n, payableAmountCents: 500n, status: "effective"
    } }) : null;
    if (legacySettlement) await prisma.settlementArchiveFile.create({ data: {
      settlementId: legacySettlement.id, fileId: "virtual-archive", uploadedByUserId: applicant,
      confirmedByUserId: reviewer, confirmedAt: new Date("2026-10-02"), status: "confirmed"
    } });
    const signedSettlement = sourceType === "signed_settlement" ? await prisma.signedContractSettlement.create({ data: {
      projectId: project.id, contractKind: "downstream", contractId: contract.id, ownerUserId: applicant,
      number: "QJ-424-REV", amountYuan: "5", state: "confirmed", confirmationNo: 1n, reviewedAt: new Date("2026-10-02")
    } }) : null;

    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication({ logger: false });
    app.getHttpAdapter().getInstance().set("json replacer", apiJsonReplacer);
    app.useGlobalPipes(createApiValidationPipe());
    await app.listen(0, "127.0.0.1");
    const storage = app.get(PrivateFileStorage);
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=", "base64");
    const digest = createHash("sha256").update(png).digest("hex");
    const signatureFile = await prisma.fileObject.create({ data: {
      bucket: storage.bucketName(), objectKey: "revision-signer.png", originalName: "虚构签名.png", mimeType: "image/png",
      sizeBytes: png.length, uploadedByUserId: reviewer, contentSha256: digest
    } });
    await storage.write(signatureFile.objectKey, png);
    const signatureVersion = await prisma.handwrittenSignatureVersion.create({
      data: { userId: reviewer, fileId: signatureFile.id, contentSha256: digest, source: "canvas" }
    });
    const base = await app.getUrl();
    const login = async (phone: string) => {
      const result = await fetch(`${base}/auth/login`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone, password })
      });
      expect(result.status).toBe(201);
      return (await result.json() as { tokens: { accessToken: string } }).tokens.accessToken;
    };
    const signatoryWithoutRole = async (phone: string, objectKey: string) => {
      const user = await prisma.user.create({ data: {
        name: "无直接岗位的虚构签批人", phone, passwordHash, mustChangePassword: false
      } });
      const file = await prisma.fileObject.create({ data: {
        bucket: storage.bucketName(), objectKey, originalName: "虚构签名.png", mimeType: "image/png",
        sizeBytes: png.length, uploadedByUserId: user.id, contentSha256: digest
      } });
      await storage.write(file.objectKey, png);
      await prisma.handwrittenSignatureVersion.create({ data: { userId: user.id, fileId: file.id, contentSha256: digest, source: "canvas" } });
      return { userId: user.id, token: await login(phone), fileId: file.id };
    };
    const applicantToken = await login(phone);
    const reviewerToken = await login(reviewerPhone);
    const post = (token: string, path: string, body: object) => fetch(`${base}${path}`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body)
    });
    const code = `R-424-P-${sourceType}`;
    const created = await post(applicantToken, "/payments", {
      code, sourceType, contractVersionId: version.id, paymentTermsVersionId: terms.id, requestedAmountCents: "400",
      ...(sourceType === "contract_due" ? { paymentTermsStageId: stage?.id } : {}),
      ...(legacySettlement ? { settlementId: legacySettlement.id } : {}),
      ...(signedSettlement ? { signedSettlementId: signedSettlement.id } : {})
    });
    expect({ status: created.status, ...(created.status !== 201 ? { response: await created.text() } : {}) }).toEqual({ status: 201 });
    const payment = await prisma.paymentRequest.findUniqueOrThrow({ where: { code } });
    const round = await prisma.approvalInstance.findFirstOrThrow({ where: { businessId: payment.id } });
    const path = `/payments/${payment.id}`;
    const detail = (token: string) => fetch(`${base}${path}`, {
      headers: { authorization: `Bearer ${token}` }
    });
    expect(await (await detail(reviewerToken)).json()).toMatchObject({
      reviewApprovalContext: { canReturnForRevision: true }
    });
    const approved = await post(reviewerToken, `${path}/approval`, {
      decision: "approve",
      expectedPaymentUpdatedAt: payment.updatedAt.toISOString(), expectedApprovalInstanceId: round.id,
      expectedNodeIndex: round.currentNodeIndex, expectedApprovalUpdatedAt: round.updatedAt.toISOString()
    });
    expect(approved.status).toBe(201);
    const [signedRound, pendingPayment] = await Promise.all([
      prisma.approvalInstance.findUniqueOrThrow({ where: { id: round.id } }),
      prisma.paymentRequest.findUniqueOrThrow({ where: { id: payment.id } })
    ]);
    const coordinates = { approvalInstanceId: signedRound.id, paymentUpdatedAt: pendingPayment.updatedAt, approvalUpdatedAt: signedRound.updatedAt };
    const signedAction = await prisma.approvalActionLog.findFirstOrThrow({ where: { approvalInstanceId: round.id, action: "approve" } });
    expect(signedAction).toMatchObject({ signatureVersionIdSnapshot: signatureVersion.id, signatureSha256Snapshot: digest });
    const withPaymentWriteFreeze = async (run: () => Promise<void>) => {
      const mode = process.env.OPERATIONAL_WRITE_FREEZE_MODE;
      const modules = process.env.OPERATIONAL_WRITE_FREEZE_MODULES;
      process.env.OPERATIONAL_WRITE_FREEZE_MODE = "modules";
      process.env.OPERATIONAL_WRITE_FREEZE_MODULES = "payment";
      try {
        await run();
      } finally {
        if (mode === undefined) delete process.env.OPERATIONAL_WRITE_FREEZE_MODE;
        else process.env.OPERATIONAL_WRITE_FREEZE_MODE = mode;
        if (modules === undefined) delete process.env.OPERATIONAL_WRITE_FREEZE_MODULES;
        else process.env.OPERATIONAL_WRITE_FREEZE_MODULES = modules;
      }
    };
    if (sourceType === "contract_advance") {
      const service = app.get(PaymentRequestService);
      expect(() => service.migrateLegacyApprovalRound(payment.id, applicant, coordinates)).toThrow("请先暂停普通付款写入");
      const finance = await prisma.user.create({ data: {
        name: "财务岗位虚构验收人", phone: "13900004249", passwordHash, mustChangePassword: false
      } });
      const financePosition = await prisma.position.findUniqueOrThrow({ where: { key: "finance_director" } });
      const principalRole = await prisma.userPosition.create({ data: { userId: finance.id, positionId: financePosition.id } });
      const firstDelegate = await signatoryWithoutRole("13900004247", "parallel-first-finance-delegate.png");
      const delegate = await signatoryWithoutRole("13900004248", "parallel-finance.png");
      const financeToken = await login(finance.phone!);
      const delegateToken = delegate.token;
      const noticeFor = async (token: string) => (await fetch(`${base}${path}/approval/duty-sms`, {
        headers: { authorization: `Bearer ${token}` }
      })).json();
      const priorNotice = await noticeFor(reviewerToken);
      expect(priorNotice).toEqual({ notice: { attemptId: expect.any(String), status: "queued", canRetry: false } });
      await withPaymentWriteFreeze(async () => {
        await expect(service.migrateLegacyApprovalRound(payment.id, applicant, {
          ...coordinates, approvalUpdatedAt: new Date(signedRound.updatedAt.getTime() - 1)
        })).rejects.toThrow("付款审批轮次已变化，请重新盘点");
        expect(await prisma.approvalInstance.findUnique({ where: { id: round.id } })).toEqual(signedRound);
        await storage.write(signatureFile.objectKey, Buffer.from("虚构签名文件损坏"));
        await expect(service.migrateLegacyApprovalRound(payment.id, applicant, coordinates)).rejects.toThrow("资料文件完整性校验失败");
        expect(await prisma.approvalInstance.findUnique({ where: { id: round.id } })).toEqual(signedRound);
        await storage.write(signatureFile.objectKey, png);
        await expect(service.migrateLegacyApprovalRound(payment.id, applicant, coordinates)).resolves.toEqual({
          status: "mapped", pendingNodeIndexes: [1, 2, 3, 4]
        });
        await expect(service.migrateLegacyApprovalRound(payment.id, applicant, coordinates)).resolves.toEqual({ status: "already_mapped" });
        expect((await post(financeToken, `${path}/approval`, { decision: "approve" })).status).toBe(503);
      });
      expect(await prisma.auditLog.count({ where: { businessId: payment.id, action: "payment.approval.legacy_cutover" } })).toBe(1);
      expect(await noticeFor(reviewerToken)).toEqual(priorNotice);
      expect(await noticeFor(financeToken)).toEqual({ notice: { attemptId: expect.any(String), status: "queued", canRetry: false } });
      const ownerNotice = await noticeFor(financeToken);
      const financeDetail = await (await detail(financeToken)).json();
      expect(financeDetail.delegationApprovalContext).toMatchObject({
        expectedApprovalInstanceId: round.id, expectedApprovalUpdatedAt: expect.any(String),
        duties: [{ index: 2, name: expect.any(String) }]
      });
      const financeCapability = await fetch(`${base}${path}/capability`, {
        headers: { authorization: `Bearer ${financeToken}` }
      });
      expect(await financeCapability.json()).toMatchObject({
        delegationApprovalContext: financeDetail.delegationApprovalContext
      });
      const assignment = {
        toUserId: firstDelegate.userId, expectedApprovalInstanceId: round.id, expectedNodeIndex: 2,
        expectedApprovalUpdatedAt: financeDetail.delegationApprovalContext.expectedApprovalUpdatedAt,
        endsAt: new Date(Date.now() + 120_000).toISOString()
      };
      const delegationUrl = `${path}/approval-delegation`;
      expect((await post(financeToken, delegationUrl, { toUserId: delegate.userId })).status).toBe(403);
      expect((await post(financeToken, delegationUrl, { ...assignment, expectedApprovalInstanceId: "other-round" })).status).toBe(403);
      expect((await post(financeToken, delegationUrl, { ...assignment, expectedNodeIndex: 1 })).status).toBe(403);
      expect((await post(financeToken, delegationUrl, { ...assignment, endsAt: new Date(Date.now() - 10_000).toISOString() })).status).toBe(400);
      const delegated = await post(financeToken, delegationUrl, assignment);
      expect({ status: delegated.status, ...(delegated.status !== 201 ? { response: await delegated.text() } : {}) }).toEqual({ status: 201 });
      expect((await post(financeToken, delegationUrl, assignment)).status).toBe(201);
      expect(await prisma.approvalActionLog.count({ where: { approvalInstanceId: round.id, action: "delegate" } })).toBe(1);
      expect(await noticeFor(firstDelegate.token)).toEqual({ notice: { attemptId: expect.any(String), status: "queued", canRetry: false } });

      const replacementContext = (await (await detail(financeToken)).json()).delegationApprovalContext;
      const replacement = { ...assignment, toUserId: delegate.userId, expectedApprovalUpdatedAt: replacementContext.expectedApprovalUpdatedAt };
      expect((await post(financeToken, delegationUrl, replacement)).status).toBe(201);
      const replacementRound = await prisma.approvalInstance.findUniqueOrThrow({ where: { id: round.id } });
      expect((await post(financeToken, delegationUrl, assignment)).status).toBe(409);
      expect(await prisma.approvalInstance.findUnique({ where: { id: round.id } })).toEqual(replacementRound);
      expect(await prisma.approvalActionLog.count({ where: { approvalInstanceId: round.id, action: "delegate" } })).toBe(2);
      expect(await prisma.approvalDelegation.count({ where: { toUserId: { in: [firstDelegate.userId, delegate.userId] } } })).toBe(0);
      const replacementAction = await prisma.approvalActionLog.findFirstOrThrow({ where: {
        approvalInstanceId: round.id, action: "delegate", metadata: { path: ["toUserId"], equals: delegate.userId }
      } });
      expect(replacementAction).toMatchObject({ actorUserId: finance.id, representedUserId: finance.id, approvedRoleKey: "finance_director",
        metadata: { toUserId: delegate.userId, endsAt: replacement.endsAt, ordinaryPaymentDutyIndex: 2 } });
      expect((await post(delegateToken, delegationUrl, { ...replacement, toUserId: reviewer })).status).toBe(403);
      expect(await noticeFor(financeToken)).toEqual(ownerNotice);
      expect(await noticeFor(firstDelegate.token)).toEqual({ notice: null });
      const replacementNotice = await noticeFor(delegateToken);
      expect(replacementNotice).toEqual({ notice: { attemptId: expect.any(String), status: "queued", canRetry: false } });
      const pendingProgress = async (token: string) => fetch(`${base}/approval-progress/${round.id}`, {
        headers: { authorization: `Bearer ${token}` }
      });
      expect(await (await pendingProgress(delegateToken)).json()).toMatchObject({ canHandle: true });
      const pending = await (await pendingProgress(applicantToken)).json();
      expect(pending.nodes[2].pending).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: finance.id }), expect.objectContaining({ id: delegate.userId })
      ]));
      const delegateDetail = await (await detail(delegateToken)).json();
      expect(delegateDetail.delegationApprovalContext).toBeUndefined();
      expect(delegateDetail.reviewApprovalContext).toMatchObject({ expectedNodeIndex: 2, executionMode: "parallel" });
      const coordinates = { ...delegateDetail.reviewApprovalContext };
      delete coordinates.executionMode;
      delete coordinates.canReturnForRevision;
      const attempt = { ...coordinates, decision: "approve" } as Parameters<PaymentRequestService["reviewApproval"]>[2];
      await prisma.userPosition.delete({ where: { id: principalRole.id } });
      expect((await post(delegateToken, `${path}/approval`, attempt)).status).toBe(403);
      await expect(service.reviewApproval(payment.id, delegate.userId, attempt)).rejects.toMatchObject({ status: 403 });
      expect((await pendingProgress(delegateToken)).status).toBe(404);
      expect((await detail(delegateToken)).status).toBe(404);
      expect(await noticeFor(delegateToken)).toEqual({ notice: null });
      await prisma.userPosition.create({ data: { userId: finance.id, positionId: financePosition.id } });
      await prisma.user.update({ where: { id: finance.id }, data: { isActive: false } });
      expect((await post(delegateToken, `${path}/approval`, attempt)).status).toBe(403);
      expect(await noticeFor(delegateToken)).toEqual({ notice: null });
      await prisma.user.update({ where: { id: finance.id }, data: { isActive: true } });
      expect(await noticeFor(delegateToken)).toEqual(replacementNotice);
      const expiry = jest.spyOn(Date, "now").mockReturnValue(Date.parse(replacement.endsAt));
      try {
        expect((await post(delegateToken, `${path}/approval`, { ...coordinates, decision: "approve" })).status).toBe(403);
        expect((await pendingProgress(delegateToken)).status).toBe(404);
        expect((await detail(delegateToken)).status).toBe(404);
        expect(await noticeFor(delegateToken)).toEqual({ notice: null });
        expect(await noticeFor(financeToken)).toEqual(ownerNotice);
      } finally {
        expiry.mockRestore();
      }
      expect((await post(financeToken, `${path}/approval`, { decision: "approve" })).status).toBe(403);
      expect((await post(financeToken, `${path}/approval`, { ...coordinates, expectedNodeIndex: 1, decision: "approve" })).status).toBe(403);
      expect((await post(financeToken, `${path}/approval`, { ...coordinates, decision: "approve", approvedAmountCents: "200" })).status).toBe(400);
      expect((await post(delegateToken, `${path}/approval`, { ...coordinates, expectedNodeIndex: 1, decision: "approve" })).status).toBe(403);
      expect((await post(delegateToken, `${path}/approval`, { ...coordinates, decision: "approve" })).status).toBe(201);
      expect((await post(financeToken, `${path}/approval`, { ...coordinates, decision: "approve" })).status).toBe(403);
      expect(await noticeFor(financeToken)).toEqual({ notice: null });
      expect(await noticeFor(delegateToken)).toEqual({ notice: null });
      expect(await noticeFor(reviewerToken)).toEqual(priorNotice);
      const form = await fetch(`${base}/approval-forms/payment_request/${payment.id}/capability`, { headers: { authorization: `Bearer ${applicantToken}` } });
      expect(await form.json()).toEqual({ available: true, incomplete: true });
      const downloaded = await post(applicantToken, `/approval-forms/payment_request/${payment.id}/download`, {
        confirmationPassword: password, downloadReason: "核对在途原签字"
      });
      expect(downloaded.status).toBe(201);
      expect(Buffer.from(await downloaded.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");
      const projected = await fetch(`${base}/approval-progress/${round.id}`, { headers: { authorization: `Bearer ${applicantToken}` } });
      expect(await projected.json()).toMatchObject({ parallelCompletion: { completed: 2, total: 5 },
        nodes: [expect.objectContaining({ signatures: [expect.objectContaining({ id: signedAction.id })] }), ...Array(4).fill(expect.anything())]
      });
      expect(await prisma.approvalActionLog.findUnique({ where: { id: signedAction.id } })).toEqual(signedAction);
      const projectApproval = await prisma.approvalInstance.findUniqueOrThrow({ where: { id: round.id } });
      expect(projectApproval.currentNodeIndex).toBe(1);
      expect(await prisma.approvalActionLog.count({ where: { approvalInstanceId: round.id, action: "approve" } })).toBe(2);
      expect(await prisma.approvalActionLog.findFirst({ where: { approvalInstanceId: round.id, action: "approve", approvedRoleKey: "finance_director" } }))
        .toMatchObject({
          actorUserId: delegate.userId, representedUserId: finance.id,
          metadata: { ordinaryPaymentDutyIndex: 2, ordinaryPaymentDelegationActionId: replacementAction.id }
        });
      expect(await prisma.auditLog.findFirst({ where: {
        businessId: payment.id, action: "payment.approval.approve", actorUserId: delegate.userId
      } })).toMatchObject({ metadata: { ordinaryPaymentDelegationActionId: replacementAction.id } });
      Object.assign(signedRound, projectApproval);
      Object.assign(pendingPayment, await prisma.paymentRequest.findUniqueOrThrow({ where: { id: payment.id } }));
    } else if (sourceType === "contract_due") {
      await withPaymentWriteFreeze(async () => {
        await app!.get(PaymentRequestService).migrateLegacyApprovalRound(payment.id, applicant, coordinates);
      });
      Object.assign(signedRound, await prisma.approvalInstance.findUniqueOrThrow({ where: { id: round.id } }));
    }
    const withdrew = sourceType === "contract_due";
    const withdrawal = withdrew
      ? (await (await detail(applicantToken)).json()).withdrawApprovalContext
      : undefined;
    if (withdrew) {
      expect(withdrawal).toEqual({ expectedApprovalInstanceId: round.id });
      expect((await post(applicantToken, `${path}/approval-withdrawal`, {})).status).toBe(409);
      expect((await (await detail(reviewerToken)).json()).withdrawApprovalContext).toBeUndefined();
    }
    const returned = withdrew
      ? await post(applicantToken, `${path}/approval-withdrawal`, withdrawal)
      : await post(reviewerToken, `${path}/approval`, {
        decision: sourceType === "contract_advance" ? "reject" : "return_to_applicant",
        comment: "请把申请金额改为三元",
        expectedPaymentUpdatedAt: pendingPayment.updatedAt.toISOString(), expectedApprovalInstanceId: round.id,
        expectedNodeIndex: signedRound.currentNodeIndex, expectedApprovalUpdatedAt: signedRound.updatedAt.toISOString()
      });
    expect(returned.status).toBe(201);
    const draft = await prisma.paymentRequest.findUniqueOrThrow({ where: { id: payment.id } });
    expect(draft.status).toBe("draft");
    const draftBody = { expectedUpdatedAt: draft.updatedAt.toISOString(), requestedAmountCents: "300" };
    const applicantDraft = await detail(applicantToken);
    expect(applicantDraft.status).toBe(200);
    expect(await applicantDraft.json()).toMatchObject({
      revisionSubmissionContext: { expectedUpdatedAt: draftBody.expectedUpdatedAt, requestedAmountCents: "400" },
      availableActionKeys: expect.arrayContaining(["revise_and_submit"]),
      ...(withdrew ? {
        returnReason: "申请已撤回，可修改后重新提交",
        meta: expect.arrayContaining([expect.objectContaining({ label: "审批状态", value: "撤回待修改" })])
      } : {})
    });
    const disallowed = await post(reviewerToken, `${path}/revision-submission`, draftBody);
    expect(disallowed.status).toBe(403);
    const tooMuch = await post(applicantToken, `${path}/revision-submission`, { ...draftBody, requestedAmountCents: "600" });
    expect(tooMuch.status).toBe(400);
    expect(await prisma.paymentRequest.findUnique({ where: { id: payment.id } })).toEqual(draft);
    const revisions = await Promise.all([
      post(applicantToken, `${path}/revision-submission`, draftBody),
      post(applicantToken, `${path}/revision-submission`, draftBody)
    ]);
    expect(revisions.map(result => result.status).sort()).toEqual([201, 409]);
    expect(await prisma.paymentRequest.findUnique({ where: { id: payment.id } })).toMatchObject({
      id: payment.id, status: "approval_pending", code: payment.code, sourceType: payment.sourceType,
      contractVersionId: version.id, paymentTermsVersionId: terms.id, requestedAmountCents: 300n,
      settlementId: payment.settlementId, signedSettlementId: payment.signedSettlementId,
      paymentTermsStageId: payment.paymentTermsStageId,
      approvedAmountCents: null, paidAmountCents: 0n
    });
    const latest = await prisma.approvalInstance.findFirstOrThrow({ where: {
      businessId: payment.id, status: "in_progress"
    } });
    expect(latest.id).not.toBe(round.id);
    expect(latest.currentNodeIndex).toBe(0);
    expect(await prisma.approvalActionLog.findUnique({ where: { id: signedAction.id } })).toEqual(signedAction);
    expect(await prisma.approvalInstance.findUnique({ where: { id: round.id } })).toMatchObject({
      status: withdrew ? "withdrawn" : "returned_to_applicant",
      frozenNodes: signedRound.frozenNodes
    });
    expect(await prisma.approvalActionLog.findMany({ where: {
      approvalInstanceId: round.id, action: withdrew ? "withdraw" : "return_to_applicant"
    } })).toEqual([expect.objectContaining({
      actorUserId: withdrew ? applicant : reviewer, comment: withdrew ? null : "请把申请金额改为三元",
      signatureFileIdSnapshot: null
    })]);
    expect(await prisma.approvalActionLog.count({ where: { approvalInstanceId: latest.id, action: "approve" } })).toBe(0);
    expect(await prisma.paymentExecution.count({ where: { paymentRequestId: payment.id } })).toBe(0);

    if (sourceType === "contract_due") {
      const replacementPayment = await prisma.paymentRequest.findUniqueOrThrow({ where: { id: payment.id } });
      expect((await post(applicantToken, `${path}/approval-withdrawal`, withdrawal)).status).toBe(409);
      expect(await prisma.approvalInstance.findUnique({ where: { id: latest.id } })).toEqual(latest);
      expect(await prisma.paymentRequest.findUnique({ where: { id: payment.id } })).toEqual(replacementPayment);
      expect(await prisma.approvalActionLog.count({ where: { approvalInstanceId: latest.id, action: "withdraw" } })).toBe(0);
      const delegate = await signatoryWithoutRole("13900004227", "parallel-last-duty.png");
      await prisma.approvalDelegation.create({ data: {
        fromUserId: reviewer, toUserId: delegate.userId, startsAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 120_000)
      } });
      for (const index of [4, 2, 0, 3, 1]) {
        const [open, source] = await Promise.all([
          prisma.approvalInstance.findUniqueOrThrow({ where: { id: latest.id } }),
          prisma.paymentRequest.findUniqueOrThrow({ where: { id: payment.id } })
        ]);
        const approval = {
          decision: "approve", expectedPaymentUpdatedAt: source.updatedAt.toISOString(), expectedApprovalInstanceId: open.id,
          expectedNodeIndex: index, expectedApprovalUpdatedAt: open.updatedAt.toISOString()
        };
        if (index === 1) {
          expect((await post(delegate.token, `${path}/approval`, { ...approval, approvedAmountCents: "200" })).status).toBe(400);
        }
        const accepted = await post(index === 1 ? delegate.token : reviewerToken, `${path}/approval`, approval);
        expect({ status: accepted.status, ...(accepted.status !== 201 ? { response: await accepted.text() } : {}) }).toEqual({ status: 201 });
      }
      expect(await prisma.approvalActionLog.findFirst({ where: {
        approvalInstanceId: latest.id, action: "approve", approvedRoleKey: "project_manager"
      } })).toMatchObject({ actorUserId: delegate.userId, representedUserId: reviewer, signatureFileIdSnapshot: delegate.fileId });
      expect(await prisma.businessEntrySubmissionSnapshot.findMany({ where: {
        projectId: project.id, sceneKey: "payment_approval_amount", entityType: "payment_request", entityId: payment.id
      } })).toEqual([expect.objectContaining({ frozenByUserId: delegate.userId, valuesSnapshot: { approvedAmountYuan: "3.00" },
        definitionSnapshot: PAYMENT_APPROVAL_AMOUNT_ENTRY_DEFINITION })]);
      await expect(prisma.$transaction(tx => app!.get(BusinessEntryTransactionService).freezeSubmissionSnapshotInTransaction(
        tx, delegate.userId, {
          sceneKey: "payment_approval_amount", definitionVersion: 1,
          target: { entityType: "payment_request", entityId: payment.id, projectId: project.id },
          values: { approvedAmountYuan: "3.00" }
        }
      ))).rejects.toMatchObject({ status: 403 });
      await expect(prisma.$transaction(tx => app!.get(BusinessEntryTransactionService).freezeFinalOrdinaryPaymentAmountInTransaction(
        tx, delegate.userId, project.id, payment.id, 300n
      ))).rejects.toMatchObject({ status: 403 });
      expect(await prisma.paymentRequest.findUnique({ where: { id: payment.id } })).toMatchObject({
        status: "approved_pending_payment", requestedAmountCents: 300n, approvedAmountCents: 300n, paidAmountCents: 0n
      });
      expect(await prisma.paymentExecution.count({ where: { paymentRequestId: payment.id } })).toBe(0);
      const formalForm = await fetch(`${base}/approval-forms/payment_request/${payment.id}/capability`, {
        headers: { authorization: `Bearer ${applicantToken}` }
      });
      expect(await formalForm.json()).toEqual({ available: true });
      const completedPdf = await post(applicantToken, `/approval-forms/payment_request/${payment.id}/download`, {
        confirmationPassword: password, downloadReason: "核对末岗签批后的正式付款审批单"
      });
      expect(completedPdf.status).toBe(201);
      expect(Buffer.from(await completedPdf.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");
      expect(await prisma.approvalActionLog.findMany({ where: { approvalInstanceId: latest.id, action: "approve" } }))
        .toHaveLength(5);

      const transferred = await signatoryWithoutRole("13900004226", "parallel-last-duty-transfer.png");
      const transferCode = `${code}-transfer`;
      const transferCreation = await post(applicantToken, "/payments", {
        code: transferCode, sourceType, contractVersionId: version.id, paymentTermsVersionId: terms.id,
        paymentTermsStageId: stage?.id, requestedAmountCents: "100"
      });
      expect({ status: transferCreation.status, ...(transferCreation.status !== 201 ? { response: await transferCreation.text() } : {}) })
        .toEqual({ status: 201 });
      const transferPayment = await prisma.paymentRequest.findUniqueOrThrow({ where: { code: transferCode } });
      const transferRound = await prisma.approvalInstance.findFirstOrThrow({ where: { businessId: transferPayment.id } });
      const transferPath = `/payments/${transferPayment.id}`;
      const approveTransferDuty = async (token: string, index: number) => {
        const [open, source] = await Promise.all([
          prisma.approvalInstance.findUniqueOrThrow({ where: { id: transferRound.id } }),
          prisma.paymentRequest.findUniqueOrThrow({ where: { id: transferPayment.id } })
        ]);
        const response = await post(token, `${transferPath}/approval`, {
          decision: "approve", expectedPaymentUpdatedAt: source.updatedAt.toISOString(), expectedApprovalInstanceId: open.id,
          expectedNodeIndex: index, expectedApprovalUpdatedAt: open.updatedAt.toISOString()
        });
        expect({ status: response.status, ...(response.status !== 201 ? { response: await response.text() } : {}) }).toEqual({ status: 201 });
      };
      await approveTransferDuty(reviewerToken, 0);
      expect((await post(reviewerToken, `${transferPath}/approval-transfer`, { toUserId: transferred.userId })).status).toBe(201);
      await withPaymentWriteFreeze(async () => {
        const [open, source] = await Promise.all([
          prisma.approvalInstance.findUniqueOrThrow({ where: { id: transferRound.id } }),
          prisma.paymentRequest.findUniqueOrThrow({ where: { id: transferPayment.id } })
        ]);
        await expect(app!.get(PaymentRequestService).migrateLegacyApprovalRound(transferPayment.id, applicant, {
          approvalInstanceId: open.id, paymentUpdatedAt: source.updatedAt, approvalUpdatedAt: open.updatedAt
        })).resolves
          .toMatchObject({ status: "mapped" });
      });
      for (const index of [4, 2, 3]) await approveTransferDuty(reviewerToken, index);
      await approveTransferDuty(transferred.token, 1);
      expect(await prisma.paymentRequest.findUnique({ where: { id: transferPayment.id } })).toMatchObject({
        status: "approved_pending_payment", requestedAmountCents: 100n, approvedAmountCents: 100n, paidAmountCents: 0n
      });
      expect(await prisma.approvalActionLog.findFirst({ where: {
        approvalInstanceId: transferRound.id, action: "approve", approvedRoleKey: "project_manager"
      } })).toMatchObject({ actorUserId: transferred.userId, representedUserId: reviewer, signatureFileIdSnapshot: transferred.fileId });
      expect(await prisma.businessEntrySubmissionSnapshot.findMany({ where: {
        projectId: project.id, sceneKey: "payment_approval_amount", entityType: "payment_request", entityId: transferPayment.id
      } })).toEqual([expect.objectContaining({ frozenByUserId: transferred.userId, valuesSnapshot: { approvedAmountYuan: "1.00" } })]);
    }

    if (sourceType === "contract_advance" || sourceType === "signed_settlement") {
      const resubmitted = await prisma.paymentRequest.findUniqueOrThrow({ where: { id: payment.id } });
      const returnedAgain = await post(reviewerToken, `${path}/approval`, {
        decision: "return_to_applicant", comment: "再次核对金额",
        expectedPaymentUpdatedAt: resubmitted.updatedAt.toISOString(), expectedApprovalInstanceId: latest.id,
        expectedNodeIndex: latest.currentNodeIndex, expectedApprovalUpdatedAt: latest.updatedAt.toISOString()
      });
      expect(returnedAgain.status).toBe(201);
      const returnedDraft = await prisma.paymentRequest.findUniqueOrThrow({ where: { id: payment.id } });
      const expectedUpdatedAt = returnedDraft.updatedAt.toISOString();
      if (sourceType === "signed_settlement") {
        const settlement = await Promise.all([
          post(applicantToken, `${path}/revision-submission`, { expectedUpdatedAt, requestedAmountCents: "200" }),
          post(applicantToken, `${path}/abandonment`, { expectedUpdatedAt, reason: "不再办理" })
        ]);
        expect(settlement.map(result => result.status).sort()).toEqual([201, 409]);
      } else {
        // A restored draft can have contradictory historical data. A full refund
        // does not erase the original execution or permit submitting it as a draft.
        const execution = await prisma.paymentExecution.create({ data: {
          paymentRequestId: payment.id, idempotencyKey: "revision-paid-once", amountCents: 300n,
          paidAt: new Date("2026-10-03"), executedByUserId: reviewer, companyEntityIdSnapshot: company.id,
          companyEntityNameSnapshot: company.name, companyEntityCreditCodeSnapshot: "91310000TEST000001"
        } });
        await prisma.paymentExecutionRefund.create({ data: {
          paymentExecutionId: execution.id, paymentRequestId: payment.id, projectId: project.id,
          idempotencyKey: "revision-fully-refunded", amountCents: 300n, receivedAt: new Date("2026-10-04"),
          reason: "虚构全额退回", recordedByUserId: reviewer, payloadFingerprint: "fully-refunded"
        } });
        const refunded = await detail(applicantToken);
        expect(refunded.status).toBe(200);
        expect(await refunded.json()).toMatchObject({
          paidAmountCents: "0", availableActionKeys: expect.not.arrayContaining(["revise_and_submit"])
        });
        const rejected = await post(applicantToken, `${path}/revision-submission`, { expectedUpdatedAt, requestedAmountCents: "200" });
        expect(rejected.status).toBe(409);
        expect(await prisma.paymentExecution.findUnique({ where: { id: execution.id } })).toEqual(execution);
        expect(await prisma.paymentRequest.findUnique({ where: { id: payment.id } })).toEqual(returnedDraft);
      }
    }
  } finally {
    await app?.close();
    await prisma.$disconnect();
    environment.restore();
    await rm(storageRoot, { recursive: true, force: true });
  }
}, 60_000);
