import "reflect-metadata";
import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { CompanyTransferCorrectionService } from "../company-transfer/company-transfer-correction.service";
import { CompanyTransferService } from "../company-transfer/company-transfer.service";
import { ProjectFundingAvailabilityService } from "../project-funding/project-funding-availability.service";
import { OperatingLedgerService } from "../operating-ledger/operating-ledger.service";
import { OperatingSourceAdapterRegistry } from "../operating-ledger/operating-source-adapter";
import { OperatingSourceReplayService } from "../operating-ledger/operating-source-replay.service";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { CompanyTransferReadService } from "../company-transfer/company-transfer-read.service";
import { CompanyTransferOperatingSourceAdapter } from "../company-transfer/company-transfer-operating-source.adapter";
import { companyRepaymentDuties } from "../company-transfer/company-transfer-repayment-approval";
import { transferRepaymentUsage } from "../company-transfer/company-transfer-legacy";
import { readCompanyTransferBalances } from "../company-transfer/company-transfer-summary";
import { createCompanyTransferFixture } from "./company-transfer-fixture";

const run = process.env.RUN_ISSUE411_THIRD_COMPANY_REPAYMENT === "1" ? describe : describe.skip;
const accountHash = (value: string) => createHash("sha256").update(value).digest("hex");

run("issue 411 third-company repayment on real PostgreSQL", () => {
  jest.setTimeout(180_000);
  let prisma: PrismaClient;
  let a: Awaited<ReturnType<typeof createCompanyTransferFixture>>;
  let b: Awaited<ReturnType<typeof createCompanyTransferFixture>>;
  let c: Awaited<ReturnType<typeof createCompanyTransferFixture>>;
  let applicant: string, financeStaff: string, financeDirector: string, leader: string;
  let evidence: { id: string; contentSha256: string };

  const person = async (role: string) => {
    const user = await prisma.user.create({ data: { name: `隔离${role}${randomUUID().slice(0, 6)}`, isActive: true } });
    const position = await prisma.position.upsert({ where: { key: role }, update: {}, create: { key: role, name: role } });
    await prisma.userPosition.create({ data: { userId: user.id, positionId: position.id, projectId: null } });
    return user.id;
  };
  const file = async (userId: string) => prisma.fileObject.create({ data: {
    bucket: "private-local", objectKey: `issue411/${randomUUID()}`, originalName: "隔离合成依据.pdf",
    mimeType: "application/pdf", sizeBytes: 100, uploadedByUserId: userId,
    contentSha256: "a".repeat(64), storageStatus: "active",
  } });
  const payerVerification = async (company: { companyId: string; companyCreditCode: string }, name: string) => {
    const id = randomUUID(), evidenceFile = await file(financeDirector);
    return prisma.paymentExecutionPayerVerification.create({ data: {
      id, reference: `PV-${id}`, holderCompanyEntityId: company.companyId, holderNameSnapshot: name,
      holderCreditCodeSnapshot: company.companyCreditCode, verificationReference: `VR-${id}`,
      verifiedByUserId: financeDirector, verifiedAt: new Date("2026-07-01"),
      verificationEvidenceFileId: evidenceFile.id, verificationEvidenceContentSha256: evidenceFile.contentSha256!,
      sourceType: "bank_account_legal_holder", sourceRecordId: id, status: "verified",
    } });
  };
  const observation = async (tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0], input: {
    holder: { companyId: string; companyCreditCode: string }; name: string; projectId: string; account: string;
    direction: "inflow" | "outflow"; amountCents: bigint; occurredAt: Date; actor: string; payerVerificationId: string;
  }) => {
    const id = randomUUID();
    await tx.verifiedBankTransactionObservation.create({ data: {
      id, reference: `OBS-${id}`, payerVerificationId: input.payerVerificationId, payerVerificationReference: `PVR-${id}`,
      holderCompanyEntityId: input.holder.companyId, holderNameSnapshot: input.name, holderCreditCodeSnapshot: input.holder.companyCreditCode,
      verificationReference: `VER-${id}`, verifiedByUserId: input.actor, verifiedAt: input.occurredAt,
      verificationEvidenceFileId: evidence.id, verificationEvidenceContentSha256: evidence.contentSha256,
      verificationSourceType: "isolated_test", verificationSourceRecordId: id, verificationIssuedByDatabaseRole: "isolated_test",
      transactionSourceType: "isolated_test", transactionSourceId: id, transactionSourceIdentity: createHash("sha256").update(id).digest("hex"),
      transactionEvidenceFileId: evidence.id, transactionEvidenceContentSha256: evidence.contentSha256,
      transactionExecutedByUserId: input.actor, amountCents: input.amountCents, direction: input.direction, occurredAt: input.occurredAt,
      payloadFingerprint: "b".repeat(64), createdByUserId: input.actor, auditAction: "observe", auditRequestId: id,
      createdTransactionId: 1n, createdBackendPid: 1,
    } });
    await tx.contractBankVerificationRequest.create({ data: {
      id: randomUUID(), projectId: input.projectId, companyEntityId: input.holder.companyId, companyName: input.name,
      companyCreditCode: input.holder.companyCreditCode, accountHash: accountHash(input.account), accountLast4: input.account.slice(-4),
      bankReference: `BANK-${id}`, bankIdentity: `BI-${id}`, direction: input.direction, amountCents: input.amountCents,
      occurredAt: input.occurredAt, evidenceFileId: evidence.id, evidenceSha256: evidence.contentSha256,
      reason: "隔离合成银行流水", status: "confirmed", recordedByUserId: input.actor, confirmedByUserId: input.actor,
      confirmedAt: input.occurredAt, observationId: id, idempotencyKey: randomUUID(), requestFingerprint: "c".repeat(64),
    } });
    return id;
  };
  const writeContext = async (tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0], actor: string) => {
    await tx.$executeRaw`INSERT INTO public."OperatingLedgerWriteContext" ("backendPid","transactionId","actorUserId")
      VALUES (pg_backend_pid(), txid_current(), ${actor})
      ON CONFLICT ("backendPid","transactionId") DO UPDATE SET "actorUserId"=EXCLUDED."actorUserId"`;
  };
  const event = async (transferId: string, kind: "outgoing" | "incoming", holder: typeof a, account: string, amountCents: bigint,
    occurredAt: Date, actor: string, payerVerificationId: string, outgoingEventId?: string) => {
    return prisma.$transaction(async tx => {
      await writeContext(tx, actor);
      const observationId = await observation(tx, { holder, name: holder === a ? "甲合成公司" : holder === b ? "乙合成公司" : "丙合成公司",
        projectId: a.projectId, account, direction: kind === "outgoing" ? "outflow" : "inflow", amountCents, occurredAt, actor, payerVerificationId });
      const created = await tx.companyTransferEvent.create({ data: {
        transferId, kind, outgoingEventId: outgoingEventId ?? null, observationId, amountCents, occurredAt,
        recordedByUserId: actor, idempotencyKey: randomUUID(), requestFingerprint: randomUUID(),
      } });
      await tx.companyTransferBankClaim.create({ data: { observationId, eventId: created.id } });
      return created.id;
    });
  };
  const leaderLog = async (approvalInstanceId: string, approvedRoleKey: string, nodeIndex?: number) => {
    await prisma.approvalActionLog.create({ data: {
      approvalInstanceId, action: "approve", actorUserId: leader, approvedRoleKey,
      signatureFileIdSnapshot: evidence.id, signatureSha256Snapshot: evidence.contentSha256,
      signatureVersionIdSnapshot: nodeIndex === undefined ? "sig-final" : `sig-${nodeIndex}`,
      metadata: nodeIndex === undefined ? {} : { nodeIndex },
    } });
  };
  const createApproval = async (id: string, parallel: boolean) => {
    const nodes: Array<Record<string, unknown>> = parallel ? companyRepaymentDuties() : [{ name: "董事长或总经理终审", mode: "any", roleKeys: ["chairman", "general_manager"], approvedRoleKeys: ["general_manager"] }];
    const instance = await prisma.approvalInstance.create({ data: {
      flowType: "company_transfer.approve", businessType: "company_transfer", businessId: id,
      status: "approved", currentNodeIndex: parallel ? 4 : 1, frozenNodes: nodes as never, applicantUserId: applicant,
    } });
    if (!parallel) await leaderLog(instance.id, "general_manager");
    return { approvalInstanceId: instance.id, nodes };
  };
  const completeParallel = async (approvalInstanceId: string, nodes: Array<Record<string, unknown>>) => {
    for (const [index, duty] of nodes.entries()) {
      const role = (duty.roleKeys as string[])[0];
      await leaderLog(approvalInstanceId, role, index);
      duty.approvedRoleKeys = [role];
    }
    await prisma.approvalInstance.update({ where: { id: approvalInstanceId }, data: { frozenNodes: nodes as never } });
  };
  const createTransfer = async (input: {
    kind: string; source: typeof a; destination: typeof a; amountCents: bigint; parallel: boolean;
    original?: Record<string, string>; repaymentDebtorCompanyId?: string | null; sourceAccount: string; destinationAccount: string;
  }) => {
    const id = randomUUID();
    const { approvalInstanceId, nodes } = await createApproval(id, input.parallel);
    const row = {
      id, code: `HZ-411-${id.slice(0, 8)}`, kind: input.kind, sourceCompanyId: input.source.companyId,
      destinationCompanyId: input.destination.companyId, repaymentDebtorCompanyId: input.repaymentDebtorCompanyId ?? null,
      sourceProjectId: a.projectId, destinationProjectId: a.projectId,
      sourceAccountHash: accountHash(input.sourceAccount), destinationAccountHash: accountHash(input.destinationAccount),
      sourceAccountLast4: input.sourceAccount.slice(-4), destinationAccountLast4: input.destinationAccount.slice(-4),
      amountCents: input.amountCents, reason: "隔离合成公司往来", evidenceFileId: evidence.id, evidenceSha256: evidence.contentSha256,
      frozenParties: { source: { name: "来源公司" }, destination: { name: "收款公司" } },
      status: input.parallel ? "submitted" : "approved", requiresParallelRepaymentApproval: input.parallel,
      approvalInstanceId, applicantUserId: applicant, approvedByUserId: leader, approvedAt: new Date("2026-08-01"),
      idempotencyKey: randomUUID(), requestFingerprint: randomUUID(), ...(input.original ?? {}),
    } as never;
    await prisma.companyTransfer.create({ data: row });
    if (input.parallel) {
      await completeParallel(approvalInstanceId, nodes);
      await prisma.companyTransfer.update({ where: { id }, data: { status: "approved" } });
    }
    return id;
  };

  const seedCompanies = async () => {
    a = await createCompanyTransferFixture(prisma, "甲合成公司");
    b = await createCompanyTransferFixture(prisma, "乙合成公司");
    c = await createCompanyTransferFixture(prisma, "丙合成公司");
    await prisma.project.update({ where: { id: a.projectId }, data: { operatingLedgerEffectiveDate: new Date("2026-07-01") } });
    await payerVerification(a, "甲合成公司");
    await payerVerification(b, "乙合成公司");
    await payerVerification(c, "丙合成公司");
  };

  beforeAll(async () => {
    const target = new URL(process.env.DATABASE_URL ?? "");
    if (process.env.NODE_ENV !== "test" || target.hostname !== "127.0.0.1" || target.pathname !== "/jg_issue411_third_company") {
      throw new Error("只允许本机一次性隔离库 jg_issue411_third_company");
    }
    prisma = new PrismaClient();
    applicant = await person("comprehensive_director");
    financeStaff = await person("finance_staff");
    financeDirector = await person("finance_director");
    leader = await person("general_manager");
    evidence = { id: (await file(applicant)).id, contentSha256: "a".repeat(64) };
    await seedCompanies();
  }, 120_000);
  afterAll(async () => { await prisma?.$disconnect(); });

  it("moves A-B debt to A-C with one payment, rejects a duplicate, and keeps the corrected net", async () => {
    const verificationA = await prisma.paymentExecutionPayerVerification.findFirstOrThrow({ where: { holderCompanyEntityId: a.companyId } });
    const verificationB = await prisma.paymentExecutionPayerVerification.findFirstOrThrow({ where: { holderCompanyEntityId: b.companyId } });
    const verificationC = await prisma.paymentExecutionPayerVerification.findFirstOrThrow({ where: { holderCompanyEntityId: c.companyId } });
    const aAccount = "6222000011111111", bAccount = "6222000022222222", cAccount = "6222000033333333";

    // A-B loan debt: B actually paid 800 to A.
    const loan = await createTransfer({ kind: "loan", source: b, destination: a, amountCents: 800n, parallel: false,
      sourceAccount: bAccount, destinationAccount: aAccount });
    const loanOutgoing = await event(loan, "outgoing", b, bAccount, 800n, new Date("2026-08-01"), financeStaff, verificationB.id);
    await event(loan, "incoming", a, aAccount, 800n, new Date("2026-08-02"), financeDirector, verificationA.id, loanOutgoing);

    // C repays B for A: source C, destination B, explicit debtor A.
    const third = await createTransfer({ kind: "repayment", source: c, destination: b, amountCents: 800n, parallel: false,
      repaymentDebtorCompanyId: a.companyId, original: { originalTransferId: loan }, sourceAccount: cAccount, destinationAccount: bAccount });
    const thirdOutgoing = await event(third, "outgoing", c, cAccount, 800n, new Date("2026-08-10"), financeStaff, verificationC.id);
    const thirdIncoming = await event(third, "incoming", b, bAccount, 800n, new Date("2026-08-11"), financeDirector, verificationB.id, thirdOutgoing);

    const loanUsage = await transferRepaymentUsage(prisma, { originalTransferId: loan });
    expect(loanUsage.received).toBe(800n);
    const balances = await prisma.$transaction(tx => readCompanyTransferBalances(tx, [a.projectId], new Date("2100-01-01")));
    expect(balances.find(row => row.companyId === a.companyId)).toMatchObject({ payableCents: "800", onBehalfPayableCents: "800" });
    expect(balances.find(row => row.companyId === c.companyId)).toMatchObject({ receivableCents: "800", onBehalfReceivableCents: "800" });
    expect(balances.find(row => row.companyId === b.companyId)).toMatchObject({ receivableCents: "0" });

    // The same loan debt cannot be repaid twice.
    await expect(createTransfer({ kind: "repayment", source: c, destination: b, amountCents: 100n, parallel: false,
      repaymentDebtorCompanyId: a.companyId, original: { originalTransferId: loan }, sourceAccount: cAccount, destinationAccount: bAccount }))
      .rejects.toThrow(/company_transfer_original_capacity/);

    // The ledger row and the operating adapter both expose the third-party origin.
    const reader = new CompanyTransferReadService(prisma as never, new ProjectVisibilityService(prisma as never));
    const view = await reader.list(financeDirector, { projectId: a.projectId });
    expect(view.rows.find(row => row.id === third)).toMatchObject({
      repaymentDebtorCompanyId: a.companyId, repaymentDebtorCompany: "甲合成公司", onBehalfRepayment: true,
    });
    const adapter = new CompanyTransferOperatingSourceAdapter();
    const snapshot = await prisma.$transaction(tx => adapter.readSourceSnapshot(tx, {
      projectId: a.projectId, sourceType: "company_transfer_event", sourceBusinessId: thirdIncoming,
    }));
    expect(snapshot).not.toBeNull();
    const fact = adapter.toOperatingFactInput(snapshot!);
    expect(fact.input.impacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ impactKind: "inter_subject_balance_increase", sourceImpactKey: "on_behalf_relationship", subject: { kind: "participating_company", id: c.companyId } }),
    ]));
    expect(fact.input.impacts.some(impact => String(impact.impactKind).includes("confirmed_cost"))).toBe(false);
    await expect(prisma.companyTransfer.delete({ where: { id: third } })).rejects.toThrow(/company_transfer_immutable/);
  });

  it("re-points a settled third-party repayment to the correct original debt and keeps the A-C debt", async () => {
    const proxy = (amountCents: bigint) => prisma.contractProxyExecution.create({ data: {
      projectId: a.projectId, sourceRef: `settlement:${randomUUID()}`, entryKind: "payment", amountCents,
      occurredAt: new Date("2026-08-05"), actualPayerKey: `participating_company:${b.companyId}`, bankReference: randomUUID(),
      evidenceFileId: evidence.id, evidenceSha256: evidence.contentSha256,
      reason: "隔离合成原代付", status: "confirmed", recordedByUserId: financeStaff,
      confirmedByUserId: financeDirector, confirmedAt: new Date("2026-08-05"),
      frozenSource: { debtor: { kind: "participating_company", id: a.companyId }, actualPayer: { kind: "participating_company", id: b.companyId } },
      idempotencyKey: randomUUID(), requestFingerprint: randomUUID(),
    } });
    const original = await proxy(800n), target = await proxy(1000n);
    const bAccount = "6222000022222222", cAccount = "6222000033333333";
    const verificationB = await prisma.paymentExecutionPayerVerification.findFirstOrThrow({ where: { holderCompanyEntityId: b.companyId } });
    const verificationC = await prisma.paymentExecutionPayerVerification.findFirstOrThrow({ where: { holderCompanyEntityId: c.companyId } });
    const third = await createTransfer({ kind: "repayment", source: c, destination: b, amountCents: 800n, parallel: true,
      repaymentDebtorCompanyId: a.companyId, original: { originalProxyId: original.id }, sourceAccount: cAccount, destinationAccount: bAccount });
    const outgoing = await event(third, "outgoing", c, cAccount, 800n, new Date("2026-08-12"), financeStaff, verificationC.id);
    await event(third, "incoming", b, bAccount, 800n, new Date("2026-08-13"), financeDirector, verificationB.id, outgoing);
    expect((await transferRepaymentUsage(prisma, { originalProxyId: original.id })).received).toBe(800n);

    const correctionId = randomUUID();
    await prisma.companyTransferOriginalDebtCorrection.create({ data: {
      id: correctionId, outgoingEventId: outgoing, originalSource: `proxy:${original.id}`,
      targetOriginalSource: `proxy:${target.id}`, reason: "原债引用填错", requestedByUserId: financeStaff, requestKey: randomUUID(),
    } });
    await prisma.companyTransferOriginalDebtCorrection.update({ where: { id: correctionId }, data: {
      status: "confirmed", confirmedByUserId: financeDirector, confirmedAt: new Date(), confirmKey: randomUUID(),
    } });
    expect((await transferRepaymentUsage(prisma, { originalProxyId: original.id })).received).toBe(0n);
    expect((await transferRepaymentUsage(prisma, { originalProxyId: target.id })).received).toBe(800n);
    // The corrected canonical plan must compile and resolve the third-party debtor
    // (no operating anchor is seeded in this guard-only fixture, hence zero rows).
    await expect(prisma.$queryRaw`SELECT * FROM public.jg_company_transfer_canonical_correction_plan(${correctionId})`).resolves.toEqual([]);

    const reader = new CompanyTransferReadService(prisma as never, new ProjectVisibilityService(prisma as never));
    const view = await reader.list(financeDirector, { projectId: a.projectId });
    expect(view.originalProxies.find(row => row.id === original.id)).toMatchObject({ remainingCents: "800", availableCents: "800" });
    expect(view.originalProxies.find(row => row.id === target.id)).toMatchObject({ remainingCents: "200", availableCents: "200" });
    const balances = await prisma.$transaction(tx => readCompanyTransferBalances(tx, [a.projectId], new Date("2100-01-01")));
    // The same disposable database also holds the 800 third-party repayment from
    // the first case; the correction must not change that A-C debt.
    expect(balances.find(row => row.companyId === a.companyId)?.onBehalfPayableCents).toBe("1600");
    expect(balances.find(row => row.companyId === c.companyId)?.onBehalfReceivableCents).toBe("1600");
  });

  const settledReturnCase = process.env.RUN_ISSUE435_SETTLED_RETURN === "1" ? it : it.skip;
  settledReturnCase("issue 435 posts pre-arrival and settled returns, restores both debts, and rolls back a failed posting", async () => {
    await seedCompanies();
    const projectId = a.projectId;
    const accountA = "6222000011111111", accountB = "6222000022222222", accountC = "6222000033333333";
    const verification = async (companyId: string) => (await prisma.paymentExecutionPayerVerification.findFirstOrThrow({
      where: { holderCompanyEntityId: companyId },
    })).id;
    const [verificationA, verificationB, verificationC] = await Promise.all([a, b, c].map(company => verification(company.companyId)));
    for (const [company, name] of [[a, "甲合成公司"], [b, "乙合成公司"], [c, "丙合成公司"]] as const) {
      const version = await prisma.companyEntityVersion.findFirstOrThrow({ where: { companyEntityId: company.companyId } });
      await prisma.projectParticipatingCompany.create({ data: {
        projectId, companyEntityId: company.companyId, companyEntityVersionId: version.id,
        companyNameSnapshot: name, companyCreditCodeSnapshot: company.companyCreditCode,
        effectiveFrom: new Date("2026-07-01"), changeReason: "隔离合成项目参与公司", addedByUserId: financeDirector,
      } });
    }
    const visibility = new ProjectVisibilityService(prisma as never);
    const replay = new OperatingSourceReplayService(prisma as never, new OperatingLedgerService(prisma as never),
      new OperatingSourceAdapterRegistry([new CompanyTransferOperatingSourceAdapter()]));
    const audit = new AuditService(prisma as never);
    const service = new CompanyTransferService(prisma as never, visibility,
      { confirmPassword: async () => {} } as never, audit, new ProjectFundingAvailabilityService(), replay);
    const reader = new CompanyTransferReadService(prisma as never, visibility);

    const verifyReturn = (amountCents: bigint, date: string) => prisma.$transaction(tx => observation(tx, {
      holder: c, name: "丙合成公司", projectId, account: accountC, direction: "inflow",
      amountCents, occurredAt: new Date(date), actor: financeDirector, payerVerificationId: verificationC,
    }));
    const settleLoan = async (amountCents: bigint) => {
      const loan = await createTransfer({ kind: "loan", source: b, destination: a, amountCents, parallel: false,
        sourceAccount: accountB, destinationAccount: accountA });
      const sent = await event(loan, "outgoing", b, accountB, amountCents, new Date("2026-08-01"), financeStaff, verificationB);
      await event(loan, "incoming", a, accountA, amountCents, new Date("2026-08-02"), financeDirector, verificationA, sent);
      const transfer = await createTransfer({ kind: "repayment", source: c, destination: b, amountCents, parallel: false,
        repaymentDebtorCompanyId: a.companyId, original: { originalTransferId: loan }, sourceAccount: accountC, destinationAccount: accountB });
      const outgoing = await event(transfer, "outgoing", c, accountC, amountCents, new Date("2026-08-10"), financeStaff, verificationC);
      return { loan, transfer, outgoing };
    };
    const original = await settleLoan(800n);
    const incoming = await event(original.transfer, "incoming", b, accountB, 800n, new Date("2026-08-11"), financeDirector, verificationB, original.outgoing);
    const password = "synthetic-test";
    const refundCommand = (observationId: string) => ({
      kind: "settled_return" as const, observationId, incomingEventId: incoming, reason: "隔离合成到账后退款",
      confirmationPassword: password, idempotencyKey: randomUUID(),
    });
    const paymentCount = await prisma.paymentExecution.count();
    const first = refundCommand(await verifyReturn(300n, "2026-08-12"));
    const [applied, replayed] = await Promise.all([
      service.execute(financeDirector, original.transfer, first),
      service.execute(financeDirector, original.transfer, first),
    ]);
    expect(replayed).toEqual(applied);
    const recorded = await prisma.paymentExecutionRefund.findUniqueOrThrow({ where: { companyTransferReturnEventId: applied.id } });
    expect(recorded).toMatchObject({
      executionType: "company_transfer_repayment", companyTransferIncomingEventId: incoming, amountCents: 300n,
      paymentExecutionId: null, paymentRequestId: null, evidenceReference: first.observationId,
    });
    expect(await prisma.companyTransferBankClaim.findUnique({ where: { observationId: first.observationId } }))
      .toMatchObject({ eventId: applied.id });
    await expect(prisma.paymentExecutionRefund.update({
      where: { id: recorded.id }, data: { reason: "改写已确认退款" },
    })).rejects.toThrow(/payment_execution_refund_is_append_only/);
    await expect(prisma.paymentExecutionRefund.delete({ where: { id: recorded.id } }))
      .rejects.toThrow(/payment_execution_refund_is_append_only/);
    await expect(prisma.paymentExecutionRefund.create({ data: {
      ...recorded, id: randomUUID(), idempotencyKey: randomUUID(),
    } })).rejects.toThrow("正式经营账必须通过受控写入函数登记");
    const auditRows = await prisma.auditLog.findMany({ where: { action: "company_transfer.settled_return", businessId: original.transfer } });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({ actorUserId: financeDirector, metadata: { eventId: applied.id, refundId: recorded.id, incomingEventId: incoming } });

    const historical = await reader.list(financeDirector, { projectId, asOf: "2026-08-11" });
    expect(historical.originalLoans.find(row => row.id === original.loan)?.remainingCents).toBe("0");
    expect(historical.balances.find(row => row.companyId === c.companyId)?.onBehalfReceivableCents).toBe("800");
    const view = await reader.list(financeDirector, { projectId });
    expect(view.rows.find(row => row.id === original.transfer)).toMatchObject({ receivedCents: "800", returnedCents: "300", inTransitCents: "0", events: expect.arrayContaining([
      expect.objectContaining({ id: incoming, canRefund: true, remainingCents: "500" }),
      expect.objectContaining({ id: applied.id, kind: "settled_return" }),
    ]) });
    expect(view.originalLoans.find(row => row.id === original.loan)).toMatchObject({ remainingCents: "300", availableCents: "300" });
    expect(view.balances.find(row => row.companyId === b.companyId)).toMatchObject({ receivableCents: "300", cashChangeCents: "-300" });
    expect(view.balances.find(row => row.companyId === c.companyId)).toMatchObject({ receivableCents: "500", cashChangeCents: "-500" });

    const impacts = await prisma.operatingImpactEntry.findMany({
      where: { sourceType: "company_transfer_event", sourceBusinessId: { in: [applied.id, `${applied.id}:refund_destination`] } },
    });
    expect(impacts).toHaveLength(3);
    expect(impacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ impactKind: "company_project_funds_increase", amountCents: 300n, subjectId: c.companyId }),
      expect.objectContaining({ impactKind: "company_project_funds_decrease", amountCents: 300n, subjectId: b.companyId }),
      expect.objectContaining({ impactKind: "inter_subject_balance_decrease", amountCents: 300n, subjectId: c.companyId }),
    ]));

    await expect(service.execute(financeDirector, original.transfer, refundCommand(first.observationId)))
      .rejects.toThrow("银行流水已认领");
    const overRefund = refundCommand(await verifyReturn(501n, "2026-08-13"));
    await expect(service.execute(financeDirector, original.transfer, overRefund)).rejects.toThrow("超过原到账剩余额度");
    expect(await prisma.companyTransferBankClaim.count({ where: { observationId: overRefund.observationId } })).toBe(0);

    const balance = refundCommand(await verifyReturn(500n, "2026-08-13"));
    const rejectAudit = jest.spyOn(audit, "record").mockRejectedValueOnce(new Error("隔离合成审计写入失败"));
    await expect(service.execute(financeDirector, original.transfer, balance)).rejects.toThrow("隔离合成审计写入失败");
    rejectAudit.mockRestore();
    expect(await prisma.paymentExecutionRefund.count({ where: { companyTransferIncomingEventId: incoming } })).toBe(1);
    expect(await prisma.companyTransferEvent.count({ where: { observationId: balance.observationId } })).toBe(0);
    expect(await prisma.companyTransferBankClaim.count({ where: { observationId: balance.observationId } })).toBe(0);
    expect(await prisma.operatingFact.count({
      where: { sourceSnapshot: { path: ["bankObservationId"], equals: balance.observationId } },
    })).toBe(0);
    const full = await service.execute(financeDirector, original.transfer, balance);
    const restored = await reader.list(financeDirector, { projectId });
    expect(restored.originalLoans.find(row => row.id === original.loan)).toMatchObject({ remainingCents: "800", availableCents: "800" });
    expect(restored.balances.find(row => row.companyId === c.companyId)).toMatchObject({ receivableCents: "0", payableCents: "0", cashChangeCents: "0" });
    expect(restored.rows.find(row => row.id === original.transfer)?.events.find(row => row.id === full.id)?.kind).toBe("settled_return");
    expect(await prisma.paymentExecution.count()).toBe(paymentCount);

    const pending = await settleLoan(100n);
    const beforeArrival = await verifyReturn(100n, "2026-08-11");
    await service.execute(financeDirector, pending.transfer, {
      kind: "returned", observationId: beforeArrival, outgoingEventId: pending.outgoing,
      confirmationPassword: password, idempotencyKey: randomUUID(),
    });
    expect(await prisma.paymentExecutionRefund.count({ where: { evidenceReference: beforeArrival } })).toBe(0);
    const pendingView = await reader.list(financeDirector, { projectId });
    expect(pendingView.originalLoans.find(row => row.id === pending.loan)).toMatchObject({ remainingCents: "100", availableCents: "100" });
    expect(pendingView.rows.find(row => row.id === pending.transfer)).toMatchObject({ receivedCents: "0", returnedCents: "100", inTransitCents: "0" });
  });

  settledReturnCase("issue 435 keeps the debt correction net and freezes the target for a later refund", async () => {
    const projectId = a.projectId;
    const debtDate = new Date("2026-08-05");
    const debtor = { kind: "participating_company", id: a.companyId };
    const creditor = { kind: "participating_company", id: b.companyId };
    const original = await prisma.contractProxyExecution.create({ data: {
      projectId, sourceRef: `settlement:${randomUUID()}`, entryKind: "payment", amountCents: 800n,
      occurredAt: debtDate, actualPayerKey: `participating_company:${b.companyId}`, bankReference: randomUUID(),
      evidenceFileId: evidence.id, evidenceSha256: evidence.contentSha256, reason: "隔离合成原代付",
      status: "confirmed", recordedByUserId: financeStaff, confirmedByUserId: financeDirector, confirmedAt: debtDate,
      frozenSource: { debtor, actualPayer: creditor }, idempotencyKey: randomUUID(), requestFingerprint: randomUUID(),
    } });
    const target = await prisma.interEntityRelationshipEntry.create({ data: {
      projectId, entryKind: "proxy_payment", direction: "increase", status: "confirmed", amountCents: 1000n,
      originalDebtorCompanyId: a.companyId, creditorCompanyId: b.companyId, approvedPayerCompanyId: b.companyId,
      debtorSnapshot: debtor, creditorSnapshot: creditor, approvedPayerSnapshot: creditor,
      idempotencyKey: randomUUID(), payloadFingerprint: randomUUID(), createdByUserId: financeStaff,
      confirmedAt: debtDate, confirmedByUserId: financeDirector,
    } });
    const originalRef = { originalProxyId: original.id };
    const targetRef = { originalInterEntityRelationshipId: target.id };
    const bAccount = "6222000022222222", cAccount = "6222000033333333";
    const verificationB = await prisma.paymentExecutionPayerVerification.findFirstOrThrow({ where: { holderCompanyEntityId: b.companyId } });
    const verificationC = await prisma.paymentExecutionPayerVerification.findFirstOrThrow({ where: { holderCompanyEntityId: c.companyId } });
    const transfer = await createTransfer({ kind: "repayment", source: c, destination: b, amountCents: 800n, parallel: true,
      repaymentDebtorCompanyId: a.companyId, original: originalRef, sourceAccount: cAccount, destinationAccount: bAccount });
    const outgoing = await event(transfer, "outgoing", c, cAccount, 800n, new Date("2026-08-18"), financeStaff, verificationC.id);
    const incoming = await event(transfer, "incoming", b, bAccount, 800n, new Date("2026-08-19"), financeDirector, verificationB.id, outgoing);

    const db = prisma as never;
    const ledger = new OperatingLedgerService(db);
    const visibility = new ProjectVisibilityService(db);
    const reader = new CompanyTransferReadService(db, visibility);
    const audit = new AuditService(db);
    const funding = new ProjectFundingAvailabilityService();
    const auth = { confirmPassword: async () => {} } as never;
    const replay = new OperatingSourceReplayService(db, ledger, new OperatingSourceAdapterRegistry([new CompanyTransferOperatingSourceAdapter()]));
    const service = new CompanyTransferService(db, visibility, auth, audit, funding, replay);
    const corrections = new CompanyTransferCorrectionService(db, auth, audit, funding, reader, ledger);
    await prisma.$transaction(tx => replay.appendConfirmedSourceIfEnabledInTransaction(tx, {
      sourceType: "company_transfer_event", sourceBusinessId: incoming, projectId,
    }, financeDirector));

    const refund = async (amountCents: bigint, occurredAt: Date) => {
      const observationId = await prisma.$transaction(tx => observation(tx, {
        holder: c, name: "丙合成公司", projectId, account: cAccount, actor: financeDirector,
        direction: "inflow", amountCents, occurredAt, payerVerificationId: verificationC.id,
      }));
      return service.execute(financeDirector, transfer, {
        kind: "settled_return", observationId, incomingEventId: incoming, reason: "隔离合成实际银行退回",
        confirmationPassword: "synthetic-test", idempotencyKey: randomUUID(),
      });
    };
    const before = await refund(300n, new Date("2026-08-20"));
    expect(await transferRepaymentUsage(prisma, originalRef)).toEqual({ received: 500n, reserved: 500n });

    const correction = await corrections.request(financeStaff, transfer, outgoing, {
      targetOriginalSource: `inter_entity:${target.id}`, reason: "隔离合成更正原代付记录", idempotencyKey: randomUUID(),
    });
    await expect(corrections.confirm(financeDirector, transfer, outgoing, correction.id, {
      confirmationPassword: "synthetic-test", idempotencyKey: randomUUID(),
    })).resolves.toMatchObject({ id: correction.id, status: "confirmed" });

    const correctionFact = await prisma.operatingFact.findFirstOrThrow({
      where: { sourceType: "company_transfer_debt_correction", sourceBusinessId: `${correction.id}:${incoming}` },
      include: { impacts: true },
    });
    expect(correctionFact).toMatchObject({ amountCents: 500n, debtorSubjectId: a.companyId,
      actualPayerSubjectId: b.companyId, impacts: [expect.objectContaining({ direction: "increase", amountCents: 500n })] });
    expect(await transferRepaymentUsage(prisma, originalRef)).toEqual({ received: 0n, reserved: 0n });
    expect(await transferRepaymentUsage(prisma, targetRef)).toEqual({ received: 500n, reserved: 500n });

    const after = await refund(200n, new Date("2026-08-21"));
    for (const [returnEvent, expectedCorrection] of [[before.id, null], [after.id, correction.id]] as const) {
      const fact = await prisma.paymentExecutionRefund.findUniqueOrThrow({ where: { companyTransferReturnEventId: returnEvent } });
      expect(fact.companyTransferDebtCorrectionId).toBe(expectedCorrection);
    }
    const refundDestinationImpacts = await prisma.operatingImpactEntry.findMany({
      where: { sourceType: "company_transfer_event", sourceBusinessId: { in: [`${before.id}:refund_destination`, `${after.id}:refund_destination`] } },
    });
    expect(refundDestinationImpacts.filter(impact => impact.sourceImpactKey === "relationship"))
      .toEqual([expect.objectContaining({ sourceBusinessId: `${before.id}:refund_destination`, direction: "increase", amountCents: 300n })]);
    expect(refundDestinationImpacts.filter(impact => impact.sourceImpactKey === "on_behalf_relationship"))
      .toEqual(expect.arrayContaining([expect.objectContaining({ direction: "decrease", amountCents: 300n }),
        expect.objectContaining({ direction: "decrease", amountCents: 200n })]));
    const plan = await prisma.$queryRaw<Array<{ amountCents: bigint }>>`
      SELECT "amountCents" FROM public.jg_company_transfer_canonical_correction_plan(${correction.id})
    `;
    expect(plan).toEqual([{ amountCents: 500n }]);
    expect(await transferRepaymentUsage(prisma, originalRef)).toEqual({ received: 0n, reserved: 0n });
    expect(await transferRepaymentUsage(prisma, targetRef, new Date("2026-08-19T23:00:00.000Z"))).toEqual({ received: 800n, reserved: 300n });
    expect(await transferRepaymentUsage(prisma, targetRef)).toEqual({ received: 300n, reserved: 300n });
  });

});
