import { randomUUID } from "node:crypto";
import { FundAccountTransferNotificationService } from "../fund-account/fund-account-transfer-notification.service";
import { ApprovalSmsService } from "../approval/approval-sms.service";
import { hash } from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { apiJsonReplacer } from "../api-json-replacer";
import { createApiValidationPipe } from "../validation/api-validation";
import { PrismaService } from "./prisma.service";
import { Task16SharedPaymentApplicationModule } from "./task16-shared-payment-application";
import { syntheticCreditCode } from "./task16-shared-standard-fixture";

const notices = process.env.TASK419_REAL_FUND_NOTICES === "1";
const live = process.env.RUN_TASK407_HANDOVER_PG16 === "1" ? it : it.skip;
live(notices ? "sends one matching duty notice to the named custodian and cancels a revoked intent" : "hands over real registered cash without rewriting balances, and takes over a departed custodian's held transfers", async () => {
  const runId = process.env.TASK398_RUN_ID ?? "";
  const db = "/jiangkong_payment_execution_concurrency";
  const urls = [process.env.TASK398_OWNER_URL, process.env.DATABASE_URL, process.env.TASK398_OBSERVER_URL].map(s => new URL(s ?? ""));
  const users = ["jg_task01_owner", "jg_task01_runtime", "jg_task01_observer"];
  if (process.env.NODE_ENV !== "test" || !/^[0-9a-f]{32}$/u.test(runId) ||
      !urls.every((url, index) => url.hostname === "127.0.0.1" && url.port === urls[0].port &&
      url.pathname === db && url.username === users[index])) throw new Error("TASK407_ISOLATED_DATABASE_REQUIRED");
  const [owner, runtime, observer] = urls.map(url => new PrismaClient({ datasources: { db: { url: url.href } } }));
  let app: INestApplication | undefined;
  try {
    const identities = await Promise.all([owner, runtime, observer].map(client =>
      client.$queryRaw<Array<{ runId: string; actor: string; superuser: boolean }>>`
        SELECT current_setting('jg.task398_run_id',true) AS "runId", current_user::text AS actor,
        (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser`));
    identities.forEach(([row], index) => {
      expect(row).toMatchObject({ runId, actor: users[index], superuser: index === 0 });
    });
    const password = randomUUID();
    const passwordHash = await hash(password, 10);
    const ids = { previous: randomUUID(), next: randomUUID(), unrelated: randomUUID(), finance: randomUUID(), company: randomUUID() };
    const accounts = [
      [ids.previous, "19500000001", "comprehensive_director"], [ids.next, "19500000002", "comprehensive_director"],
      [ids.unrelated, "19500000003", "comprehensive_director"], [ids.finance, "19500000004", "finance_staff"]
    ];
    await owner.$transaction(async tx => {
      for (const [id, phone, key] of accounts) {
        await tx.user.create({ data: { id, phone, passwordHash, name: `合成现金${phone.slice(-1)}`, mustChangePassword: false } });
        const position = await tx.position.upsert({ where: { key }, create: { key, name: key }, update: {} });
        await tx.userPosition.create({ data: { userId: id, positionId: position.id, projectId: null } });
      }
      await tx.companyEntity.create({ data: { id: ids.company, name: "合成转款公司", dataStatus: "complete",
        currentVersionNo: 1, unifiedSocialCreditCode: syntheticCreditCode(runId.slice(0, 12), 0) } });
    });

    let smsAvailable = false;
    const sender = jest.fn().mockResolvedValue({status: "accepted"});
    const builder = Test.createTestingModule({ imports: [Task16SharedPaymentApplicationModule] })
      .overrideProvider(PrismaService).useValue(runtime);
    if (notices) builder.overrideProvider(ApprovalSmsService).useValue({available: () => smsAvailable, sendDutyIntent: sender});
    const module = await builder.compile();
    app = module.createNestApplication({ logger: false });
    app.getHttpAdapter().getInstance().set("json replacer", apiJsonReplacer);
    app.useGlobalPipes(createApiValidationPipe());
    await app.listen(0, "127.0.0.1");
    const origin = await app.getUrl();
    const request = async (path: string, token?: string, body?: unknown) => {
      const response = await fetch(origin + path, { method: body === undefined ? "GET" : "POST",
        headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, body: await response.json() };
    };
    const login = async (phone: string) => {
      const response = await request("/auth/login", undefined, { phone, password });
      expect(response.status).toBe(201);
      return response.body.tokens.accessToken as string;
    };
    const [previous, next, unrelated, finance] = await Promise.all(accounts.map(account => login(account[1])));
    const cashScope = "public_cash";
    const companyScope = `company:${ids.company}`;
    const handovers = "/public-cash-handovers";
    const initial = handovers + "/initial-custodian";
    const transfers = "/fund-account-transfers";
    const open = (scopeKey: string, token: string) => request("/fund-accounts/openings", token, {
      scopeKey, balanceYuan: "100", asOfDate: "2026-11-05", evidenceReference: "合成期初", reconciliationNote: "合成实点",
      reason: "隔离校验", idempotencyKey: randomUUID(), sources: [{
        amountYuan: "100", sourceStatus: "pending", sourceName: null, projectStatus: "pending", projectId: null
      }]
    });
    const cash = await open(cashScope, previous);
    const company = await open(companyScope, finance);
    expect([cash.status, company.status]).toEqual([201, 201]);
    const cashId = (await observer.registeredFundAccount.findUniqueOrThrow({ where: { scopeKey: cashScope } })).id;
    const initialInput = { idempotencyKey: randomUUID(), expectedRevision: 0 };
    expect((await request(initial, finance, initialInput)).status).toBe(403);
    const claim = await request(initial, previous, initialInput);
    expect(claim).toMatchObject({ status: 201, body: { custodianId: ids.previous } });
    expect(await request(initial, previous, initialInput)).toEqual(claim);
    expect((await request(initial, next, { idempotencyKey: randomUUID(), expectedRevision: 1 })).status).toBe(409);

    if (notices) {
      const register = () => request(transfers, finance, {
        sourceScopeKey: companyScope, destinationScopeKey: cashScope, expectedRegistrationId: company.body.id,
        idempotencyKey: randomUUID(), transferredOn: "2026-11-06", evidenceReference: "合成公司转现金",
        lines: [{sourceBatchId: company.body.sources[0].id, amountYuan: "2.1251"}]
      });
      const businessType = "registered_fund_transfer_duty_notification";
      const evidence = (id:string) => observer.$transaction(async tx => {
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
        const transfer = await tx.registeredFundTransfer.findUniqueOrThrow({where:{id},select:{status:true,revision:true}});
        const actions = await tx.registeredFundTransferAction.count({where:{transferId:id}});
        const events = await tx.auditLog.findMany({where:{businessId:id,businessType},select:{action:true,metadata:true}});
        return {transfer,actions,events};
      });
      const duty = async (token:string,id:string) => {
        const response = await request("/me/work-items",token);
        expect(response.status).toBe(200);
        return response.body.queues.pending.find((row:{businessId:string}) => row.businessId === id);
      };
      const first = await register();
      expect(first).toMatchObject({status:201,body:{status:"pending_receipt",revision:1}});
      const id = first.body.id as string;
      expect(await evidence(id)).toMatchObject({transfer:{status:"pending_receipt",revision:1},actions:1,
        events:[{action:"queued",metadata:{recipientId:ids.previous,revision:1}}]});
      expect(await duty(previous,id)).toMatchObject({targetPath:"/资金账户",amountText:"2.1251 元"});
      expect(await duty(next,id)).toBeUndefined();
      const consumer = app.get(FundAccountTransferNotificationService);
      smsAvailable=true;
      await consumer.afterCommit();
      await consumer.afterCommit();
      expect(sender).toHaveBeenCalledTimes(1);
      expect(sender).toHaveBeenCalledWith(accounts[0][1],expect.objectContaining({targetPath:"/资金账户",amountText:"2.1251 元"}));
      expect((await evidence(id)).events.map(event=>event.action).sort()).toEqual(["accepted","dispatch_claimed","queued"]);

      smsAvailable=false;
      const second = await register();
      expect(second).toMatchObject({status:201,body:{status:"pending_receipt",revision:1}});
      const secondId = second.body.id as string;
      expect(await duty(previous,secondId)).toBeDefined();
      await owner.userPosition.deleteMany({where:{userId:ids.previous,projectId:null}});
      expect(await duty(previous,secondId)).toBeUndefined();
      expect(await duty(unrelated,secondId)).toBeUndefined();
      smsAvailable=true;
      await consumer.afterCommit();
      await consumer.afterCommit();
      expect(sender).toHaveBeenCalledTimes(1);
      const final = await evidence(secondId);
      expect(final).toMatchObject({transfer:{status:"pending_receipt",revision:1},actions:1});
      expect(final.events.map(event=>event.action).sort()).toEqual(["cancelled","queued"]);
      console.log("TASK419_FUND_TRANSFER_NOTICE_PASS named=1 revoked=0 transfer-revisions=1,1 actions=1,1");
      return;
    }

    const firstBatch = cash.body.sources[0].id as string;
    const send = async (amountYuan: string, token = previous) => {
      return request(transfers, token, {
        sourceScopeKey: cashScope, destinationScopeKey: companyScope, expectedRegistrationId: cash.body.id,
        idempotencyKey: randomUUID(), transferredOn: "2026-11-06", evidenceReference: "合成转款材料",
        lines: [{ sourceBatchId: firstBatch, amountYuan }]
      });
    };
    const act = async (id: string, token: string, action: string, expectedRevision: number, idempotencyKey = randomUUID()) => {
      return request(`${transfers}/${id}/actions`, token, {
        idempotencyKey, action, expectedRevision, evidenceReference: "隔离核对实际款项"
      });
    };
    const start = async (token: string, deliveredYuan: string, toCustodianId = ids.next) => {
      const read = await request(handovers, token);
      expect(read.status).toBe(200);
      return request(handovers, token, { idempotencyKey: randomUUID(), toCustodianId,
        expectedRevision: read.body.revision, deliveredYuan, evidenceReference: "合成交接盘点" });
    };
    const confirm = (id: string, token: string, receivedYuan: string, idempotencyKey = randomUUID()) =>
      request(`${handovers}/${id}/confirmation`, token, { idempotencyKey, receivedYuan });
    const observeMoney = async () => {
      return observer.$transaction(async tx => {
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
        return {
          balances: (await tx.fundAccountBalanceRegistration.findMany({ orderBy: [{ accountId: "asc" }, { version: "asc" }],
            select: { id: true, balanceYuan: true, status: true, accountId: true, version: true } }))
            .map(row => ({ ...row, balanceYuan: row.balanceYuan?.toFixed(4) })),
          factCount: await tx.operatingFact.count(), impactCount: await tx.operatingImpactEntry.count(),
          executionCount: await tx.paymentExecution.count()
        };
      });
    };
    const sentA = await send("20");
    const sentB = await send("10");
    expect([sentA.status, sentB.status]).toEqual([201, 201]);
    expect((await act(sentA.body.id, finance, "reject", 1)).status).toBe(201);
    expect((await act(sentB.body.id, finance, "reject", 1)).status).toBe(201);
    const stale = await start(previous, "70");
    expect(stale).toMatchObject({ status: 201, body: { expectedBalanceYuan: "70.0000" } });
    const third = await send("5");
    expect(third.status).toBe(201);
    expect((await act(third.body.id, finance, "confirm", 1)).status).toBe(201);
    expect(await confirm(stale.body.id, next, "70")).toMatchObject({ status: 409, body: { code: "PUBLIC_CASH_HANDOVER_SUPERSEDED" } });

    await owner.user.update({ where: { id: ids.previous }, data: { isActive: false, sessionVersion: { increment: 1 } } });
    expect([401, 403]).toContain((await request(handovers, previous)).status);
    expect((await act(sentA.body.id, next, "return", 2)).status).toBe(403);
    const before = await observeMoney();
    const started = await start(finance, "65");
    expect(started).toMatchObject({ status: 201, body: { expectedBalanceYuan: "65.0000" } });
    expect((await confirm(started.body.id, unrelated, "65")).status).toBe(403);
    const key = randomUUID();
    const decided = await confirm(started.body.id, next, "64.9999", key);
    expect(decided).toMatchObject({ status: 201, body: { discrepancyYuan: "-0.0001", status: "awaiting_reconciliation" } });
    expect(await confirm(started.body.id, next, "64.9999", key)).toEqual(decided);
    expect(await observeMoney()).toEqual(before);
    expect(await observer.publicCashCustody.findUniqueOrThrow({ where: { accountId: cashId } }))
      .toMatchObject({ initialCustodianId: ids.previous, currentCustodianId: ids.next });
    expect(await observer.publicCashHandover.findUniqueOrThrow({ where: { id: started.body.id } }))
      .toMatchObject({ fromCustodianId: ids.previous, startedByUserId: ids.finance, toCustodianId: ids.next });
    expect(await observer.publicCashHandoverReceipt.count()).toBe(1);

    const heldList = await request(transfers, next);
    expect(heldList.body.transfers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: sentA.body.id, status: "rejected_held", canResolveRejection: true }),
      expect.objectContaining({ id: sentB.body.id, status: "rejected_held", canResolveRejection: true })
    ]));
    expect((await act(sentA.body.id, unrelated, "return", 2)).status).toBe(403);
    expect(await act(sentA.body.id, next, "return", 2)).toMatchObject({ status: 201, body: { status: "returned" } });
    expect(await act(sentB.body.id, next, "resubmit", 2)).toMatchObject({ status: 201, body: { status: "pending_receipt" } });
    expect(await observeMoney()).toEqual(before);
    for (const id of [sentA.body.id, sentB.body.id]) {
      expect(await observer.registeredFundTransfer.findUniqueOrThrow({ where: { id } })).toMatchObject({ createdByUserId: ids.previous });
      expect((await observer.registeredFundTransferAction.findMany({ where: { transferId: id }, orderBy: { revision: "asc" } })).map(row => row.actorUserId))
        .toEqual([ids.previous, ids.finance, ids.next]);
      expect(await observer.auditLog.findFirst({ where: { businessId: id, actorUserId: ids.next } }))
        .toMatchObject({ metadata: { cashCustodyHandoverId: started.body.id } });
    }
    const after = await request("/fund-accounts", finance);
    expect(after.body.accounts).toEqual(expect.arrayContaining([
      expect.objectContaining({ scopeKey: cashScope, balanceYuan: "85.0000" }),
      expect.objectContaining({ scopeKey: companyScope, balanceYuan: "105.0000" })
    ]));
    const cashBeforeRace = after.body.accounts.find((account: { scopeKey: string }) => account.scopeKey === cashScope);
    const raceHandover = await start(next, "85", ids.unrelated);
    expect(raceHandover.status).toBe(201);
    const raceKey = randomUUID();
    const [handoverRace, transferRace] = await Promise.all([
      confirm(raceHandover.body.id, unrelated, "85"),
      request(transfers, next, {
        sourceScopeKey: cashScope, destinationScopeKey: companyScope,
        expectedRegistrationId: cashBeforeRace.currentRegistrationId, idempotencyKey: raceKey,
        transferredOn: "2026-11-06", evidenceReference: "合成并发现金转款",
        lines: [{ sourceBatchId: cashBeforeRace.sources[0].id, amountYuan: "1.0000" }]
      })
    ]);
    expect([handoverRace.status, transferRace.status].filter(code => code === 201)).toHaveLength(1);
    const finalCustody = await observer.publicCashCustody.findUniqueOrThrow({ where: { accountId: cashId } });
    expect(finalCustody.currentCustodianId).toBe(handoverRace.status === 201 ? ids.unrelated : ids.next);
    if (transferRace.status === 201) {
      expect(handoverRace.status).toBe(409);
      expect((await observer.registeredFundTransferAction.findUniqueOrThrow({ where: { idempotencyKey: raceKey } })).actorUserId).toBe(ids.next);
    } else {
      expect([403, 409]).toContain(transferRace.status);
      expect(await observer.registeredFundTransferAction.findUnique({ where: { idempotencyKey: raceKey } })).toBeNull();
    }

  } finally {
    await app?.close();
    await Promise.all([owner.$disconnect(), runtime.$disconnect(), observer.$disconnect()]);
  }
}, 120_000);
