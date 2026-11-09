import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Prisma } from "@prisma/client";
import { FileController } from "../file/file.controller";
import { fingerprint } from "../operating-takeover/operating-takeover.utils";
import { AuditController } from "../audit/audit.controller";
import { OperatingLedgerService } from "../operating-ledger/operating-ledger.service";
import { OperatingSourceReplayService } from "../operating-ledger/operating-source-replay.service";
import { OperatingSourceAdapterRegistry } from "../operating-ledger/operating-source-adapter";
import { PaymentExecutionOperatingSourceAdapter } from "./payment-operating-source.adapter";
import { type INestApplication } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionGuard } from "../auth/guards/permission.guard";
import { JwtTokenService } from "../auth/jwt-token.service";
import { PrismaService } from "../database/prisma.service";
import { createRegisteredPaymentSyntheticDb } from "./testing/registered-payment-execution.synthetic-db";
import { PaymentRequestService } from "./payment-request.service";
import { PaymentController } from "./payment.controller";
import { PaymentReadService } from "./payment-read.service";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { ApprovalSmsService } from "../approval/approval-sms.service";
import { apiJsonReplacer } from "../api-json-replacer";
import { PaymentAmountService } from "./payment-amount.service";
import { RetiredWriteEntryGuard } from "../retired-write-entry/retired-write-entry.guard";
import { createApiValidationPipe } from "../validation/api-validation";
import { RegisteredPaymentExecutionController } from "./registered-payment-execution.controller";
import { RegisteredPaymentExecutionService } from "./registered-payment-execution.service";
import { RegisteredPaymentNotificationService } from "./registered-payment-notification.service";
import { MeController } from "../me/me.controller";
import { MeService } from "../me/me.service";
import { FileService, PrivateFileStorage } from "../file/file.service";
import { AuthService } from "../auth/auth.service";
import { FundAccountController } from "../fund-account/fund-account.controller";
import { FundAccountService } from "../fund-account/fund-account.service";
import { AuditService } from "../audit/audit.service";

// Persistence and identity facts are synthetic. HTTP, role resolution, JWT,
// permission/retirement guards and the business service remain real.
describe("registered payment execution public HTTP (synthetic persistence)", () => {
  let app: INestApplication;
  let database: ReturnType<typeof createRegisteredPaymentSyntheticDb>;
  let notificationSmsCalls: string[];
  let notificationSmsEnabled: boolean;
  let notificationSmsOutcome: "accepted" | "failed" | "unknown";
  let notificationTransactionDepth: number;
  let notificationSmsTransactionStates: boolean[];
  const tokens = new JwtTokenService();
  const previousOperatingWriteSecret = process.env.OPERATING_LEDGER_DB_WRITE_SECRET;
  const previousStorageDriver = process.env.FILE_STORAGE_DRIVER;
  const previousStorageRoot = process.env.FILE_STORAGE_ROOT;
  let voucherStorageRoot: string | undefined;

  beforeAll(async () => {
    voucherStorageRoot = await mkdtemp(join(tmpdir(), "jg-task16-voucher-fixture-"));
    process.env.FILE_STORAGE_DRIVER = "local";
    process.env.FILE_STORAGE_ROOT = voucherStorageRoot;
  });

  afterAll(async () => {
    if (previousStorageDriver === undefined) delete process.env.FILE_STORAGE_DRIVER;
    else process.env.FILE_STORAGE_DRIVER = previousStorageDriver;
    if (previousStorageRoot === undefined) delete process.env.FILE_STORAGE_ROOT;
    else process.env.FILE_STORAGE_ROOT = previousStorageRoot;
    if (voucherStorageRoot) await rm(voucherStorageRoot, { recursive: true, force: true });
  });
  beforeAll(() => { process.env.OPERATING_LEDGER_DB_WRITE_SECRET = "synthetic-local-payment16-not-a-database-credential"; });
  afterAll(() => { if (previousOperatingWriteSecret === undefined) delete process.env.OPERATING_LEDGER_DB_WRITE_SECRET; else process.env.OPERATING_LEDGER_DB_WRITE_SECRET = previousOperatingWriteSecret; });
  beforeEach(async () => {
    database = createRegisteredPaymentSyntheticDb();
    notificationSmsCalls = [];
    notificationSmsEnabled = false;
    notificationSmsOutcome = "accepted";
    notificationTransactionDepth = 0;
    notificationSmsTransactionStates = [];
    const seed = database.prisma as unknown as {
      paymentRequest: { create(input: { data: Record<string, unknown> }): Promise<unknown> };
      approvalInstance: { create(input: { data: Record<string, unknown> }): Promise<unknown> };
    };
    await seed.approvalInstance.create({ data: {
      id: "approved-round-a", businessType: "payment_request", businessId: "payment-a",
      flowType: "payment.approve", status: "approved", frozenNodes: [], currentNodeIndex: 1, applicantUserId: "employee",
      createdAt: new Date("2026-11-01T00:00:00Z")
    } });
    await seed.paymentRequest.create({ data: {
      id: "payment-a", code: "FK-16-01", projectId: "project-a", sourceType: "contract_due",
      paymentSubjectType: "our_company", contractId: "contract-a", contractVersionId: "version-a", paymentTermsVersionId: "terms-a",
      requestedAmountCents: 10000n, approvedAmountCents: 10000n, paidAmountCents: 0n,
      status: "approved_pending_payment",
      updatedAt: new Date("2026-11-05T00:00:00Z")
    } });
    const module = await Test.createTestingModule({
      controllers: [PaymentController, FileController, RegisteredPaymentExecutionController, MeController, FundAccountController, AuditController],
      providers: [{ provide: ApprovalSmsService, useValue: { available: () => notificationSmsEnabled, send: async (phone: string) => { notificationSmsCalls.push(phone); notificationSmsTransactionStates.push(notificationTransactionDepth > 0); if (notificationSmsEnabled) return {status:notificationSmsOutcome,message:"Synthetic SMS outcome; no external gateway"}; return {status:"failed",message:"\u5408\u6210\u77ed\u4fe1\u9002\u914d\u5668\u5173\u95ed"}; } } }, PaymentReadService, ProjectVisibilityService, { provide: OperatingSourceReplayService, inject: [PrismaService], useFactory: (prisma: PrismaService) => new OperatingSourceReplayService(prisma,new OperatingLedgerService(prisma),new OperatingSourceAdapterRegistry([new PaymentExecutionOperatingSourceAdapter()])) }, { provide: PaymentRequestService, inject: [PrismaService, AuthService, AuditService, FileService, OperatingSourceReplayService, RegisteredPaymentNotificationService], useFactory: (prisma: PrismaService, auth: AuthService, audit: AuditService, files: FileService, operating: OperatingSourceReplayService, notifications: RegisteredPaymentNotificationService) => new PaymentRequestService(new PaymentAmountService(), prisma, audit, files, auth, undefined, undefined, undefined, undefined, operating, undefined, notifications) }, RegisteredPaymentExecutionService, RegisteredPaymentNotificationService, MeService, AuditService, AuthService, JwtTokenService, FundAccountService, { provide: FileService, inject: [PrismaService, AuditService], useFactory: (prisma: PrismaService, audit: AuditService) => new FileService(prisma,audit,new PrivateFileStorage()) }, { provide: PrismaService, useValue: database.prisma }]
    }).compile();
    app = module.createNestApplication({ logger: ["error"] });
    app.getHttpAdapter().getInstance().set("json replacer", apiJsonReplacer);
    const reflector = new Reflector();
    app.useGlobalGuards(new JwtAuthGuard(reflector, tokens, database.prisma as never),
      new RetiredWriteEntryGuard(), new PermissionGuard(reflector, database.prisma as never));
    app.useGlobalPipes(createApiValidationPipe());
    await app.listen(0, "127.0.0.1");
  });
  afterEach(async () => { await app?.close(); });
  async function get(actor: string, path = "/payment-executions/work-items") {
    const token = tokens.signAccessToken({ id: actor, name: "合成付款人员", phone: null, sessionVersion: 0 });
    const response = await fetch(`${await app.getUrl()}${path}`, { headers: { authorization: `Bearer ${token}` } });
    return { status: response.status, body: await response.json() };
  }
  async function post(actor: string, path: string, body: unknown) {
    const token = tokens.signAccessToken({ id: actor, name: "合成付款人员", phone: null, sessionVersion: 0 });
    const response = await fetch(`${await app.getUrl()}${path}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }
  async function prepareFrozenOurVersion(contractTypeKey = "material_purchase") {
    const seed=database.prisma as unknown as Record<string,{create(input:{data:Record<string,unknown>}):Promise<unknown>}>;
    await seed.contract.create({data:{id:"contract-a",code:"HT-16-01",name:"合成合同",projectId:"project-a",contractTypeKey}});
    await seed.contractVersion.create({data:{id:"version-a",contractId:"contract-a",versionNo:1,status:"active",signingSubjectType:"our_company",companyEntityIdSnapshot:"company-a",companyEntityNameSnapshot:"甲公司",companyEntityCreditCodeSnapshot:"SYNTHETIC-COMPANY-A"}});
    await seed.paymentTermsVersion.create({data:{id:"terms-a",contractId:"contract-a",contractVersionId:"version-a",versionNo:1,status:"active",originalText:"按冻结付款条件分次付款",updatedAt:new Date("2026-11-01T00:00:00Z")}});
  }
  async function prepareApprovedPayment(sourceStatus: "known" | "pending" = "known") {
    const opening = await post("finance", "/fund-accounts/openings", {
      scopeKey: "company:company-a", balanceYuan: "100", asOfDate: "2026-11-05", evidenceReference: "甲公司期初核对表",
      reconciliationNote: "余额和来源核对一致", reason: "期初启用", idempotencyKey: "task16-opening-a",
      sources: [{ amountYuan: "100", sourceStatus, sourceName: sourceStatus === "known" ? "甲项目自有资金" : null, projectStatus: "project", projectId: "project-a" }]
    });
    expect(opening.status).toBe(201);
    const seed = database.prisma as unknown as Record<string, {create(input: {data:Record<string,unknown>}): Promise<unknown>; update(input:{where:{id:string};data:Record<string,unknown>}):Promise<unknown>}>;
    await seed.contract.create({data:{id:"contract-a",projectId:"project-a",contractTypeKey:"material_purchase"}});
    await seed.contractVersion.create({data:{id:"version-a",contractId:"contract-a",status:"active",signingSubjectType:"our_company",companyEntityIdSnapshot:"company-a",companyEntityNameSnapshot:"甲公司",companyEntityCreditCodeSnapshot:"SYNTHETIC-COMPANY-A"}});
    await seed.paymentTermsVersion.create({data:{id:"terms-a",contractId:"contract-a",contractVersionId:"version-a",versionNo:1,status:"active",originalText:"按冻结付款条件分次付款",updatedAt:new Date("2026-11-01T00:00:00Z")}});
    await seed.settlement.create({data:{id:"settlement-a",contractId:"contract-a",contractVersionId:"version-a",status:"effective",payableAmountCents:10000n,paidAmountCents:0n}});
    await seed.paymentRequest.update({where:{id:"payment-a"},data:{sourceType:"settlement",settlementId:"settlement-a"}});
    return opening;
  }
  async function recordSourcePayment(opening: {body:{id:string;sources:Array<{id:string}>}}, amountCents: string, key: string) {
    const current = await get("keeper");
    return post("keeper", "/payment-executions/payment-a/registrations", {
      idempotencyKey:key, expectedPaymentUpdatedAt:current.body.items[0].expectedPaymentUpdatedAt, amountCents, paidAt:"2026-11-06",
      scopeKey:"company:company-a", expectedRegistrationId:opening.body.id,
      openingTreatment:"not_included", openingReason:"已核对此笔未含期初", openingEvidence:"实际付款登记及核对依据",
      sourceAllocations:[{sourceBatchId:opening.body.sources[0].id,amountCents}], confirmationPassword:"Synthetic15Password!"
    });
  }
  async function prepareConfirmedHistoricalPayment() {
    const opening = await prepareApprovedPayment();
    const seed = database.prisma as unknown as Record<string, {
      create(input:{data:Record<string,unknown>}):Promise<unknown>;
      update(input:{where:{id:string};data:Record<string,unknown>}):Promise<unknown>;
      findMany(input:{where:Record<string,unknown>}):Promise<Array<Record<string,unknown>>>;
      findUnique(input:{where:{id:string}}):Promise<Record<string,unknown>|null>;
    }>;
    // A confirmed, activated historical baseline with remaining legal capacity:
    // historical paid 40 is already in the initial settlement; the new request
    // can still pay 100. Neither date/amount nor the funds-opening axis proves
    // whether this proposed payment was included in that contract baseline.
    await seed.contractTakeover.create({data:{
      id:"history-basis-a",projectId:"project-a",contractId:"contract-a",contractVersionId:"version-a",paymentTermsVersionId:"terms-a",
      takeoverLevel:"A",takeoverStatus:"confirmed",lifecycleStatus:"active",signedAt:new Date("2026-10-01T00:00:00Z"),
      historicalSettledCents:14000n,historicalPaidCents:4000n,historicalProxyPaidCents:0n,historicalAdvancePaidCents:0n,
      historicalApprovalPendingPaymentCents:0n,historicalApprovedPendingPaymentCents:0n,historicalAdvanceDeductedCents:0n,
      historicalRetentionWithheldCents:0n,historicalRetentionReleasedCents:0n,otherConfirmedOccupancyCents:0n,
      historicalBalanceConfirmedAt:new Date("2026-11-01T00:00:00Z"),historicalBalanceConfirmedByUserId:"director",
      confirmedAt:new Date("2026-11-01T00:00:00Z"),confirmedByUserId:"director",activatedAt:new Date("2026-11-01T00:00:00Z"),
      activatedByUserId:"director",activationIdempotencyKey:"history-basis-activation-a",historicalInitialSettlementId:"settlement-a",
      createdByUserId:"employee",updatedAt:new Date("2026-11-01T00:00:00Z")
    }});
    await seed.paymentTermsVersion.update({where:{id:"terms-a"},data:{originalText:"历史核对后继续按已批准结算付款"}});
    await seed.contractTakeoverHistoricalPayment.create({data:{id:"history-payment-a",takeoverId:"history-basis-a",rowKey:"historical-paid-1",sequenceNo:1,amountCents:4000n,paidAt:new Date("2026-10-15T00:00:00Z"),status:"active",activatedAt:new Date("2026-11-01T00:00:00Z"),updatedAt:new Date("2026-11-01T00:00:00Z")}});
    await seed.settlement.update({where:{id:"settlement-a"},data:{payableAmountCents:14000n,paidAmountCents:4000n}});
    return {opening,seed};
  }
  it.each(["missing", "uncertain"] as const)("rejects a new unproven historical-contract registration with %s independent history confirmation before any business write", async treatment => {
    const {opening,seed}=await prepareConfirmedHistoricalPayment();
    const current = await get("keeper");
    expect(current.status).toBe(200);
    expect(current.body.items[0].remainingAmountCents).toBe("10000");
    const models=["paymentExecution","registeredPaymentFunding","registeredPaymentEvent","registeredFundPaymentAllocation","operatingFact","auditLog"];
    const before=await Promise.all(models.map(model=>seed[model].findMany({where:{}})));
    const response=await post("keeper","/payment-executions/payment-a/registrations",{
      idempotencyKey:"98572f27-0910-431e-96f1-7cc34d5ed0e9",expectedPaymentUpdatedAt:current.body.items[0].expectedPaymentUpdatedAt,
      amountCents:"3000",paidAt:"2026-11-04",scopeKey:"company:company-a",expectedRegistrationId:opening.body.id,
      openingTreatment:"not_included",openingReason:"已核对资金期初未含",openingEvidence:"资金核对表，不代表合同历史核对",sourceAllocations:[{sourceBatchId:opening.body.sources[0].id,amountCents:"3000"}],confirmationPassword:"Synthetic15Password!",
      ...(treatment === "uncertain" ? {contractHistoryConfirmation:{treatment:"uncertain",expectedFingerprint:"0".repeat(64),reason:"原合同历史需核源",evidence:"尚无逐笔证明"}} : {})
    });
    expect(response.status).toBe(409);
    expect(response.body.message).toMatch(/合同历史/);
    expect(await Promise.all(models.map(model=>seed[model].findMany({where:{}})))).toEqual(before);
    expect((await seed.paymentRequest.findUnique({where:{id:"payment-a"}}))?.paidAmountCents).toBe(0n);
    expect((await seed.settlement.findUnique({where:{id:"settlement-a"}}))?.paidAmountCents).toBe(4000n);
    expect((await seed.contractTakeover.findUnique({where:{id:"history-basis-a"}}))?.historicalPaidCents).toBe(4000n);
  });
  it("keeps a voucherless original result unconfirmed until its funding receipt is visible", async () => {
    const opening = await prepareApprovedPayment();
    const key = "49e1a688-357e-4ca3-8b48-bf4bf4d0ad49";
    const work = await get("keeper");
    const resultPath = `/payment-executions/results/${key}`;
    expect((await post("keeper", "/payment-executions/payment-a/registrations", {
      idempotencyKey: key, expectedPaymentUpdatedAt: work.body.items[0].expectedPaymentUpdatedAt, amountCents: "4000", paidAt: "2026-11-06",
      scopeKey: "company:company-a", expectedRegistrationId: opening.body.id, openingTreatment: "not_included",
      openingReason: "核对之后线下实付", openingEvidence: "合成付款核对依据",
      sourceAllocations: [{ sourceBatchId: opening.body.sources[0].id, amountCents: "4000" }], confirmationPassword: "Synthetic15Password!"
    })).status).toBe(201);
    const funds = await get("finance", "/fund-accounts");
    const records = await get("finance", "/payment-executions/recorded-items");
    const pendingWork = await get("keeper");
    const { registeredPaymentFunding } = database.prisma as unknown as Pick<Prisma.TransactionClient, "registeredPaymentFunding">;
    jest.spyOn(registeredPaymentFunding, "findUnique").mockResolvedValueOnce(null);

    expect(await get("keeper", resultPath)).toEqual({
      status: 200, body: { status: "unconfirmed", message: "尚未查到付款登记结果，请保留原请求并继续查询" }
    });
    expect(await get("finance", resultPath)).toMatchObject({
      status: 200, body: { status: "recorded", execution: { paymentId: "payment-a", amountCents: "4000", voucherPending: true } }
    });
    expect(await get("finance", "/fund-accounts")).toEqual(funds);
    expect(await get("finance", "/payment-executions/recorded-items")).toEqual(records);
    expect(await get("keeper")).toEqual(pendingWork);
  });
  it("records an independently confirmed new historical-contract payment and replays its original key without rewriting the frozen historical baseline", async () => {
    const {opening,seed}=await prepareConfirmedHistoricalPayment();
    const options=await get("keeper","/payment-executions/payment-a/registration-options");
    expect(options.status).toBe(200);
    expect(options.body.contractHistoryBasis).toMatchObject({required:true,records:[{historicalPaidCents:"4000",historicalProxyPaidCents:"0",historicalAdvancePaidCents:"0"}]});
    const body={idempotencyKey:"bb832f93-6426-47dc-832c-67e55bc6cf26",expectedPaymentUpdatedAt:options.body.expectedPaymentUpdatedAt,
      amountCents:"3000",paidAt:"2026-11-04",scopeKey:"company:company-a",expectedRegistrationId:opening.body.id,
      openingTreatment:"not_included",openingReason:"资金期初核对未包含",openingEvidence:"资金期初表",sourceAllocations:[{sourceBatchId:opening.body.sources[0].id,amountCents:"3000"}],confirmationPassword:"Synthetic15Password!",
      contractHistoryConfirmation:{treatment:"not_included",expectedFingerprint:options.body.contractHistoryBasis.fingerprint,reason:"核对后是历史40之外的新付款",evidence:"新付款原始凭据与合同历史核对清单"}};
    const first=await post("keeper","/payment-executions/payment-a/registrations",body);
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({amountCents:"3000"});
    expect((await get("keeper",`/payment-executions/results/${body.idempotencyKey}`)).body).toMatchObject({status:"recorded",execution:{amountCents:"3000",voucherPending:true}});
    expect((await seed.settlement.findUnique({where:{id:"settlement-a"}}))?.paidAmountCents).toBe(7000n);
    expect((await seed.contractTakeover.findUnique({where:{id:"history-basis-a"}}))?.historicalPaidCents).toBe(4000n);
    const accounts=await get("keeper","/fund-accounts");
    expect(accounts.body.accounts.find((row:{scopeKey:string})=>row.scopeKey==="company:company-a").balanceYuan).toBe("70.0000");
    await seed.contractTakeover.update({where:{id:"history-basis-a"},data:{updatedAt:new Date("2026-11-06T01:00:00Z"),evidenceSummary:"后续复核依据变更"}});
    const marker=controlHistoryRevision(null);
    const prior=await Promise.all(["paymentExecution","registeredPaymentFunding","registeredPaymentEvent","registeredFundPaymentAllocation","operatingFact","auditLog"].map(model=>seed[model].findMany({where:{}})));
    const replay=await post("keeper","/payment-executions/payment-a/registrations",body);
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(first.body);
    expect(marker.seen).toEqual([]);
    expect(await Promise.all(["paymentExecution","registeredPaymentFunding","registeredPaymentEvent","registeredFundPaymentAllocation","operatingFact","auditLog"].map(model=>seed[model].findMany({where:{}})))).toEqual(prior);
  });
  it.each(["included","stale"] as const)("refuses %s contract-history confirmation for a new key without changing payment or funds",async mode=>{
    const {opening,seed}=await prepareConfirmedHistoricalPayment();
    const options=await get("keeper","/payment-executions/payment-a/registration-options");
    expect(options.status).toBe(200);
    if(mode==="stale")await seed.contractTakeover.update({where:{id:"history-basis-a"},data:{updatedAt:new Date("2026-11-06T01:00:00Z"),evidenceSummary:"经复核更新的历史依据"}});
    const models=["paymentExecution","registeredPaymentFunding","registeredPaymentEvent","registeredFundPaymentAllocation","operatingFact","auditLog"];
    const before=await Promise.all(models.map(model=>seed[model].findMany({where:{}})));
    const response=await post("keeper","/payment-executions/payment-a/registrations",{
      idempotencyKey:"eb008f95-06cc-499d-beb0-28742483df2d",expectedPaymentUpdatedAt:options.body.expectedPaymentUpdatedAt,
      amountCents:"3000",paidAt:"2026-11-04",scopeKey:"company:company-a",expectedRegistrationId:opening.body.id,
      openingTreatment:"included",openingReason:"资金期初已包含",openingEvidence:"资金表不能代替合同核对",sourceAllocations:[],confirmationPassword:"Synthetic15Password!",
      contractHistoryConfirmation:{treatment:mode==="included"?"included":"not_included",expectedFingerprint:options.body.contractHistoryBasis.fingerprint,reason:"合同历史独立核对",evidence:"原核对清单"}
    });
    expect(response.status).toBe(409);
    expect(response.body.message).toMatch(/合同历史/);
    expect(await Promise.all(models.map(model=>seed[model].findMany({where:{}})))).toEqual(before);
    expect((await seed.paymentRequest.findUnique({where:{id:"payment-a"}}))?.paidAmountCents).toBe(0n);
    expect((await seed.settlement.findUnique({where:{id:"settlement-a"}}))?.paidAmountCents).toBe(4000n);
    expect((await seed.contractTakeover.findUnique({where:{id:"history-basis-a"}}))?.historicalPaidCents).toBe(4000n);
  });
  it("keeps ordinary no-history registration free of an independent contract-history declaration",async()=>{
    const opening=await prepareApprovedPayment();
    const marker=controlHistoryRevision(0n);
    const options=await get("keeper","/payment-executions/payment-a/registration-options");
    expect(options.status).toBe(200);
    expect(options.body.contractHistoryBasis).toMatchObject({required:false,revision:"0",records:[]});
    expect((await recordSourcePayment(opening,"3000","9799675b-332d-4ea3-91d5-bf63b2f90d87")).status).toBe(201);
    expect(marker.seen.some(sql=>sql.includes("jg_registered_history_lock_revision"))).toBe(true);
  });
  it.each(["missing_reason","invalid_treatment"] as const)("returns safe Chinese validation for %s in independent history confirmation before writes",async mode=>{
    const {opening,seed}=await prepareConfirmedHistoricalPayment();
    const options=await get("keeper","/payment-executions/payment-a/registration-options");
    const models=["paymentExecution","registeredPaymentFunding","registeredPaymentEvent","registeredFundPaymentAllocation","operatingFact","auditLog"];
    const before=await Promise.all(models.map(model=>seed[model].findMany({where:{}})));
    const response=await post("keeper","/payment-executions/payment-a/registrations",{
      idempotencyKey:"286e47fb-d23c-4f6a-a78b-255fdc6f94ef",expectedPaymentUpdatedAt:options.body.expectedPaymentUpdatedAt,
      amountCents:"3000",paidAt:"2026-11-04",scopeKey:"company:company-a",expectedRegistrationId:opening.body.id,
      openingTreatment:"included",openingReason:"资金期初已含",openingEvidence:"资金核对表",sourceAllocations:[],confirmationPassword:"Synthetic15Password!",
      contractHistoryConfirmation:{treatment:mode==="invalid_treatment"?"wrong":"not_included",expectedFingerprint:options.body.contractHistoryBasis.fingerprint,...(mode==="missing_reason"?{}:{reason:"独立合同核对"}),evidence:"原始付款证明"}
    });
    expect(response.status).toBe(400);
    expect(response.body.message).toBe("提交内容格式不正确，请检查后重试");
    expect(response.body.errors).toEqual(expect.arrayContaining([mode==="missing_reason"?"请填写合同历史独立核对原因":"请选择本次实付与合同历史已付的核对结果"]));
    expect(response.body.errors.every((message:string)=>/[\u3400-\u9fff]/u.test(message)&&!message.includes("must "))).toBe(true);
    expect(await Promise.all(models.map(model=>seed[model].findMany({where:{}})))).toEqual(before);
  });
  function controlHistoryRevision(initial:bigint|null) {
    // Exact synthetic persistence coordinate only: no lock/trigger/PG proof.
    let revision=initial;
    const seen:string[]=[];
    const original=database.prisma.$queryRaw;
    database.prisma.$queryRaw=(async(query:Prisma.Sql|TemplateStringsArray,...values:unknown[])=>{
      const text=Array.isArray(query)?query.join("?"):(query as Prisma.Sql).sql;
      if(text.includes("jg_registered_history_read_revision")||text.includes("jg_registered_history_lock_revision")){
        const args=Array.isArray(query)?values:(query as Prisma.Sql).values;
        if(args[0]!=="contract-a")throw new Error("Unexpected marker contract in public HTTP fixture");
        seen.push(text);return [{revision}];
      }
      return original(query,...values);
    }) as typeof database.prisma.$queryRaw;
    return {set:(value:bigint|null)=>{revision=value;},seen};
  }
  it("refuses new registered payment when its historical basis marker is missing without repairing it or writing funds",async()=>{
    const opening=await prepareApprovedPayment();
    const options=await get("keeper","/payment-executions/payment-a/registration-options");
    expect(options.status).toBe(200);
    const control=controlHistoryRevision(null);
    const seed=database.prisma as unknown as Record<string,{findMany(input:{where:Record<string,unknown>}):Promise<unknown[]>}>;
    const models=["paymentExecution","registeredPaymentFunding","registeredPaymentEvent","registeredFundPaymentAllocation","operatingFact","auditLog"];
    const before=await Promise.all(models.map(model=>seed[model].findMany({where:{}})));
    const response=await post("keeper","/payment-executions/payment-a/registrations",{
      idempotencyKey:"5c6b8f26-a9c7-45b8-898c-9f2943b08932",expectedPaymentUpdatedAt:options.body.expectedPaymentUpdatedAt,amountCents:"3000",paidAt:"2026-11-04",
      scopeKey:"company:company-a",expectedRegistrationId:opening.body.id,openingTreatment:"not_included",openingReason:"期初未含",openingEvidence:"已核对的实付依据",sourceAllocations:[{sourceBatchId:opening.body.sources[0].id,amountCents:"3000"}],confirmationPassword:"Synthetic15Password!"
    });
    expect(response.status).toBe(409);
    expect(response.body.message).toMatch(/历史.*准备|历史.*基线/);
    expect(control.seen.length).toBeGreaterThan(0);
    expect(await Promise.all(models.map(model=>seed[model].findMany({where:{}})))).toEqual(before);
  });
  it("rejects an old contract-history confirmation after only its server revision changes while historical records stay identical",async()=>{
    const {opening,seed}=await prepareConfirmedHistoricalPayment();
    const control=controlHistoryRevision(0n);
    const options=await get("keeper","/payment-executions/payment-a/registration-options");
    expect(options.status).toBe(200);
    const history=await seed.contractTakeover.findUnique({where:{id:"history-basis-a"}});
    control.set(2n); // Represents a committed change-and-restore, not money edits.
    const models=["paymentExecution","registeredPaymentFunding","registeredPaymentEvent","registeredFundPaymentAllocation","operatingFact","auditLog"];
    const before=await Promise.all(models.map(model=>seed[model].findMany({where:{}})));
    const response=await post("keeper","/payment-executions/payment-a/registrations",{
      idempotencyKey:"60993cb8-9164-4719-82c0-2a18bdf93fd2",expectedPaymentUpdatedAt:options.body.expectedPaymentUpdatedAt,amountCents:"3000",paidAt:"2026-11-04",
      scopeKey:"company:company-a",expectedRegistrationId:opening.body.id,openingTreatment:"not_included",openingReason:"资金期初未含",openingEvidence:"资金核对表",sourceAllocations:[{sourceBatchId:opening.body.sources[0].id,amountCents:"3000"}],confirmationPassword:"Synthetic15Password!",
      contractHistoryConfirmation:{treatment:"not_included",expectedFingerprint:options.body.contractHistoryBasis.fingerprint,reason:"独立核对合同历史未含",evidence:"逐项历史与新付款证明"}
    });
    expect(response.status).toBe(409);
    expect(response.body.message).toMatch(/合同历史.*变化/);
    expect(control.seen.length).toBeGreaterThan(0);
    expect(await seed.contractTakeover.findUnique({where:{id:"history-basis-a"}})).toEqual(history);
    expect(await Promise.all(models.map(model=>seed[model].findMany({where:{}})))).toEqual(before);
  });
  it("does not ignore a supplied stale history declaration when the current contract has no historical amount",async()=>{
    const opening=await prepareApprovedPayment();
    const options=await get("keeper","/payment-executions/payment-a/registration-options");
    expect(options.status).toBe(200);
    expect(options.body.contractHistoryBasis.required).toBe(false);
    const seed=database.prisma as unknown as Record<string,{findMany(input:{where:Record<string,unknown>}):Promise<unknown[]>}>;
    const models=["paymentExecution","registeredPaymentFunding","registeredPaymentEvent","registeredFundPaymentAllocation","operatingFact","auditLog"];
    const before=await Promise.all(models.map(model=>seed[model].findMany({where:{}})));
    const response=await post("keeper","/payment-executions/payment-a/registrations",{
      idempotencyKey:"62ea79b7-ed14-4c84-b314-b76d261465dc",expectedPaymentUpdatedAt:options.body.expectedPaymentUpdatedAt,amountCents:"3000",paidAt:"2026-11-04",
      scopeKey:"company:company-a",expectedRegistrationId:opening.body.id,openingTreatment:"not_included",openingReason:"资金未含",openingEvidence:"资金核对表",sourceAllocations:[{sourceBatchId:opening.body.sources[0].id,amountCents:"3000"}],confirmationPassword:"Synthetic15Password!",
      contractHistoryConfirmation:{treatment:"not_included",expectedFingerprint:"0".repeat(64),reason:"旧核对声明",evidence:"旧核对依据"}
    });
    expect(response.status).toBe(409);
    expect(response.body.message).toMatch(/合同历史.*变化/);
    expect(await Promise.all(models.map(model=>seed[model].findMany({where:{}})))).toEqual(before);
  });
  it("reuses only the original key of a proven activated HFT link to this request, rejecting a new key or compensated source without another business write", async () => {
    const opening=await prepareApprovedPayment();
    const seed = database.prisma as unknown as Record<string,{create(input:{data:Record<string,unknown>}):Promise<unknown>;update(input:{where:{id:string};data:Record<string,unknown>}):Promise<unknown>}>;
    const key="0b60ee63-639b-4f74-a849-fb9c6b9a011e",executionId="293b4a09-72af-491d-baff-05707f2cb411",rowId="6a0e226d-fbfe-41ad-a189-44be36ad16ea";
    const paidAt=new Date("2026-11-04T00:00:00+08:00");
    await seed.paymentExecution.create({data:{id:executionId,idempotencyKey:key,paymentRequestId:"payment-a",settlementId:"settlement-a",amountCents:4000n,paidAt,voucherFileId:"historic-private-voucher",companyEntityIdSnapshot:"company-a",companyEntityNameSnapshot:"甲公司",executedByUserId:"finance"}});
    await seed.paymentRequest.update({where:{id:"payment-a"},data:{paidAmountCents:4000n,status:"partially_paid"}});
    await seed.historicalFinancialTakeoverBatch.create({data:{id:"hft-a",projectId:"project-a",status:"activated",revision:2,manifestFingerprint:"frozen-manifest",readSetFingerprint:"read-set"}});
    await seed.historicalFinancialTakeoverActivation.create({data:{id:"activation-a",batchId:"hft-a",manifestFingerprint:"frozen-manifest",activationFingerprint:"activation-fingerprint",activatedAt:new Date("2026-11-05T00:00:00Z")}});
    const target={id:executionId,idempotencyKey:key,voucherFileId:"historic-private-voucher",amountCents:4000n,paidAt,payerCompanyEntityId:"company-a"};
    await seed.historicalFinancialTakeoverRowMapping.create({data:{id:rowId,batchId:"hft-a",projectId:"project-a",kind:"payment_execution",evidenceLevel:"A",mappingDecision:"LINK",targetKind:"payment_execution",targetRef:executionId,targetFingerprint:fingerprint(target),targetSnapshot:JSON.parse(JSON.stringify(target,(_,v)=>typeof v==="bigint"?v.toString():v)),amountCents:4000n,sourceVersion:1,mappingFingerprint:"mapping-frozen"}});
    const path=`/payment-executions/payment-a/existing-source/historical_financial_takeover_row/${rowId}`;
    const beforeFunds=await get("finance","/fund-accounts"),beforeWork=await get("keeper"),beforeAudit=await get("admin","/audit-logs");
    const preview=await get("keeper",path);
    expect(preview).toMatchObject({status:200,body:{samePaymentRequest:true,conclusion:"original_result",originalResultKey:key,source:{version:2,fingerprint:expect.stringMatching(/^[a-f0-9]{64}$/)}}});
    const options=await get("keeper","/payment-executions/payment-a/registration-options");
    expect(options).toMatchObject({status:200,body:{originalResults:[expect.objectContaining({executionId,resultKey:key,amountCents:"4000",paidAt:"2026-11-04",source:{type:"historical_financial_takeover_row",id:rowId,version:2,fingerprint:expect.stringMatching(/^[a-f0-9]{64}$/)}})]}});
    const body={idempotencyKey:key,expectedPaymentUpdatedAt:beforeWork.body.items[0].expectedPaymentUpdatedAt,amountCents:"4000",paidAt:"2026-11-04",scopeKey:"company:company-a",expectedRegistrationId:opening.body.id,openingTreatment:"included",openingReason:"历史余额已含",openingEvidence:"冻结来源",sourceAllocations:[],confirmationPassword:"Synthetic15Password!",existingSource:{type:"historical_financial_takeover_row",id:rowId,expectedVersion:preview.body.source.version,expectedFingerprint:preview.body.source.fingerprint}};
    expect(await post("keeper","/payment-executions/payment-a/registrations",body)).toMatchObject({status:201,body:{id:executionId,idempotencyKey:key,amountCents:"4000"}});
    expect((await post("keeper","/payment-executions/payment-a/registrations",{...body,idempotencyKey:"8e7e40bb-23a8-44df-8ae0-01ac77b1b953"})).status).toBe(409);
    expect((await post("keeper","/payment-executions/payment-a/registrations",{...body,amountCents:"4001"})).status).toBe(409);
    expect((await post("keeper","/payment-executions/payment-a/registrations",{...body,paidAt:"2026-11-03"})).status).toBe(409);
    await seed.historicalFinancialTakeoverBatch.update({where:{id:"hft-a"},data:{readSetFingerprint:"drifted-read-set"}});
    expect((await post("keeper","/payment-executions/payment-a/registrations",body)).status).toBe(409);
    await seed.historicalFinancialTakeoverCompensation.create({data:{id:"compensation-a",batchId:"hft-a",activationId:"activation-a",compensationFingerprint:"compensated"}});
    expect((await post("keeper","/payment-executions/payment-a/registrations",body)).status).toBe(409);
    expect((await get("keeper","/payment-executions/payment-a/registration-options")).body.originalResults).toEqual([]);
    expect(await get("finance","/fund-accounts")).toEqual(beforeFunds);expect(await get("keeper")).toEqual(beforeWork);expect(await get("admin","/audit-logs")).toEqual(beforeAudit);
    expect((await get("keeper",`/payment-executions/results/${key}`)).body.execution.executionId).toBe(executionId);
  });
  it("revalidates a linked source after a synthetic pre-callback P2034 instead of returning a now-compensated historical receipt", async () => {
    const opening=await prepareApprovedPayment(),key="e256c177-e705-4114-a83a-3d11038c2cbd";
    const intent={idempotencyKey:key,expectedPaymentUpdatedAt:"2026-11-05T00:00:00.000Z",amountCents:"4000",paidAt:"2026-11-06",scopeKey:"company:company-a",expectedRegistrationId:opening.body.id,openingTreatment:"not_included",openingReason:"已核对此笔未含期初",openingEvidence:"实际付款登记及核对依据",sourceAllocations:[{sourceBatchId:opening.body.sources[0].id,amountCents:"4000"}],confirmationPassword:"Synthetic15Password!"};
    const recorded=await post("keeper","/payment-executions/payment-a/registrations",intent);expect(recorded.status).toBe(201);
    const executionId=recorded.body.id,fileId="56a452d1-69e1-4909-94ac-e59077ba4f55",rowId="89eb23be-48a1-409c-90ee-38233acb4a3d";
    const seed=database.prisma as unknown as Record<string,{create(input:{data:Record<string,unknown>}):Promise<unknown>}>;
    await seed.fileObject.create({data:{id:fileId,bucket:"synthetic-private",objectKey:"task16/hft-proof.png",originalName:"原付款凭证.png",mimeType:"image/png",sizeBytes:68,uploadedByUserId:"keeper",contentSha256:"c".repeat(64),storageStatus:"active",supersedesFileObjectId:null}});
    expect((await post("keeper",`/payment-executions/${executionId}/voucher`,{fileId})).status).toBe(201);
    await seed.historicalFinancialTakeoverBatch.create({data:{id:"hft-conflict",projectId:"project-a",status:"activated",revision:1,manifestFingerprint:"manifest-conflict",readSetFingerprint:"read-conflict"}});
    await seed.historicalFinancialTakeoverActivation.create({data:{id:"activation-conflict",batchId:"hft-conflict",manifestFingerprint:"manifest-conflict",activationFingerprint:"activation-conflict",activatedAt:new Date("2026-11-06T00:00:00Z")}});
    const target={id:executionId,idempotencyKey:key,voucherFileId:fileId,amountCents:4000n,paidAt:new Date(recorded.body.paidAt),payerCompanyEntityId:"company-a"};
    await seed.historicalFinancialTakeoverRowMapping.create({data:{id:rowId,batchId:"hft-conflict",projectId:"project-a",kind:"payment_execution",evidenceLevel:"A",mappingDecision:"LINK",targetKind:"payment_execution",targetRef:executionId,targetFingerprint:fingerprint(target),targetSnapshot:JSON.parse(JSON.stringify(target,(_,v)=>typeof v==="bigint"?v.toString():v)),amountCents:4000n,sourceVersion:1,mappingFingerprint:"mapping-conflict"}});
    const preview=await get("keeper",`/payment-executions/payment-a/existing-source/historical_financial_takeover_row/${rowId}`);expect(preview.status).toBe(200);
    await seed.historicalFinancialTakeoverCompensation.create({data:{id:"compensation-conflict",batchId:"hft-conflict",activationId:"activation-conflict",compensationFingerprint:"source-no-longer-active"}});
    const beforeFunds=await get("finance","/fund-accounts"),beforeWork=await get("keeper"),beforeAudit=await get("admin","/audit-logs");
    // Adapter error is injected before the callback, not a real PG COMMIT fault.
    database.conflictNextTransaction();
    expect((await post("keeper","/payment-executions/payment-a/registrations",{...intent,existingSource:{type:"historical_financial_takeover_row",id:rowId,expectedVersion:preview.body.source.version,expectedFingerprint:preview.body.source.fingerprint}})).status).toBe(409);
    database.conflictNextTransaction();
    expect((await post("keeper","/payment-executions/payment-a/registrations",intent)).status).toBe(201);
    expect(await get("finance","/fund-accounts")).toEqual(beforeFunds);expect(await get("keeper")).toEqual(beforeWork);expect(await get("admin","/audit-logs")).toEqual(beforeAudit);
  });
  it("makes the genuine final approval visible as a targeted execution notification without sending SMS or changing Me duty on read", async () => {
    await prepareApprovedPayment();
    const seed=database.prisma as unknown as Record<string,{update(input:{where:{id:string};data:Record<string,unknown>}):Promise<Record<string,unknown>>}>;
    const pending=await seed.paymentRequest.update({where:{id:"payment-a"},data:{status:"approval_pending",approvedAmountCents:null}});
    const round=await seed.approvalInstance.update({where:{id:"approved-round-a"},data:{status:"in_progress",currentNodeIndex:0,updatedAt:new Date("2026-11-05T00:01:00.000Z"),frozenNodes:[{name:"财务主管批准",roleKeys:["finance_director"],mode:"any",approvedRoleKeys:[],protocolVersion:1,executionMode:"parallel",roleScopesByRole:{finance_director:"global"},candidateUserIdsByRole:{finance_director:["director"]},candidateUserIds:["director"]}]}});
    if (!(pending.updatedAt instanceof Date) || !(round.updatedAt instanceof Date)) throw new Error("Synthetic approval coordinates must contain real dates");
    const approval=await post("director","/payments/payment-a/approval",{
      decision:"approve",expectedPaymentUpdatedAt:pending.updatedAt.toISOString(),expectedApprovalInstanceId:"approved-round-a",expectedNodeIndex:0,expectedApprovalUpdatedAt:round.updatedAt.toISOString()
    });
    expect(approval).toMatchObject({status:201,body:{status:"approved_pending_payment"}});
    expect(notificationSmsCalls).toEqual([]);
    const beforeMe=await get("keeper","/me/work-items");
    expect(beforeMe.status).toBe(200);
    expect(beforeMe.body.queues.pending).toContainEqual(expect.objectContaining({type:"payment_execution",businessId:"payment-a"}));
    const notification=await get("keeper","/payment-executions/notifications");
    expect(notification).toMatchObject({status:200,body:{items:[{businessCode:"FK-16-01",status:"queued",summary:expect.stringContaining("付款"),targetPath:"/付款管理?payment=FK-16-01"}]}});
    expect(await get("keeper","/payment-executions/notifications")).toEqual(notification);
    const afterMe=await get("keeper","/me/work-items");
    expect(afterMe.status).toBe(200);
    expect(afterMe.body.queues.pending.filter((item:{type:string})=>item.type === "payment_execution").map((item:{businessId:string})=>item.businessId)).toEqual(["payment-a"]);
    expect(notificationSmsCalls).toEqual([]);
  });
  it("dispatches targeted fake SMS from the genuine approval path and keeps accepted reads from resending", async () => {
    await prepareApprovedPayment();
    database.setPhone("finance", "13000000001");
    database.setPhone("keeper", "13000000002");
    notificationSmsEnabled = true;
    // Observe only callback lifetime of this synthetic transaction adapter.
    // This cannot prove a PostgreSQL COMMIT or concurrent claim exclusion.
    const transaction = database.prisma.$transaction;
    database.prisma.$transaction = async <T>(run: (client: unknown) => Promise<T>) => transaction(async client => {
      notificationTransactionDepth++;
      try { return await run(client); } finally { notificationTransactionDepth--; }
    });
    const seed=database.prisma as unknown as Record<string,{update(input:{where:{id:string};data:Record<string,unknown>}):Promise<Record<string,unknown>>}>;
    const pending=await seed.paymentRequest.update({where:{id:"payment-a"},data:{status:"approval_pending",approvedAmountCents:null}});
    const round=await seed.approvalInstance.update({where:{id:"approved-round-a"},data:{status:"in_progress",currentNodeIndex:0,updatedAt:new Date("2026-11-05T00:01:00.000Z"),frozenNodes:[{name:"财务主管批准",roleKeys:["finance_director"],mode:"any",approvedRoleKeys:[],protocolVersion:1,executionMode:"parallel",roleScopesByRole:{finance_director:"global"},candidateUserIdsByRole:{finance_director:["director"]},candidateUserIds:["director"]}]}});
    if (!(pending.updatedAt instanceof Date) || !(round.updatedAt instanceof Date)) throw new Error("Synthetic approval coordinates must contain real dates");
    const approval=await post("director","/payments/payment-a/approval",{decision:"approve",expectedPaymentUpdatedAt:pending.updatedAt.toISOString(),expectedApprovalInstanceId:"approved-round-a",expectedNodeIndex:0,expectedApprovalUpdatedAt:round.updatedAt.toISOString()});
    expect(approval).toMatchObject({status:201,body:{status:"approved_pending_payment"}});
    expect(notificationSmsCalls.sort()).toEqual(["13000000001", "13000000002"]);
    expect(notificationSmsTransactionStates).toEqual([false, false]);
    expect(await get("keeper","/payment-executions/notifications")).toMatchObject({status:200,body:{items:[expect.objectContaining({status:"accepted"})]}});
    await get("keeper","/payment-executions/notifications");
    expect(notificationSmsCalls).toHaveLength(2);
  });
  it("keeps the genuine approval pending when its same-transaction notification intent cannot be persisted", async () => {
    await prepareApprovedPayment();
    const seed=database.prisma as unknown as Record<string,{update(input:{where:{id:string};data:Record<string,unknown>}):Promise<Record<string,unknown>>}>;
    const pending=await seed.paymentRequest.update({where:{id:"payment-a"},data:{status:"approval_pending",approvedAmountCents:null}});
    const round=await seed.approvalInstance.update({where:{id:"approved-round-a"},data:{status:"in_progress",currentNodeIndex:0,updatedAt:new Date("2026-11-05T00:01:00.000Z"),frozenNodes:[{name:"财务主管批准",roleKeys:["finance_director"],mode:"any",approvedRoleKeys:[],protocolVersion:1,executionMode:"parallel",roleScopesByRole:{finance_director:"global"},candidateUserIdsByRole:{finance_director:["director"]},candidateUserIds:["director"]}]}});
    if (!(pending.updatedAt instanceof Date) || !(round.updatedAt instanceof Date)) throw new Error("Synthetic approval coordinates must contain real dates");
    const beforeMe=await get("director","/me/work-items"),beforeFunds=await get("finance","/fund-accounts");
    Object.assign(seed.approvalActionLog,{createMany:async()=>{throw new Error("Synthetic outbox persistence failure before callback completion");}});
    const approval=await post("director","/payments/payment-a/approval",{decision:"approve",expectedPaymentUpdatedAt:pending.updatedAt.toISOString(),expectedApprovalInstanceId:"approved-round-a",expectedNodeIndex:0,expectedApprovalUpdatedAt:round.updatedAt.toISOString()});
    expect(approval.status).toBe(500);
    const afterMe=await get("director","/me/work-items");
    expect(afterMe.status).toBe(200);
    const identities=(items:Array<{id:string;type:string;businessId:string}>)=>items.map(({id,type,businessId})=>({id,type,businessId}));
    expect(identities(afterMe.body.queues.pending)).toEqual(identities(beforeMe.body.queues.pending));
    expect(await get("finance","/fund-accounts")).toEqual(beforeFunds);
    expect(await get("keeper")).toMatchObject({status:200,body:{items:[],total:0}});
    expect(await get("keeper","/payment-executions/notifications")).toMatchObject({status:200,body:{items:[]}});
    expect(notificationSmsCalls).toEqual([]);
  });
  it.each(["failed", "unknown"] as const)("preserves genuine approval and a distinct %s notification result without sending the same claimed intent again", async outcome => {
    await prepareApprovedPayment();
    const seed=database.prisma as unknown as Record<string,{update(input:{where:{id:string};data:Record<string,unknown>}):Promise<Record<string,unknown>>}>;
    const pending=await seed.paymentRequest.update({where:{id:"payment-a"},data:{status:"approval_pending",approvedAmountCents:null}});
    const round=await seed.approvalInstance.update({where:{id:"approved-round-a"},data:{status:"in_progress",currentNodeIndex:0,updatedAt:new Date("2026-11-05T00:01:00.000Z"),frozenNodes:[{name:"财务主管批准",roleKeys:["finance_director"],mode:"any",approvedRoleKeys:[],protocolVersion:1,executionMode:"parallel",roleScopesByRole:{finance_director:"global"},candidateUserIdsByRole:{finance_director:["director"]},candidateUserIds:["director"]}]}});
    if (!(pending.updatedAt instanceof Date) || !(round.updatedAt instanceof Date)) throw new Error("Synthetic approval coordinates must contain real dates");
    database.setPhone("finance","13000000001");database.setPhone("keeper","13000000002");
    notificationSmsEnabled=true;notificationSmsOutcome=outcome;
    const approval=await post("director","/payments/payment-a/approval",{decision:"approve",expectedPaymentUpdatedAt:pending.updatedAt.toISOString(),expectedApprovalInstanceId:"approved-round-a",expectedNodeIndex:0,expectedApprovalUpdatedAt:round.updatedAt.toISOString()});
    expect(approval).toMatchObject({status:201,body:{status:"approved_pending_payment"}});
    expect(notificationSmsCalls.sort()).toEqual(["13000000001","13000000002"]);
    expect(await get("keeper","/payment-executions/notifications")).toMatchObject({status:200,body:{items:[expect.objectContaining({status:outcome})]}});
    await app.get(RegisteredPaymentNotificationService).dispatchQueued("payment-a");
    expect(notificationSmsCalls).toHaveLength(2);
    expect((await get("keeper")).body.items).toContainEqual(expect.objectContaining({paymentId:"payment-a",remainingAmountCents:"10000"}));
  });
  it("resolves the current phone at dispatch and omits a revoked recipient without leaking phone numbers through notification reads", async () => {
    await prepareApprovedPayment();
    database.setPhone("finance","13000000003");database.setPhone("keeper","13000000004");
    const seed=database.prisma as unknown as Record<string,{update(input:{where:{id:string};data:Record<string,unknown>}):Promise<Record<string,unknown>>}>;
    const pending=await seed.paymentRequest.update({where:{id:"payment-a"},data:{status:"approval_pending",approvedAmountCents:null}});
    const round=await seed.approvalInstance.update({where:{id:"approved-round-a"},data:{status:"in_progress",currentNodeIndex:0,updatedAt:new Date("2026-11-05T00:01:00.000Z"),frozenNodes:[{name:"财务主管批准",roleKeys:["finance_director"],mode:"any",approvedRoleKeys:[],protocolVersion:1,executionMode:"parallel",roleScopesByRole:{finance_director:"global"},candidateUserIdsByRole:{finance_director:["director"]},candidateUserIds:["director"]}]}});
    if (!(pending.updatedAt instanceof Date) || !(round.updatedAt instanceof Date)) throw new Error("Synthetic approval coordinates must contain real dates");
    expect(await post("director","/payments/payment-a/approval",{decision:"approve",expectedPaymentUpdatedAt:pending.updatedAt.toISOString(),expectedApprovalInstanceId:"approved-round-a",expectedNodeIndex:0,expectedApprovalUpdatedAt:round.updatedAt.toISOString()})).toMatchObject({status:201,body:{status:"approved_pending_payment"}});
    expect(notificationSmsCalls).toEqual([]);
    database.setPhone("keeper","13000000002");database.setRole("finance","employee");
    notificationSmsEnabled=true;
    await app.get(RegisteredPaymentNotificationService).dispatchQueued("payment-a");
    expect(notificationSmsCalls).toEqual(["13000000002"]);
    const own=await get("keeper","/payment-executions/notifications");
    expect(own).toMatchObject({status:200,body:{items:[expect.objectContaining({status:"accepted"})]}});
    for (const phone of ["13000000002","13000000003","13000000004"]) expect(JSON.stringify(own.body)).not.toContain(phone);
    expect((await get("finance","/payment-executions/notifications")).status).toBe(403);
    await app.get(RegisteredPaymentNotificationService).dispatchQueued("payment-a");
    expect(notificationSmsCalls).toHaveLength(1);
  });
  it("does not dispatch an old queued notification after the approved payment has been genuinely paid in full", async () => {
    const opening=await prepareApprovedPayment();
    const seed=database.prisma as unknown as Record<string,{update(input:{where:{id:string};data:Record<string,unknown>}):Promise<Record<string,unknown>>}>;
    const pending=await seed.paymentRequest.update({where:{id:"payment-a"},data:{status:"approval_pending",approvedAmountCents:null}});
    const round=await seed.approvalInstance.update({where:{id:"approved-round-a"},data:{status:"in_progress",currentNodeIndex:0,updatedAt:new Date("2026-11-05T00:01:00.000Z"),frozenNodes:[{name:"财务主管批准",roleKeys:["finance_director"],mode:"any",approvedRoleKeys:[],protocolVersion:1,executionMode:"parallel",roleScopesByRole:{finance_director:"global"},candidateUserIdsByRole:{finance_director:["director"]},candidateUserIds:["director"]}]}});
    if (!(pending.updatedAt instanceof Date) || !(round.updatedAt instanceof Date)) throw new Error("Synthetic approval coordinates must contain real dates");
    expect(await post("director","/payments/payment-a/approval",{decision:"approve",expectedPaymentUpdatedAt:pending.updatedAt.toISOString(),expectedApprovalInstanceId:"approved-round-a",expectedNodeIndex:0,expectedApprovalUpdatedAt:round.updatedAt.toISOString()})).toMatchObject({status:201,body:{status:"approved_pending_payment"}});
    expect(notificationSmsCalls).toEqual([]);
    expect((await recordSourcePayment(opening,"10000","fcd74ef0-e212-4fe8-85e4-d494d93b4d5b")).status).toBe(201);
    const beforeFunds=await get("finance","/fund-accounts"),beforeRecorded=await get("keeper","/payment-executions/recorded-items");
    expect(beforeRecorded.body.items).toHaveLength(1);
    database.setPhone("keeper","13000000002");notificationSmsEnabled=true;
    await app.get(RegisteredPaymentNotificationService).dispatchQueued("payment-a");
    expect(notificationSmsCalls).toEqual([]);
    expect(await get("keeper","/payment-executions/notifications")).toMatchObject({status:200,body:{items:[]}});
    expect((await get("keeper")).body.items).toEqual([]);
    expect(await get("finance","/fund-accounts")).toEqual(beforeFunds);
    expect(await get("keeper","/payment-executions/recorded-items")).toEqual(beforeRecorded);
  });
  it.each(["wage_link", "unsupported_source"])("preserves genuine approval without entering this notification outbox for an unsupported domain: %s", async domain => {
    await prepareApprovedPayment();
    const seed=database.prisma as unknown as Record<string,{create(input:{data:Record<string,unknown>}):Promise<unknown>;update(input:{where:{id:string};data:Record<string,unknown>}):Promise<Record<string,unknown>>}>;
    if (domain === "wage_link") {
      const executionId="32c1c692-89bb-4ff7-b921-e33d57241fd8";
      await seed.contract.update({where:{id:"contract-a"},data:{contractTypeKey:"labor_subcontract"}});
      await seed.paymentExecution.create({data:{id:executionId,idempotencyKey:"ac5fb54e-1cbe-4483-b631-d74df23db5b4",paymentRequestId:"payment-a",paymentSubjectType:"our_company",companyEntityIdSnapshot:"company-a",companyEntityNameSnapshot:"甲公司",companyEntityCreditCodeSnapshot:"SYNTHETIC-COMPANY-A",amountCents:2500n,paidAt:new Date("2026-11-04T00:00:00Z"),executedByUserId:"finance",voucherFileId:"legacy-private-wage-file"}});
      await seed.paymentExecutionWagePayableBinding.create({data:{id:"unsupported-notify-wage-link",paymentExecutionId:executionId,wagePayableRefId:"private-wage-ref",debtorCompanyId:"company-a",debtorCompanySnapshot:{name:"甲公司"},projectId:"project-a",projectSnapshot:{name:"甲项目"},creditorSubjectType:"employee",creditorUserId:"private-worker",creditorSubjectIdentityKey:"private-worker-identity",creditorNameSnapshot:"PRIVATE_WORKER_NAME",creditorVersionFingerprint:"a".repeat(64),creditorSnapshot:{name:"PRIVATE_WORKER_NAME"},currencyCode:"CNY",createdByUserId:"finance",amountCents:2500n}});
      await seed.settlement.update({where:{id:"settlement-a"},data:{paidAmountCents:2500n}});
    }
    const pending=await seed.paymentRequest.update({where:{id:"payment-a"},data:{status:"approval_pending",approvedAmountCents:null,...(domain === "wage_link" ? {paidAmountCents:2500n} : {sourceType:"legacy_unsupported"})}});
    const round=await seed.approvalInstance.update({where:{id:"approved-round-a"},data:{status:"in_progress",currentNodeIndex:0,updatedAt:new Date("2026-11-05T00:01:00.000Z"),frozenNodes:[{name:"财务主管批准",roleKeys:["finance_director"],mode:"any",approvedRoleKeys:[],protocolVersion:1,executionMode:"parallel",roleScopesByRole:{finance_director:"global"},candidateUserIdsByRole:{finance_director:["director"]},candidateUserIds:["director"]}]}});
    if (!(pending.updatedAt instanceof Date) || !(round.updatedAt instanceof Date)) throw new Error("Synthetic approval coordinates must contain real dates");
    // Fail the synthetic durable-outbox persistence boundary if entered. A read
    // that merely hides unsupported rows would not prove approval skipped it.
    Object.assign(seed.approvalActionLog,{createMany:async()=>{throw new Error("Unsupported domain must not persist this notification outbox");}});
    const approval=await post("director","/payments/payment-a/approval",{decision:"approve",expectedPaymentUpdatedAt:pending.updatedAt.toISOString(),expectedApprovalInstanceId:"approved-round-a",expectedNodeIndex:0,expectedApprovalUpdatedAt:round.updatedAt.toISOString()});
    expect(approval).toMatchObject({status:201,body:{status:"approved_pending_payment"}});
    expect(await get("keeper","/payment-executions/notifications")).toMatchObject({status:200,body:{items:[]}});
    expect(notificationSmsCalls).toEqual([]);
  });
  it("returns a structured unconfirmed result after a synthetic pre-callback conflict with no original receipt, preserving the original query key", async () => {
    const opening=await prepareApprovedPayment(),key="ebcb7524-a7d2-496e-a7f5-f66fb678c27c";
    const beforeFunds=await get("finance","/fund-accounts"),beforeWork=await get("keeper");
    // Synthetic pre-callback conflict; this does not simulate or prove PG COMMIT.
    database.conflictNextTransaction();
    const response=await post("keeper","/payment-executions/payment-a/registrations",{
      idempotencyKey:key,expectedPaymentUpdatedAt:beforeWork.body.items[0].expectedPaymentUpdatedAt,amountCents:"4000",paidAt:"2026-11-06",
      scopeKey:"company:company-a",expectedRegistrationId:opening.body.id,openingTreatment:"not_included",openingReason:"核对之后线下实付",openingEvidence:"合成付款核对依据",
      sourceAllocations:[{sourceBatchId:opening.body.sources[0].id,amountCents:"4000"}],confirmationPassword:"Synthetic15Password!"
    });
    expect(response).toMatchObject({status:409,body:{code:"PAYMENT_RESULT_UNCONFIRMED",resultStatus:"unconfirmed",idempotencyKey:key,message:expect.any(String)}});
    expect((await get("keeper",`/payment-executions/results/${key}`)).body.status).toBe("unconfirmed");
    expect(await get("finance","/fund-accounts")).toEqual(beforeFunds);
    expect(await get("keeper")).toEqual(beforeWork);
  });
  it("keeps the original key unconfirmed when the read after a write conflict is unavailable", async () => {
    const opening = await prepareApprovedPayment();
    const key = "59889bfc-48df-490b-9f88-dd696a604ff2";
    const paymentPath = "/payment-executions/payment-a/registrations";
    const resultPath = `/payment-executions/results/${key}`;
    const work = await get("keeper");
    const input = {
      idempotencyKey: key, expectedPaymentUpdatedAt: work.body.items[0].expectedPaymentUpdatedAt, amountCents: "4000", paidAt: "2026-11-06",
      scopeKey: "company:company-a", expectedRegistrationId: opening.body.id, openingTreatment: "not_included",
      openingReason: "核对之后线下实付", openingEvidence: "合成付款核对依据",
      sourceAllocations: [{ sourceBatchId: opening.body.sources[0].id, amountCents: "4000" }], confirmationPassword: "Synthetic15Password!"
    };
    expect((await post("keeper", paymentPath, input)).status).toBe(201);
    const original = await get("keeper", resultPath);
    const funds = await get("finance", "/fund-accounts");
    const pending = await get("keeper");

    database.conflictNextTransaction();
    const transact = database.prisma.$transaction;
    const transaction = jest.spyOn(database.prisma, "$transaction");
    transaction.mockImplementationOnce(async run => {
      try {
        return await transact(run);
      } catch (error) {
        transaction.mockRejectedValueOnce(new Error("Synthetic conflict read unavailable"));
        throw error;
      }
    });

    const response = await post("keeper", paymentPath, input);
    expect(response).toMatchObject({
      status: 409,
      body: { code: "PAYMENT_RESULT_UNCONFIRMED", resultStatus: "unconfirmed", idempotencyKey: key }
    });
    expect(JSON.stringify(response.body)).not.toContain("Synthetic conflict read unavailable");
    expect(await get("keeper", resultPath)).toEqual(original);
    expect(await get("finance", "/fund-accounts")).toEqual(funds);
    expect(await get("keeper")).toEqual(pending);
    expect(await get("finance", "/payment-executions/recorded-items")).toMatchObject({ status: 200, body: { total: 1 } });
  });
  it("does not disclose other-project historical sources or distinguish their identity from an unknown source", async () => {
    await prepareApprovedPayment();
    const seed=database.prisma as unknown as Record<string,{create(input:{data:Record<string,unknown>}):Promise<unknown>}>;
    const sourceId="65e8cfa0-b610-43b0-9fab-c10f4429f9e9";
    await seed.contractTakeover.create({data:{id:"foreign-takeover",projectId:"other-project",contractId:"foreign-contract",takeoverStatus:"confirmed",takeoverLevel:"A",activatedAt:new Date("2026-11-05T00:00:00Z")}});
    await seed.contractTakeoverHistoricalPayment.create({data:{id:sourceId,takeoverId:"foreign-takeover",status:"activated",activatedAt:new Date("2026-11-05T00:00:00Z"),amountCents:999999n,paidAt:new Date("2026-11-03T00:00:00Z"),bankReference:"must-not-leak-private-reference"}});
    const path="/payment-executions/payment-a/existing-source/contract_takeover_historical_payment/";
    const foreign=await get("keeper",path+sourceId),unknown=await get("keeper",path+"77cfd884-557e-421f-a9df-f27425b4e924");
    expect(foreign).toEqual(unknown);expect(foreign.status).toBe(409);
    expect(JSON.stringify(foreign.body)).not.toContain("must-not-leak");expect(JSON.stringify(foreign.body)).not.toContain("999999");
  });
  it("reads an activated historical payment without treating the same contract as the same request, and rejects a duplicate registration without changing funds", async () => {
    const opening = await prepareApprovedPayment();
    const seed = database.prisma as unknown as Record<string,{create(input:{data:Record<string,unknown>}):Promise<unknown>}>;
    const sourceId = "4f2945dc-b4df-4a84-a1b0-dc48fefc3bcc";
    await seed.contractTakeover.create({data:{id:"takeover-a",projectId:"project-a",contractId:"contract-a",contractVersionId:"version-a",takeoverStatus:"confirmed",takeoverLevel:"A",activatedAt:new Date("2026-11-05T00:00:00Z")}});
    await seed.contractTakeoverHistoricalPayment.create({data:{id:sourceId,takeoverId:"takeover-a",status:"activated",amountCents:4000n,paidAt:new Date("2026-11-04T00:00:00+08:00"),activatedAt:new Date("2026-11-05T00:00:00Z"),rowKey:"past-1",sequenceNo:1}});
    const path = `/payment-executions/payment-a/existing-source/contract_takeover_historical_payment/${sourceId}`;
    const beforeFunds = await get("finance","/fund-accounts");
    const beforeWork = await get("keeper");
    const beforeAudit = await get("admin","/audit-logs");
    const preview = await get("keeper",path);
    expect(preview).toMatchObject({status:200,body:{samePaymentRequest:false,contractHistoryAlreadyIncluded:true,conclusion:"not_linked_to_request",source:{type:"contract_takeover_historical_payment",id:sourceId,version:1,fingerprint:expect.stringMatching(/^[a-f0-9]{64}$/)}}});
    expect((await get("project_finance",path)).status).toBe(403);
    expect((await get("keeper",path.replace("payment-a","unavailable-payment"))).status).toBe(409);
    const key="f78717f8-c63e-4bd9-b84b-c451d827033e";
    const attempt=await post("keeper","/payment-executions/payment-a/registrations",{
      idempotencyKey:key,expectedPaymentUpdatedAt:beforeWork.body.items[0].expectedPaymentUpdatedAt,amountCents:"4000",paidAt:"2026-11-04",
      scopeKey:"company:company-a",expectedRegistrationId:opening.body.id,openingTreatment:"included",openingReason:"此笔余额已含期初",openingEvidence:"原核对表",sourceAllocations:[],confirmationPassword:"Synthetic15Password!",
      existingSource:{type:preview.body.source.type,id:sourceId,expectedVersion:preview.body.source.version,expectedFingerprint:preview.body.source.fingerprint}
    });
    expect(attempt).toMatchObject({status:409,body:{message:expect.stringContaining("已计历史但未建立同一申请关联")}});
    expect(await get("finance","/fund-accounts")).toEqual(beforeFunds);
    expect(await get("keeper")).toEqual(beforeWork);
    expect(await get("admin","/audit-logs")).toEqual(beforeAudit);
    expect((await get("keeper",`/payment-executions/results/${key}`)).body.status).toBe("unconfirmed");
  });
  it("records an actual partial payment against an explicitly uncovered known source, keeping one shared remainder and a pending voucher", async () => {
    const opening = await prepareApprovedPayment();
    const key = "d81e3233-373b-4b96-83e3-a835b32f61e1";
    const payment = await post("keeper", "/payment-executions/payment-a/registrations", {
      idempotencyKey:key, expectedPaymentUpdatedAt:"2026-11-05T00:00:00.000Z", amountCents:"4000", paidAt:"2026-11-06",
      scopeKey:"company:company-a", expectedRegistrationId:opening.body.id,
      openingTreatment:"not_included", openingReason:"实际支付发生在核对之后", openingEvidence:"线下付款登记第16号",
      sourceAllocations:[{sourceBatchId:opening.body.sources[0].id,amountCents:"4000"}], confirmationPassword:"Synthetic15Password!"
    });
    expect(payment.status).toBe(201);
    const audit = await get("admin","/audit-logs");
    expect(audit.status).toBe(200);
    expect(audit.body.rows).toContainEqual(expect.objectContaining({action:"业务操作",businessType:"付款业务",actor:"合成人员"}));
    const result = await get("keeper", `/payment-executions/results/${key}`);
    expect(result).toMatchObject({status:200,body:{status:"recorded",execution:{paymentId:"payment-a",amountCents:"4000",voucherPending:true}}});
    for (const actor of ["finance","keeper"]) {
      expect(await get(actor)).toMatchObject({status:200,body:{items:[expect.objectContaining({paidAmountCents:"4000",remainingAmountCents:"6000"})]}});
    }
    const funds = await get("finance", "/fund-accounts");
    expect(funds.status).toBe(200);
    expect(funds.body.accounts.find((account:{scopeKey:string})=>account.scopeKey==="company:company-a")).toMatchObject({balanceYuan:"60.0000",sources:[expect.objectContaining({amountYuan:"60.0000"})]});
  });
  it("freezes the explicitly covered executions when a correction starts and keeps a later 30 payment deducted after confirmation", async () => {
    const opening = await prepareApprovedPayment();
    const earlierKey = "0b25c123-e626-43a4-8ef9-bd72c87a8912";
    expect((await recordSourcePayment(opening,"2000",earlierKey)).status).toBe(201);
    const earlier = await get("finance",`/payment-executions/results/${earlierKey}`);
    const earlierId = earlier.body.execution.executionId;
    const correction = await post("finance","/fund-accounts/corrections",{
      scopeKey:"company:company-a",balanceYuan:"100",asOfDate:"2026-11-06",evidenceReference:"已核对包含前一笔20元的余额100",
      reconciliationNote:"只包含明确选择的20元实付",reason:"核实原登记差额",idempotencyKey:"task16-correction-coverage",
      previousRegistrationId:opening.body.id,coveredExecutionIds:[earlierId],
      sources:[{amountYuan:"100",sourceStatus:"known",sourceName:"甲项目自有资金",projectStatus:"project",projectId:"project-a",previousSourceBatchId:opening.body.sources[0].id}]
    });
    expect(correction.status).toBe(201);
    const laterKey = "a83379b2-d171-4d6a-b6aa-78c2bc9ebac4";
    expect((await recordSourcePayment(opening,"3000",laterKey)).status).toBe(201);
    const confirmation = await post("director",`/fund-accounts/registrations/${correction.body.id}/confirm`,{
      expectedApprovalInstanceId:correction.body.approvalInstanceId,idempotencyKey:"confirm-coverage-task16",reviewNote:"按冻结实付清单核对，待审新付款不并入"
    });
    expect(confirmation.status).toBe(201);
    const account = (await get("finance","/fund-accounts")).body.accounts.find((row:{scopeKey:string})=>row.scopeKey==="company:company-a");
    expect(account).toMatchObject({balanceYuan:"70.0000",sources:[expect.objectContaining({amountYuan:"70.0000"})]});
    expect(account.history[0]).toMatchObject({balanceYuan:"100.0000",coveredExecutionIds:[earlierId]});
    expect((await get("finance",`/payment-executions/results/${laterKey}`)).body.execution.amountCents).toBe("3000");
  });
  it("rejects confirmation of a known 20 correction after an uncovered 30 payment, retaining the pending correction and old effective balance", async () => {
    const opening=await prepareApprovedPayment();
    const correction=await post("finance","/fund-accounts/corrections",{
      scopeKey:"company:company-a",balanceYuan:"20",asOfDate:"2026-11-06",evidenceReference:"已知核对20元，未包含待审新增支出",reconciliationNote:"冻结已包含清单为空",reason:"核对账实差额",idempotencyKey:"task16-known-insufficient-correction",previousRegistrationId:opening.body.id,coveredExecutionIds:[],
      sources:[{amountYuan:"20",sourceStatus:"known",sourceName:"甲项目自有资金",projectStatus:"project",projectId:"project-a",previousSourceBatchId:opening.body.sources[0].id}]
    });
    expect(correction.status).toBe(201);
    const originalKey="030043dc-2f9c-4241-acab-1c207981f0a4";
    expect((await recordSourcePayment(opening,"3000",originalKey)).status).toBe(201);
    const before=await get("finance","/fund-accounts");
    expect(before.body.accounts.find((row:{scopeKey:string})=>row.scopeKey === "company:company-a")).toMatchObject({balanceYuan:"70.0000",currentRegistrationId:opening.body.id,history:[expect.objectContaining({id:correction.body.id,status:"pending_review",coveredExecutionIds:[]}),expect.objectContaining({id:opening.body.id,balanceYuan:"100.0000"})]});
    const confirmation=await post("director",`/fund-accounts/registrations/${correction.body.id}/confirm`,{expectedApprovalInstanceId:correction.body.approvalInstanceId,idempotencyKey:"task16-known-insufficient-confirm",reviewNote:"不得确认成负十元，不修改真实支出"});
    const after=await get("finance","/fund-accounts");
    const account=after.body.accounts.find((row:{scopeKey:string})=>row.scopeKey === "company:company-a");
    expect({status:confirmation.status,balanceYuan:account.balanceYuan,currentRegistrationId:account.currentRegistrationId,correctionState:account.history.find((row:{id:string})=>row.id === correction.body.id)?.status}).toEqual({status:409,balanceYuan:"70.0000",currentRegistrationId:opening.body.id,correctionState:"pending_review"});
    expect(after).toEqual(before);
    expect((await get("keeper",`/payment-executions/results/${originalKey}`)).body.execution.amountCents).toBe("3000");
  });
  it("confirms an unknown correction as unknown while preserving the uncovered 30 and blocking a new debit without inventing sources", async () => {
    const opening=await prepareApprovedPayment();
    const correction=await post("finance","/fund-accounts/corrections",{scopeKey:"company:company-a",balanceYuan:null,asOfDate:"2026-11-06",evidenceReference:"核对余额尚未确定",reconciliationNote:"已包含清单冻结为空，未知不填零",reason:"如实保留待核对",idempotencyKey:"task16-unknown-uncovered-correction",previousRegistrationId:opening.body.id,coveredExecutionIds:[],sources:[]});
    expect(correction.status).toBe(201);
    const originalKey="f842b5f9-8c82-43b4-9857-e029b192d200";
    expect((await recordSourcePayment(opening,"3000",originalKey)).status).toBe(201);
    expect((await post("director",`/fund-accounts/registrations/${correction.body.id}/confirm`,{expectedApprovalInstanceId:correction.body.approvalInstanceId,idempotencyKey:"task16-unknown-uncovered-confirm",reviewNote:"未知保持未知，真实三十元支出仍保留"})).status).toBe(201);
    const before=await get("finance","/fund-accounts"),work=await get("keeper");
    expect(before.body.accounts.find((row:{scopeKey:string})=>row.scopeKey === "company:company-a")).toMatchObject({currentRegistrationId:correction.body.id,balanceYuan:null,unallocatedPaymentAmountYuan:"30.0000",sources:[],registeredPayments:[expect.objectContaining({amountCents:"3000"})]});
    const rejected=await post("keeper","/payment-executions/payment-a/registrations",{idempotencyKey:"45ccac8d-e486-4754-8ce2-1e7ef725b8dd",expectedPaymentUpdatedAt:work.body.items[0].expectedPaymentUpdatedAt,amountCents:"100",paidAt:"2026-11-06",scopeKey:"company:company-a",expectedRegistrationId:correction.body.id,openingTreatment:"not_included",openingReason:"此新付款未含核对",openingEvidence:"合成实付依据",sourceAllocations:[],confirmationPassword:"Synthetic15Password!"});
    expect(rejected.status).toBe(409);expect(rejected.body.message).toContain("未知");
    expect(await get("finance","/fund-accounts")).toEqual(before);expect(await get("keeper")).toEqual(work);
    expect((await get("keeper",`/payment-executions/results/${originalKey}`)).body.execution.amountCents).toBe("3000");
  });
  async function prepareDetailPayment() {
    const seed=database.prisma as unknown as Record<string,{create(input:{data:Record<string,unknown>}):Promise<unknown>;update(input:{where:{id:string};data:Record<string,unknown>}):Promise<unknown>}>;
    await seed.contract.create({data:{id:"contract-a",code:"HT-16-01",name:"合成材料采购合同",projectId:"project-a",contractTypeKey:"material_purchase"}});
    await seed.contractVersion.create({data:{id:"version-a",contractId:"contract-a",versionNo:1,status:"active",signingSubjectType:"our_company",companyEntityIdSnapshot:"company-a",companyEntityNameSnapshot:"甲公司",companyEntityCreditCodeSnapshot:"SYNTHETIC-COMPANY-A"}});
    await seed.paymentTermsVersion.create({data:{id:"terms-a",contractId:"contract-a",contractVersionId:"version-a",versionNo:1,status:"active",originalText:"本期有效结算经审批后可分次实际付款",updatedAt:new Date("2026-11-01T00:00:00Z")}});
    await seed.settlement.create({data:{id:"settlement-a",code:"JS-16-01",periodLabel:"合成第一期",contractId:"contract-a",contractVersionId:"version-a",status:"effective",payableAmountCents:10000n,paidAmountCents:0n}});
    await seed.paymentRequest.update({where:{id:"payment-a"},data:{sourceType:"settlement",settlementId:"settlement-a"}});
    return seed;
  }
  it("projects supported registered execution and optional later evidence into the real Detail without depending on account eligibility", async () => {
    await prepareDetailPayment();
    database.setProjectMember("finance","project-a","finance_staff");
    const options=await get("finance","/payment-executions/payment-a/registration-options");
    expect(options).toMatchObject({status:200,body:{accounts:[]}});
    const detail=await get("finance","/payments/FK-16-01");
    expect(detail.status).toBe(200);
    expect(detail.body.availableActions).toContainEqual(expect.objectContaining({key:"record_execution",enabled:true}));
    expect(detail.body).toMatchObject({registeredExecutionCapability:{supportedDomain:true,allowedActor:true},traceRules:expect.arrayContaining([expect.stringContaining("电子凭证可后补")])});
    expect(detail.body.executionBlockMessage).not.toContain("必须");
  });
  it("keeps a supported Detail domain denied to project-only finance without widening registered options access", async () => {
    await prepareDetailPayment();
    const detail=await get("project_finance","/payments/FK-16-01");
    expect(detail.status).toBe(200);
    expect(detail.body.registeredExecutionCapability).toMatchObject({supportedDomain:true,allowedActor:false,workflowReady:true,canSupplementVoucher:false,blockedReason:expect.stringContaining("有权")});
    expect(detail.body.executionBlockMessage).toContain("有权");
    expect(detail.body.traceRules.join(" ")).not.toContain("电子凭证可后补");
    expect((await get("project_finance","/payment-executions/payment-a/registration-options")).status).toBe(403);
  });
  it.each(["returned","missing"])("keeps supported Detail out of legacy bank fallback when the latest approved workflow is %s", async state => {
    const seed=await prepareDetailPayment();
    database.setProjectMember("finance","project-a","finance_staff");
    if (state === "returned") await seed.approvalInstance.create({data:{id:"latest-returned-round",businessType:"payment_request",businessId:"payment-a",flowType:"payment.approve",status:"returned_to_applicant",currentNodeIndex:0,frozenNodes:[],applicantUserId:"employee",createdAt:new Date("2026-11-06T00:00:00Z")}});
    else await seed.approvalInstance.update({where:{id:"approved-round-a"},data:{flowType:"retired.payment.approve"}});
    const detail=await get("finance","/payments/FK-16-01");
    expect(detail.status).toBe(200);
    expect(detail.body.registeredExecutionCapability).toMatchObject({supportedDomain:true,allowedActor:true,workflowReady:false,canSupplementVoucher:false,blockedReason:expect.stringContaining("审批")});
    expect(detail.body.traceRules.join(" ")).not.toContain("电子凭证可后补");
    expect((await get("finance","/payment-executions/payment-a/registration-options")).status).toBe(409);
  });
  it.each(["paymentExecutionWagePayableBinding","historicalWageSummaryPaymentExecutionLink"])("does not promise registered later evidence for a real wage-linked Detail: %s", async relation => {
    const seed=await prepareDetailPayment();
    const executionId="cb7bd44f-a7e3-46e9-a8f9-fcc78ca7f501";
    await seed.paymentExecution.create({data:{id:executionId,idempotencyKey:"98693580-2637-407f-b426-724f29a1a1c4",paymentRequestId:"payment-a",paymentSubjectType:"our_company",companyEntityIdSnapshot:"company-a",companyEntityNameSnapshot:"甲公司",companyEntityCreditCodeSnapshot:"SYNTHETIC-COMPANY-A",amountCents:2500n,paidAt:new Date("2026-11-04T00:00:00Z"),executedByUserId:"finance",voucherFileId:"legacy-private-wage-file"}});
    const relationship=relation === "paymentExecutionWagePayableBinding"
      ? {wagePayableRefId:"private-wage-ref",debtorCompanyId:"company-a",debtorCompanySnapshot:{name:"甲公司"},projectId:"project-a",projectSnapshot:{name:"甲项目"},creditorSubjectType:"employee",creditorUserId:"private-worker",creditorSubjectIdentityKey:"private-worker-identity",creditorNameSnapshot:"PRIVATE_WORKER_NAME",creditorVersionFingerprint:"a".repeat(64),creditorSnapshot:{name:"PRIVATE_WORKER_NAME"},currencyCode:"CNY",createdByUserId:"finance"}
      : {authorityCreditorLineId:"private-summary-line",summaryPayableRefId:"private-summary-ref",paymentExecutionFingerprint:"a".repeat(64),paymentExecutionSetFingerprint:"b".repeat(64),targetFingerprint:"c".repeat(64),paymentEvidenceSnapshot:{name:"PRIVATE_WORKER_NAME"},ordinal:1};
    await seed[relation].create({data:{id:"detail-wage-link",paymentExecutionId:executionId,amountCents:2500n,...relationship}});
    await seed.paymentRequest.update({where:{id:"payment-a"},data:{paidAmountCents:2500n,status:"partially_paid"}});
    const detail=await get("finance","/payments/FK-16-01");
    expect(detail.status).toBe(200);
    expect(detail.body.registeredExecutionCapability).toMatchObject({supportedDomain:false,allowedActor:false,workflowReady:false,canSupplementVoucher:false});
    expect(detail.body.traceRules.join(" ")).not.toContain("电子凭证可后补");
  });
  it.each(["affiliate","unsupported_source"])("does not promise registered later evidence for unsupported Detail domain: %s", async kind => {
    const seed=await prepareDetailPayment();
    if (kind === "affiliate") {
      await seed.paymentRequest.update({where:{id:"payment-a"},data:{paymentSubjectType:"affiliate"}});
      await seed.contractVersion.update({where:{id:"version-a"},data:{signingSubjectType:"affiliate"}});
    } else await seed.paymentRequest.update({where:{id:"payment-a"},data:{sourceType:"unsupported_legacy_source"}});
    const detail=await get("finance","/payments/FK-16-01");
    expect(detail.status).toBe(200);
    expect(detail.body.registeredExecutionCapability).toMatchObject({supportedDomain:false,workflowReady:false,canSupplementVoucher:false});
    expect(detail.body.traceRules.join(" ")).not.toContain("电子凭证可后补");
  });
  it("rejects a real wage-linked request from registered work, options and new execution despite sufficient confirmed source funds", async () => {
    const seed=await prepareDetailPayment();
    const opening=await post("finance","/fund-accounts/openings",{scopeKey:"company:company-a",balanceYuan:"100",asOfDate:"2026-11-05",evidenceReference:"已含原工资付款的期初核对",reconciliationNote:"实际余额与来源均为一百元",reason:"资金核对",idempotencyKey:"wage-fence-opening",sources:[{amountYuan:"100",sourceStatus:"known",sourceName:"甲项目自有资金",projectStatus:"project",projectId:"project-a"}]});
    expect(opening.status).toBe(201);
    const originalExecutionId="ed43797f-fb8e-45b3-83c1-ecc64377267d";
    await seed.paymentExecution.create({data:{id:originalExecutionId,idempotencyKey:"5a150024-2c99-4292-9e5b-bc9abcf173f6",paymentRequestId:"payment-a",paymentSubjectType:"our_company",companyEntityIdSnapshot:"company-a",companyEntityNameSnapshot:"甲公司",companyEntityCreditCodeSnapshot:"SYNTHETIC-COMPANY-A",amountCents:2500n,paidAt:new Date("2026-11-04T00:00:00Z"),executedByUserId:"finance",voucherFileId:"legacy-private-wage-file"}});
    await seed.paymentExecutionWagePayableBinding.create({data:{id:"wage-domain-binding",paymentExecutionId:originalExecutionId,wagePayableRefId:"private-wage-ref",debtorCompanyId:"company-a",debtorCompanySnapshot:{name:"甲公司"},projectId:"project-a",projectSnapshot:{name:"甲项目"},creditorSubjectType:"employee",creditorUserId:"private-worker",creditorSubjectIdentityKey:"private-worker-identity",creditorNameSnapshot:"PRIVATE_WORKER_NAME",creditorVersionFingerprint:"a".repeat(64),creditorSnapshot:{name:"PRIVATE_WORKER_NAME"},currencyCode:"CNY",createdByUserId:"finance",amountCents:2500n}});
    await seed.paymentRequest.update({where:{id:"payment-a"},data:{paidAmountCents:2500n,status:"partially_paid"}});
    await seed.settlement.update({where:{id:"settlement-a"},data:{paidAmountCents:2500n}});
    const beforeFunds=await get("finance","/fund-accounts"),beforeRecorded=await get("finance","/payment-executions/recorded-items"),beforeAudit=await get("admin","/audit-logs");
    expect(beforeFunds.body.accounts.find((row:{scopeKey:string})=>row.scopeKey === "company:company-a")).toMatchObject({balanceYuan:"100.0000",currentRegistrationId:opening.body.id,sources:[expect.objectContaining({amountYuan:"100.0000",sourceStatus:"known",projectId:"project-a"})]});
    const work=await get("finance"),options=await get("finance","/payment-executions/payment-a/registration-options");
    const key="ddf8e747-ef5c-46be-854c-c6d3a3ec065e";
    const attempt=await post("finance","/payment-executions/payment-a/registrations",{idempotencyKey:key,expectedPaymentUpdatedAt:"2026-11-05T00:00:00.000Z",amountCents:"3000",paidAt:"2026-11-06",scopeKey:"company:company-a",expectedRegistrationId:opening.body.id,openingTreatment:"not_included",openingReason:"本次尝试未含核对",openingEvidence:"合成付款依据",sourceAllocations:[{sourceBatchId:opening.body.sources[0].id,amountCents:"3000"}],confirmationPassword:"Synthetic15Password!"});
    const result=await get("finance",`/payment-executions/results/${key}`),afterFunds=await get("finance","/fund-accounts");
    expect({offered:work.body.items.some((row:{paymentId:string})=>row.paymentId === "payment-a"),optionsStatus:options.status,registrationStatus:attempt.status,resultStatus:result.body.status,balanceYuan:afterFunds.body.accounts.find((row:{scopeKey:string})=>row.scopeKey === "company:company-a").balanceYuan}).toEqual({offered:false,optionsStatus:409,registrationStatus:409,resultStatus:"unconfirmed",balanceYuan:"100.0000"});
    expect(afterFunds).toEqual(beforeFunds);expect(await get("finance","/payment-executions/recorded-items")).toEqual(beforeRecorded);expect(await get("admin","/audit-logs")).toEqual(beforeAudit);
  });
  async function prepareCashOperatingPayment() {
    await prepareApprovedPayment();
    const seed = database.prisma as unknown as Record<string, {create(input:{data:Record<string,unknown>}):Promise<unknown>;update(input:{where:{id:string};data:Record<string,unknown>}):Promise<unknown>}>;
    await seed.project.update({where:{id:"project-a"},data:{operatingLedgerEffectiveDate:new Date("2026-11-01T00:00:00Z")}});
    await seed.contractVersion.update({where:{id:"version-a"},data:{companyEntityVersionId:"company-version-a",affiliateAssignmentId:"affiliate-assignment-a",affiliateBusinessPartyVersionId:"affiliate-version-a"}});
    await seed.projectAffiliateAssignment.create({data:{id:"affiliate-assignment-a",projectId:"project-a",businessPartyVersionId:"affiliate-version-a",affiliateNameSnapshot:"施工企业甲",affiliateCreditCodeSnapshot:"SYNTHETIC-AFFILIATE",effectiveFrom:new Date("2026-11-01T00:00:00Z"),endedAt:null}});
    await seed.projectParticipatingCompany.create({data:{id:"participation-a",projectId:"project-a",companyEntityId:"company-a",companyEntityVersionId:"company-version-a",companyNameSnapshot:"甲公司",companyCreditCodeSnapshot:"SYNTHETIC-COMPANY-A",effectiveFrom:new Date("2026-11-01T00:00:00Z"),endedAt:null}});
    await seed.contractPartySnapshot.create({data:{id:"party-b-a",contractVersionId:"version-a",roleKey:"party_b",businessPartyVersionId:"supplier-version-a",displayOrder:0,snapshot:{name:"供应商甲"}}});
    const cash = await post("keeper","/fund-accounts/openings",{scopeKey:"public_cash",balanceYuan:"100",asOfDate:"2026-11-05",evidenceReference:"公共现金实点表",reconciliationNote:"现金来源项目均已核对",reason:"期初",idempotencyKey:"task16-cash-opening",sources:[{amountYuan:"100",sourceStatus:"known",sourceName:"甲项目已登记资金",projectStatus:"project",projectId:"project-a"}]});
    expect(cash.status).toBe(201);
    return cash;
  }
  it("preserves the companyless actual payer and canonical cash consequence when a project operating ledger is enabled", async () => {
    const cash = await prepareCashOperatingPayment();
    const key = "d34c2fb8-bc9f-45eb-99a7-c3c9856e4106";
    const recorded = await post("keeper","/payment-executions/payment-a/registrations",{idempotencyKey:key,expectedPaymentUpdatedAt:"2026-11-05T00:00:00.000Z",amountCents:"4000",paidAt:"2026-11-06",scopeKey:"public_cash",expectedRegistrationId:cash.body.id,openingTreatment:"not_included",openingReason:"本次现金实付未含期初",openingEvidence:"纸质现金付款登记",sourceAllocations:[{sourceBatchId:cash.body.sources[0].id,amountCents:"4000"}],confirmationPassword:"Synthetic15Password!"});
    expect(recorded.body.message).toBeUndefined();
    expect(recorded).toMatchObject({status:201});
    const result = await get("finance",`/payment-executions/results/${key}`);
    expect(result.status).toBe(200);
    expect(result.body.effects).toEqual([expect.objectContaining({actualPayerKind:"public_cash",actualPayerId:"public_cash",impacts:expect.arrayContaining([expect.objectContaining({kind:"public_cash_funds_decrease",amountCents:"4000",subjectKind:"public_cash",subjectId:"public_cash"})])})]);
    expect(result.body.effects[0].impacts).not.toContainEqual(expect.objectContaining({kind:"company_project_funds_decrease"}));
    expect((await get("keeper","/payment-executions/recorded-items")).body.items).toContainEqual(expect.objectContaining({resultKey:key,actualPayerName:"\u516c\u5171\u73b0\u91d1"}));
    const funds = (await get("finance","/fund-accounts")).body.accounts;
    expect(funds.find((account:{scopeKey:string})=>account.scopeKey==="public_cash")).toMatchObject({balanceYuan:"60.0000",companyEntityId:null});
    expect(funds.find((account:{scopeKey:string})=>account.scopeKey==="company:company-a").balanceYuan).toBe("100.0000");
  });
  it("keeps the same formal operating fact and revision when a later voucher is added and the public source service replays it", async () => {
    const cash = await prepareCashOperatingPayment();
    const key = "f0d2171b-2643-47fd-abf9-8f4d5a742bcc";
    expect((await post("keeper","/payment-executions/payment-a/registrations",{idempotencyKey:key,expectedPaymentUpdatedAt:"2026-11-05T00:00:00.000Z",amountCents:"4000",paidAt:"2026-11-06",scopeKey:"public_cash",expectedRegistrationId:cash.body.id,openingTreatment:"not_included",openingReason:"本次现金未含期初",openingEvidence:"现金付款原始登记",sourceAllocations:[{sourceBatchId:cash.body.sources[0].id,amountCents:"4000"}],confirmationPassword:"Synthetic15Password!"})).status).toBe(201);
    const before = await get("finance",`/payment-executions/results/${key}`);
    expect(before.body.effects).toEqual([expect.objectContaining({sourceVersion:1,recordedVoucherPending:true})]);
    const executionId=before.body.execution.executionId;
    const fileId="0b9dd9ae-d84a-4f9c-943b-0b4dbb6ecc38";
    await (database.prisma as unknown as {fileObject:{create(input:{data:Record<string,unknown>}):Promise<unknown>}}).fileObject.create({data:{id:fileId,bucket:"synthetic-private",objectKey:"task16/cash-voucher-a.png",originalName:"现金凭证.png",mimeType:"image/png",sizeBytes:68,uploadedByUserId:"finance",contentSha256:"b".repeat(64),storageStatus:"active",supersedesFileObjectId:null}});
    expect((await post("finance",`/payment-executions/${executionId}/voucher`,{fileId})).status).toBe(201);
    const replay = await app.get(OperatingSourceReplayService).replaySource({projectId:"project-a",sourceType:"payment_execution",sourceBusinessId:executionId},"project_finance");
    expect(replay).toMatchObject({id:before.body.effects[0].factId,created:false});
    const after = await get("finance",`/payment-executions/results/${key}`);
    expect(after.body.execution.voucherPending).toBe(false);
    expect(after.body.effects).toEqual(before.body.effects);
    expect((await get("finance","/fund-accounts")).body.accounts.find((row:{scopeKey:string})=>row.scopeKey==="public_cash").balanceYuan).toBe("60.0000");
  });
  it("keeps the account 70 while split pending source availability stays unknown instead of duplicating or inventing a 30 allocation", async () => {
    const opening = await prepareApprovedPayment("pending");
    const correction = await post("finance","/fund-accounts/corrections",{
      scopeKey:"company:company-a",balanceYuan:"100",asOfDate:"2026-11-06",evidenceReference:"来源拆为两份50，后续实付未含本次核对",reconciliationNote:"两个待核对出资来源仍待明确分摊",reason:"核对来源拆分",idempotencyKey:"task16-split-pending-coverage",previousRegistrationId:opening.body.id,coveredExecutionIds:[],
      sources:[1,2].map(()=>({amountYuan:"50",sourceStatus:"pending",sourceName:null,projectStatus:"project",projectId:"project-a",previousSourceBatchId:opening.body.sources[0].id}))
    });
    expect(correction.status).toBe(201);
    expect((await recordSourcePayment(opening,"3000","85bf9615-8990-47e4-a984-fea47bdcbbf8")).status).toBe(201);
    expect((await post("director",`/fund-accounts/registrations/${correction.body.id}/confirm`,{expectedApprovalInstanceId:correction.body.approvalInstanceId,idempotencyKey:"task16-confirm-split",reviewNote:"仅确认核对及来源拆分，不将待审付款归给任一出资方"})).status).toBe(201);
    const read = await get("finance","/fund-accounts");
    expect(read.status).toBe(200);
    const account = read.body.accounts.find((row:{scopeKey:string})=>row.scopeKey==="company:company-a");
    expect(account).toMatchObject({balanceYuan:"70.0000",unallocatedPaymentAmountYuan:"30.0000",sources:[
      expect.objectContaining({amountYuan:null,reconciledAmountYuan:"50.0000",pendingAllocation:true,sourceStatus:"pending"}),
      expect.objectContaining({amountYuan:null,reconciledAmountYuan:"50.0000",pendingAllocation:true,sourceStatus:"pending"})
    ],projectBalances:[expect.objectContaining({amountYuan:"70.0000",projectId:"project-a"})]});
    expect(account.history[0].sources.map((row:{amountYuan:string})=>row.amountYuan)).toEqual(["50.0000","50.0000"]);
    const work = await get("keeper");
    const rejected = await post("keeper","/payment-executions/payment-a/registrations",{idempotencyKey:"3449d9de-84c8-4682-a9eb-2d4d46cc27ae",expectedPaymentUpdatedAt:work.body.items[0].expectedPaymentUpdatedAt,amountCents:"4000",paidAt:"2026-11-06",scopeKey:"company:company-a",expectedRegistrationId:correction.body.id,openingTreatment:"not_included",openingReason:"未含期初",openingEvidence:"实际付款资料",sourceAllocations:[{sourceBatchId:correction.body.sources[0].id,amountCents:"4000"}],confirmationPassword:"Synthetic15Password!"});
    expect(rejected.status).toBe(409);
    expect(rejected.body.message).toContain("待核对");
    expect((await get("finance")).body.items[0].remainingAmountCents).toBe("7000");
  });
  it("replays one original-key fact without a second debit, rejects changed intent and clearly rejects overpayment before writes", async () => {
    const opening = await prepareApprovedPayment();
    const key = "a4040116-3cd3-4d80-9564-a1731dc53e30";
    expect((await recordSourcePayment(opening,"4000",key)).status).toBe(201);
    const before = await get("finance",`/payment-executions/results/${key}`);
    expect((await recordSourcePayment(opening,"4000",key)).status).toBe(201);
    expect((await get("keeper",`/payment-executions/results/${key}`)).body.execution.executionId).toBe(before.body.execution.executionId);
    expect((await recordSourcePayment(opening,"3000",key)).status).toBe(409);
    const overKey = "3659bc25-c597-44b4-ae7e-eddf27e7c538";
    const over = await recordSourcePayment(opening,"7000",overKey);
    expect(over.status).toBe(400);
    expect(over.body.message).toContain("超过付款申请剩余");
    expect((await get("finance",`/payment-executions/results/${overKey}`)).body.status).toBe("unconfirmed");
    expect((await get("keeper")).body.items[0]).toMatchObject({paidAmountCents:"4000",remainingAmountCents:"6000"});
    expect((await get("finance","/fund-accounts")).body.accounts.find((row:{scopeKey:string})=>row.scopeKey==="company:company-a").balanceYuan).toBe("60.0000");
  });
  it("keeps the shared remainder current when a second authorized payer submits an older request version", async () => {
    const opening = await prepareApprovedPayment();
    const registration = "/payment-executions/payment-a/registrations";
    const options = "/payment-executions/payment-a/registration-options";
    const recorded = "/payment-executions/recorded-items";
    const funds = "/fund-accounts";
    const result = (key: string) => `/payment-executions/results/${key}`;
    const directorKey = "472ac301-265b-466b-aefb-d6f06a9ced17";
    const financeKey = "651c29b8-a769-488b-89ba-84a3fb5991b4";
    const directorView = await get("keeper", options);
    const financeView = await get("finance", options);
    for (const view of [directorView, financeView]) {
      expect(view).toMatchObject({ status: 200, body: {
        canRegisterPayment: true, paidAmountCents: "0", remainingAmountCents: "10000"
      } });
    }
    const originalVersion = financeView.body.expectedPaymentUpdatedAt;
    expect(originalVersion).toEqual(expect.any(String));
    expect(directorView.body.expectedPaymentUpdatedAt).toBe(originalVersion);

    const command = (idempotencyKey: string, amountCents: string) => ({
      idempotencyKey, amountCents, expectedPaymentUpdatedAt: originalVersion, paidAt: "2026-11-06",
      scopeKey: "company:company-a", expectedRegistrationId: opening.body.id,
      openingTreatment: "not_included", openingReason: "核对确认未含期初", openingEvidence: "合成实付登记凭据",
      sourceAllocations: [{ sourceBatchId: opening.body.sources[0].id, amountCents }],
      confirmationPassword: "Synthetic15Password!"
    });
    const financeDraft = command(financeKey, "6000");
    expect((await post("keeper", registration, command(directorKey, "4000"))).status).toBe(201);
    const firstFunds = await get("finance", funds);
    const firstRecords = await get("finance", recorded);
    const firstAudit = await get("admin", "/audit-logs");
    expect(firstRecords).toMatchObject({ status: 200, body: { total: 1 } });
    expect(firstFunds.body.accounts).toContainEqual(expect.objectContaining({
      scopeKey: "company:company-a", balanceYuan: "60.0000"
    }));

    const stale = await post("finance", registration, financeDraft);
    expect(stale).toMatchObject({ status: 409, body: { message: "付款申请已变化，请刷新后重试" } });
    expect(await get("finance", result(financeKey))).toMatchObject({ status: 200, body: { status: "unconfirmed" } });
    expect(await get("finance", recorded)).toEqual(firstRecords);
    expect(await get("finance", funds)).toEqual(firstFunds);
    expect(await get("admin", "/audit-logs")).toEqual(firstAudit);
    for (const actor of ["keeper", "finance"]) {
      expect((await get(actor)).body.items).toContainEqual(expect.objectContaining({
        paymentId: "payment-a", paidAmountCents: "4000", remainingAmountCents: "6000"
      }));
    }

    const refreshed = await get("finance", options);
    expect(refreshed).toMatchObject({ status: 200, body: { remainingAmountCents: "6000" } });
    expect(refreshed.body.expectedPaymentUpdatedAt).not.toBe(originalVersion);
    expect((await post("finance", registration, {
      ...financeDraft, expectedPaymentUpdatedAt: refreshed.body.expectedPaymentUpdatedAt
    })).status).toBe(201);
    for (const actor of ["keeper", "finance"]) {
      expect((await get(actor)).body.items).not.toContainEqual(expect.objectContaining({ paymentId: "payment-a" }));
      expect((await get(actor, recorded)).body.items.map((item: { resultKey: string }) => item.resultKey).sort())
        .toEqual([directorKey, financeKey]);
    }
    expect(await get("finance", result(directorKey))).toMatchObject({ status: 200, body: {
      status: "recorded", execution: { paymentId: "payment-a", amountCents: "4000", voucherPending: true }
    } });
    expect(await get("keeper", result(financeKey))).toMatchObject({ status: 200, body: {
      status: "recorded", execution: { paymentId: "payment-a", amountCents: "6000", voucherPending: true }
    } });
    expect((await get("finance", funds)).body.accounts).toContainEqual(expect.objectContaining({
      scopeKey: "company:company-a", balanceYuan: "0.0000"
    }));
  });
  it("shows a later private voucher in the original detail to its project manager without granting registration rights", async () => {
    await prepareDetailPayment();
    database.setProjectMember("delegate","project-a","project_manager");
    // Public read authority must really succeed before this attachment test.
    // This different employee is not the applicant and has no registration
    // position. Only a real project-manager membership is added; no delegation.
    const readable=await get("delegate","/payments/FK-16-01");
    expect(readable.status).toBe(200);
    expect(readable.body.registeredExecutionCapability).toMatchObject({supportedDomain:true,allowedActor:false});
    expect((await get("delegate","/payment-executions/payment-a/registration-options")).status).toBe(403);
    const opening=await post("finance","/fund-accounts/openings",{
      scopeKey:"company:company-a",balanceYuan:"100",asOfDate:"2026-11-05",evidenceReference:"项目付款凭证读取测试期初",reconciliationNote:"甲项目来源明确",reason:"合成期初",idempotencyKey:"task16-pm-readable-voucher-opening",
      sources:[{amountYuan:"100",sourceStatus:"known",sourceName:"甲项目自有资金",projectStatus:"project",projectId:"project-a"}]
    });
    expect(opening.status).toBe(201);
    const key="913814d9-93f8-4a88-9a65-7be82aa9f60f";
    expect((await recordSourcePayment(opening,"4000",key)).status).toBe(201);
    const executionId=(await get("keeper",`/payment-executions/results/${key}`)).body.execution.executionId;
    const bytes=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=","base64");
    const form=new FormData();form.append("file",new Blob([bytes],{type:"image/png"}),"read-only-voucher.png");form.append("idempotencyKey","8c52b6e6-4dd2-4fb5-8ec8-9f2d0a74b602");
    const token=tokens.signAccessToken({id:"keeper",name:"综合部主管",phone:null,sessionVersion:0});
    const uploaded=await fetch(`${await app.getUrl()}/payment-executions/${executionId}/voucher-file-uploads`,{method:"POST",headers:{authorization:`Bearer ${token}`},body:form});
    expect(uploaded.status).toBe(201);
    const file=await uploaded.json();
    expect(file.sizeBytes).toBe(bytes.length);
    expect((await post("keeper",`/payment-executions/${executionId}/voucher`,{fileId:file.id})).status).toBe(201);
    const detail=await get("delegate","/payments/FK-16-01");
    expect(detail.status).toBe(200);
    expect(detail.body.registeredExecutionCapability).toMatchObject({supportedDomain:true,allowedActor:false});
    expect(detail.body.evidenceFiles).toContainEqual(expect.objectContaining({recordId:executionId,fileId:file.id,fileName:"read-only-voucher.png",purpose:"付款凭证",canDownload:true}));
  });
  it("allows its project manager to download later private voucher bytes without granting registration or cross-project access", async () => {
    await prepareDetailPayment();
    database.setProjectMember("delegate","project-a","project_manager");
    // Public read authority must really succeed before this attachment test.
    // This different employee is not the applicant and has no registration
    // position. Only a real project-manager membership is added; no delegation.
    const readable=await get("delegate","/payments/FK-16-01");
    expect(readable.status).toBe(200);
    expect(readable.body.registeredExecutionCapability).toMatchObject({supportedDomain:true,allowedActor:false});
    expect((await get("delegate","/payment-executions/payment-a/registration-options")).status).toBe(403);
    const opening=await post("finance","/fund-accounts/openings",{
      scopeKey:"company:company-a",balanceYuan:"100",asOfDate:"2026-11-05",evidenceReference:"项目付款凭证读取测试期初",reconciliationNote:"甲项目来源明确",reason:"合成期初",idempotencyKey:"task16-pm-download-voucher-opening",
      sources:[{amountYuan:"100",sourceStatus:"known",sourceName:"甲项目自有资金",projectStatus:"project",projectId:"project-a"}]
    });
    expect(opening.status).toBe(201);
    const key="1f8df2af-4b04-4d53-8b22-856b1c28ab88";
    expect((await recordSourcePayment(opening,"4000",key)).status).toBe(201);
    const executionId=(await get("keeper",`/payment-executions/results/${key}`)).body.execution.executionId;
    const bytes=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=","base64");
    const form=new FormData();form.append("file",new Blob([bytes],{type:"image/png"}),"read-only-voucher.png");form.append("idempotencyKey","18b2c023-bb87-44da-95ef-71a410f73b50");
    const token=tokens.signAccessToken({id:"keeper",name:"综合部主管",phone:null,sessionVersion:0});
    const uploaded=await fetch(`${await app.getUrl()}/payment-executions/${executionId}/voucher-file-uploads`,{method:"POST",headers:{authorization:`Bearer ${token}`},body:form});
    expect(uploaded.status).toBe(201);
    const file=await uploaded.json();
    expect(file.sizeBytes).toBe(bytes.length);
    expect((await post("keeper",`/payment-executions/${executionId}/voucher`,{fileId:file.id})).status).toBe(201);
    const detail=await get("delegate","/payments/FK-16-01");
    expect(detail.status).toBe(200);
    expect(detail.body.registeredExecutionCapability).toMatchObject({supportedDomain:true,allowedActor:false});
    expect(detail.body.evidenceFiles).toContainEqual(expect.objectContaining({recordId:executionId,fileId:file.id,fileName:"read-only-voucher.png",purpose:"付款凭证",canDownload:true}));
    // The PM can read this document, but is not a payment registrar.
    // This dedicated endpoint needs no user-supplied password or reason.
    const ticket=await get("delegate",`/payment-executions/${executionId}/voucher-ticket`);
    expect(ticket.status).toBe(200);
    expect(Date.parse(ticket.body.expiresAt)-Date.now()).toBeGreaterThan(0);
    expect(Date.parse(ticket.body.expiresAt)-Date.now()).toBeLessThanOrEqual(300000);
    const download=await fetch(new URL(ticket.body.downloadUrl,await app.getUrl()));
    expect(download.status).toBe(200);
    expect(Buffer.from(await download.arrayBuffer())).toEqual(bytes);
    const capability=await get("delegate",`/files/${file.id}/download-ticket-capability`);
    expect(capability.status).toBe(200);
    expect(capability.body.action.enabled).toBe(true);
    // Exercise the existing public file service, not the generic POST whose
    // global DTO still requires a password/reason outside this local fix.
    const files=app.get(FileService);
    const genericTicket=await files.createDownloadTicket(file.id,{actorUserId:"delegate",downloadReason:"实际付款凭证下载"});
    expect(Date.parse(genericTicket.expiresAt)-Date.now()).toBeGreaterThan(0);
    expect(Date.parse(genericTicket.expiresAt)-Date.now()).toBeLessThanOrEqual(300000);
    const genericDownload=await fetch(new URL(genericTicket.downloadUrl,await app.getUrl()));
    expect(genericDownload.status).toBe(200);
    expect(Buffer.from(await genericDownload.arrayBuffer())).toEqual(bytes);
    const audit=await get("admin","/audit-logs/file-downloads");
    expect(audit.status).toBe(200);
    expect(audit.body.rows).toContainEqual(expect.objectContaining({fileName:"read-only-voucher.png",downloadReason:"实际付款凭证下载"}));
    expect((await post("delegate",`/payment-executions/${executionId}/voucher`,{fileId:file.id})).status).toBe(403);
    database.setProjectMember("delegate","project-a",null);
    database.setProjectMember("delegate","project-b","project_manager");
    expect([403,404]).toContain((await get("delegate","/payments/FK-16-01")).status);
    expect((await get("delegate",`/payment-executions/${executionId}/voucher-ticket`)).status).toBe(403);
    expect((await get("delegate",`/files/${file.id}/download-ticket-capability`)).status).toBe(403);
    await expect(files.createDownloadTicket(file.id,{actorUserId:"delegate",downloadReason:"实际付款凭证下载"})).rejects.toMatchObject({status:403});
    // A previously issued ticket must not bypass current document scope.
    expect((await fetch(new URL(ticket.body.downloadUrl,await app.getUrl()))).status).toBe(403);
  });
  it("rejects an already-issued private voucher ticket after its readable project manager account is disabled", async () => {
    await prepareDetailPayment();
    database.setProjectMember("delegate","project-a","project_manager");
    // Public read authority must really succeed before this attachment test.
    // This different employee is not the applicant and has no registration
    // position. Only a real project-manager membership is added; no delegation.
    const readable=await get("delegate","/payments/FK-16-01");
    expect(readable.status).toBe(200);
    expect(readable.body.registeredExecutionCapability).toMatchObject({supportedDomain:true,allowedActor:false});
    expect((await get("delegate","/payment-executions/payment-a/registration-options")).status).toBe(403);
    const opening=await post("finance","/fund-accounts/openings",{
      scopeKey:"company:company-a",balanceYuan:"100",asOfDate:"2026-11-05",evidenceReference:"项目付款凭证读取测试期初",reconciliationNote:"甲项目来源明确",reason:"合成期初",idempotencyKey:"task16-disabled-pm-ticket-opening",
      sources:[{amountYuan:"100",sourceStatus:"known",sourceName:"甲项目自有资金",projectStatus:"project",projectId:"project-a"}]
    });
    expect(opening.status).toBe(201);
    const key="191d9d95-a00b-41cf-b2b5-938150de2f01";
    expect((await recordSourcePayment(opening,"4000",key)).status).toBe(201);
    const executionId=(await get("keeper",`/payment-executions/results/${key}`)).body.execution.executionId;
    const bytes=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=","base64");
    const form=new FormData();form.append("file",new Blob([bytes],{type:"image/png"}),"read-only-voucher.png");form.append("idempotencyKey","469bba41-a11e-44ed-a3c4-e859ccbcdb60");
    const token=tokens.signAccessToken({id:"keeper",name:"综合部主管",phone:null,sessionVersion:0});
    const uploaded=await fetch(`${await app.getUrl()}/payment-executions/${executionId}/voucher-file-uploads`,{method:"POST",headers:{authorization:`Bearer ${token}`},body:form});
    expect(uploaded.status).toBe(201);
    const file=await uploaded.json();
    expect(file.sizeBytes).toBe(bytes.length);
    expect((await post("keeper",`/payment-executions/${executionId}/voucher`,{fileId:file.id})).status).toBe(201);
    const detail=await get("delegate","/payments/FK-16-01");
    expect(detail.status).toBe(200);
    expect(detail.body.registeredExecutionCapability).toMatchObject({supportedDomain:true,allowedActor:false});
    expect(detail.body.evidenceFiles).toContainEqual(expect.objectContaining({recordId:executionId,fileId:file.id,fileName:"read-only-voucher.png",purpose:"付款凭证",canDownload:true}));
    // The PM can read this document, but is not a payment registrar.
    // This dedicated endpoint needs no user-supplied password or reason.
    const ticket=await get("delegate",`/payment-executions/${executionId}/voucher-ticket`);
    expect(ticket.status).toBe(200);
    expect(Date.parse(ticket.body.expiresAt)-Date.now()).toBeGreaterThan(0);
    expect(Date.parse(ticket.body.expiresAt)-Date.now()).toBeLessThanOrEqual(300000);
    const download=await fetch(new URL(ticket.body.downloadUrl,await app.getUrl()));
    expect(download.status).toBe(200);
    expect(Buffer.from(await download.arrayBuffer())).toEqual(bytes);
    // Disable only this persisted user. Keep all existing project membership
    // and positions, and access the original @Public URL without a JWT.
    // Login rejection cannot substitute for private-file current authority.
    database.setActive("delegate",false);
    const disabledDownload=await fetch(new URL(ticket.body.downloadUrl,await app.getUrl()));
    expect(disabledDownload.status).toBe(403);
  });
  it("uploads and downloads actual private voucher bytes for the comprehensive director after full payment, without reopening the payment", async () => {
    const opening=await prepareApprovedPayment(),key="c0f508e2-a900-4da6-973b-ac88c0250a1d";
    expect((await recordSourcePayment(opening,"10000",key)).status).toBe(201);
    const executionId=(await get("keeper",`/payment-executions/results/${key}`)).body.execution.executionId;
    expect(await get("finance","/payment-executions/recorded-items?paymentId=payment-a")).toMatchObject({status:200,body:{items:[expect.objectContaining({executionId,paymentId:"payment-a",code:"FK-16-01",amountCents:"10000",voucherPending:true,resultKey:key})]}});
    expect((await get("project_finance","/payment-executions/recorded-items")).status).toBe(403);
    expect((await get("finance","/payment-executions/recorded-items?paymentId=other-request")).body.items).toEqual([]);
    const bytes=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=","base64");
    const upload=async(actor:string)=>{
      const body=new FormData();body.append("file",new Blob([bytes],{type:"image/png"}),"actual-voucher.png");body.append("idempotencyKey","a10b0c30-c66d-4d08-af46-a8572a11c6bc");
      const token=tokens.signAccessToken({id:actor,name:"合成人员",phone:null,sessionVersion:0});
      const response=await fetch(`${await app.getUrl()}/payment-executions/${executionId}/voucher-file-uploads`,{method:"POST",headers:{authorization:`Bearer ${token}`},body});
      return {status:response.status,body:await response.json()};
    };
    expect((await upload("project_finance")).status).toBe(403);
    const uploaded=await upload("keeper");expect(uploaded.status).toBe(201);expect(uploaded.body.sizeBytes).toBe(bytes.length);
    expect((await post("keeper",`/payment-executions/${executionId}/voucher`,{fileId:uploaded.body.id})).status).toBe(201);
    const ticket=await get("keeper",`/payment-executions/${executionId}/voucher-ticket`);expect(ticket.status).toBe(200);
    const download=await fetch(new URL(ticket.body.downloadUrl,await app.getUrl()));expect(download.status).toBe(200);expect(Buffer.from(await download.arrayBuffer())).toEqual(bytes);
    expect((await get("keeper")).body.items).toEqual([]);
    expect((await get("keeper","/payment-executions/recorded-items")).body.items).toEqual([expect.objectContaining({executionId,voucherPending:false,resultKey:key})]);
    expect((await get("finance","/fund-accounts")).body.accounts.find((row:{scopeKey:string})=>row.scopeKey==="company:company-a").balanceYuan).toBe("0.0000");
    database.setRole("keeper","employee");expect((await upload("keeper")).status).toBe(403);
  });
  it("attaches a private voucher later without another payment, deduction or approval", async () => {
    const opening = await prepareApprovedPayment();
    const key = "045de377-e7a3-462b-bf08-a0ce81896592";
    expect((await recordSourcePayment(opening,"4000",key)).status).toBe(201);
    const before = await get("keeper",`/payment-executions/results/${key}`);
    const executionId = before.body.execution.executionId;
    const fileId = "8713c6cf-a27d-490b-aea5-814fa4333169";
    await (database.prisma as unknown as {fileObject:{create(input:{data:Record<string,unknown>}):Promise<unknown>}}).fileObject.create({data:{id:fileId,bucket:"synthetic-private",objectKey:"task16/voucher-private-a.png",originalName:"付款凭证.png",mimeType:"image/png",sizeBytes:68,uploadedByUserId:"finance",contentSha256:"a".repeat(64),storageStatus:"active",supersedesFileObjectId:null}});
    expect((await post("finance",`/payment-executions/${executionId}/voucher`,{fileId})).status).toBe(201);
    expect((await post("finance",`/payment-executions/${executionId}/voucher`,{fileId})).status).toBe(201);
    const ticket = await get("keeper",`/payment-executions/${executionId}/voucher-ticket`);
    expect(ticket.status).toBe(200);
    expect(new URL(ticket.body.downloadUrl,"http://synthetic.local").pathname).toBe(`/files/${fileId}/download`);
    expect(Date.parse(ticket.body.expiresAt)-Date.now()).toBeGreaterThan(0);
    expect(Date.parse(ticket.body.expiresAt)-Date.now()).toBeLessThanOrEqual(300000);
    const audit = await get("admin","/audit-logs/file-downloads");
    expect(audit.status).toBe(200);
    expect(audit.body).toMatchObject({summary:{ticket:1},rows:[expect.objectContaining({fileName:"付款凭证.png",downloadReason:"实际付款凭证下载"})]});
    const after = await get("finance",`/payment-executions/results/${key}`);
    expect(after.body.execution).toMatchObject({executionId,paymentId:"payment-a",amountCents:"4000",voucherPending:false});
    expect((await get("keeper")).body.items[0]).toMatchObject({paidAmountCents:"4000",remainingAmountCents:"6000"});
    expect((await get("finance","/fund-accounts")).body.accounts.find((row:{scopeKey:string})=>row.scopeKey==="company:company-a").balanceYuan).toBe("60.0000");
    database.setRole("keeper","employee");
    expect((await post("keeper",`/payment-executions/${executionId}/voucher`,{fileId})).status).toBe(403);
    expect((await get("keeper",`/payment-executions/${executionId}/voucher-ticket`)).status).toBe(403);
  });
  it("rejects a newly selected inactive proxy company while continuing the original inactive frozen company against its confirmed container", async () => {
    const a=await prepareApprovedPayment();
    const b=await post("finance","/fund-accounts/openings",{scopeKey:"company:company-b",balanceYuan:"100",asOfDate:"2026-11-05",evidenceReference:"乙核对",reconciliationNote:"项目归属已核对",reason:"期初",idempotencyKey:"inactive-b-opening",sources:[{amountYuan:"100",sourceStatus:"known",sourceName:"乙资金",projectStatus:"project",projectId:"project-a"}]});
    expect(b.status).toBe(201);
    const seed=database.prisma as unknown as Record<string,{create(input:{data:Record<string,unknown>}):Promise<unknown>;update(input:{where:{id:string};data:Record<string,unknown>}):Promise<unknown>}>;
    await seed.companyEntity.update({where:{id:"company-b"},data:{isActive:false}});
    const before=await get("finance","/fund-accounts");
    const options=await get("keeper","/payment-executions/payment-a/registration-options");
    expect(options).toMatchObject({status:200,body:{paymentId:"payment-a",remainingAmountCents:"10000",accounts:expect.arrayContaining([expect.objectContaining({scopeKey:"company:company-b",eligible:false,reason:expect.stringContaining("停用公司不能新选")})])}});
    const rejected=await post("keeper","/payment-executions/payment-a/registrations",{idempotencyKey:"02ca5064-1ab9-40af-99a5-e76f700fa703",expectedPaymentUpdatedAt:"2026-11-05T00:00:00.000Z",amountCents:"4000",paidAt:"2026-11-06",scopeKey:"company:company-b",expectedRegistrationId:b.body.id,openingTreatment:"not_included",openingReason:"未含期初",openingEvidence:"核对依据",sourceAllocations:[{sourceBatchId:b.body.sources[0].id,amountCents:"4000"}],confirmationPassword:"Synthetic15Password!"});
    expect(rejected).toMatchObject({status:409,body:{message:expect.stringContaining("停用公司不能新选")}});
    expect(await get("finance","/fund-accounts")).toEqual(before);
    await seed.companyEntityVersion.create({data:{id:"frozen-company-a",companyEntityId:"company-a",name:"甲公司",unifiedSocialCreditCode:"SYNTHETIC-COMPANY-A",isActive:true}});
    await seed.contractVersion.update({where:{id:"version-a"},data:{companyEntityVersionId:"frozen-company-a",status:"effective"}});
    await seed.companyEntity.update({where:{id:"company-a"},data:{isActive:false}});
    expect((await get("keeper","/payment-executions/payment-a/registration-options")).body.accounts).toContainEqual(expect.objectContaining({scopeKey:"company:company-a",eligible:true,currentRegistrationId:a.body.id}));
    expect((await recordSourcePayment(a,"4000","09b214a5-df3b-43b8-88e6-f7cfb91780bb")).status).toBe(201);
    expect((await get("finance","/fund-accounts")).body.accounts.find((row:{scopeKey:string})=>row.scopeKey==="company:company-a").balanceYuan).toBe("60.0000");
  });
  it("keeps an approved unenabled project payable with one B-to-A payment and one A-to-B debt without inventing operating projection", async () => {
    await prepareApprovedPayment();
    const seed=database.prisma as unknown as {project:{update(input:{where:{id:string};data:{operatingLedgerEffectiveDate:null}}):Promise<unknown>}};
    await seed.project.update({where:{id:"project-a"},data:{operatingLedgerEffectiveDate:null}});
    const b=await post("finance","/fund-accounts/openings",{scopeKey:"company:company-b",balanceYuan:"100",asOfDate:"2026-11-05",evidenceReference:"乙公司资金核对表",reconciliationNote:"甲项目来源明确",reason:"期初",idempotencyKey:"task16-unenabled-b-opening",sources:[{amountYuan:"100",sourceStatus:"known",sourceName:"乙公司登记资金",projectStatus:"project",projectId:"project-a"}]});
    expect(b.status).toBe(201);
    const options=await get("finance","/payment-executions/payment-a/registration-options");
    expect(options).toMatchObject({status:200,body:{remainingAmountCents:"10000",accounts:expect.arrayContaining([expect.objectContaining({scopeKey:"company:company-b",eligible:true})])}});
    const key="35869eb5-3b1d-4841-b91b-323703bf2a99";
    const intent={idempotencyKey:key,expectedPaymentUpdatedAt:options.body.expectedPaymentUpdatedAt,amountCents:"4000",paidAt:"2026-11-06",scopeKey:"company:company-b",expectedRegistrationId:b.body.id,openingTreatment:"not_included",openingReason:"本次实付未含期初",openingEvidence:"乙公司实际支付原始登记",sourceAllocations:[{sourceBatchId:b.body.sources[0].id,amountCents:"4000"}],confirmationPassword:"Synthetic15Password!"};
    expect((await post("finance","/payment-executions/payment-a/registrations",intent)).status).toBe(201);
    const result=await get("keeper",`/payment-executions/results/${key}`);
    expect(result).toMatchObject({status:200,body:{status:"recorded",execution:{amountCents:"4000"},effects:[],intercompany:[expect.objectContaining({debtorCompanyId:"company-a",creditorCompanyId:"company-b",amountCents:"4000",status:"confirmed"})]}});
    expect((await post("finance","/payment-executions/payment-a/registrations",intent)).status).toBe(201);
    expect((await get("finance",`/payment-executions/results/${key}`)).body).toEqual(result.body);
    expect((await get("finance","/payment-executions/recorded-items")).body.items).toHaveLength(1);
    const accounts=(await get("finance","/fund-accounts")).body.accounts;
    expect(accounts.find((row:{scopeKey:string})=>row.scopeKey==="company:company-a").balanceYuan).toBe("100.0000");
    expect(accounts.find((row:{scopeKey:string})=>row.scopeKey==="company:company-b").balanceYuan).toBe("60.0000");
    for(const actor of ["finance","keeper"])expect((await get(actor)).body.items[0]).toMatchObject({paidAmountCents:"4000",remainingAmountCents:"6000"});
  });
  it("records B paying A without making B a project participant, creates one canonical A-to-B debt and keeps a later A partial payment shared", async () => {
    await prepareCashOperatingPayment();
    const b=await post("finance","/fund-accounts/openings",{scopeKey:"company:company-b",balanceYuan:"100",asOfDate:"2026-11-05",evidenceReference:"乙公司资金核对表",reconciliationNote:"甲项目资金归属明确",reason:"期初",idempotencyKey:"task16-company-b-opening",sources:[{amountYuan:"100",sourceStatus:"known",sourceName:"乙公司登记资金",projectStatus:"project",projectId:"project-a"}]});
    expect(b.status).toBe(201);
    const key="19822a4a-d375-4212-a0d6-20d3c4852cd0";
    const intent={idempotencyKey:key,expectedPaymentUpdatedAt:"2026-11-05T00:00:00.000Z",amountCents:"4000",paidAt:"2026-11-06",scopeKey:"company:company-b",expectedRegistrationId:b.body.id,openingTreatment:"not_included",openingReason:"乙公司本次实付未含期初",openingEvidence:"乙公司实际支付原始登记",sourceAllocations:[{sourceBatchId:b.body.sources[0].id,amountCents:"4000"}],confirmationPassword:"Synthetic15Password!"};
    const recorded=await post("finance","/payment-executions/payment-a/registrations",intent);
    expect(recorded.body.message).toBeUndefined();
    expect(recorded.status).toBe(201);
    const bResult=await get("keeper",`/payment-executions/results/${key}`);
    expect(bResult.body.effects).toEqual([expect.objectContaining({actualPayerId:"company-b",impacts:expect.arrayContaining([expect.objectContaining({kind:"inter_subject_balance_increase",subjectId:"company-b",amountCents:"4000"})])})]);
    expect(bResult.body.intercompany).toEqual([expect.objectContaining({debtorCompanyId:"company-a",creditorCompanyId:"company-b",amountCents:"4000",status:"confirmed",voucherPending:true})]);
    const a=(await get("finance","/fund-accounts")).body.accounts.find((row:{scopeKey:string})=>row.scopeKey==="company:company-a");
    expect((await recordSourcePayment({body:{id:a.currentRegistrationId,sources:a.sources}},"4000","c2f6c231-c9e9-48bd-8771-669c604b24e3")).status).toBe(201);
    expect((await post("finance","/payment-executions/payment-a/registrations",intent)).status).toBe(201);
    expect((await get("finance",`/payment-executions/results/${key}`)).body.intercompany).toHaveLength(1);
    await (database.prisma as unknown as {companyEntity:{update(input:{where:{id:string};data:Record<string,unknown>}):Promise<unknown>}}).companyEntity.update({where:{id:"company-b"},data:{name:"RENAMED_CURRENT_DIRECTORY"}});
    expect((await get("keeper","/payment-executions/recorded-items")).body.items).toContainEqual(expect.objectContaining({resultKey:key,actualPayerName:"\u4e59\u516c\u53f8"}));
    const accounts=(await get("finance","/fund-accounts")).body.accounts;
    expect(accounts.find((row:{scopeKey:string})=>row.scopeKey==="company:company-a").balanceYuan).toBe("60.0000");
    expect(accounts.find((row:{scopeKey:string})=>row.scopeKey==="company:company-b").balanceYuan).toBe("60.0000");
    for(const actor of ["finance","keeper"])expect((await get(actor)).body.items[0]).toMatchObject({paidAmountCents:"8000",remainingAmountCents:"2000"});
  });
  it("never lets an ordinary unparticipating payer self-claim the registered-source exception", async () => {
    await prepareCashOperatingPayment();
    const ledger=new OperatingLedgerService(database.prisma as never);
    await expect(ledger.appendFromSource({projectId:"project-a",sourceType:"payment_execution",sourceBusinessId:"unbound-ordinary-source",sourceBusinessCode:"普通付款来源",sourceVersion:1,idempotencyKey:"ordinary-source-no-registered-authority",occurredAt:new Date("2026-11-06T00:00:00Z"),confirmedAt:new Date("2026-11-06T00:00:00Z"),confirmedByUserId:"project_finance",factKind:"downstream_payment",operatingLevel:"inter_subject",evidenceLevel:"A",amountCents:1000n,currencyCode:"CNY",direction:"outflow",isBeforeOperatingLedgerEffectiveDate:false,affiliateAssignmentId:"affiliate-assignment-a",affiliateBusinessPartyVersionId:"affiliate-version-a",affiliateNameSnapshot:"施工企业甲",affiliateCreditCodeSnapshot:"SYNTHETIC-AFFILIATE",subjects:{debtor:{kind:"participating_company",id:"company-a"},approvedPayer:{kind:"participating_company",id:"company-a"},actualPayer:{kind:"participating_company",id:"company-b"},payee:{kind:"downstream_counterparty",id:"supplier-version-a"}},sourceSnapshot:{registeredFunding:{accountId:"client-invented-account",actualPayerSnapshot:{companyEntityId:"company-b"}}},impacts:[{idempotencyKey:"ordinary-unbound-funds",sourceImpactKey:"company_project_funds_decrease",impactKind:"company_project_funds_decrease",amountCents:1000n,direction:"decrease",subjectRole:"actual_payer",subject:{kind:"participating_company",id:"company-b"}}]},"project_finance")).rejects.toThrow("未在本项目事实日参与");
    expect(await ledger.readFacts("project-a","project_finance")).toEqual([]);
    expect((await get("project_finance")).status).toBe(403);
  });
  it.each(["missing_version", "draft_unconfirmed"])("does not offer registered work without an explicitly frozen our-company version: %s", async state => {
    await prepareApprovedPayment();
    const seed = database.prisma as unknown as Record<string, {update(input:{where:{id:string};data:Record<string,unknown>}):Promise<unknown>}>;
    if (state === "missing_version") await seed.paymentRequest.update({where:{id:"payment-a"},data:{contractVersionId:"orphan-version"}});
    else await seed.contractVersion.update({where:{id:"version-a"},data:{signingSubjectType:"draft_unconfirmed"}});
    const beforeFunds = await get("finance", "/fund-accounts");
    const beforeAudit = await get("admin", "/audit-logs");
    const work = await get("keeper");
    const options = await get("keeper", "/payment-executions/payment-a/registration-options");
    expect(work).toMatchObject({status:200,body:{total:0,items:[]}});
    expect(options.status).toBe(409);
    expect(await get("finance", "/fund-accounts")).toEqual(beforeFunds);
    expect(await get("admin", "/audit-logs")).toEqual(beforeAudit);
  });
  it("projects an explicit current registration operation grant from options without granting project-only or technical accounts", async () => {
    await prepareApprovedPayment();
    const beforeFunds=await get("finance","/fund-accounts");
    const beforeAudit=await get("admin","/audit-logs");
    for (const actor of ["project_finance","admin"]) {
      expect((await get(actor,"/payment-executions/payment-a/registration-options")).status).toBe(403);
      expect((await get(actor,"/payment-executions/recorded-items")).status).toBe(403);
    }
    const options=await get("finance","/payment-executions/payment-a/registration-options");
    expect(options.status).toBe(200);
    expect(options.body).toMatchObject({paymentId:"payment-a",paidAmountCents:"0",remainingAmountCents:"10000",accounts:[expect.objectContaining({scopeKey:"company:company-a",eligible:true})]});
    // The public read response must explicitly grant this operation. A positive
    // remaining amount, voucher-pending status or client role is not authority.
    expect(options.body.canRegisterPayment).toBe(true);
    const keeper=await get("keeper","/payment-executions/payment-a/registration-options");
    expect(keeper.status).toBe(200);
    expect(keeper.body.canRegisterPayment).toBe(true);
    expect(await get("finance","/fund-accounts")).toEqual(beforeFunds);
    expect(await get("admin","/audit-logs")).toEqual(beforeAudit);
  });
  it("projects a separate current supplementary-voucher grant after full payment and removes it after real evidence is attached", async () => {
    const opening=await prepareApprovedPayment();
    const key="d43294d5-b319-48b9-8209-30bc82b16e6c";
    expect((await recordSourcePayment(opening,"10000",key)).status).toBe(201);
    const result=await get("keeper",`/payment-executions/results/${key}`);
    expect(result.status).toBe(200);
    const executionId=result.body.execution.executionId;
    for (const actor of ["project_finance","admin"]) {
      expect((await get(actor,"/payment-executions/recorded-items?paymentId=payment-a")).status).toBe(403);
      expect((await post(actor,`/payment-executions/${executionId}/voucher`,{fileId:"86bc2875-41ad-4353-81dc-7087b8970691"})).status).toBe(403);
    }
    expect((await get("keeper")).body.items).toEqual([]);
    const pending=await get("finance","/payment-executions/recorded-items?paymentId=payment-a");
    expect(pending.status).toBe(200);
    expect(pending.body.items).toEqual([expect.objectContaining({executionId,paymentId:"payment-a",amountCents:"10000",voucherPending:true,resultKey:key})]);
    // Supplement authority is a current server operation grant, independently
    // of being fully paid and independently of the display-only pending state.
    expect(pending.body.items[0].canSupplementVoucher).toBe(true);
    const bytes=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=","base64");
    const form=new FormData();form.append("file",new Blob([bytes],{type:"image/png"}),"operation-grant-voucher.png");form.append("idempotencyKey","a6b1535c-0e1a-4639-9daa-e31b035c50ec");
    const token=tokens.signAccessToken({id:"keeper",name:"综合部主管",phone:null,sessionVersion:0});
    const uploaded=await fetch(`${await app.getUrl()}/payment-executions/${executionId}/voucher-file-uploads`,{method:"POST",headers:{authorization:`Bearer ${token}`},body:form});
    expect(uploaded.status).toBe(201);
    const file=await uploaded.json();expect(file.sizeBytes).toBe(bytes.length);
    expect((await post("keeper",`/payment-executions/${executionId}/voucher`,{fileId:file.id})).status).toBe(201);
    const supplemented=await get("finance","/payment-executions/recorded-items?paymentId=payment-a");
    expect(supplemented.status).toBe(200);
    expect(supplemented.body.items).toEqual([expect.objectContaining({executionId,paymentId:"payment-a",voucherPending:false,canSupplementVoucher:false,resultKey:key})]);
    expect((await get("keeper",`/payment-executions/results/${key}`)).body.execution).toMatchObject({executionId,amountCents:"10000",voucherPending:false});
    expect((await get("finance","/fund-accounts")).body.accounts.find((row:{scopeKey:string})=>row.scopeKey==="company:company-a").balanceYuan).toBe("0.0000");
  });
  it("projects a fresh root supplementary-voucher grant from the original result without expanding result access", async () => {
    const opening=await prepareApprovedPayment();
    const key="d6619e52-ec04-4543-a379-171ff27cec47";
    expect((await recordSourcePayment(opening,"10000",key)).status).toBe(201);
    for (const actor of ["project_finance","admin"]) {
      expect((await get(actor,`/payment-executions/results/${key}`)).status).toBe(403);
    }
    expect((await get("keeper")).body.items).toEqual([]);
    const pending=await get("finance",`/payment-executions/results/${key}`);
    expect(pending.status).toBe(200);
    expect(pending.body).toMatchObject({status:"recorded",execution:{paymentId:"payment-a",amountCents:"10000",voucherPending:true}});
    const executionId=pending.body.execution.executionId;
    expect(typeof executionId).toBe("string");
    expect(pending.body.canSupplementVoucher).toBe(true);
    const bytes=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=","base64");
    const form=new FormData();form.append("file",new Blob([bytes],{type:"image/png"}),"result-operation-voucher.png");form.append("idempotencyKey","ce8ab340-5c99-4213-ae9f-66a184813745");
    const token=tokens.signAccessToken({id:"keeper",name:"综合部主管",phone:null,sessionVersion:0});
    const uploaded=await fetch(`${await app.getUrl()}/payment-executions/${executionId}/voucher-file-uploads`,{method:"POST",headers:{authorization:`Bearer ${token}`},body:form});
    expect(uploaded.status).toBe(201);
    const file=await uploaded.json();expect(file.sizeBytes).toBe(bytes.length);
    expect((await post("keeper",`/payment-executions/${executionId}/voucher`,{fileId:file.id})).status).toBe(201);
    const supplemented=await get("finance",`/payment-executions/results/${key}`);
    expect(supplemented.status).toBe(200);
    expect(supplemented.body).toMatchObject({status:"recorded",canSupplementVoucher:false,execution:{executionId,paymentId:"payment-a",amountCents:"10000",voucherPending:false}});
    expect((await get("keeper","/payment-executions/recorded-items?paymentId=payment-a")).body.items).toEqual([expect.objectContaining({executionId,amountCents:"10000",voucherPending:false,resultKey:key})]);
    expect((await get("finance","/fund-accounts")).body.accounts.find((row:{scopeKey:string})=>row.scopeKey==="company:company-a").balanceYuan).toBe("0.0000");
  });
  it("gives current finance and comprehensive director the same approved unpaid request without fabricating bank information", async () => {
    await prepareFrozenOurVersion();
    for (const actor of ["finance", "keeper"]) {
      const response = await get(actor);
      expect(response.status).toBe(200);
      expect(response.body.items).toEqual([expect.objectContaining({
        paymentId: "payment-a", code: "FK-16-01", paidAmountCents: "0", remainingAmountCents: "10000"
      })]);
    }
  });
  it("keeps a previously partially-paid fixture in both current queues and removes a fully paid fixture", async () => {
    await prepareFrozenOurVersion();
    const payments = (database.prisma as unknown as { paymentRequest: { update(input: {where: {id: string}; data: Record<string, unknown>}): Promise<unknown> } }).paymentRequest;
    await payments.update({ where: { id: "payment-a" }, data: { paidAmountCents: 4000n, status: "partially_paid" } });
    for (const actor of ["finance", "keeper"]) {
      expect(await get(actor)).toMatchObject({ status: 200, body: { total: 1, items: [
        expect.objectContaining({ paidAmountCents: "4000", remainingAmountCents: "6000" })
      ] } });
    }
    await payments.update({ where: { id: "payment-a" }, data: { paidAmountCents: 10000n, status: "paid" } });
    expect(await get("finance")).toMatchObject({ status: 200, body: { total: 0, items: [] } });
    expect(await get("keeper")).toMatchObject({ status: 200, body: { total: 0, items: [] } });
  });
  it("rechecks current company positions and never grants technical administrators payment authority", async () => {
    await prepareFrozenOurVersion();
    database.setRole("keeper", "employee");
    expect((await get("keeper")).status).toBe(403);
    expect((await get("admin")).status).toBe(403);
    expect((await get("project_finance")).status).toBe(403);
    database.setActive("finance", false);
    expect((await get("finance")).status).toBe(401);
  });
  it.each(["approved_first","returned_first"] as const)("rejects ambiguous equal-time latest approval rounds in %s persistence order before registered writes",async order=>{
    const opening=await prepareApprovedPayment();
    const options=await get("keeper","/payment-executions/payment-a/registration-options");
    expect(options.status).toBe(200);
    const seed=database.prisma as unknown as Record<string,{create(input:{data:Record<string,unknown>}):Promise<unknown>;findMany(input:{where:Record<string,unknown>}):Promise<Array<Record<string,unknown>>>}>;
    const statuses=order==="approved_first"?["approved","returned"]:["returned","approved"];
    for(const status of statuses)await seed.approvalInstance.create({data:{id:`equal-round-${status}`,businessType:"payment_request",businessId:"payment-a",flowType:"payment.approve",status,frozenNodes:[],currentNodeIndex:1,applicantUserId:"employee",createdAt:new Date("2026-11-03T00:00:00Z")}});
    const models=["paymentExecution","registeredPaymentFunding","registeredPaymentEvent","registeredFundPaymentAllocation","operatingFact","auditLog"];
    const before=await Promise.all(models.map(model=>seed[model].findMany({where:{}})));
    const work=await get("keeper"),afterOptions=await get("keeper","/payment-executions/payment-a/registration-options");
    const response=await post("keeper","/payment-executions/payment-a/registrations",{
      idempotencyKey:"e09b09ce-e45e-43fc-87c2-6e49b2591552",expectedPaymentUpdatedAt:options.body.expectedPaymentUpdatedAt,amountCents:"3000",paidAt:"2026-11-04",
      scopeKey:"company:company-a",expectedRegistrationId:opening.body.id,openingTreatment:"not_included",openingReason:"已核对资金未含期初",openingEvidence:"真实原付款凭据",sourceAllocations:[{sourceBatchId:opening.body.sources[0].id,amountCents:"3000"}],confirmationPassword:"Synthetic15Password!"
    });
    // All three public actions are observed before asserting; an insertion-order
    // accident must not authorize the direct POST behind an apparently hidden UI.
    expect(response.status).toBe(409);
    expect(work.body.items).toEqual([]);
    expect(afterOptions.status).toBe(409);
    expect(await Promise.all(models.map(model=>seed[model].findMany({where:{}})))).toEqual(before);
  });
  it("rejects direct registration when the latest approval round has returned even if the old request still says approved", async () => {
    const opening=await prepareApprovedPayment(),key="83a0d098-d9af-468b-8d61-1914382484c8";
    await (database.prisma as unknown as {approvalInstance:{create(input:{data:Record<string,unknown>}):Promise<unknown>}}).approvalInstance.create({data:{id:"new-returned-round",businessType:"payment_request",businessId:"payment-a",flowType:"payment.approve",status:"returned",frozenNodes:[],currentNodeIndex:0,applicantUserId:"employee",createdAt:new Date("2026-11-06T00:00:00Z")}});
    const beforeFunds=await get("finance","/fund-accounts"),beforeAudit=await get("admin","/audit-logs");
    expect((await get("keeper")).body.items).toEqual([]);
    const attempt=await post("keeper","/payment-executions/payment-a/registrations",{idempotencyKey:key,expectedPaymentUpdatedAt:"2026-11-05T00:00:00.000Z",amountCents:"4000",paidAt:"2026-11-06",scopeKey:"company:company-a",expectedRegistrationId:opening.body.id,openingTreatment:"not_included",openingReason:"未含期初",openingEvidence:"原审批已退回不可通过旧状态付款",sourceAllocations:[{sourceBatchId:opening.body.sources[0].id,amountCents:"4000"}],confirmationPassword:"Synthetic15Password!"});
    expect(attempt).toMatchObject({status:409,body:{message:expect.stringContaining("审批")}});
    expect((await get("keeper",`/payment-executions/results/${key}`)).body.status).toBe("unconfirmed");
    expect(await get("finance","/fund-accounts")).toEqual(beforeFunds);expect(await get("admin","/audit-logs")).toEqual(beforeAudit);
  });
  it("does not offer a stale approved request after its latest approval round has returned", async () => {
    await prepareFrozenOurVersion();
    await (database.prisma as unknown as {approvalInstance: {create(input: {data: Record<string, unknown>}): Promise<unknown>}}).approvalInstance.create({ data: {
      id: "returned-round-a", businessType: "payment_request", businessId: "payment-a", flowType: "payment.approve",
      status: "returned", frozenNodes: [], currentNodeIndex: 0, applicantUserId: "employee", createdAt: new Date("2026-11-02T00:00:00Z")
    } });
    expect(await get("finance")).toMatchObject({ status: 200, body: { total: 0, items: [] } });
  });
  it.each(["paymentExecutionWagePayableBinding","historicalWageSummaryPaymentExecutionLink"])("does not expose legacy wage-linked execution through the new result entrance: %s", async sourceTable => {
    await prepareFrozenOurVersion("labor_subcontract");
    const seed=database.prisma as unknown as Record<string,{create(input:{data:Record<string,unknown>}):Promise<unknown>}>;
    const executionId="310fd3ac-a267-42f3-bb75-7fc351c36612",key="329045c8-ff26-4ebd-b615-05de5ab08422";
    await seed.paymentExecution.create({data:{id:executionId,idempotencyKey:key,paymentRequestId:"payment-a",paymentSubjectType:"our_company",companyEntityIdSnapshot:"company-a",companyEntityNameSnapshot:"A",companyEntityCreditCodeSnapshot:"SYNTHETIC-A",amountCents:2500n,paidAt:new Date("2026-11-04T00:00:00Z"),executedByUserId:"finance",voucherFileId:"legacy-private-wage-file"}});
    const relationship=sourceTable === "paymentExecutionWagePayableBinding"
      ? {wagePayableRefId:"private-wage-ref",debtorCompanyId:"company-a",debtorCompanySnapshot:{name:"A"},projectId:"project-a",projectSnapshot:{name:"A"},creditorSubjectType:"employee",creditorUserId:"private-worker",creditorSubjectIdentityKey:"private-worker-identity",creditorNameSnapshot:"PRIVATE_WORKER_NAME",creditorVersionFingerprint:"a".repeat(64),creditorSnapshot:{name:"PRIVATE_WORKER_NAME"},currencyCode:"CNY",createdByUserId:"finance"}
      : {authorityCreditorLineId:"private-summary-line",summaryPayableRefId:"private-summary-ref",paymentExecutionFingerprint:"a".repeat(64),paymentExecutionSetFingerprint:"b".repeat(64),targetFingerprint:"c".repeat(64),paymentEvidenceSnapshot:{name:"PRIVATE_WORKER_NAME"},ordinal:1};
    await seed[sourceTable].create({data:{id:"legacy-wage-link",paymentExecutionId:executionId,amountCents:2500n,...relationship}});
    for(const actor of ["keeper","finance"]) {
      const response=await get(actor,`/payment-executions/results/${key}`);
      expect(response.status).toBe(403);
      expect(JSON.stringify(response.body)).not.toContain("2500");
      expect(JSON.stringify(response.body)).not.toContain("PRIVATE_WORKER_NAME");
    }
  });
  it("queries the canonical execution by the original request key and leaves an unseen result unconfirmed", async () => {
    await prepareFrozenOurVersion();
    const key = "76b3c58b-d43a-479e-9d5a-7a729fa45099";
    const path = `/payment-executions/results/${key}`;
    const initial = await get("keeper", path);
    expect(initial.status).toBe(200);
    expect(initial.body).toEqual({ status: "unconfirmed", message: "尚未查到付款登记结果，请保留原请求并继续查询" });
    await (database.prisma as unknown as { paymentExecution: { create(input: { data: Record<string, unknown> }): Promise<unknown> } }).paymentExecution.create({ data: {
      id: "execution-a", idempotencyKey: key, paymentRequestId: "payment-a", paymentSubjectType: "our_company",
      companyEntityIdSnapshot: "company-a", companyEntityNameSnapshot: "甲公司", companyEntityCreditCodeSnapshot: "SYNTHETIC-COMPANY-A",
      amountCents: 4000n, paidAt: new Date("2026-11-04T00:00:00Z"), executedByUserId: "finance", voucherFileId: "voucher-a"
    } });
    for (const actor of ["keeper", "finance"]) {
      const observed = await get(actor, path);
      expect(observed.status).toBe(200);
      expect(observed.body).toMatchObject({ status: "recorded", execution: {
        executionId: "execution-a", paymentId: "payment-a", amountCents: "4000", paidAt: "2026-11-04", voucherPending: false
      } });
    }
    database.setRole("keeper", "employee");
    expect((await get("keeper", path)).status).toBe(403);
  });
  it("keeps Me queue and card consistent after a partial fixture, full fixture and current duty revocation", async () => {
    await prepareFrozenOurVersion();
    const payments = (database.prisma as unknown as { paymentRequest: { update(input: {where: {id: string}; data: Record<string, unknown>}): Promise<unknown> } }).paymentRequest;
    await payments.update({ where: { id: "payment-a" }, data: { paidAmountCents: 4000n, status: "partially_paid" } });
    for (const actor of ["finance", "keeper"]) {
      const work = await get(actor, "/me/work-items");
      expect(work.status).toBe(200);
      expect(work.body.queues.pending.filter((item: {type: string}) => item.type === "payment_execution")).toEqual([
        expect.objectContaining({ businessId: "payment-a", amountText: "¥60.00" })
      ]);
      const summary = await get(actor, "/me/workbench-summary");
      expect(summary.status).toBe(200);
      expect(summary.body.cards).toContainEqual(expect.objectContaining({ id: "approved_pending_payment", count: 1 }));
    }
    await payments.update({ where: { id: "payment-a" }, data: { paidAmountCents: 10000n, status: "paid" } });
    expect((await get("keeper", "/me/work-items")).body.queues.pending).not.toContainEqual(expect.objectContaining({ type: "payment_execution" }));
    expect((await get("keeper", "/me/workbench-summary")).body.cards).toContainEqual(expect.objectContaining({ id: "approved_pending_payment", count: 0 }));
    database.setRole("keeper", "employee");
    expect((await get("keeper", "/me/work-items")).body.queues.pending).not.toContainEqual(expect.objectContaining({ type: "payment_execution" }));
    expect((await get("keeper", "/me/workbench-summary")).body.cards).not.toContainEqual(expect.objectContaining({ id: "approved_pending_payment" }));
  });
  it("projects the shared execution duty into the comprehensive director's actual Me queue and homepage count", async () => {
    await prepareFrozenOurVersion();
    const work = await get("keeper", "/me/work-items");
    expect(work.status).toBe(200);
    expect(work.body.queues.pending).toContainEqual(expect.objectContaining({
      type: "payment_execution", businessType: "payment_request", businessId: "payment-a"
    }));
    const summary = await get("keeper", "/me/workbench-summary");
    expect(summary.status).toBe(200);
    expect(summary.body.cards).toContainEqual(expect.objectContaining({ id: "approved_pending_payment", count: 1 }));
  });
});
