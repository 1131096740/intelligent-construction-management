import "reflect-metadata";
import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
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

  beforeAll(async () => {
    const target = new URL(process.env.DATABASE_URL ?? "");
    if (process.env.NODE_ENV !== "test" || target.hostname !== "127.0.0.1" || target.pathname !== "/jg_issue411_third_company") {
      throw new Error("只允许本机一次性隔离库 jg_issue411_third_company");
    }
    prisma = new PrismaClient();
    a = await createCompanyTransferFixture(prisma, "甲合成公司");
    b = await createCompanyTransferFixture(prisma, "乙合成公司");
    c = await createCompanyTransferFixture(prisma, "丙合成公司");
    await prisma.project.update({ where: { id: a.projectId }, data: { operatingLedgerEffectiveDate: new Date("2026-07-01") } });
    applicant = await person("comprehensive_director");
    financeStaff = await person("finance_staff");
    financeDirector = await person("finance_director");
    leader = await person("general_manager");
    evidence = { id: (await file(applicant)).id, contentSha256: "a".repeat(64) };
    await payerVerification(a, "甲合成公司");
    await payerVerification(b, "乙合成公司");
    await payerVerification(c, "丙合成公司");
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
});
