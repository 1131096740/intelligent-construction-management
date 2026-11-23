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
import { PrivateFileStorage } from "../file/file.service";
import { createApiValidationPipe } from "../validation/api-validation";

const run = process.env.ISSUE424_PAYMENT_REHEARSAL_URL ? it : it.skip;

run.each(["contract_advance", "contract_due", "settlement", "signed_settlement"] as const)(
  "the original applicant can correct a returned %s amount and submit a fresh round against the same basis",
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
    const signedAction = await prisma.approvalActionLog.findFirstOrThrow({ where: { approvalInstanceId: round.id, action: "approve" } });
    expect(signedAction).toMatchObject({ signatureVersionIdSnapshot: signatureVersion.id, signatureSha256Snapshot: digest });
    const returned = await post(reviewerToken, `${path}/approval`, {
      decision: "return_to_applicant", comment: "请把申请金额改为三元",
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
      availableActionKeys: expect.arrayContaining(["revise_and_submit"])
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
    expect(await prisma.approvalActionLog.findMany({ where: { approvalInstanceId: round.id, action: "return_to_applicant" } }))
      .toEqual([expect.objectContaining({ comment: "请把申请金额改为三元", signatureFileIdSnapshot: null })]);
    expect(await prisma.approvalActionLog.count({ where: { approvalInstanceId: latest.id, action: "approve" } })).toBe(0);
    expect(await prisma.paymentExecution.count({ where: { paymentRequestId: payment.id } })).toBe(0);

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
