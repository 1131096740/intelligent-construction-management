import { Prisma, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { FundAccountService } from "../fund-account/fund-account.service";
import { FundAccountTransferService } from "../fund-account/fund-account-transfer.service";

// PREPARED ONLY in task15. The existing opt-in PG16 inventory owns execution.
// Merely importing this spec with the flag absent constructs no Prisma client.
const enabled = process.env.RUN_REGISTERED_FUND_ACCOUNT_DATABASE === "1";
const describeDatabase = enabled ? describe : describe.skip;
type RegistrationInsert = Pick<Prisma.FundAccountBalanceRegistrationUncheckedCreateInput,
  "id" | "accountId" | "version" | "kind" | "status" | "approvalInstanceId" | "previousRegistrationId" |
  "balanceYuan" | "asOfDate" | "evidenceReference" | "reconciliationNote" | "reason" | "idempotencyKey" |
  "payloadFingerprint" | "createdByUserId" | "confirmedByUserId" | "confirmedAt" | "reviewNote">;

describeDatabase("registered fund account PostgreSQL invariants (not executed during implementation)", () => {
  let prisma: PrismaClient;
  let actor: string;
  let company: string;
  beforeAll(async () => {
    const target = new URL(process.env.DATABASE_URL ?? "");
    if (process.env.NODE_ENV === "production" || !["127.0.0.1", "localhost", "::1"].includes(target.hostname) || target.pathname !== "/jiangkong_database_dynamic_misc") throw new Error("资金账户约束验收只允许既有本机专用PG16库存入口");
    prisma = new PrismaClient();
    actor = (await prisma.user.create({ data: { name: "资金账户合成验收" } })).id;
    company = (await prisma.companyEntity.create({ data: { name: `资金账户合成${randomUUID()}` } })).id;
  });
  afterAll(async () => { await prisma?.$disconnect(); });
  const registration = (accountId: string) => ({ accountId, version: 1, kind: "opening", status: "confirmed", previousRegistrationId: null, balanceYuan: new Prisma.Decimal(0), asOfDate: "2026-11-05", evidenceReference: "合成核对依据", reconciliationNote: "不含新收入、不重扣历史", reason: "期初核对", idempotencyKey: randomUUID(), payloadFingerprint: "a".repeat(64), createdByUserId: actor, confirmedByUserId: actor, confirmedAt: new Date() });
  // Prisma CREATE injects schema defaults for Task 16's separate install, even
  // with a narrow RETURNING projection. These fixture inserts use base columns.
  async function createAccount({ scopeKey, kind, companyEntityId }: { scopeKey: string; kind: string; companyEntityId: string | null }) {
    const [row] = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "RegisteredFundAccount" ("id", "scopeKey", "kind", "companyEntityId")
      VALUES (${randomUUID()}, ${scopeKey}, ${kind}, ${companyEntityId}) RETURNING "id"
    `;
    return row;
  }
  async function account() {
    const { id } = await prisma.companyEntity.create({ data: { name: `合成公司${randomUUID()}` }, select: { id: true } });
    return createAccount({ scopeKey: `company:${id}`, kind: "company", companyEntityId: id });
  }
  async function createRegistration(tx: Prisma.TransactionClient, data: RegistrationInsert) {
    const [row] = await tx.$queryRaw<Array<{ id: string; balanceYuan: Prisma.Decimal | null }>>`
      INSERT INTO "FundAccountBalanceRegistration" (
        "id", "accountId", "version", "kind", "status", "approvalInstanceId", "previousRegistrationId",
        "balanceYuan", "asOfDate", "evidenceReference", "reconciliationNote", "reason", "idempotencyKey",
        "payloadFingerprint", "createdByUserId", "confirmedByUserId", "confirmedAt", "reviewNote"
      ) VALUES (
        ${data.id ?? randomUUID()}, ${data.accountId}, ${data.version}, ${data.kind}, ${data.status},
        ${data.approvalInstanceId ?? null}, ${data.previousRegistrationId ?? null}, ${data.balanceYuan ?? null},
        ${data.asOfDate}, ${data.evidenceReference}, ${data.reconciliationNote}, ${data.reason}, ${data.idempotencyKey},
        ${data.payloadFingerprint}, ${data.createdByUserId}, ${data.confirmedByUserId ?? null}, ${data.confirmedAt ?? null},
        ${data.reviewNote ?? null}
      ) RETURNING "id", "balanceYuan"
    `;
    return row;
  }
  // Prepared resource tests create real formal-round facts; these helpers never run without opt-in.
  async function correction(data: RegistrationInsert) {
    return prisma.$transaction(async tx => {
      const id = randomUUID(); const roundId = randomUUID();
      await tx.approvalInstance.create({ data: { id: roundId, flowType: "fund_account_balance_correction", businessType: "fund_account_balance_registration", businessId: id, applicantUserId: actor, status: "approval_pending", currentNodeIndex: 0, frozenNodes: [{ name: "财务主管余额核对复核", roleKeys: ["finance_director"], mode: "any", approvedRoleKeys: [], protocolVersion: 1, executionMode: "parallel", roleScopesByRole: { finance_director: "global" } }] } });
      return createRegistration(tx, { ...data, id, approvalInstanceId: roundId });
    });
  }
  async function close(id: string, status: "confirmed" | "returned" | "withdrawn", appendZeroSource = false) {
    return prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "FundAccountBalanceRegistration" WHERE "id" = ${id} FOR UPDATE`);
      const row = await tx.fundAccountBalanceRegistration.findUniqueOrThrow({ where: { id }, select: { status: true, approvalInstanceId: true, previousRegistrationId: true } });
      if (row.status !== "pending_review") return { count: 0 };
      const action = status === "confirmed" ? "approve" : status === "returned" ? "reject" : "withdraw";
      await tx.approvalInstance.update({ where: { id: row.approvalInstanceId! }, data: { status: action === "approve" ? "approved" : action === "reject" ? "rejected" : "withdrawn" } });
      const key = randomUUID();
      await tx.approvalActionLog.create({ data: { approvalInstanceId: row.approvalInstanceId!, actorUserId: actor, representedUserId: actor, action, approvedRoleKey: action === "approve" ? "finance_director" : null, signatureVersionIdSnapshot: action === "approve" ? "synthetic-version" : null, signatureFileIdSnapshot: action === "approve" ? "synthetic-file" : null, signatureSha256Snapshot: action === "approve" ? "a".repeat(64) : null, metadata: { fundReviewCommandKind: "fund_account_balance_review_v1", fundReviewCommandKey: key, fundReviewPayloadFingerprint: "a".repeat(64), fundReviewReceipt: { id, approvalInstanceId: row.approvalInstanceId, status } } } });
      const result = await tx.fundAccountBalanceRegistration.updateMany({ where: { id, status: "pending_review" }, data: status === "confirmed" ? { status, confirmedByUserId: actor, confirmedAt: new Date(), reviewNote: "合成复核" } : { status, closedByUserId: actor, closedAt: new Date(), closeReason: "合成退回或撤回" } });
      if (appendZeroSource) {
        const priorSource = await tx.fundAccountSourceBatch.findFirstOrThrow({ where: { registrationId: row.previousRegistrationId! } });
        await tx.fundAccountSourceBatch.create({ data: { registrationId: id, lineNo: 1, amountYuan: new Prisma.Decimal(0), sourceStatus: "pending", projectStatus: "pending", previousSourceBatchId: priorSource.id } });
      }
      return result;
    });
  }
  // This case needs the separate Task 16 and Task 24 installed material.
  // The historical database inventory has neither and retains its existing cases.
  if (process.env.RUN_REGISTERED_FUND_TRANSFER_LINEAGE_DATABASE === "1") {
    it("keeps held transfer source identity through a real balance correction", async () => {
      const createRoleHolder = async (role: "comprehensive_director" | "finance_staff" | "finance_director") => {
        const user = await prisma.user.create({ data: { name: `合成资金角色 ${role}` } });
        const position = await prisma.position.upsert({ where: { key: role }, update: {}, create: { key: role, name: role } });
        await prisma.userPosition.create({ data: { userId: user.id, positionId: position.id } });
        return user.id;
      };
      const keeper = await createRoleHolder("comprehensive_director");
      const finance = await createRoleHolder("finance_staff");
      const reviewer = await createRoleHolder("finance_director");
      const signatureFile = await prisma.fileObject.create({
        data: {
          bucket: "fund-lineage-local", objectKey: randomUUID(), originalName: "复核手写签名.png",
          mimeType: "image/png", sizeBytes: 1, uploadedByUserId: reviewer, storageStatus: "active",
          contentSha256: "b".repeat(64)
        }
      });
      const signature = await prisma.handwrittenSignatureVersion.create({
        data: { userId: reviewer, fileId: signatureFile.id, contentSha256: "b".repeat(64) }
      });
      const project = async (name: string) => await prisma.project.create({ data: { name, code: randomUUID() } });
      const priorProject = await project("合成资金原项目");
      const otherProject = await project("合成另一项目");
      const audit = new AuditService();
      const funds = new FundAccountService(prisma as never, new AuthService(prisma as never, undefined as never), audit);
      const transfers = new FundAccountTransferService(prisma as never, audit);
      const cashScope = "public_cash";
      const companyScope = `company:${company}`;
      const source = {
        amountYuan: "100.0000", sourceStatus: "known" as const, sourceName: "合成原出资方",
        projectStatus: "project" as const, projectId: priorProject.id
      };
      const opening = {
        balanceYuan: "100.0000", asOfDate: "2026-11-05", evidenceReference: "合成余额凭据",
        reconciliationNote: "合成核对", reason: "合成登记"
      };
      const open = (scopeKey: string, actorId: string) => funds.registerOpening(actorId, {
        ...opening, scopeKey, idempotencyKey: randomUUID(), sources: [source]
      });
      const origin = await open(cashScope, keeper);
      await open(companyScope, finance);
      const transfer = await transfers.register(keeper, {
        sourceScopeKey: cashScope, destinationScopeKey: companyScope, expectedRegistrationId: origin.id,
        idempotencyKey: randomUUID(), evidenceReference: "合成线下转款", transferredOn: opening.asOfDate,
        lines: [{ sourceBatchId: origin.sources[0].id, amountYuan: "30.0001" }]
      });
      const request = (projectId: string) => funds.requestCorrection(finance, {
        ...opening, scopeKey: cashScope, previousRegistrationId: origin.id, idempotencyKey: randomUUID(),
        sources: [{ ...source, projectId, previousSourceBatchId: origin.sources[0].id }]
      });
      const review = (approvalInstanceId: string | null) => {
        if (!approvalInstanceId) throw new Error("隔离夹具缺少资金复核轮次");
        return { expectedApprovalInstanceId: approvalInstanceId, idempotencyKey: randomUUID(), reviewNote: "合成复核" };
      };
      const changed = await request(otherProject.id);
      await expect(prisma.$transaction(async tx => {
        await tx.fundAccountBalanceRegistration.update({ where: { id: changed.id }, data: {
          status: "confirmed", confirmedByUserId: reviewer,
          confirmedAt: new Date(), reviewNote: "合成数据库约束探针"
        } });
        await tx.$executeRaw`SET CONSTRAINTS "FundAccountBalanceRegistration_transfer_capacity" IMMEDIATE`;
      })).rejects.toThrow("pending fund transfer source capacity or lineage changed");
      await expect(funds.confirmCorrection(reviewer, changed.id, review(changed.approvalInstanceId)))
        .rejects.toThrow("待确认转款的余额或来源归属尚未保留");
      expect(await prisma.approvalActionLog.count({ where: { approvalInstanceId: changed.approvalInstanceId! } })).toBe(0);
      await funds.returnCorrection(reviewer, changed.id, review(changed.approvalInstanceId));

      const preserved = await request(priorProject.id);
      await expect(funds.confirmCorrection(reviewer, preserved.id, review(preserved.approvalInstanceId)))
        .resolves.toMatchObject({ status: "confirmed", signatureVersionId: signature.id });
      await expect(funds.readAccount(finance, cashScope)).resolves.toMatchObject({
        currentRegistrationId: preserved.id, balanceYuan: "69.9999"
      });
      await expect(transfers.act(finance, transfer.id, {
        expectedRevision: 1, action: "confirm", idempotencyKey: randomUUID(), evidenceReference: "合成实收"
      })).resolves.toMatchObject({ id: transfer.id, status: "received" });

      const rows = await prisma.fundAccountSourceBatch.findMany({
        where: { registration: { transferId: transfer.id } }
      });
      expect(rows.every(row => row.projectId === priorProject.id && row.sourceName === source.sourceName)).toBe(true);
      expect(rows.filter(row => row.receivedTransferLineId).map(row => row.amountYuan.toFixed(4))).toEqual(["30.0001"]);
      await expect(funds.readAccount(finance, cashScope)).resolves.toMatchObject({ balanceYuan: "69.9999" });
      await expect(funds.readAccount(finance, companyScope)).resolves.toMatchObject({ balanceYuan: "130.0001" });
    }, 30_000);
  }

  it("binds scope key to the precise company and forbids a company-owned public cash account", async () => {
    await expect(createAccount({ scopeKey: `company:wrong-${company}`, kind: "company", companyEntityId: company })).rejects.toMatchObject({ meta: { code: "23514" } });
    await expect(createAccount({ scopeKey: `invalid-cash-${company}`, kind: "public_cash", companyEntityId: company })).rejects.toMatchObject({ meta: { code: "23514" } });
  });
  it("admits only one global companyless public cash container under a race", async () => {
    const outcomes = await Promise.allSettled([1, 2].map(() => createAccount({ scopeKey: "public_cash", kind: "public_cash", companyEntityId: null })));
    expect(outcomes.filter(row => row.status === "fulfilled")).toHaveLength(1);
  });
  it("admits one opening root per account under simultaneous different idempotency keys", async () => {
    const container = await account();
    const results = await Promise.allSettled([1, 2].map(() => createRegistration(prisma, registration(container.id))));
    expect(results.filter(row => row.status === "fulfilled")).toHaveLength(1);
  });
  it("refuses known balances without conserving sources but permits unknown without invented zero", async () => {
    const container = await account();
    await expect(createRegistration(prisma, { ...registration(container.id), balanceYuan: new Prisma.Decimal("80000") })).rejects.toThrow();
    const unknown = await createRegistration(prisma, { ...registration(container.id), balanceYuan: null });
    expect(unknown.balanceYuan).toBeNull();
  });
  it("preserves 4-place source amounts independently from unresolved project and source", async () => {
    const container = await account();
    await prisma.$transaction(async tx => {
      const opening = await createRegistration(tx, { ...registration(container.id), balanceYuan: new Prisma.Decimal("80000.1234") });
      await tx.fundAccountSourceBatch.create({ data: { registrationId: opening.id, lineNo: 1, amountYuan: new Prisma.Decimal("80000.1234"), sourceStatus: "pending", projectStatus: "pending" } });
    });
    const rows = await prisma.fundAccountBalanceRegistration.findMany({ where: { accountId: container.id }, select: { balanceYuan: true, sources: { select: { amountYuan: true, projectId: true } } } });
    expect(rows[0].balanceYuan?.toFixed(4)).toBe("80000.1234");
    expect(rows[0].sources[0].amountYuan.toFixed(4)).toBe("80000.1234");
    expect(rows[0].sources[0].projectId).toBeNull();
  });
  it("rejects cross-account predecessor and preserves confirmed history against rewrite", async () => {
    const a = await account(); const b = await account();
    const opening = await createRegistration(prisma, registration(a.id));
    await expect(correction({ ...registration(b.id), version: 2, kind: "correction", status: "pending_review", confirmedAt: null, confirmedByUserId: null, previousRegistrationId: opening.id })).rejects.toThrow();
    await expect(prisma.fundAccountBalanceRegistration.update({ where: { id: opening.id }, data: { balanceYuan: new Prisma.Decimal(1) }, select: { id: true } })).rejects.toThrow();
  });
  it("admits only one pending successor and prevents stale confirmed successors", async () => {
    const container = await account();
    const opening = await createRegistration(prisma, registration(container.id));
    const pending = { ...registration(container.id), kind: "correction", status: "pending_review", previousRegistrationId: opening.id, confirmedAt: null, confirmedByUserId: null };
    const outcomes = await Promise.allSettled([2, 3].map(version => correction({ ...pending, version, idempotencyKey: randomUUID() })));
    expect(outcomes.filter(row => row.status === "fulfilled")).toHaveLength(1);
    const row = await prisma.fundAccountBalanceRegistration.findFirstOrThrow({ where: { accountId: container.id, status: "pending_review" }, select: { id: true, approvalInstanceId: true } });
    await expect(prisma.fundAccountBalanceRegistration.update({where:{id:row.id},data:{status:"confirmed",confirmedByUserId:actor,confirmedAt:new Date(),reviewNote:"缺少正式签批不得生效"},select:{id:true}})).rejects.toThrow();
    expect((await prisma.fundAccountBalanceRegistration.findUniqueOrThrow({where:{id:row.id},select:{status:true}})).status).toBe("pending_review");
    await close(row.id, "confirmed");
    const receipt = await prisma.approvalActionLog.findFirstOrThrow({where:{approvalInstanceId:row.approvalInstanceId!}});
    await expect(prisma.approvalActionLog.update({where:{id:receipt.id},data:{comment:"不能改写已办回执"}})).rejects.toThrow();
    await expect(prisma.approvalActionLog.delete({where:{id:receipt.id}})).rejects.toThrow();
    await expect(prisma.approvalActionLog.create({data:{approvalInstanceId:row.approvalInstanceId!,action:"approve",actorUserId:actor,metadata:receipt.metadata as Prisma.InputJsonValue}})).rejects.toThrow();
    const unrelated = await prisma.approvalActionLog.create({data:{approvalInstanceId:randomUUID(),action:"comment",actorUserId:actor,metadata:{businessType:"unrelated"}}});
    await prisma.approvalActionLog.update({where:{id:unrelated.id},data:{comment:"旧类型不受fund namespace约束影响"}});
    await prisma.approvalActionLog.delete({where:{id:unrelated.id}});
    await expect(createRegistration(prisma, { ...pending, version: 4, idempotencyKey: randomUUID(), status: "confirmed", confirmedByUserId: actor, confirmedAt: new Date(), reviewNote: "不允许跳过待复核" })).rejects.toThrow();
  });
  async function terminalSourceAppendIsRejected(status: "confirmed" | "returned" | "withdrawn") {
    const container = await account();
    const opening = await prisma.$transaction(async tx => {
      const row = await createRegistration(tx, registration(container.id));
      // Real zero is valid in the original opening transaction.
      await tx.fundAccountSourceBatch.create({ data: { registrationId: row.id, lineNo: 1, amountYuan: new Prisma.Decimal(0), sourceStatus: "pending", projectStatus: "pending" } });
      return row;
    });
    const pending = await correction({ ...registration(container.id), version: 2, kind: "correction", status: "pending_review", previousRegistrationId: opening.id, confirmedByUserId: null, confirmedAt: null });
    // Legal review log + terminal UPDATE refresh xmin, but may not append a
    // zero-valued source referencing the legitimate original source afterward.
    await expect(close(pending.id, status, true)).rejects.toThrow();
    expect((await prisma.fundAccountBalanceRegistration.findUniqueOrThrow({ where: { id: pending.id }, select: { status: true } })).status).toBe("pending_review");
    expect(await prisma.fundAccountSourceBatch.count({ where: { registrationId: pending.id } })).toBe(0);
    await close(pending.id, status);
  }
  it("rejects zero source append after a legitimate confirmed UPDATE in the same closing transaction", async () => terminalSourceAppendIsRejected("confirmed"));
  it("rejects zero source append after a legitimate returned UPDATE in the same closing transaction", async () => terminalSourceAppendIsRejected("returned"));
  it("rejects zero source append after a legitimate withdrawn UPDATE in the same closing transaction", async () => terminalSourceAppendIsRejected("withdrawn"));
  it("rejects source snapshots added after the original reconciliation transaction", async () => {
    const container = await account();
    const opening = await createRegistration(prisma, registration(container.id));
    await expect(prisma.fundAccountSourceBatch.create({ data: { registrationId: opening.id, lineNo: 1, amountYuan: new Prisma.Decimal(0), sourceStatus: "pending", projectStatus: "pending" } })).rejects.toThrow();
  });
  it("retains returned versions, frees pending uniqueness, rejects old confirmation, and serializes the next confirmation versus withdrawal", async () => {
    const container = await account();
    const opening = await createRegistration(prisma, registration(container.id));
    const pendingData = { ...registration(container.id), version: 2, kind: "correction", status: "pending_review", previousRegistrationId: opening.id, confirmedAt: null, confirmedByUserId: null };
    const pending = await correction(pendingData);
    await close(pending.id, "returned");
    await expect(prisma.fundAccountBalanceRegistration.update({ where: { id: pending.id }, data: { status: "confirmed", confirmedByUserId: actor, confirmedAt: new Date(), reviewNote: "不能复活旧单" }, select: { id: true } })).rejects.toThrow();
    const next = await correction({ ...pendingData, version: 3, idempotencyKey: randomUUID() });
    const results = await Promise.all([
      close(next.id, "confirmed"),
      close(next.id, "withdrawn")
    ]);
    expect(results.map(result => result.count).sort()).toEqual([0, 1]);
    expect(await prisma.fundAccountBalanceRegistration.count({ where: { accountId: container.id } })).toBe(3);
  });
});
