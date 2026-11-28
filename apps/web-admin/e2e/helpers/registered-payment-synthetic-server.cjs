// Real Nest business/guards/files over synthetic persistence. Never connects PG/COS.
(async () => {
const path = await import("node:path");
const fs = await import("node:fs");
const { createRequire } = await import("node:module");
const { randomBytes, createHash } = await import("node:crypto");
const os = await import("node:os");
const root = path.resolve(__dirname, "../../../..");
if (fs.realpathSync(process.cwd()) !== root) throw new Error("Requires task16 isolated root");
process.umask(0o077);
for (const key of ["DATABASE_URL", "DIRECT_URL", "DIRECT_DATABASE_URL", "SHADOW_DATABASE_URL"]) delete process.env[key];
const artifactRoot = process.env.JG_PAYMENT_ARTIFACTS;
if (!artifactRoot || !path.resolve(artifactRoot).startsWith(root + "/")) throw new Error("Requires owned artifact root");
fs.mkdirSync(artifactRoot,{recursive:true});
const transportControlFile = path.join(artifactRoot,"transport-control.json");
const transportLogFile = path.join(artifactRoot,"transport-log.jsonl");
function readOwnedFaultControls() {
  let raw = {};
  try { if (fs.existsSync(transportControlFile)) raw = JSON.parse(fs.readFileSync(transportControlFile,"utf8")) ?? {}; } catch { /* Malformed owned controls never arm a fault. */ }
  const roleFact = raw.keeperRoleBeforeNextResult;
  const keeperRoleBeforeNextResult = roleFact && ["employee","comprehensive_director"].includes(roleFact.role) && typeof roleFact.resultKey === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(roleFact.resultKey) ? {role:roleFact.role,resultKey:roleFact.resultKey} : null;
  return {advanceHistoryBasisBeforeNextRegistration:raw.advanceHistoryBasisBeforeNextRegistration === true,dropNextRegistrationResponse:raw.dropNextRegistrationResponse === true,dropNextVoucherUploadResponse:raw.dropNextVoucherUploadResponse === true,conflictNextRegistrationTransaction:raw.conflictNextRegistrationTransaction === true,keeperRoleBeforeNextResult};
}
const storageRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "jg-task16-web-private-")));
fs.chmodSync(storageRoot,0o700);
if (storageRoot.startsWith(root + "/")) throw new Error("Private bytes must remain outside the Vite workspace allow boundary");
Object.assign(process.env, { NODE_ENV: "test", JWT_ACCESS_SECRET: randomBytes(32).toString("hex"), JWT_REFRESH_SECRET: randomBytes(32).toString("hex"), FILE_STORAGE_DRIVER: "local", FILE_STORAGE_ROOT: storageRoot, FILE_DOWNLOAD_SECRET: randomBytes(32).toString("hex"), OPERATING_LEDGER_DB_WRITE_SECRET: "synthetic-local-task16-not-db-credential", APPROVAL_SMS_ENABLED: "false", AUTH_SMS_ENABLED: "false", SMS_ENABLED: "false" });
const req = createRequire(path.join(root, "services/api/package.json"));
const ts = createRequire(path.join(root,"apps/web-admin/package.json"))("typescript");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename,"utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true, emitDecoratorMetadata: true, esModuleInterop: true } }).outputText, filename);
const load = name => req(path.join(root, "services/api/src", name + ".ts"));
const { Test } = req("@nestjs/testing");
const { Reflector } = req("@nestjs/core");
const { PrismaService } = load("database/prisma.service");
const { createRegisteredPaymentSyntheticDb } = load("payment/testing/registered-payment-execution.synthetic-db");
const { JwtAuthGuard } = load("auth/guards/jwt-auth.guard");
const { PermissionGuard } = load("auth/guards/permission.guard");
const { RetiredWriteEntryGuard } = load("retired-write-entry/retired-write-entry.guard");
const { JwtTokenService } = load("auth/jwt-token.service");
const { AuthService } = load("auth/auth.service");
const { ApprovalSmsService } = load("approval/approval-sms.service");
const { AuditService } = load("audit/audit.service");
const { PaymentRequestService } = load("payment/payment-request.service");
const { PaymentController } = load("payment/payment.controller");
const { PaymentReadService } = load("payment/payment-read.service");
const { ProjectVisibilityService } = load("auth/project-visibility.service");
const { PaymentAmountService } = load("payment/payment-amount.service");
const { RegisteredPaymentExecutionController } = load("payment/registered-payment-execution.controller");
const { RegisteredPaymentExecutionService } = load("payment/registered-payment-execution.service");
const { RegisteredPaymentNotificationService } = load("payment/registered-payment-notification.service");
const { FundAccountController } = load("fund-account/fund-account.controller");
const { FundAccountService } = load("fund-account/fund-account.service");
const { FileController } = load("file/file.controller");
const { FileService, PrivateFileStorage } = load("file/file.service");
const { MeController } = load("me/me.controller");
const { MeService } = load("me/me.service");
const { createApiValidationPipe } = load("validation/api-validation");
const { apiJsonReplacer } = load("api-json-replacer");
const database = createRegisteredPaymentSyntheticDb();
const tokens = new JwtTokenService();
const sessions = Object.fromEntries([["finance","finance_staff",true],["keeper","comprehensive_director",true],["director","finance_director",true],["project_finance","finance_staff",false]].map(([id, role, companyWide]) => { const user = { id, name: id === "keeper" ? "综合部主管" : id === "director" ? "财务主管" : id === "project_finance" ? "项目财务人员" : "财务人员", phone: null, mustChangePassword: false, roleKeys: [role], globalRoleKeys: companyWide ? [role] : [] }; return [id,{ user, accessToken: tokens.signAccessToken({...user,sessionVersion:0}), refreshToken: "synthetic-only" }]; }));
async function main() {
  const p = database.prisma;
  const entryProbe = process.env.JG_PAYMENT_ENTRY_PROBE ?? "normal";
  const dualFinanceEntryProbe = ["dual_finance","dual_finance_no_openings"].includes(entryProbe);
  const skipFundOpenings = entryProbe === "dual_finance_no_openings";
  let historicalOriginal = null;
  if (dualFinanceEntryProbe) database.setProjectMember("finance","project-a","finance_staff");
  await p.approvalInstance.create({data:{id:"approved-round-a",businessType:"payment_request",businessId:"payment-a",flowType:"payment.approve",status:"approved",frozenNodes:[],currentNodeIndex:1,applicantUserId:"employee",createdAt:new Date("2026-11-01T00:00:00Z")}});
  await p.paymentRequest.create({data:{id:"payment-a",code:"FK-16-01",projectId:"project-a",sourceType:"settlement",paymentSubjectType:"our_company",contractId:"contract-a",contractVersionId:"version-a",paymentTermsVersionId:"terms-a",settlementId:"settlement-a",requestedAmountCents:10000n,approvedAmountCents:10000n,paidAmountCents:0n,status:"approved_pending_payment",updatedAt:new Date("2026-11-05T00:00:00Z")}});
  await p.contract.create({data:{id:"contract-a",code:"HT-16-01",name:"合成材料采购合同",projectId:"project-a",contractTypeKey:"material_purchase"}});
  await p.contractVersion.create({data:{id:"version-a",contractId:"contract-a",versionNo:1,status:"active",signingSubjectType:"our_company",companyEntityIdSnapshot:"company-a",companyEntityNameSnapshot:"甲公司",companyEntityCreditCodeSnapshot:"SYNTHETIC-COMPANY-A"}});
  await p.paymentTermsVersion.create({data:{id:"terms-a",contractId:"contract-a",contractVersionId:"version-a",versionNo:1,status:"active",originalText:"本期有效结算经审批后可分次实际付款",updatedAt:new Date("2026-11-01T00:00:00Z")}});
  await p.settlement.create({data:{id:"settlement-a",code:"JS-16-01",periodLabel:"合成第一期",contractId:"contract-a",contractVersionId:"version-a",status:"effective",payableAmountCents:10000n,paidAmountCents:0n}});
  if (entryProbe === "contract_history") {
    // Parent's confirmed/activated baseline coordinates, not a new history command.
    await p.contractTakeover.create({data:{
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
    await p.contractTakeoverHistoricalPayment.create({data:{id:"history-payment-a",takeoverId:"history-basis-a",rowKey:"historical-paid-1",sequenceNo:1,amountCents:4000n,paidAt:new Date("2026-10-15T00:00:00Z"),status:"active",activatedAt:new Date("2026-11-01T00:00:00Z"),updatedAt:new Date("2026-11-01T00:00:00Z")}});
    await p.settlement.update({where:{id:"settlement-a"},data:{payableAmountCents:14000n,paidAmountCents:4000n}});
  }
  const module = await Test.createTestingModule({ controllers:[RegisteredPaymentExecutionController,PaymentController,FundAccountController,FileController,MeController], providers:[
    {provide:PrismaService,useValue:p},
    {provide:ApprovalSmsService,useValue:{available:()=>false,send:async()=>({status:"failed",message:"合成短信适配器已关闭"})}}, AuthService, AuditService, JwtTokenService, RegisteredPaymentExecutionService, RegisteredPaymentNotificationService, FundAccountService, MeService, PaymentReadService, ProjectVisibilityService,
    {provide:FileService,inject:[PrismaService,AuditService],useFactory:(prisma,audit)=>new FileService(prisma,audit,new PrivateFileStorage())},
    {provide:PaymentRequestService,inject:[PrismaService,AuthService,AuditService,FileService,RegisteredPaymentNotificationService],useFactory:(prisma,auth,audit,files,notifications)=>new PaymentRequestService(new PaymentAmountService(),prisma,audit,files,auth,undefined,undefined,undefined,undefined,undefined,undefined,notifications)}
  ] }).compile();
  const app = module.createNestApplication({logger:["error"]});
  app.getHttpAdapter().getInstance().set("json replacer",apiJsonReplacer);
  const reflector = new Reflector();
  app.useGlobalGuards(new JwtAuthGuard(reflector,tokens,p),new RetiredWriteEntryGuard(),new PermissionGuard(reflector,p));
  app.useGlobalPipes(createApiValidationPipe());
  // Owned synthetic faults only: an explicit one-shot DB pre-callback conflict,
  // or a socket drop after the real guarded handler returned its HTTP 201 body.
  // Neither boundary simulates or proves a PostgreSQL COMMIT.
  app.use(async(request,response,next)=>{
    const registration = request.method === "POST" && /^\/payment-executions\/[^/]+\/registrations$/.test(request.path);
    const upload = request.method === "POST" && /^\/payment-executions\/[^/]+\/voucher-file-uploads$/.test(request.path);
    const binding = request.method === "POST" && /^\/payment-executions\/[^/]+\/voucher$/.test(request.path);
    const result = request.method === "GET" && /^\/payment-executions\/results\/[^/]+$/.test(request.path);
    if (!registration && !upload && !binding && !result) return next();
    let syntheticPreCallbackConflict = false;
    let syntheticKeeperRoleFact = null;
    let syntheticHistoryBasisAdvanced = false;
    const before = readOwnedFaultControls();
    if (registration && request.path === "/payment-executions/payment-a/registrations" && before.conflictNextRegistrationTransaction) {
      before.conflictNextRegistrationTransaction = false;
      fs.writeFileSync(transportControlFile,JSON.stringify(before));
      database.conflictNextTransaction();
      syntheticPreCallbackConflict = true;
    }
    if (registration && request.path === "/payment-executions/payment-a/registrations" && entryProbe === "contract_history" && before.advanceHistoryBasisBeforeNextRegistration) {
      before.advanceHistoryBasisBeforeNextRegistration = false;
      fs.writeFileSync(transportControlFile,JSON.stringify(before));
      try {
        // Synthetic concurrent fact only. Revision advancement belongs to the
        // parent's adapter update port, never hand-written here or a PG claim.
        await p.contractTakeover.update({where:{id:"history-basis-a"},data:{updatedAt:new Date("2026-11-06T01:00:00Z"),evidenceSummary:"经独立复核更新历史依据"}});
        syntheticHistoryBasisAdvanced = true;
      } catch (failure) { return next(failure); }
    }
    if (result && before.keeperRoleBeforeNextResult?.resultKey === request.path.split("/").at(-1)) {
      syntheticKeeperRoleFact = before.keeperRoleBeforeNextResult.role;
      before.keeperRoleBeforeNextResult = null;
      fs.writeFileSync(transportControlFile,JSON.stringify(before));
      database.setRole("keeper",syntheticKeeperRoleFact);
    }
    const originalEnd = response.end.bind(response);
    let ended = false;
    response.end = function(chunk,...args) {
      if (ended) return originalEnd(chunk,...args);
      ended = true;
      let body = {};
      try { const parsed = JSON.parse(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk ?? "")); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed; } catch { /* Only known scalar fields are observed. */ }
      const controls = readOwnedFaultControls();
      const flag = registration ? "dropNextRegistrationResponse" : upload ? "dropNextVoucherUploadResponse" : null;
      const drop = response.statusCode === 201 && flag !== null && controls[flag];
      const canonicalKey = value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : undefined;
      const requestKey = canonicalKey(result ? request.path.split("/").at(-1) : request.body?.idempotencyKey);
      fs.appendFileSync(transportLogFile,JSON.stringify({at:new Date().toISOString(),method:request.method,path:request.path,statusAtEnd:response.statusCode,handlerReturned201:response.statusCode === 201,syntheticPersistenceOnly:true,dropped:drop,syntheticPreCallbackConflict,syntheticHistoryBasisAdvanced,
        ...(syntheticKeeperRoleFact ? {syntheticKeeperRoleFact} : {}),
        ...(requestKey ? {requestKey} : {}),
        ...(typeof request.body?.amountCents === "string" && /^\d+$/.test(request.body.amountCents) ? {amountCents:request.body.amountCents} : {}),
        ...(typeof request.body?.paidAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(request.body.paidAt) ? {paidAt:request.body.paidAt} : {}),
        ...(canonicalKey(body.id ?? body.executionId) ? {returnedId:body.id ?? body.executionId} : {}),
        ...(["recorded","unconfirmed"].includes(body.status ?? body.resultStatus) ? {resultStatus:body.status ?? body.resultStatus} : {}),
        ...(body.code === "PAYMENT_RESULT_UNCONFIRMED" ? {resultCode:body.code} : {}),
        ...(typeof body.contentSha256 === "string" && /^[a-f0-9]{64}$/.test(body.contentSha256) ? {fileSha256:body.contentSha256} : {})})+"\n");
      if (drop) { controls[flag] = false; fs.writeFileSync(transportControlFile,JSON.stringify(controls)); response.socket?.destroy(); return response; }
      return originalEnd(chunk,...args);
    };
    next();
  });
  await app.listen(Number(process.env.JG_PAYMENT_API_PORT),"127.0.0.1");
  for (const scopeKey of skipFundOpenings ? [] : ["company:company-a","company:company-b","public_cash"]) {
    const response = await fetch(`${await app.getUrl()}/fund-accounts/openings`,{method:"POST",headers:{authorization:`Bearer ${sessions[scopeKey === "public_cash" ? "keeper" : "finance"].accessToken}`,"content-type":"application/json"},body:JSON.stringify({scopeKey,balanceYuan:"100",asOfDate:"2026-11-05",evidenceReference:"合成余额核对表",reconciliationNote:"已核对余额来源项目",reason:"本地合成期初",idempotencyKey:`opening-${scopeKey}`,sources:[{amountYuan:"100",sourceStatus:"known",sourceName:"甲项目自有资金",projectStatus:"project",projectId:"project-a"}]})});
    if (!response.ok) throw new Error(`Synthetic opening ${response.status}: ${await response.text()}`);
  }
  if (entryProbe === "hft_original") {
    // Seed an already existing source, not a task34 create/activate command.
    // Its payment and private child voucher use the real task16 HTTP services.
    const { fingerprint } = load("operating-takeover/operating-takeover.utils");
    const { paymentExecutionVoucherFileId } = load("payment/payment-execution-voucher");
    const base = await app.getUrl();
    const headers = {authorization:`Bearer ${sessions.keeper.accessToken}`,"content-type":"application/json"};
    const json = async (route,init) => {
      const response = await fetch(base+route,{headers,...init});
      if (!response.ok) throw new Error(`Historical-source fixture HTTP ${response.status} at ${route}`);
      return response.json();
    };
    const work = (await json("/payment-executions/work-items")).items.find(row=>row.paymentId === "payment-a");
    const account = (await json("/fund-accounts")).accounts.find(row=>row.scopeKey === "company:company-b");
    const key = "0b60ee63-639b-4f74-a849-fb9c6b9a011e";
    const recorded = await json("/payment-executions/payment-a/registrations",{method:"POST",body:JSON.stringify({idempotencyKey:key,expectedPaymentUpdatedAt:work.expectedPaymentUpdatedAt,amountCents:"4000",paidAt:"2026-11-04",scopeKey:"company:company-b",expectedRegistrationId:account.currentRegistrationId,openingTreatment:"not_included",openingReason:"原登记实付已核对未含期初",openingEvidence:"合成原付款及余额核对依据",sourceAllocations:[{sourceBatchId:account.sources[0].id,amountCents:"4000"}],confirmationPassword:"Synthetic15Password!"})});
    const file = new FormData();
    file.append("file",new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=","base64")],{type:"image/png"}),"合成原付款凭证.png");
    file.append("idempotencyKey","56a452d1-69e1-4909-94ac-e59077ba4f55");
    const uploadedResponse = await fetch(`${base}/payment-executions/${recorded.id}/voucher-file-uploads`,{method:"POST",headers:{authorization:headers.authorization},body:file});
    if (uploadedResponse.status !== 201) throw new Error(`Historical-source private upload HTTP ${uploadedResponse.status}`);
    const uploaded = await uploadedResponse.json();
    await json(`/payment-executions/${recorded.id}/voucher`,{method:"POST",body:JSON.stringify({fileId:uploaded.id})});
    const execution = await p.paymentExecution.findUnique({where:{id:recorded.id}});
    const voucherFileId = await paymentExecutionVoucherFileId(p,execution);
    const batchId="a101d1c9-8891-4a8e-aa5f-1a838318cce1",activationId="2b88c24e-a81d-49ef-8b9e-63b7e7ac5be5",rowId="6a0e226d-fbfe-41ad-a189-44be36ad16ea";
    await p.historicalFinancialTakeoverBatch.create({data:{id:batchId,projectId:"project-a",status:"activated",revision:2,manifestFingerprint:"frozen-manifest",readSetFingerprint:"read-set"}});
    await p.historicalFinancialTakeoverActivation.create({data:{id:activationId,batchId,manifestFingerprint:"frozen-manifest",activationFingerprint:"activation-fingerprint",activatedAt:new Date()}});
    const target={id:execution.id,idempotencyKey:execution.idempotencyKey,voucherFileId,amountCents:execution.amountCents,paidAt:execution.paidAt,payerCompanyEntityId:execution.companyEntityIdSnapshot};
    await p.historicalFinancialTakeoverRowMapping.create({data:{id:rowId,batchId,projectId:"project-a",kind:"payment_execution",evidenceLevel:"A",mappingDecision:"LINK",targetKind:"payment_execution",targetRef:execution.id,targetFingerprint:fingerprint(target),targetSnapshot:JSON.parse(JSON.stringify(target,apiJsonReplacer)),amountCents:execution.amountCents,sourceVersion:1,mappingFingerprint:"mapping-frozen"}});
    historicalOriginal={executionId:execution.id,resultKey:key,rowId,paidAt:"2026-11-04",amountCents:"4000",bootstrapRegisteredPayments:1,privateVoucherUploadedThroughHttp:true};
  }
  fs.mkdirSync(artifactRoot,{recursive:true});
  fs.writeFileSync(path.join(artifactRoot,"fixture.json"),JSON.stringify({sessions,url:await app.getUrl(),storageRoot,transportControlFile,transportLogFile,historicalOriginal}));
  fs.writeFileSync(path.join(artifactRoot,"as-run-sources.json"),JSON.stringify({pid:process.pid,nodeVersion:process.version,typescriptVersion:ts.version,entryProbe,dualFinanceEntryProbe,skipFundOpenings,bootstrapSha256:createHash("sha256").update(fs.readFileSync(__filename)).digest("hex"),lockfileSha256:createHash("sha256").update(fs.readFileSync(path.join(root,"pnpm-lock.yaml"))).digest("hex"),root,privateStorageRoot:storageRoot,privateStorageMode:fs.statSync(storageRoot).mode & 0o777,startedAt:new Date().toISOString(),sources:Object.keys(require.cache).filter(file=>file.startsWith(path.join(root,"services/api/src")) && file.endsWith(".ts")).sort().map(file=>({file:path.relative(root,file),sha256:createHash("sha256").update(fs.readFileSync(file)).digest("hex")}))},null,2));
  process.stdout.write("Registered payment synthetic HTTP ready\n");
  for (const signal of ["SIGINT","SIGTERM"]) process.on(signal,async()=>{await app.close();process.exit(0)});
}
await main();
})().catch(error=>{console.error(error);process.exitCode=1});
