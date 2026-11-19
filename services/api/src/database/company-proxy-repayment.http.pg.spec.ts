import { buildRegisteredPgFixturePlan } from "./registered-payment-postgres.fixture";
import { seedSharedPaymentPredecessors } from "./task16-shared-standard-fixture";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { companyTransferWorkItems } from "../company-transfer/company-transfer-workitems";
import { OperatingLedgerService } from "../operating-ledger/operating-ledger.service";
import { OperatingSourceReplayService } from "../operating-ledger/operating-source-replay.service";
import "reflect-metadata";
import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { appendRegisteredOperationalPayment, readRegisteredOperationalPayment } from "../fund-account/registered-operational-payment";
import { hash } from "bcryptjs";
import { createHash, randomUUID } from "node:crypto";
import { AppModule } from "../app.module";
import { createApiValidationPipe } from "../validation/api-validation";
import { apiJsonReplacer } from "../api-json-replacer";
import { createCompanyTransferFixture } from "./company-transfer-fixture";
import { PrismaService } from "./prisma.service";

const run = process.env.RUN_COMPANY_PROXY_REPAYMENT_HTTP === "1" ? describe : describe.skip;
run("project company proxy repayment on real PostgreSQL", () => {
  jest.setTimeout(90000);
  let app: INestApplication;
  let db: PrismaService;
  let base: string;
  const password = "isolated-company-transfer-fixture";
  const tokens = new Map<string, string>();

  beforeAll(async () => {
    const target = new URL(process.env.DATABASE_URL ?? "");
    if (process.env.NODE_ENV !== "test" || target.hostname !== "127.0.0.1" ||
        target.pathname !== "/jiangkong_payment_execution_concurrency" || !process.env.TASK410_ISOLATED_RUN_ID) {
      throw new Error("Only the isolated synthetic runtime is supported");
    }
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication({ logger: ["error"] });
    app.getHttpAdapter().getInstance().set("json replacer", apiJsonReplacer);
    app.useGlobalPipes(createApiValidationPipe());
    await app.listen(0, "127.0.0.1");
    db = app.get(PrismaService);
    base = await app.getUrl();
    const writeSecret = process.env.OPERATING_LEDGER_DB_WRITE_SECRET!;
    await db.$executeRaw`INSERT INTO "OperatingLedgerWriteSecret" ("id","secretHash")
      VALUES (1,crypt(${writeSecret},gen_salt('bf'))) ON CONFLICT ("id") DO UPDATE SET "secretHash"=EXCLUDED."secretHash"`;
  });
  afterAll(async () => { await app?.close(); });

  async function actor(roles: Array<{ role: string; projectId?: string }>) {
    const user = await db.user.create({ data: {
      name: "隔离合成经办", phone: `137${String(tokens.size + 1).padStart(8, "0")}`,
      passwordHash: await hash(password, 4), isActive: true, mustChangePassword: false,
    } });
    for (const { role, projectId } of roles) {
      const position = await db.position.upsert({ where: { key: role }, update: {}, create: { key: role, name: role } });
      await db.userPosition.create({ data: { userId: user.id, positionId: position.id, projectId } });
    }
    await loginActor(user.id, user.phone!);
    return user.id;
  }

  async function loginActor(userId: string, phone: string) {
    const login = await fetch(`${base}/auth/login`, {
      headers: { "content-type": "application/json" }, method: "POST", body: JSON.stringify({ phone: phone, password }),
    });
    expect(login.status).toBe(201);
    tokens.set(userId, (await login.json()).tokens.accessToken);
    const form = new FormData();
    form.append("file", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64")], { type: "image/png" }), "签名.png");
    const signature = await fetch(`${base}/me/signature/canvas`, {
      headers: { authorization: `Bearer ${tokens.get(userId)}` }, method: "POST", body: form,
    });
    expect(signature.status).toBe(201);

  }

  async function call(userId: string, path: string, body?: unknown, expectedStatus = body === undefined ? 200 : 201) {
    const response = await fetch(`${base}${path}`, {
      headers: { "content-type": "application/json", authorization: `Bearer ${tokens.get(userId)}` },
      ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
    });
    const payload = await response.json();
    if (response.status !== expectedStatus) throw new Error(`Unexpected HTTP status ${response.status}, expected ${expectedStatus}: ${payload.message}`);
    return payload;
  }

  async function evidence(userId: string) {
    return db.fileObject.create({ data: { originalName: "隔离合成依据.pdf", mimeType: "application/pdf",
      sizeBytes: 100, bucket: "private-local", objectKey: `task410/${randomUUID()}`,
      storageStatus: "active", uploadedByUserId: userId, contentSha256: "a".repeat(64) } });
  }

  it("uses the original company pair, reserves principal, and requires each signed pending duty", async () => {
    const a = await createCompanyTransferFixture(db, "甲合成公司");
    const b = await createCompanyTransferFixture(db, "乙合成公司");
    const applicant = await actor([{ role: "comprehensive_director" }]);
    const finance = await actor([{ role: "finance_director" }]);
    const manager = await actor([{ role: "project_manager", projectId: a.projectId }]);
    const leader = await actor([{ role: "general_manager" }]);
    const otherProjectManager = await actor([{ role: "project_manager", projectId: b.projectId }]);
    const reconciler = await actor([{ role: "finance_staff", projectId: a.projectId }]);
    for (const company of [a, b]) {
      await db.projectParticipatingCompany.create({ data: {
        projectId: a.projectId, companyEntityId: company.companyId, companyEntityVersionId: company.companyVersionId,
        companyNameSnapshot: "合成原代付公司", companyCreditCodeSnapshot: company.companyCreditCode,
        effectiveFrom: new Date("2026-07-01"), changeReason: "隔离合成", addedByUserId: a.recorderId,
      } });
    }
    await db.projectReceipt.create({ data: {
      projectId: a.projectId, receivedAt: new Date("2026-08-01"), amountCents: 100000n,
      payerName: "隔离合成期初资金", sourceType: "other", voucherFileId: (await evidence(reconciler)).id, recordedByUserId: reconciler,
    } });
    const aAccount = "122233334444", bAccount = "222233334444";
    const verified = async (companyId: string, accountNumber: string, direction: "outflow" | "inflow", amountCents: string) => {
      const bank = await call(reconciler, "/contract-bank-verifications", { projectId: a.projectId, companyEntityId: companyId,
        accountNumber, bankReference: randomUUID(), direction, amountCents, occurredAt: "2026-08-20",
        evidenceFileId: (await evidence(reconciler)).id, reason: "合成原代付款流水", idempotencyKey: randomUUID(), confirmationPassword: password,
      });
      await call(finance, `/contract-bank-verifications/${bank.id}/decision`, { decision: "confirm", accountNumber,
        holderEvidenceFileId: (await evidence(finance)).id, confirmationPassword: password,
      });
      return (await db.contractBankVerificationRequest.findUniqueOrThrow({ where: { id: bank.id } })).observationId!;
    };
    const newDebt = async (amountCents: bigint) => {
      const observationId = await verified(b.companyId, bAccount, "outflow", amountCents.toString());
      const originalEvidence = await evidence(a.recorderId);
      const original = await db.contractProxyExecution.create({ data: {
        projectId: a.projectId, sourceRef: "isolated-original-contract-payment", entryKind: "payment",
        amountCents, occurredAt: new Date("2026-08-20"), actualPayerKey: `participating_company:${b.companyId}`,
        bankReference: randomUUID(), evidenceFileId: originalEvidence.id, evidenceSha256: originalEvidence.contentSha256!,
        reason: "合成原代付", status: "pending_confirm", recordedByUserId: a.recorderId, bankObservationId: observationId,
        frozenSource: { debtor: { kind: "participating_company", id: a.companyId }, actualPayer: { kind: "participating_company", id: b.companyId } },
        idempotencyKey: randomUUID(), requestFingerprint: "isolated-test-original",
      } });
      await db.contractProxyBankClaim.create({ data: { observationId, proxyExecutionId: original.id } });
      await db.contractProxyExecution.update({ where: { id: original.id }, data: { status: "confirmed", confirmedByUserId: a.directorId,
        confirmedAt: new Date("2026-08-20"), confirmationSignatureVersionId: a.signatureVersionId } });
      return original;
    };
    const original = await newDebt(800n);
    const correctionTarget = await newDebt(400n);
    const request = {
      kind: "repayment", originalProxyId: original.id, sourceCompanyId: a.companyId, destinationCompanyId: b.companyId,
      sourceProjectId: a.projectId, destinationProjectId: a.projectId, sourceAccount: aAccount,
      destinationAccount: bAccount, amountCents: "500", reason: "合成分次归还",
      evidenceFileId: (await evidence(applicant)).id, confirmationPassword: password, idempotencyKey: randomUUID(),
    };
    const sourcePath = `/company-transfers?projectId=${a.projectId}&originalSource=proxy:${original.id}`;
    await call(applicant, `${sourcePath}&originalSource=proxy:${original.id}`, undefined, 400);
    await call(applicant, "/company-transfers?transferId=one&transferId=two", undefined, 400);
    expect((await call(applicant, sourcePath)).canCreate).toBe(true);
    expect((await call(finance, sourcePath)).canCreate).toBe(false);
    const submitted = await call(applicant, "/company-transfers", request);
    expect(await call(applicant, "/company-transfers", request)).toEqual(submitted);
    const dutyPath = `/company-transfers/${submitted.id}/duty-sms`;
    const queued = (businessType: string) => db.auditLog.findMany({
      where:{businessType,businessId:submitted.id,action:"queued"},
    });
    const reviewRows = await queued("company_transfer_final_review_duty_notification");
    const recipients = reviewRows.map(row => row.metadata as {nodeIndex:number;recipientId:string});
    expect(recipients).toEqual(expect.arrayContaining([
      expect.objectContaining({nodeIndex:0,recipientId:applicant}),expect.objectContaining({nodeIndex:1,recipientId:manager}),
      expect.objectContaining({nodeIndex:2,recipientId:finance}),expect.objectContaining({nodeIndex:3,recipientId:leader}),
    ]));
    expect(new Set(recipients.map(row=>`${row.nodeIndex}:${row.recipientId}`)).size).toBe(reviewRows.length);
    expect(recipients.some(row=>row.recipientId===otherProjectManager)).toBe(false);
    expect((await call(manager,dutyPath)).notices).toEqual([
      expect.objectContaining({dutyName:"项目经理",status:"queued",canRetry:false}),
    ]);
    expect((await call(otherProjectManager,dutyPath)).notices).toEqual([]);

    const evidenceCapability = `/files/${request.evidenceFileId}/download-ticket-capability`;
    expect((await call(manager, evidenceCapability)).action.enabled).toBe(true);
    expect((await call(applicant, evidenceCapability)).action.enabled).toBe(true);
    await call(otherProjectManager, evidenceCapability, undefined, 403);
    await call(applicant, "/company-transfers", { ...request, amountCents: "301", idempotencyKey: randomUUID() }, 409);
    expect((await call(applicant, sourcePath)).originalProxies[0].availableCents).toBe("300");

    const decision = `/company-transfers/${submitted.id}/decision`;
    const approve = { action: "approve", confirmationPassword: password };
    await call(leader, decision, { ...approve, nodeIndex: 3 });
    await call(applicant, decision, { ...approve, nodeIndex: 0 }, 400);
    expect(await db.companyTransfer.findUnique({ where: { id: submitted.id }, select: { status: true } })).toEqual({ status: "submitted" });
    await call(applicant, `/company-transfers/${submitted.id}/events`, { kind: "outgoing", observationId: randomUUID(),
      idempotencyKey: randomUUID(), confirmationPassword: password }, 409);
    await call(manager, decision, { ...approve, nodeIndex: 1 });
    expect((await call(manager,dutyPath)).notices).toEqual([]);

    await call(manager, evidenceCapability, undefined, 403);
    await call(applicant, decision, { ...approve, nodeIndex: 0, selfReviewReason: "合成职责自审" });
    const final = await call(finance, decision, { ...approve, nodeIndex: 2 });
    expect(final.status).toBe("approved");
    expect((await call(applicant,dutyPath)).notices).toEqual([
      expect.objectContaining({dutyName:"登记实际出款",status:"queued",canRetry:false}),
    ]);
    expect((await queued("company_transfer_cash_duty_notification")).map(row=>row.metadata)).toContainEqual(
      {key:"outgoing",recipientId:applicant},
    );


    const row = await db.companyTransfer.findUniqueOrThrow({ where: { id: submitted.id } });
    expect(row).toMatchObject({ requiresParallelRepaymentApproval: true, approvedByUserId: leader, originalProxyId: original.id });
    const signed = await db.approvalActionLog.findMany({ where: { approvalInstanceId: row.approvalInstanceId!, action: "approve" } });
    expect(signed).toHaveLength(4);
    expect(signed.every(action => !!action.signatureVersionIdSnapshot)).toBe(true);
    expect(await db.companyTransferEvent.count({ where: { transferId: submitted.id } })).toBe(0);
    const eventPath = `/company-transfers/${submitted.id}/events`;
    const transferView = `/company-transfers?transferId=${submitted.id}`;
    const outgoingIds: string[] = [];
    for (const [index, amount] of ["200", "300"].entries()) {
      const outgoingInput = { kind: "outgoing", observationId: await verified(a.companyId, aAccount, "outflow", amount),
        idempotencyKey: randomUUID(), confirmationPassword: password };
      const outgoing = await call(applicant, eventPath, outgoingInput);
      const cashIntents = (await queued("company_transfer_cash_duty_notification")).map(row=>row.metadata);
      expect(cashIntents).toContainEqual({key:outgoing.id,recipientId:finance});
      expect(cashIntents).not.toContainEqual({key:outgoing.id,recipientId:applicant});

      outgoingIds.push(outgoing.id);
      if (index === 0) {
        await call(finance, `${eventPath}/${outgoing.id}/original-debt-corrections`, {
          targetOriginalSource: `proxy:${correctionTarget.id}`, reason: "尚未到账核销",
          idempotencyKey: randomUUID(),
        }, 409);
      }
      expect(await call(applicant, eventPath, outgoingInput)).toEqual(outgoing);
      expect((await call(finance, transferView)).rows[0].inTransitCents).toBe(amount);
      const incomingInput = { kind: "incoming", outgoingEventId: outgoing.id,
        observationId: await verified(b.companyId, bAccount, "inflow", amount),
        idempotencyKey: randomUUID(), confirmationPassword: password };
      await call(applicant, eventPath, incomingInput, 403);
      await call(finance, eventPath, incomingInput);
      expect((await call(finance, transferView)).rows[0].inTransitCents).toBe("0");
      expect((await call(applicant, sourcePath)).originalProxies[0].remainingCents).toBe(index === 0 ? "600" : "300");
    }
    expect(await db.companyTransferEvent.count({ where: { transferId: submitted.id } })).toBe(4);
    const correctionPath = `${eventPath}/${outgoingIds[0]}/original-debt-corrections`;
    const correctionIntent = { targetOriginalSource: `proxy:${correctionTarget.id}`, reason: "原债引用填错",
      idempotencyKey: randomUUID() };
    await call(applicant, correctionPath, correctionIntent, 403);
    const originalClaimCount = await db.companyTransferBankClaim.count();
    const mistakenEvent = await db.companyTransferEvent.findUniqueOrThrow({ where: { id: outgoingIds[0] } });
    const pending = await call(finance, correctionPath, correctionIntent);
    expect(pending.status).toBe("pending");
    expect(await call(finance, correctionPath, correctionIntent)).toEqual(pending);
    const correctionKind = "company_transfer_correction_duty_notification";
    const correctionDuties = async (actorId: string) =>
      (await companyTransferWorkItems(db,actorId,new ProjectVisibilityService(db))).filter(row=>row.id.startsWith("company_transfer_correction:"));
    const noticeIntents = await queued(correctionKind);
    expect(noticeIntents.map(row=>row.metadata)).toEqual([{recipientId:finance,key:outgoingIds[0]}]);
    expect(await correctionDuties(finance)).toMatchObject([{
      id:`company_transfer_correction:${outgoingIds[0]}`,
      targetPath:`/公司互转台账?transferId=${submitted.id}&correctionEventId=${outgoingIds[0]}`,
    }]);
    expect(await correctionDuties(applicant)).toEqual([]);
    expect((await call(finance,dutyPath)).notices).toContainEqual(
      expect.objectContaining({dutyName:"复核归还原债更正",status:"queued",canRetry:false}),
    );
    expect((await call(applicant,dutyPath)).notices).not.toContainEqual(
      expect.objectContaining({dutyName:"复核归还原债更正"}),
    );

    expect((await call(finance, `${correctionPath}?idempotencyKey=${correctionIntent.idempotencyKey}`)).result).toEqual(pending);
    expect((await call(applicant, sourcePath)).originalProxies[0].remainingCents).toBe("300");
    const decisionPath = `${correctionPath}/${pending.id}/confirm`;
    const confirm = { idempotencyKey: randomUUID(), confirmationPassword: password };
    await call(finance, decisionPath, confirm, 400);
    const command = { ...confirm, selfReviewReason: "财务主管亲自发起后的复核确认" };
    const confirmed = await call(finance, decisionPath, command);
    expect(confirmed.status).toBe("confirmed");
    expect(await call(finance, decisionPath, command)).toEqual(confirmed);
    expect((await call(finance, `${correctionPath}?idempotencyKey=${confirm.idempotencyKey}`)).result).toEqual(confirmed);
    expect(await correctionDuties(finance)).toEqual([]);
    expect((await call(finance,dutyPath)).notices).not.toContainEqual(
      expect.objectContaining({dutyName:"复核归还原债更正"}),
    );

    expect(await db.companyTransferEvent.findUniqueOrThrow({ where: { id: outgoingIds[0] } })).toEqual(mistakenEvent);
    expect((await call(applicant, sourcePath)).originalProxies[0]).toMatchObject({ remainingCents: "500", availableCents: "500" });
    const correctedPath = `/company-transfers?projectId=${a.projectId}&originalSource=proxy:${correctionTarget.id}`;
    const correctedLedger = await call(finance, correctedPath);
    expect(correctedLedger.originalProxies[0]).toMatchObject({ remainingCents: "200", availableCents: "200" });
    expect(correctedLedger.rows[0]).toMatchObject({ id: submitted.id, events: expect.arrayContaining([
      expect.objectContaining({ id: outgoingIds[0], effectiveOriginalSource: `proxy:${correctionTarget.id}` }),
      expect.objectContaining({ kind: "incoming", outgoingEventId: outgoingIds[0], effectiveOriginalSource: `proxy:${correctionTarget.id}` }),
    ]) });
    await call(finance, `${eventPath}/${outgoingIds[1]}/original-debt-corrections`, {
      ...correctionIntent, idempotencyKey: randomUUID(),
    }, 409);
    expect(await db.companyTransferOriginalDebtCorrection.count()).toBe(1);
    expect(await db.companyTransferBankClaim.count()).toBe(originalClaimCount);
    expect(await db.companyTransferEvent.count({ where: { transferId: submitted.id } })).toBe(4);
    await expect(db.companyTransfer.findMany({ where: { originalProxyId: original.id } })).resolves.toHaveLength(1);
  });
  it("debits an operational payment once and exposes its original A–B debt without a second payment", async () => {
    const a = await createCompanyTransferFixture(db, "甲合成原债务");
    const b = await createCompanyTransferFixture(db, "乙合成真实付款");
    const accountant = await actor([{ role: "finance_staff" }]);
    const scopeKey = `company:${b.companyId}`;
    const opening = await call(accountant, "/fund-accounts/openings", {
      scopeKey, balanceYuan: "11.0000", asOfDate: "2026-08-19", evidenceReference: "合成期初",
      reconciliationNote: "期初核对", reason: "隔离资金", idempotencyKey: randomUUID(),
      sources: [
        { amountYuan: "8.0000", sourceStatus: "known", sourceName: "合成项目资金", projectStatus: "project", projectId: a.projectId },
        { amountYuan: "3.0000", sourceStatus: "pending", projectStatus: "pending" },
      ],
    });
    const [projectSource, unknownSource] = opening.sources as Array<{ id: string }>;
    const claim = await db.expenseClaim.create({ data: {
      code: `expense-task410-${randomUUID()}`, claimType: "reimbursement", status: "approved_pending_payment",
      companyEntityId: a.companyId, companyEntityNameSnapshot: "合成原债务公司", projectId: a.projectId,
      applicantUserId: accountant, applicantNameSnapshot: "合成申请人", handledByUserId: accountant,
      handledByNameSnapshot: "合成经办", reason: "合成已批准原费用", requestedAmountCents: 800n, companyPayableAmountCents: 800n,
    } });
    const voucher = await evidence(accountant);
    const input = {
      sourceType: "expense_claim_payment_execution" as const, executionId: randomUUID(), actorUserId: accountant,
      projectId: a.projectId, originalDebtorCompanyId: a.companyId, amountCents: 800n, paidAt: new Date("2026-08-20"),
      funding: { scopeKey, expectedRegistrationId: opening.id, sourceAllocations: [{ sourceBatchId: projectSource.id, amountCents: "800" }] },
    };
    const append = (data: typeof input) => db.$transaction(async tx => {
      await tx.expenseClaimPaymentExecution.create({ data: {
        id: data.executionId, expenseClaimId: claim.id, amountCents: data.amountCents, paidAt: data.paidAt,
        paymentMethod: "bank_transfer", voucherFileId: voucher.id, recordedByUserId: accountant,
      } });
      return appendRegisteredOperationalPayment(tx, data);
    });
    await expect(append({ ...input, paidAt: new Date("2026-08-19") })).rejects.toThrow("已覆盖付款日期");
    await expect(append({ ...input, funding: { ...input.funding, sourceAllocations: [
      { sourceBatchId: projectSource.id, amountCents: "500" }, { sourceBatchId: unknownSource.id, amountCents: "300" },
    ] } })).rejects.toThrow("资金来源");
    expect(await db.expenseClaimPaymentExecution.count({ where: { expenseClaimId: claim.id } })).toBe(0);
    const result = await append(input);
    expect(result).toMatchObject({ actualPayerCompanyId: b.companyId });
    expect(result.relationshipEntryId).not.toBeNull();
    expect(await db.$transaction(tx => readRegisteredOperationalPayment(tx, input))).toEqual(result);
    expect(await db.expenseClaimPaymentExecution.count({ where: { expenseClaimId: claim.id } })).toBe(1);
    await expect(db.projectFundingAllocation.create({ data: {
      projectId: a.projectId, executionType: input.sourceType, executionId: input.executionId,
      businessType: "expense_claim", businessId: claim.id, sourceType: "project_cash_pool",
      sourceKey: a.projectId, amountCents: input.amountCents, occurredAt: input.paidAt,
      createdByUserId: accountant, direction: "consume",
    } })).rejects.toThrow("cannot have a second project funding debit");
    expect(await db.projectFundingAllocation.count({ where: { executionId: input.executionId } })).toBe(0);
    const fact = await db.registeredOperationalPayment.findUniqueOrThrow({ where: { id: result.relationshipEntryId! }, include: {
      registration: { include: { sources: { orderBy: { lineNo: "asc" } } } },
    } });
    expect(fact.registration.balanceYuan!.toFixed(4)).toBe("3.0000");
    expect(fact.registration.sources.map(row => row.amountYuan.toFixed(4))).toEqual(["0.0000", "3.0000"]);
    const debt = await call(accountant, `/company-transfers?projectId=${a.projectId}&originalSource=operational:${fact.id}`);
    expect(debt).toMatchObject({ originalSourceFound: true, canCreate: false, legacyOptions: [{
      originalOperationalPaymentId: fact.id, sourceCompanyId: a.companyId, destinationCompanyId: b.companyId,
      remainingCents: "800", availableCents: "800",
    }] });
    const director = await actor([{ role: "finance_director" }]);
    const accountNumber = "433333334444";
    const inflow = await call(accountant, "/contract-bank-verifications", {
      projectId: null, companyEntityId: b.companyId, accountNumber, bankReference: randomUUID(),
      direction: "inflow", amountCents: "300", occurredAt: "2026-08-19", evidenceFileId: (await evidence(accountant)).id,
      reason: "合成公司自有入账", idempotencyKey: randomUUID(), confirmationPassword: password,
    });
    await call(director, `/contract-bank-verifications/${inflow.id}/decision`, {
      decision: "confirm", accountNumber, holderEvidenceFileId: (await evidence(director)).id, confirmationPassword: password,
    });
    const owned = await call(director, "/fund-account-advance-receipts/company-owned", {
      scopeKey, expectedRegistrationId: fact.registrationId, idempotencyKey: randomUUID(),
      observationReference: `contract-bank:${inflow.id}`, ownershipEvidence: "隔离合成公司自有资金",
    });
    const accountList = await call(accountant, "/fund-accounts?includeSourceOwnership=true");
    expect(accountList.accounts.find((row: { scopeKey: string }) => row.scopeKey === scopeKey).sources)
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: owned.sourceBatchId, isCompanyOwnedUnadvanced: true })]));
    const secondClaim = await db.expenseClaim.create({ data: {
      code: `expense-task410-${randomUUID()}`, claimType: "reimbursement", status: "approved_pending_payment",
      companyEntityId: a.companyId, companyEntityNameSnapshot: "合成原债务公司", projectId: a.projectId,
      applicantUserId: accountant, applicantNameSnapshot: "合成申请人", handledByUserId: accountant,
      handledByNameSnapshot: "合成经办", reason: "另一份合成已批准原费用", requestedAmountCents: 300n, companyPayableAmountCents: 300n,
    } });
    const secondVoucher = await evidence(accountant);
    const second = await db.$transaction(async tx => {
      const execution = await tx.expenseClaimPaymentExecution.create({ data: {
        expenseClaimId: secondClaim.id, amountCents: 300n, paidAt: input.paidAt,
        paymentMethod: "bank_transfer", voucherFileId: secondVoucher.id, recordedByUserId: accountant,
      } });
      return appendRegisteredOperationalPayment(tx, { ...input, executionId: execution.id, amountCents: 300n, funding: {
        scopeKey, expectedRegistrationId: owned.registrationId, sourceAllocations: [{ sourceBatchId: owned.sourceBatchId, amountCents: "300" }],
      } });
    });
    expect(second).toMatchObject({ actualPayerCompanyId: b.companyId });
    const secondDebt = await call(accountant, `/company-transfers?projectId=${a.projectId}&originalSource=operational:${second.relationshipEntryId}`);
    expect(secondDebt.legacyOptions).toEqual([expect.objectContaining({
      sourceCompanyId: a.companyId, destinationCompanyId: b.companyId, remainingCents: "300",
    })]);
    expect(await db.registeredPaymentProjectAdvance.count()).toBe(0);
    expect(await db.registeredFundCompanyOwnedReceipt.count()).toBe(1);

  });

  it.each([
    { name: "relinks a settled registered contract debt to an operational proxy in the same project ledger", canonical: "none" },
    { name: "relinks to the canonical contract proxy ledger without duplicating cash", canonical: "target" },
    { name: "relinks from the canonical contract proxy ledger without duplicating cash", canonical: "source" },
  ])("$name", async ({ canonical }) => {
    const allocatedRunId = process.env.TASK410_ISOLATED_RUN_ID!;
    const runId = createHash("sha256").update(`${allocatedRunId}:${canonical}`).digest("hex").slice(0, 12);
    const plan = buildRegisteredPgFixturePlan(runId, "2026-11-07", "2026-11-01");
    const { actor: finance, project: projectId, companyA, companyB, payment: paymentId, approvedRound, settlement } = plan.ids;
    const encodedPassword = await hash(password, 4);
    const seeded = await seedSharedPaymentPredecessors(db, plan, {
      financeHash: encodedPassword, keeperHash: encodedPassword, directorHash: encodedPassword,
    }, process.env.FILE_STORAGE_ROOT!);
    const keeper = seeded.keeper, director = seeded.director;
    if (canonical !== "none") {
      const archiveEvidence = await evidence(finance);
      const firstDay = new Date(plan.openingDate);
      await db.contractFormalFile.create({ data: {
        id: randomUUID(), contractVersionId: plan.ids.version, purpose: "mutually_signed_final",
        fileId: archiveEvidence.id, contentSha256: archiveEvidence.contentSha256!, pageCount: 1, sourceRevision: 1,
        status: "active", uploadedByUserId: finance, declarationSnapshot: {}, declaredByUserId: finance,
        declaredAt: firstDay, confirmedAt: firstDay, confirmedByUserId: director, confirmationSnapshot: {},
      } });
    }
    await loginActor(finance, plan.phone);
    await loginActor(keeper, seeded.keeperPhone);
    await loginActor(director, seeded.directorPhone);
    const leader = await actor([{ role: "general_manager" }]);
    const manager = await actor([{ role: "project_manager", projectId }]);
    const payerCompany = await db.companyEntity.findUniqueOrThrow({ where: { id: companyB } });
    await db.projectParticipatingCompany.create({ data: {
      projectId, companyEntityId: companyB, companyEntityVersionId: plan.ids.companyVersionB,
      companyNameSnapshot: payerCompany.name, companyCreditCodeSnapshot: payerCompany.unifiedSocialCreditCode!,
      effectiveFrom: new Date(plan.openingDate), changeReason: "隔离合成", addedByUserId: finance,
    } });
    await db.projectReceipt.create({ data: { projectId, receivedAt: new Date(plan.openingDate), amountCents: 100000n,
      payerName: "合成期初资金", sourceType: "other", voucherFileId: (await evidence(finance)).id, recordedByUserId: finance } });
    const request = await db.paymentRequest.findUniqueOrThrow({ where: { id: paymentId } });
    const round = await db.approvalInstance.findUniqueOrThrow({ where: { id: approvedRound } });
    await call(director, `/payments/${paymentId}/approval`, {
      decision: "approve", expectedPaymentUpdatedAt: request.updatedAt.toISOString(),
      expectedApprovalInstanceId: round.id, expectedNodeIndex: 0, expectedApprovalUpdatedAt: round.updatedAt.toISOString(),
    });
    await app.get(OperatingSourceReplayService).replaySource({ projectId, sourceType: "settlement", sourceBusinessId: settlement }, finance);
    const scopeKey = `company:${companyB}`;
    const balance = await call(finance, "/fund-accounts/openings", {
      scopeKey, balanceYuan: "30", asOfDate: plan.openingDate, evidenceReference: "合成期初",
      reconciliationNote: "合成项目资金", reason: "隔离核对", idempotencyKey: randomUUID(),
      sources: [{ amountYuan: "30", sourceStatus: "known", sourceName: "合成", projectStatus: "project", projectId }],
    });
    const options = await call(finance, `/payment-executions/${paymentId}/registration-options`);
    const execution = await call(finance, `/payment-executions/${paymentId}/registrations`, {
      idempotencyKey: randomUUID(), expectedPaymentUpdatedAt: options.expectedPaymentUpdatedAt, amountCents: "800",
      paidAt: plan.paidAt, scopeKey, expectedRegistrationId: balance.id, openingTreatment: "not_included",
      openingReason: "合成实付不含期初", openingEvidence: "隔离登记", confirmationPassword: password,
      sourceAllocations: [{ sourceBatchId: balance.sources[0].id, amountCents: "800" }],
    });
    const registeredDebt = await db.interEntityRelationshipEntry.findFirstOrThrow({ where: { paymentExecutionId: execution.id } });
    expect(registeredDebt).toMatchObject({ sourceType: "registered_payment_execution",
      originalDebtorCompanyId: companyA, creditorCompanyId: companyB, amountCents: 800n });
    const expense = await db.expenseClaim.create({ data: {
      code: `expense-task410-${randomUUID()}`, claimType: "reimbursement", status: "approved_pending_payment",
      companyEntityId: companyA, companyEntityNameSnapshot: "合成原债公司", projectId,
      paymentSubjectCompanyEntityId: companyA, paymentSubjectNameSnapshot: "合成原债公司",
      applicantUserId: finance, applicantNameSnapshot: "合成申请人", handledByUserId: finance,
      handledByNameSnapshot: "合成经办", reason: "合成已批准原费用", requestedAmountCents: 500n, companyPayableAmountCents: 500n,
    } });
    const expenseEvidence = await evidence(finance);
    const operational = await db.$transaction(async tx => {
      const paidAt = new Date(plan.paidAt);
      const saved = await tx.expenseClaimPaymentExecution.create({ data: { expenseClaimId: expense.id,
        amountCents: 500n, paidAt, paymentMethod: "bank_transfer", voucherFileId: expenseEvidence.id, recordedByUserId: finance } });
      return appendRegisteredOperationalPayment(tx, { sourceType: "expense_claim_payment_execution", executionId: saved.id,
        actorUserId: finance, projectId, originalDebtorCompanyId: companyA, amountCents: 500n, paidAt,
        funding: { scopeKey, expectedRegistrationId: balance.id, sourceAllocations: [{ sourceBatchId: balance.sources[0].id, amountCents: "500" }] },
      });
    });
    expect(operational.relationshipEntryId).toBeTruthy();
    const sourceAccount = "122233334444", destinationAccount = "222233334444";
    async function verified(companyEntityId: string, accountNumber: string, direction: "inflow" | "outflow", amountCents = "200") {
      const bank = await call(finance, "/contract-bank-verifications", { projectId, companyEntityId, accountNumber, direction,
        bankReference: randomUUID(), amountCents, occurredAt: new Date().toISOString(), evidenceFileId: (await evidence(finance)).id,
        reason: "合成银行流水", idempotencyKey: randomUUID(), confirmationPassword: password,
      });
      await call(director, `/contract-bank-verifications/${bank.id}/decision`, { decision: "confirm", accountNumber,
        holderEvidenceFileId: (await evidence(director)).id, confirmationPassword: password,
      });
      return (await db.contractBankVerificationRequest.findUniqueOrThrow({ where: { id: bank.id } })).observationId!;
    }
    let canonicalProxyId: string | undefined;
    if (canonical !== "none") {
      const bankObservationId = await verified(companyB, destinationAccount, "outflow", "700");
      const proxy = await call(finance, "/contract-proxy-executions", {
        projectId, sourceRef: `settlement:${settlement}`, entryKind: "payment", amountCents: "700", occurredAt: new Date().toISOString(),
        actualPayerKey: `participating_company:${companyB}`, bankReference: randomUUID(),
        bankObservationId, evidenceFileId: (await evidence(finance)).id,
        reason: "合成合同代付", idempotencyKey: randomUUID(), confirmationPassword: password,
      });
      await call(director, `/contract-proxy-executions/${proxy.id}/decision`, { decision: "confirm", confirmationPassword: password });
      canonicalProxyId = proxy.id;
    }
    const transfer = await call(keeper, "/company-transfers", {
      kind: "repayment",
      ...(canonical === "source" ? { originalProxyId: canonicalProxyId } : { originalInterEntityRelationshipId: registeredDebt.id }),
      sourceCompanyId: companyA, destinationCompanyId: companyB, sourceProjectId: projectId, destinationProjectId: projectId,
      sourceAccount, destinationAccount, amountCents: "200", reason: "合成原债归还", evidenceFileId: (await evidence(keeper)).id,
      confirmationPassword: password, idempotencyKey: randomUUID(),
    });
    for (const [index, approver] of [keeper,manager,director,leader].entries()) await call(approver, `/company-transfers/${transfer.id}/decision`, {
      action: "approve", nodeIndex: index, confirmationPassword: password, ...(index === 0 ? { selfReviewReason: "合成自审" } : {}),
    });
    const eventPath = `/company-transfers/${transfer.id}/events`;
    const outgoing = await call(keeper, eventPath, { kind: "outgoing", observationId: await verified(companyA, sourceAccount, "outflow"),
      idempotencyKey: randomUUID(), confirmationPassword: password });
    await call(director, eventPath, { kind: "incoming", outgoingEventId: outgoing.id,
      observationId: await verified(companyB, destinationAccount, "inflow"), idempotencyKey: randomUUID(), confirmationPassword: password });
    const readDebt = async (id: string) => {
      const view = await call(finance, `/company-transfers?projectId=${projectId}&originalSource=${id}`);
      return id.startsWith("proxy:") ? view.originalProxies[0] : view.legacyOptions[0];
    };
    const from = canonical === "source" ? `proxy:${canonicalProxyId}` : `inter_entity:${registeredDebt.id}`;
    const to = canonical === "target" ? `proxy:${canonicalProxyId}` : `operational:${operational.relationshipEntryId}`;
    const fromTotal = canonical === "source" ? 700 : 800;
    const toTotal = canonical === "target" ? 700 : 500;
    expect(await readDebt(from)).toMatchObject({ remainingCents: String(fromTotal - 200), availableCents: String(fromTotal - 200) });
    expect(await readDebt(to)).toMatchObject({ remainingCents: String(toTotal), availableCents: String(toTotal) });
    const readFacts = () => db.$transaction(async tx => ({
      events: await tx.companyTransferEvent.findMany({ where: { transferId: transfer.id }, orderBy: { id: "asc" } }),
      banks: await tx.companyTransferBankClaim.count(),
      operatingFacts: await tx.operatingFact.findMany({ where: { projectId, sourceType: { not: "company_transfer_debt_correction" } }, orderBy: { id: "asc" } }),
      impacts: await tx.operatingImpactEntry.findMany({ where: { projectId, sourceType: { not: "company_transfer_debt_correction" } }, orderBy: { id: "asc" } }),
    }));
    const before = await readFacts();
    const correctionPath = `${eventPath}/${outgoing.id}/original-debt-corrections`;
    const proposed = await call(finance, correctionPath, { targetOriginalSource: to, reason: "同主体同项目核销目标填错", idempotencyKey: randomUUID() });
    const confirmPath = `${correctionPath}/${proposed.id}/confirm`;
    const confirm = { idempotencyKey: randomUUID(), confirmationPassword: password };
    if (canonical === "target") {
      const ledger = app.get(OperatingLedgerService);
      const realAppend = ledger.appendConfirmedSourceInTransaction.bind(ledger);
      const changedPosting = jest.spyOn(ledger, "appendConfirmedSourceInTransaction").mockImplementationOnce(
        (tx, input, actorId, entryKind) => realAppend(tx, {
          ...input,
          impacts: input.impacts.map(impact =>
            impact.numericProtocolVersion === 2 ? impact : { ...impact, amountCents: 201n }
          ),
        }, actorId, entryKind)
      );
      try {
        await call(director, confirmPath, confirm, 409);
        expect(changedPosting).toHaveBeenCalledTimes(1);
      } finally { changedPosting.mockRestore(); }
      expect(await db.companyTransferOriginalDebtCorrection.findUniqueOrThrow({ where: { id: proposed.id } })).toMatchObject({
        status: "pending", confirmKey: null, confirmedAt: null,
      });
      expect(await db.operatingFact.count({ where: { projectId, sourceType: "company_transfer_debt_correction" } })).toBe(0);
      expect(await db.operatingImpactEntry.count({ where: { projectId, sourceType: "company_transfer_debt_correction" } })).toBe(0);
      expect(await readDebt(from)).toMatchObject({ remainingCents: String(fromTotal - 200) });
      expect(await readDebt(to)).toMatchObject({ remainingCents: String(toTotal) });
      expect(await readFacts()).toEqual(before);
    }
    const result = await call(director, confirmPath, confirm);
    expect(await call(director, confirmPath, confirm)).toEqual(result);
    expect(await readDebt(from)).toMatchObject({ remainingCents: String(fromTotal), availableCents: String(fromTotal) });
    expect(await readDebt(to)).toMatchObject({ remainingCents: String(toTotal - 200), availableCents: String(toTotal - 200) });
    expect(await readFacts()).toEqual(before);
    const journal = await db.operatingFact.findMany({
      where: { projectId, sourceType: "company_transfer_debt_correction" }, include: { impacts: true },
    });
    if (canonical !== "none") {
      const [privileges] = await db.$queryRaw<Array<{ routines: bigint; publicExecute: boolean }>>`
        SELECT count(DISTINCT routine.oid) AS routines,
          coalesce(bool_or(acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'),false) AS "publicExecute"
        FROM pg_catalog.pg_proc routine JOIN pg_catalog.pg_namespace namespace ON namespace.oid = routine.pronamespace
        CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(routine.proacl,pg_catalog.acldefault('f',routine.proowner))) acl
        WHERE namespace.nspname = 'public' AND routine.proname IN (
          'jg_company_transfer_canonical_correction_plan', 'jg_company_transfer_canonical_correction_fact',
          'jg_company_transfer_canonical_correction_impact', 'jg_company_transfer_canonical_correction_complete'
        )
      `;
      expect(privileges).toEqual({ routines: 4n, publicExecute: false });
      const comparison = await app.get(OperatingSourceReplayService).compareProject(projectId, finance);
      expect(comparison.differences.filter(difference => difference.sourceType === "company_transfer_debt_correction")).toEqual([]);
    }
    if (canonical === "none") expect(journal).toEqual([]);
    else {
      const direction = canonical === "source" ? "increase" : "decrease";
      expect(journal).toEqual([expect.objectContaining({
        entryKind: "correction", direction: "neutral", amountCents: 200n,
        impacts: [expect.objectContaining({ impactKind: `inter_subject_balance_${direction}`, direction, amountCents: 200n,
          subjectId: companyB, subjectRole: "actual_payer" })],
      })]);
    }
  });

});
