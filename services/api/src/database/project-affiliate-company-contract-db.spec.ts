import {assertContractBankProject,contractBankProjectWhere} from "../contract-ledger/contract-bank-project";
import {ContractBankVerificationService} from "../contract-ledger/contract-bank-verification.service";
import {ContractEconomicReviewOperatingSourceAdapter} from "../contract-ledger/contract-economic-review-operating-source.adapter";
import { VerifiedBankTransactionObservationService } from "../fund-execution/verified-bank-transaction-observation.service";
import { FundExecutionService } from "../fund-execution/fund-execution.service";
import { FundExecutionSelectionOptionsService } from "../fund-execution/fund-execution-selection-options.service";
import { FundExecutionSelectionRefService } from "../fund-execution/fund-execution-selection-ref.service";
import { FundExecutionCanonicalAdapterService } from "../fund-execution/fund-execution-canonical-adapter.service";
import { UpwardReceiptMatchService } from "../contract-ledger/upward-receipt-match.service";
import { UpwardReceiptMatchOperatingSourceAdapter } from "../contract-ledger/upward-receipt-match-operating-source.adapter";
import { UpwardContractAmountService } from "../contract-ledger/upward-contract-amount.service";
import { ContractRelationshipLedgerService } from "../contract-ledger/contract-relationship-ledger.service";
import { ProjectService } from "../project/project.service";
import { ProjectUpstreamFundBusinessEntryService } from "../project/project-upstream-fund-business-entry.service";
import { Test } from "@nestjs/testing";
import { ContractProxyExecutionService } from "../contract-ledger/contract-proxy-execution.service";
import { ContractProxyExecutionController } from "../contract-ledger/contract-proxy-execution.controller";
import { ContractProxyOperatingSourceAdapter } from "../contract-ledger/contract-proxy-operating-source.adapter";
import { ProjectAffiliateBusinessService } from "../project/project-affiliate-business.service";
import { ProjectUpstreamFundFactOperatingSourceAdapter,ProjectAffiliateContractFactOperatingSourceAdapter,ProjectAffiliateSettlementFactOperatingSourceAdapter } from "../project/project-operating-source.adapter";
import { OperatingLedgerService } from "../operating-ledger/operating-ledger.service";
import { OperatingSourceReplayService } from "../operating-ledger/operating-source-replay.service";
import { OperatingSourceAdapterRegistry } from "../operating-ledger/operating-source-adapter";
import { ProjectFundingAvailabilityService } from "../project-funding/project-funding-availability.service";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { ContractEconomicReviewService } from "../contract-ledger/contract-economic-review.service";
import { AuditService } from "../audit/audit.service";
import { BadRequestException } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { ProjectAffiliateCompanyContractService } from "../project/project-affiliate-company-contract.service";

const TEST_DATABASE = "jiangkong_project_affiliate_company_contract_test";
const LIVE_TEST_ENABLED =
  process.env.RUN_PROJECT_AFFILIATE_COMPANY_CONTRACT_DB_TESTS === "1";

export function projectAffiliateCompanyContractDatabaseUrl(
  value: string | undefined
) {
  if (!value || process.env.NODE_ENV === "production") {
    throw new Error(
      "挂靠公司合同并发测试必须连接非生产专用数据库"
    );
  }
  const url = new URL(value);
  if (
    !["postgresql:", "postgres:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "::1"].includes(url.hostname) ||
    url.pathname !== `/${TEST_DATABASE}`
  ) {
    throw new Error("挂靠公司合同并发测试拒绝非本机专用数据库");
  }
  return url.toString();
}

describe("project affiliate-company contract database target guard", () => {
  it("rejects a production or non-local database target", () => {
    expect(() =>
      projectAffiliateCompanyContractDatabaseUrl(
        "postgresql://user:pass@example.com/production"
      )
    ).toThrow("挂靠公司合同并发测试拒绝非本机专用数据库");
  });
});

const databaseUrl = LIVE_TEST_ENABLED
  ? projectAffiliateCompanyContractDatabaseUrl(
      process.env.PROJECT_AFFILIATE_COMPANY_CONTRACT_DATABASE_URL
    )
  : undefined;
const describeDatabase = LIVE_TEST_ENABLED ? describe : describe.skip;

describeDatabase("project affiliate-company contract PostgreSQL constraints", () => {
  const createTestClient = () =>
    databaseUrl
      ? new PrismaClient({
          datasources: { db: { url: databaseUrl } }
        })
      : new PrismaClient();
  const prisma = createTestClient();

  jest.setTimeout(15_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("公司互转真实PG：独立领导OR终审、两侧流水、在途、借款归还、自有资金与项目权限", async()=>{
    const {CompanyTransferService}=await import("../company-transfer/company-transfer.service");
    const {CompanyTransferReadService}=await import("../company-transfer/company-transfer-read.service");
    const {CompanyTransferOperatingSourceAdapter}=await import("../company-transfer/company-transfer-operating-source.adapter");
    const f=await createFixture(prisma),b=await createFixture(prisma),leader=await createFixture(prisma),gm=await createFixture(prisma),manager=await createFixture(prisma);
    const file=async(actor=f.recorderId)=>{const id=randomUUID();await prisma.fileObject.create({data:{id,bucket:"private-local",objectKey:`tests/${id}.pdf`,originalName:"互转测试依据.pdf",mimeType:"application/pdf",sizeBytes:100,uploadedByUserId:actor,contentSha256:"e".repeat(64),storageStatus:"active"}});return id;};
    for(const [userId,key] of [[f.recorderId,"finance_staff"],[f.directorId,"finance_director"],[leader.directorId,"chairman"],[gm.directorId,"general_manager"]]){const p=await prisma.position.upsert({where:{key},create:{key,name:key},update:{}});await prisma.userPosition.create({data:{userId,positionId:p.id}});}
    await prisma.projectMember.create({data:{projectId:f.projectId,userId:manager.recorderId,positionKey:"project_manager"}});
    for(const c of [f,b])await prisma.projectParticipatingCompany.create({data:{projectId:f.projectId,companyEntityId:c.companyId,companyEntityVersionId:c.companyVersionId,companyNameSnapshot:"我方建设有限公司",companyCreditCodeSnapshot:c.companyCreditCode,effectiveFrom:new Date("2026-07-01"),changeReason:"互转合成验收",addedByUserId:f.recorderId}});
    await prisma.project.update({where:{id:f.projectId},data:{operatingLedgerEffectiveDate:new Date("2026-07-01")}});
    await prisma.projectReceipt.create({data:{projectId:f.projectId,receivedAt:new Date("2026-08-01"),amountCents:100000n,payerName:"合成测试",sourceType:"other",voucherFileId:await file(),recordedByUserId:f.recorderId}});
    const secret=process.env.OPERATING_LEDGER_DB_WRITE_SECRET!;await prisma.$executeRaw`INSERT INTO "OperatingLedgerWriteSecret" ("id","secretHash") VALUES (1,crypt(${secret},gen_salt('bf'))) ON CONFLICT("id") DO UPDATE SET "secretHash"=EXCLUDED."secretHash"`;
    const audit=new AuditService(),visibility=new ProjectVisibilityService(prisma as never),auth={confirmPassword:async(_a:string,p:string)=>{if(p!=="test-password")throw new BadRequestException("密码错误");}},ledger=new OperatingLedgerService(prisma as never),replay=new OperatingSourceReplayService(prisma as never,ledger,new OperatingSourceAdapterRegistry([new CompanyTransferOperatingSourceAdapter()]));
    const service=new CompanyTransferService(prisma as never,visibility,auth as never,audit,new ProjectFundingAvailabilityService(),replay),reader=new CompanyTransferReadService(prisma as never,visibility),bankService=new ContractBankVerificationService(prisma as never,visibility,auth as never,audit);
    const decision={action:"approve" as const,confirmationPassword:"test-password"};
    const request=async(kind:"storage"|"loan"|"repayment",amountCents:string,source=f.companyId,destination=b.companyId,projectId:string|null=f.projectId,originalTransferId?:string)=>service.create(f.recorderId,{kind,sourceCompanyId:source,destinationCompanyId:destination,sourceProjectId:projectId,destinationProjectId:projectId,sourceAccount:source===f.companyId?"6222000011111111":"6222000022222222",destinationAccount:destination===b.companyId?"6222000022222222":"6222000011111111",amountCents,reason:"隔离互转用途",evidenceFileId:await file(),confirmationPassword:"test-password",idempotencyKey:randomUUID(),originalTransferId});
    const bank=async(companyEntityId:string,direction:"inflow"|"outflow",amountCents:string,projectId:string|null=f.projectId,occurredAt="2026-08-20")=>{const accountNumber=companyEntityId===f.companyId?"6222000011111111":"6222000022222222";const r=await bankService.prepare(f.recorderId,{projectId,companyEntityId,accountNumber,bankReference:randomUUID(),direction,amountCents,occurredAt,evidenceFileId:await file(),reason:"隔离银行回单",idempotencyKey:randomUUID(),confirmationPassword:"test-password"});await bankService.decide(f.directorId,r.id,{decision:"confirm",accountNumber,holderEvidenceFileId:await file(f.directorId),confirmationPassword:"test-password"});return (await prisma.contractBankVerificationRequest.findUniqueOrThrow({where:{id:r.id}})).observationId!;};
    const execute=async(id:string,kind:"outgoing"|"incoming"|"returned",company:string,amount:string,outgoingEventId?:string,projectId:string|null=f.projectId,occurredAt="2026-08-20")=>service.execute(kind==="outgoing"?f.recorderId:f.directorId,id,{kind,observationId:await bank(company,kind==="outgoing"?"outflow":"inflow",amount,projectId,occurredAt),outgoingEventId,idempotencyKey:randomUUID(),confirmationPassword:"test-password"});
    const storage=await request("storage","10000");
    await expect(service.decide(f.recorderId,storage.id,decision)).rejects.toThrow("独立");
    const beforeBank=await bank(f.companyId,"outflow","10000");await expect(service.execute(f.recorderId,storage.id,{kind:"outgoing",observationId:beforeBank,idempotencyKey:randomUUID(),confirmationPassword:"test-password"})).rejects.toThrow("审批通过");
    const votes=await Promise.allSettled([service.decide(leader.directorId,storage.id,decision),service.decide(gm.directorId,storage.id,decision)]);expect(votes.filter(v=>v.status==="fulfilled")).toHaveLength(1);
    const out=await service.execute(f.recorderId,storage.id,{kind:"outgoing",observationId:beforeBank,idempotencyKey:randomUUID(),confirmationPassword:"test-password"});
    expect((await reader.list(f.recorderId,{projectId:f.projectId})).rows.find(r=>r.id===storage.id)?.inTransitCents).toBe("10000");
    const incoming=await bank(b.companyId,"inflow","6000");await expect(service.execute(f.recorderId,storage.id,{kind:"incoming",observationId:incoming,outgoingEventId:out.id,idempotencyKey:randomUUID(),confirmationPassword:"test-password"})).rejects.toThrow("另一位");
    await service.execute(f.directorId,storage.id,{kind:"incoming",observationId:incoming,outgoingEventId:out.id,idempotencyKey:randomUUID(),confirmationPassword:"test-password"});
    await execute(storage.id,"returned",f.companyId,"4000",out.id);
    const settled=(await reader.list(manager.recorderId,{projectId:f.projectId})).rows.find(r=>r.id===storage.id)!;expect(settled).toMatchObject({inTransitCents:"0",receivedCents:"6000",returnedCents:"4000",sourceAccountLast4:null,canExecute:false});
    await expect(execute(storage.id,"incoming",b.companyId,"1",out.id)).rejects.toThrow("剩余额度");
    await expect(service.execute(f.recorderId,storage.id,{kind:"outgoing",observationId:beforeBank,idempotencyKey:randomUUID(),confirmationPassword:"test-password"})).rejects.toThrow();
    const loan=await request("loan","7000");await service.decide(gm.directorId,loan.id,decision);const loanOut=await execute(loan.id,"outgoing",f.companyId,"7000");await execute(loan.id,"incoming",b.companyId,"7000",loanOut.id);
    const repayment=await request("repayment","7000",b.companyId,f.companyId,f.projectId,loan.id);
    await expect(request("repayment","1",b.companyId,f.companyId,f.projectId,loan.id)).rejects.toThrow("超过原往来");
    await service.decide(leader.directorId,repayment.id,decision);await prisma.companyEntity.update({where:{id:b.companyId},data:{isActive:false}});const inactiveBank=await bank(b.companyId,"outflow","7000");await expect(prisma.contractBankEventClaim.create({data:{observationId:inactiveBank,sourceType:"payment_execution",sourceId:randomUUID(),createdByUserId:f.recorderId}})).rejects.toThrow("inactive_company_repayment_only");const repaymentOut=await service.execute(f.recorderId,repayment.id,{kind:"outgoing",observationId:inactiveBank,idempotencyKey:randomUUID(),confirmationPassword:"test-password"});await execute(repayment.id,"incoming",f.companyId,"7000",repaymentOut.id);await prisma.companyEntity.update({where:{id:b.companyId},data:{isActive:true}});
    const balances=(await reader.list(f.recorderId,{projectId:f.projectId})).balances;expect(balances.every(b=>b.receivableCents==="0"&&b.payableCents==="0")).toBe(true);
    const own=await request("storage","2000",f.companyId,b.companyId,null);await service.decide(gm.directorId,own.id,decision);const ownOut=await execute(own.id,"outgoing",f.companyId,"2000",undefined,null);await execute(own.id,"incoming",b.companyId,"2000",ownOut.id,null);
    expect((await reader.list(manager.recorderId,{projectId:f.projectId})).rows.some(r=>r.id===own.id)).toBe(false);
    const projectExport=await reader.list(f.recorderId,{projectsOnly:"true"},true);expect(projectExport.rows.some(r=>r.id===own.id)).toBe(false);expect(projectExport.balances.every(b=>b.projectId!==null)).toBe(true);
    expect(await prisma.operatingFact.count({where:{sourceType:"company_transfer_event",sourceBusinessId:ownOut.id}})).toBe(0);
    const facts=await prisma.operatingFact.findMany({where:{projectId:f.projectId,sourceType:"company_transfer_event"},include:{impacts:true}});expect(facts.flatMap(f=>f.impacts).some(i=>/cost|income|payable|receivable/.test(i.impactKind))).toBe(false);
    expect(facts.flatMap(f=>f.impacts).reduce((a,i)=>a+(i.direction==="increase"?i.amountCents:-i.amountCents),0n)).toBe(0n);
    // Two legal repayment reservations must not consume each other's historical capacity.
    const datedLoan=await request("loan","20000");await service.decide(gm.directorId,datedLoan.id,decision);
    const datedOut=await execute(datedLoan.id,"outgoing",f.companyId,"20000",undefined,f.projectId,"2026-08-01");
    await execute(datedLoan.id,"incoming",b.companyId,"10000",datedOut.id,f.projectId,"2026-08-01");await execute(datedLoan.id,"incoming",b.companyId,"10000",datedOut.id,f.projectId,"2026-09-01");
    const a=await request("repayment","10000",b.companyId,f.companyId,f.projectId,datedLoan.id),later=await request("repayment","10000",b.companyId,f.companyId,f.projectId,datedLoan.id);
    await service.decide(gm.directorId,a.id,decision);await service.decide(gm.directorId,later.id,decision);
    await execute(a.id,"outgoing",b.companyId,"10000",undefined,f.projectId,"2026-08-20");
    await expect(execute(later.id,"outgoing",b.companyId,"10000",undefined,f.projectId,"2026-08-05")).rejects.toThrow("发生日");
    const laterOut=await execute(later.id,"outgoing",b.companyId,"10000",undefined,f.projectId,"2026-09-20");await execute(later.id,"returned",b.companyId,"10000",laterOut.id,f.projectId,"2026-10-01");
    const retro=await request("repayment","10000",b.companyId,f.companyId,f.projectId,datedLoan.id);await service.decide(gm.directorId,retro.id,decision);
    const retroBank=await bank(b.companyId,"outflow","10000",f.projectId,"2026-09-25");
    await expect(service.execute(f.recorderId,retro.id,{kind:"outgoing",observationId:retroBank,idempotencyKey:randomUUID(),confirmationPassword:"test-password"})).rejects.toThrow("发生日");
    await expect(prisma.$transaction(async tx=>{await tx.$executeRaw`SELECT public."authorizeOperatingLedgerWrite"(${f.recorderId},${secret})`;await tx.companyTransferEvent.create({data:{transferId:retro.id,kind:"outgoing",observationId:retroBank,amountCents:10000n,occurredAt:new Date("2026-09-25"),recordedByUserId:f.recorderId,idempotencyKey:randomUUID(),requestFingerprint:randomUUID()}});})).rejects.toThrow("dated_original_capacity");
    // Project money lent to own funds retains each side's separate ownership.
    const mixed=await service.create(f.recorderId,{kind:"loan",sourceCompanyId:f.companyId,destinationCompanyId:b.companyId,sourceProjectId:f.projectId,destinationProjectId:null,sourceAccount:"6222000011111111",destinationAccount:"6222000022222222",amountCents:"1000",reason:"项目与自有资金混合归属",evidenceFileId:await file(),confirmationPassword:"test-password",idempotencyKey:randomUUID()});await service.decide(gm.directorId,mixed.id,decision);const mixedOut=await execute(mixed.id,"outgoing",f.companyId,"1000");await execute(mixed.id,"incoming",b.companyId,"1000",mixedOut.id,null);
    const mixedProject=await reader.list(manager.recorderId,{projectId:f.projectId});expect(mixedProject.balances.every(b=>b.projectId===f.projectId)).toBe(true);expect(mixedProject.rows.find(r=>r.id===mixed.id)?.events.map(e=>e.kind)).toEqual(["outgoing"]);
    // A former participant can repay its approved original debt, but cannot originate new transfers.
    const exitedLoan=await request("loan","1000");await service.decide(gm.directorId,exitedLoan.id,decision);
    const exitedOut=await execute(exitedLoan.id,"outgoing",f.companyId,"1000");await execute(exitedLoan.id,"incoming",b.companyId,"1000",exitedOut.id);
    await prisma.projectParticipatingCompany.updateMany({where:{projectId:f.projectId,companyEntityId:b.companyId},data:{endedAt:new Date("2026-10-10")}});
    await expect(request("loan","1000")).rejects.toThrow();await expect(request("storage","1000")).rejects.toThrow();
    const exitedRepayment=await request("repayment","1000",b.companyId,f.companyId,f.projectId,exitedLoan.id);await service.decide(gm.directorId,exitedRepayment.id,decision);
    const exitPay=await execute(exitedRepayment.id,"outgoing",b.companyId,"1000",undefined,f.projectId,"2026-10-15");
    const exitReceive=await execute(exitedRepayment.id,"incoming",f.companyId,"1000",exitPay.id,f.projectId,"2026-10-15");
    await prisma.projectMember.create({data:{projectId:f.projectId,userId:f.directorId,positionKey:"finance_director"}});
    const beforeReplay=await prisma.operatingFact.count({where:{projectId:f.projectId}});
    for (const eventId of [exitPay.id,exitReceive.id]) await replay.replaySource({projectId:f.projectId,sourceType:"company_transfer_event",sourceBusinessId:eventId},f.directorId);
    expect(await prisma.operatingFact.count({where:{projectId:f.projectId}})).toBe(beforeReplay);
    const sourceAdapter=new CompanyTransferOperatingSourceAdapter();
    for (const eventId of [exitPay.id,exitReceive.id]) await prisma.$transaction(async tx=>{const snapshot=await sourceAdapter.readSourceSnapshot(tx,{projectId:f.projectId,sourceType:"company_transfer_event",sourceBusinessId:eventId});const input=sourceAdapter.toOperatingFactInput(snapshot!).input;const materialized=await ledger.materializeSourceForComparisonInTransaction(tx,input);expect(materialized.input.occurredAt.toISOString().slice(0,10)).toBe("2026-10-15");});
    const repaid=(await reader.list(f.recorderId,{projectId:f.projectId})).rows.find(r=>r.id===exitedRepayment.id)!;expect(repaid).toMatchObject({receivedCents:"1000",inTransitCents:"0"});

  },60000);

  it("真实HTTP及PG16：表外合同结算→我方代付→退款及归还→一次核销和往来余额", async () => {
    const f=await createFixture(prisma);
    await prisma.projectMember.createMany({data:[{projectId:f.projectId,userId:f.recorderId,positionKey:"budget_staff"},{projectId:f.projectId,userId:f.recorderId,positionKey:"finance_staff"},{projectId:f.projectId,userId:f.directorId,positionKey:"contract_director"},{projectId:f.projectId,userId:f.directorId,positionKey:"budget_staff"},{projectId:f.projectId,userId:f.directorId,positionKey:"finance_director"}]});
    await prisma.projectParticipatingCompany.create({data:{projectId:f.projectId,companyEntityId:f.companyId,companyEntityVersionId:f.companyVersionId,companyNameSnapshot:"我方建设有限公司",companyCreditCodeSnapshot:f.companyCreditCode,effectiveFrom:new Date("2026-07-01"),changeReason:"隔离闭环测试",addedByUserId:f.recorderId}});
    await prisma.project.update({where:{id:f.projectId},data:{operatingLedgerEffectiveDate:new Date("2026-07-01")}});
    const secret=process.env.OPERATING_LEDGER_DB_WRITE_SECRET!;
    await prisma.$executeRaw`INSERT INTO "OperatingLedgerWriteSecret" ("id","secretHash") VALUES (1,crypt(${secret},gen_salt('bf'))) ON CONFLICT("id") DO UPDATE SET "secretHash"=EXCLUDED."secretHash"`;
    const audit=new AuditService(),ledger=new OperatingLedgerService(prisma as never);
    const registry=new OperatingSourceAdapterRegistry([new ProjectAffiliateContractFactOperatingSourceAdapter(),new ProjectAffiliateSettlementFactOperatingSourceAdapter(),new ProjectUpstreamFundFactOperatingSourceAdapter(),new ContractProxyOperatingSourceAdapter(),new UpwardReceiptMatchOperatingSourceAdapter()]);
    const replay=new OperatingSourceReplayService(prisma as never,ledger,registry);
    const auth={confirmPassword:async(_actor:string,password:string)=>{if(password!=="test-password")throw new BadRequestException("密码错误");}};
    const business=new ProjectAffiliateBusinessService(prisma as never,audit,auth as never,replay);
    const vendorId=randomUUID(),vendorVersionId=randomUUID();
    await prisma.businessParty.create({data:{id:vendorId,name:"合成供应商",normalizedName:`合成供应商-${vendorId}`,createdByUserId:f.recorderId}});
    await prisma.businessPartyVersion.create({data:{id:vendorVersionId,businessPartyId:vendorId,versionNo:1,snapshot:{name:"合成供应商"},createdByUserId:f.recorderId}});
    const contract=await business.recordContractFact(f.projectId,f.recorderId,{contractType:"material_purchase",externalContractReference:`EXT-${randomUUID()}`,counterpartyName:"合成供应商",counterpartyVersionId:vendorVersionId,signedAt:"2026-08-01",amountNature:"fixed",amountCents:"100000",advanceAllowed:false,basisType:"oral",description:"隔离外部合同",idempotencyKey:randomUUID()});
    await business.confirmContractFact(f.projectId,contract.id,f.directorId,{confirmationPassword:"test-password",confirmationActionId:randomUUID()});
    const settlement=await business.recordSettlementFact(f.projectId,f.recorderId,{contractLedgerId:contract.ledgerId,counterpartyName:"合成供应商",settledAt:"2026-08-10",periodLabel:"第一期",amountCents:"80000",basisType:"oral",description:"隔离结算",idempotencyKey:randomUUID()});
    await business.confirmSettlementFact(f.projectId,settlement.id,f.directorId,{confirmationPassword:"test-password",confirmationActionId:randomUUID()});
    const second=await business.recordSettlementFact(f.projectId,f.recorderId,{contractLedgerId:contract.ledgerId,counterpartyName:"合成供应商",settledAt:"2026-08-12",periodLabel:"第二期",amountCents:"20000",basisType:"oral",description:"隔离结算第二期",idempotencyKey:randomUUID()});
    await business.confirmSettlementFact(f.projectId,second.id,f.directorId,{confirmationPassword:"test-password",confirmationActionId:randomUUID()});
    const receiptFile=randomUUID();
    await prisma.fileObject.create({data:{id:receiptFile,bucket:"private-local",objectKey:`tests/${receiptFile}.pdf`,originalName:"合成资金凭证.pdf",mimeType:"application/pdf",sizeBytes:100,uploadedByUserId:f.recorderId,contentSha256:"d".repeat(64),storageStatus:"active"}});
    await prisma.projectReceipt.create({data:{projectId:f.projectId,receivedAt:new Date("2026-08-01"),amountCents:100000n,payerName:"隔离测试",sourceType:"other",voucherFileId:receiptFile,recordedByUserId:f.recorderId}});
    const service=new ContractProxyExecutionService(prisma as never,new ProjectVisibilityService(prisma as never),auth as never,audit,replay,new ProjectFundingAvailabilityService());
    const module=await Test.createTestingModule({controllers:[ContractProxyExecutionController],providers:[{provide:ContractProxyExecutionService,useValue:service}]}).compile();
    const app=module.createNestApplication();
    app.use((req:{headers:Record<string,string>;user?:{id:string}},_res:unknown,next:()=>void)=>{req.user={id:req.headers["x-test-actor"]??"unknown"};next();});
    await app.listen(0,"127.0.0.1");
    const base=await app.getUrl();
    const post=async(path:string,body:unknown,actor=f.recorderId)=>{const response=await fetch(`${base}/contract-proxy-executions${path}`,{method:"POST",headers:{"content-type":"application/json","x-test-actor":actor},body:JSON.stringify(body)});return {status:response.status,body:await response.json() as {id:string;status:string;message?:string}};};
    const newFile=async(actor=f.recorderId)=>{const id=randomUUID();await prisma.fileObject.create({data:{id,bucket:"private-local",objectKey:`tests/${id}.pdf`,originalName:"银行凭证.pdf",mimeType:"application/pdf",sizeBytes:100,uploadedByUserId:actor,contentSha256:"e".repeat(64),storageStatus:"active"}});return id;};
    try {
    for(const [userId,roleKey] of [[f.recorderId,"finance_staff"],[f.directorId,"finance_director"]]){const position=await prisma.position.upsert({where:{key:roleKey},create:{key:roleKey,name:roleKey},update:{}});await prisma.userPosition.create({data:{userId,positionId:position.id}});}
    const unrelatedProject=await createFixture(prisma);
    const bankVerification=new ContractBankVerificationService(prisma as never,new ProjectVisibilityService(prisma as never),auth as never,audit);
    const bankObservation=async(amountCents:string,direction:"inflow"|"outflow",date="2026-08-20")=>{
      const bankInput={projectId:f.projectId,companyEntityId:f.companyId,accountNumber:"6222000012345678",bankReference:randomUUID(),direction,amountCents,occurredAt:date,evidenceFileId:await newFile(),reason:"真实开户公司和银行交易人工独立核验",idempotencyKey:randomUUID(),confirmationPassword:"test-password"};
      const row=await bankVerification.prepare(f.recorderId,bankInput);
      expect((await bankVerification.prepare(f.recorderId,bankInput)).id).toBe(row.id);
      await expect(bankVerification.prepare(f.recorderId,{...bankInput,accountNumber:"6222-0000 12345678",idempotencyKey:randomUUID()})).rejects.toThrow("已提交核验");
      await expect(bankVerification.decide(f.recorderId,row.id,{decision:"confirm",holderEvidenceFileId:await newFile(),confirmationPassword:"test-password"})).rejects.toThrow("独立");
      await expect(prisma.$queryRaw`SELECT public.issue_contract_bank_holder(${row.id},${f.directorId},${await newFile(f.directorId)},${"not-a-signature"},${"a".repeat(64)})`).rejects.toThrow();
      const decision={decision:"confirm" as const,accountNumber:"6222-0000 12345678",holderEvidenceFileId:await newFile(f.directorId),confirmationPassword:"test-password"};
      await expect(bankVerification.decide(f.directorId,row.id,{...decision,accountNumber:"9999000012345678"})).rejects.toThrow("完整银行账号");
      await bankVerification.decide(f.directorId,row.id,decision);await bankVerification.decide(f.directorId,row.id,decision);
      const confirmed=await prisma.contractBankVerificationRequest.findUniqueOrThrow({where:{id:row.id}});expect(confirmed.status).toBe("confirmed");expect(confirmed.accountLast4).toBe("5678");expect(JSON.stringify(confirmed,(_k,v)=>typeof v==="bigint"?v.toString():v)).not.toContain("6222000012345678");
      const observation=await prisma.verifiedBankTransactionObservation.findUniqueOrThrow({where:{id:confirmed.observationId!}});
      await expect(assertContractBankProject(prisma as never,observation,"other-project")).rejects.toThrow("跨项目");
      expect(await prisma.verifiedBankTransactionObservation.count({where:{id:observation.id,...await contractBankProjectWhere(prisma as never,"other-project")}})).toBe(0);
      expect(await prisma.verifiedBankTransactionObservation.count({where:{id:observation.id,...await contractBankProjectWhere(prisma as never,f.projectId)}})).toBe(1);
      if(direction==="outflow"){
       const wrong=await prisma.contractProxyExecution.create({data:{projectId:unrelatedProject.projectId,sourceRef:"settlement:scope-test",entryKind:"payment",amountCents:BigInt(amountCents),occurredAt:observation.occurredAt,actualPayerKey:`participating_company:${f.companyId}`,bankObservationId:observation.id,bankReference:randomUUID(),evidenceFileId:await newFile(),evidenceSha256:"e".repeat(64),reason:"验证跨项目数据库认领拒绝",frozenSource:{actualPayer:{kind:"participating_company",id:f.companyId}},recordedByUserId:f.recorderId,idempotencyKey:randomUUID(),requestFingerprint:randomUUID()}});
       await expect(prisma.contractProxyBankClaim.create({data:{observationId:observation.id,proxyExecutionId:wrong.id}})).rejects.toThrow("bank_transaction_project_mismatch");
       expect(await prisma.contractProxyBankClaim.count({where:{observationId:observation.id}})).toBe(0);
      }
      return confirmed.observationId!;
    };
      const input={bankObservationId:await bankObservation("50000","outflow","2026-08-15"),projectId:f.projectId,sourceRef:`affiliate_settlement:${settlement.ledgerId}`,entryKind:"payment",allocations:[{sourceRef:`affiliate_settlement:${settlement.ledgerId}`,amountCents:"40000"},{sourceRef:`affiliate_settlement:${second.ledgerId}`,amountCents:"10000"}],amountCents:"50000",occurredAt:"2026-08-15",actualPayerKey:`participating_company:${f.companyId}`,bankReference:randomUUID(),evidenceFileId:await newFile(),reason:"真实已付的合成事后登记",idempotencyKey:randomUUID(),confirmationPassword:"test-password"};
      const prepared=await post("",input);expect(prepared.status).toBe(201);
      expect((await post("",input)).body.id).toBe(prepared.body.id);
      expect((await post(`/${prepared.body.id}/decision`,{decision:"confirm",confirmationPassword:"test-password"})).status).toBe(403);
      const confirmed=await post(`/${prepared.body.id}/decision`,{decision:"confirm",confirmationPassword:"test-password"},f.directorId);expect(confirmed).toMatchObject({status:201,body:{status:"confirmed"}});
      for(const [entryKind,amountCents] of [["refund","10000"],["repayment","20000"]]){
        const next=await post("",{...input,bankObservationId:await bankObservation(amountCents,"inflow"),entryKind,amountCents,allocations:entryKind==="refund"?[{sourceRef:`affiliate_settlement:${settlement.ledgerId}`,amountCents:"5000"},{sourceRef:`affiliate_settlement:${second.ledgerId}`,amountCents:"5000"}]:[{sourceRef:`affiliate_settlement:${settlement.ledgerId}`,amountCents:"20000"}],originalId:prepared.body.id,occurredAt:"2026-08-20",bankReference:randomUUID(),evidenceFileId:await newFile(),idempotencyKey:randomUUID()});expect(next.status).toBe(201);
        expect((await post(`/${next.body.id}/decision`,{decision:"confirm",confirmationPassword:"test-password"},f.directorId)).status).toBe(201);
      }
      expect(await prisma.contractProxyBankClaim.count({where:{observationId:input.bankObservationId}})).toBe(1);
      const duplicate=await post("",{...input,evidenceFileId:await newFile(),idempotencyKey:randomUUID(),bankReference:randomUUID()});expect(duplicate.status).toBe(409);
      const early=await post("",{...input,entryKind:"refund",originalId:prepared.body.id,allocations:[{sourceRef:input.sourceRef,amountCents:"1000"}],amountCents:"1000",occurredAt:"2026-08-14",evidenceFileId:await newFile(),idempotencyKey:randomUUID(),bankReference:randomUUID()});expect(early.status).toBe(400);
      const impacts=await prisma.operatingImpactEntry.findMany({where:{projectId:f.projectId}});
      const sum=(kinds:string[])=>impacts.filter(i=>kinds.includes(i.impactKind)).reduce((sum,i)=>sum+(i.direction==="decrease"?-i.amountCents:i.amountCents),0n);
      expect(sum(["confirmed_cost"])).toBe(100000n);
      expect(sum(["payable_increase","payable_decrease"])).toBe(60000n);
      expect(sum(["inter_subject_balance_increase","inter_subject_balance_decrease"])).toBe(20000n);
      expect(await prisma.operatingFact.count({where:{projectId:f.projectId,sourceType:"contract_proxy_execution"}})).toBe(3);
      const coverage=await prisma.$transaction(tx=>new ProjectFundingAvailabilityService().assertPersistedProjectFundingLedgerCoverage(tx,f.projectId));
      expect(coverage.projectCashSourceAmountCents).toBe(120000n);
      expect((await post(`/${prepared.body.id}/decision`,{decision:"confirm",confirmationPassword:"test-password"},f.directorId)).status).toBe(201);
      expect((await post("",{...input,allocations:undefined,amountCents:"45001",evidenceFileId:await newFile(),idempotencyKey:randomUUID(),bankReference:randomUUID()})).status).toBe(409);
      const excessRefund=await post("",{...input,entryKind:"refund",originalId:prepared.body.id,amountCents:"6000",allocations:[{sourceRef:`affiliate_settlement:${second.ledgerId}`,amountCents:"6000"}],evidenceFileId:await newFile(),idempotencyKey:randomUUID(),bankReference:randomUUID()});expect(excessRefund.status).toBe(409);
      // 尚无对上合同/结算时，银行到账先走原资金办理完整审批与确认。
      const chairman=randomUUID(),cashConfirmer=randomUUID();
      await prisma.user.createMany({data:[{id:chairman,name:"合成最终审批人",isActive:true},{id:cashConfirmer,name:"合成到账确认人",isActive:true}]});
      for(const [userId,roleKey] of [[cashConfirmer,"finance_director"],[chairman,"chairman"]]){
        const position=await prisma.position.upsert({where:{key:roleKey},create:{key:roleKey,name:roleKey},update:{}});await prisma.userPosition.create({data:{userId,positionId:position.id}});
      }
      for(const userId of [chairman,cashConfirmer]){const fileId=await newFile(userId);await prisma.handwrittenSignatureVersion.create({data:{userId,fileId,contentSha256:"e".repeat(64),source:"canvas"}});}
      const incoming=await bankObservation("20000","inflow","2026-08-05");
      const refs=new FundExecutionSelectionRefService({bankObservationSecret:randomUUID(),axisBusinessSecret:randomUUID()});
      const funding=new ProjectFundingAvailabilityService(),options=new FundExecutionSelectionOptionsService(prisma as never,refs,funding);
      const fundService=new FundExecutionService(prisma as never,audit,options,new FundExecutionCanonicalAdapterService(funding,ledger));
      const candidates=await options.listObservationCandidates(f.recorderId);
      const candidate=candidates.find(c=>c.summary.includes("200.00")&&c.summary.includes("我方建设有限公司"));expect(candidate).toBeDefined();
      const draft=await fundService.createCase(f.recorderId,{observationSelectionRef:candidate!.selectionRef,reason:"对上资料尚未齐全，保留银行真实到账",idempotencyKey:randomUUID()});
      const plans=await options.listCasePlans(draft.caseId,f.recorderId);
      const classified=await fundService.updateCase(f.recorderId,{caseId:draft.caseId,expectedRevision:draft.revision,reason:"归入本项目公司账户待核对",selectionRefs:plans[0].lines.flatMap(l=>l.axes.map(a=>a.selectionRef)),idempotencyKey:randomUUID()});
      const submitted=await fundService.submitCase(f.recorderId,{caseId:draft.caseId,expectedRevision:classified.revision,idempotencyKey:randomUUID()});
      await fundService.reviewApproval(f.directorId,{caseId:draft.caseId,action:"approve",comment:"已核验真实银行到账"});
      await fundService.reviewApproval(chairman,{caseId:draft.caseId,action:"approve",comment:"同意归入项目"});
      await fundService.confirmCase(cashConfirmer,{caseId:draft.caseId,expectedRevision:submitted.revision,idempotencyKey:randomUUID()});
      expect(await prisma.bankTransactionClaim.count({where:{observationId:incoming}})).toBe(1);
      const receiptFact=await prisma.operatingFact.findFirstOrThrow({where:{projectId:f.projectId,sourceType:"fund_execution",direction:"inflow"}});
      const cashBefore=(await prisma.operatingImpactEntry.findMany({where:{projectId:f.projectId,impactKind:{in:["company_project_funds_increase","company_project_funds_decrease"]}}})).reduce((n,i)=>n+(i.direction==="decrease"?-i.amountCents:i.amountCents),0n);
      // 对上合同未定额 -> 追加确定金额 -> 对上结算 -> 真实拨款，收入成本均不得复制。
      const upperService=new ProjectAffiliateCompanyContractService(prisma as never,audit,auth as never);
      const upper=await upperService.record(f.projectId,f.recorderId,{contractReference:`UP-${randomUUID()}`,contractName:"合成对上合同",companyEntityId:f.companyId,signedAt:"2026-08-01",rightsObligationsSummary:"合成上游履约往来",amountNature:"uncapped",fileId:f.contractFileId,idempotencyKey:randomUUID()});
      await upperService.confirm(f.projectId,upper.id,f.directorId,{confirmationPassword:"test-password",confirmationActionId:randomUUID()});
      const revisionService=new UpwardContractAmountService(prisma as never,new ProjectVisibilityService(prisma as never),auth as never,audit);
      const revisionInput={projectId:f.projectId,contractId:upper.id,amountNature:"fixed" as const,amountCents:"700000",effectiveAt:"2026-08-02T00:00:00Z",evidenceFileId:await newFile(),reason:"双方补定对上完整总额",idempotencyKey:randomUUID(),confirmationPassword:"test-password"};
      const revision=await revisionService.prepare(f.recorderId,revisionInput);
      expect((await revisionService.prepare(f.recorderId,revisionInput)).id).toBe(revision.id);
      await expect(revisionService.decide(f.recorderId,revision.id,{decision:"confirm",confirmationPassword:"test-password"})).rejects.toThrow();
      await revisionService.decide(f.directorId,revision.id,{decision:"confirm",confirmationPassword:"test-password"});
      expect((await prisma.projectAffiliateCompanyContract.findUniqueOrThrow({where:{id:upper.id}})).amountCents).toBeNull();
      await expect(prisma.upwardContractAmountRevision.update({where:{id:revision.id},data:{amountCents:700001n}})).rejects.toThrow("immutable");
      const upperSettlement=await business.recordSettlementFact(f.projectId,f.recorderId,{contractLedgerId:upper.id,affiliateCompanyContractId:upper.id,counterpartyName:"我方建设有限公司",settledAt:"2026-08-10",periodLabel:"对上第一期",amountCents:"60000",basisType:"oral",description:"对上已确认履约",idempotencyKey:randomUUID()});
      await business.confirmSettlementFact(f.projectId,upperSettlement.id,f.directorId,{confirmationPassword:"test-password",confirmationActionId:randomUUID()});
      const invoice=await prisma.invoiceRecord.create({data:{projectId:f.projectId,identityKey:randomUUID(),invoiceType:"vat_general",invoiceCode:"123456789012",invoiceNumber:randomUUID(),issueDate:new Date("2026-08-11"),sellerName:"我方建设有限公司",buyerName:"挂靠建设集团",totalAmountCents:60000n,allocatableAmountCents:60000n,fileId:await newFile(),uploadedByUserId:f.recorderId,sourceBusinessType:"project_upstream_fund_fact",sourceBusinessId:upperSettlement.id}});
      const projectService=new ProjectService(prisma as never,audit,auth as never,new ProjectFundingAvailabilityService(),replay,undefined,new ProjectUpstreamFundBusinessEntryService(audit));
      const directReceiptBank=await bankObservation("30000","inflow","2026-08-22");
      const directReceiptReference=(await prisma.verifiedBankTransactionObservation.findUniqueOrThrow({where:{id:directReceiptBank}})).reference;
      const receipt=await projectService.recordUpstreamFundFact(f.projectId,f.recorderId,{bankObservationReference:directReceiptReference,factType:"affiliate_remittance_to_company",basisType:"oral",occurredAt:"2026-08-22",amountCents:"30000",counterpartyName:"我方建设有限公司",companyEntityId:f.companyId,affiliateCompanyContractId:upper.id,affiliateSettlementFactId:upperSettlement.id,invoiceRecordId:invoice.id,idempotencyKey:randomUUID()});
      await projectService.confirmUpstreamFundFact(f.projectId,receipt.id,f.directorId,{confirmationPassword:"test-password",confirmationActionId:randomUUID()});
      const final=await prisma.operatingImpactEntry.findMany({where:{projectId:f.projectId}});
      const finalSum=(kinds:string[])=>final.filter(i=>kinds.includes(i.impactKind)).reduce((sum,i)=>sum+(i.direction==="decrease"?-i.amountCents:i.amountCents),0n);
      expect(finalSum(["confirmed_cost"])).toBe(100000n);
      expect(finalSum(["confirmed_income"])).toBe(0n);
      expect(finalSum(["receivable_increase","receivable_decrease"])).toBe(30000n);
      const matching=new UpwardReceiptMatchService(prisma as never,new ProjectVisibilityService(prisma as never),auth as never,audit,replay);
      const matchInput={projectId:f.projectId,receiptFactId:receiptFact.id,settlementLedgerId:upperSettlement.ledgerId,amountCents:"20000",occurredAt:"2026-08-23",reason:"原8月5日到账匹配对上结算",idempotencyKey:randomUUID(),confirmationPassword:"test-password"};
      const match=await matching.prepare(f.recorderId,matchInput);
      await matching.decide(f.directorId,match.id,{decision:"confirm",confirmationPassword:"test-password"});
      await matching.decide(f.directorId,match.id,{decision:"confirm",confirmationPassword:"test-password"});
      await expect(matching.prepare(f.recorderId,{...matchInput,amountCents:"1",idempotencyKey:randomUUID()})).rejects.toThrow("未匹配");
      const matchImpacts=await prisma.operatingImpactEntry.findMany({where:{projectId:f.projectId}});
      const afterMatch=(k:string[])=>matchImpacts.filter(i=>k.includes(i.impactKind)).reduce((n,i)=>n+(i.direction==="decrease"?-i.amountCents:i.amountCents),0n);
      expect(afterMatch(["receivable_increase","receivable_decrease"])).toBe(10000n);
      expect(afterMatch(["company_project_funds_increase","company_project_funds_decrease"])).toBe(cashBefore+30000n);
      expect(afterMatch(["confirmed_cost"])).toBe(100000n);
      expect(afterMatch(["construction_enterprise_funds_increase","construction_enterprise_funds_decrease"])).toBe(-70000n);
      const unmatched=await matching.prepare(f.recorderId,{...matchInput,originalId:match.id,occurredAt:"2026-08-24",idempotencyKey:randomUUID()});
      await matching.decide(f.directorId,unmatched.id,{decision:"confirm",confirmationPassword:"test-password"});
      const afterUnmatch=await prisma.operatingImpactEntry.findMany({where:{projectId:f.projectId}});
      const unmatchSum=(k:string[])=>afterUnmatch.filter(i=>k.includes(i.impactKind)).reduce((n,i)=>n+(i.direction==="decrease"?-i.amountCents:i.amountCents),0n);
      expect(unmatchSum(["receivable_increase","receivable_decrease"])).toBe(30000n);
      expect(unmatchSum(["construction_enterprise_funds_increase","construction_enterprise_funds_decrease"])).toBe(-70000n);
      expect(unmatchSum(["company_project_funds_increase","company_project_funds_decrease"])).toBe(cashBefore+30000n);
      await expect(matching.prepare(f.recorderId,{...matchInput,originalId:match.id,amountCents:"1",occurredAt:"2026-08-24",idempotencyKey:randomUUID()})).rejects.toThrow("解除金额");
      const rematch=await matching.prepare(f.recorderId,{...matchInput,occurredAt:"2026-08-25",idempotencyKey:randomUUID()});
      await matching.decide(f.directorId,rematch.id,{decision:"confirm",confirmationPassword:"test-password"});
      await expect(prisma.upwardReceiptMatch.update({where:{id:match.id},data:{amountCents:1n}})).rejects.toThrow("immutable");
      const relationshipService=new ContractRelationshipLedgerService(prisma as never,new ProjectVisibilityService(prisma as never));
      const view=await relationshipService.list(f.directorId,{projectId:f.projectId,relationship:"upward",asOf:"2026-08-31"});
      expect(view.totals[0].knownAmountCents).toBe("700000");
      const cashView=await relationshipService.list(f.directorId,{projectId:f.projectId,section:"receipts",relationship:"upward",asOf:"2026-08-31"});expect(cashView.totals[0].knownAmountCents).toBe("50000");
      const before=await relationshipService.list(f.directorId,{projectId:f.projectId,relationship:"upward",asOf:"2026-08-01"});
      expect(before.totals[0].unknownAmountCount).toBe(1);

      // 解除匹配后走真实反向银行事件，才冲回原现金双方视角。
      const releaseMatch=await matching.prepare(f.recorderId,{...matchInput,originalId:rematch.id,occurredAt:"2026-08-26",idempotencyKey:randomUUID()});await matching.decide(f.directorId,releaseMatch.id,{decision:"confirm",confirmationPassword:"test-password"});
      await bankObservation("20000","outflow","2026-08-27");
      const target=(await options.listReversalTargets(f.recorderId))[0];
      const reverseObservation=(await options.listObservationCandidates(f.recorderId)).find(c=>c.summary.includes("200.00"));expect(reverseObservation).toBeDefined();
      const reverse=await fundService.createReversalCase(f.recorderId,{targetSelectionRef:target.targetSelectionRef,observationSelectionRef:reverseObservation!.selectionRef,reason:"原待匹配款真实退回",idempotencyKey:randomUUID()});
      const reverseSubmitted=await fundService.submitCase(f.recorderId,{caseId:reverse.caseId,expectedRevision:reverse.revision,idempotencyKey:randomUUID()});
      await fundService.reviewApproval(f.directorId,{caseId:reverse.caseId,action:"approve",comment:"已核对退款流水"});await fundService.reviewApproval(chairman,{caseId:reverse.caseId,action:"approve",comment:"同意退回"});
      await fundService.confirmCase(cashConfirmer,{caseId:reverse.caseId,expectedRevision:reverseSubmitted.revision,idempotencyKey:randomUUID()});
      const reversed=await prisma.operatingImpactEntry.findMany({where:{projectId:f.projectId}}),net=(k:string[])=>reversed.filter(i=>k.includes(i.impactKind)).reduce((n,i)=>n+(i.direction==="decrease"?-i.amountCents:i.amountCents),0n);
      expect(net(["receivable_increase","receivable_decrease"])).toBe(30000n);expect(net(["company_project_funds_increase","company_project_funds_decrease"])).toBe(cashBefore+10000n);expect(net(["construction_enterprise_funds_increase","construction_enterprise_funds_decrease"])).toBe(-50000n);
      expect(net(["confirmed_cost"])).toBe(100000n);

    } finally { await app.close(); }
  },60000);

  it("PG16：全额重复排除后减额仍为零承诺，必须复核目标更正版本且不能变成负合同额",async()=>{
    const f=await createFixture(prisma);await prisma.projectMember.createMany({data:[{projectId:f.projectId,userId:f.directorId,positionKey:"contract_director"}]});
    await prisma.projectParticipatingCompany.create({data:{projectId:f.projectId,companyEntityId:f.companyId,companyEntityVersionId:f.companyVersionId,companyNameSnapshot:"我方建设有限公司",companyCreditCodeSnapshot:f.companyCreditCode,effectiveFrom:new Date("2026-07-01"),changeReason:"隔离闭环测试",addedByUserId:f.recorderId}});
    await prisma.project.update({where:{id:f.projectId},data:{operatingLedgerEffectiveDate:new Date("2026-07-01")}});
    const secret=process.env.OPERATING_LEDGER_DB_WRITE_SECRET!;await prisma.$executeRaw`INSERT INTO "OperatingLedgerWriteSecret" ("id","secretHash") VALUES (1,crypt(${secret},gen_salt('bf'))) ON CONFLICT("id") DO UPDATE SET "secretHash"=EXCLUDED."secretHash"`;
    const audit=new AuditService(),registry=new OperatingSourceAdapterRegistry([new ProjectAffiliateContractFactOperatingSourceAdapter(),new ContractEconomicReviewOperatingSourceAdapter()]);
    const replay=new OperatingSourceReplayService(prisma as never,new OperatingLedgerService(prisma as never),registry),auth={confirmPassword:async()=>undefined};
    const business=new ProjectAffiliateBusinessService(prisma as never,audit,auth as never,replay);
    const vendorId=randomUUID(),vendorVersionId=randomUUID();await prisma.businessParty.create({data:{id:vendorId,name:"经济复核材料商",normalizedName:vendorId,createdByUserId:f.recorderId}});await prisma.businessPartyVersion.create({data:{id:vendorVersionId,businessPartyId:vendorId,versionNo:1,snapshot:{name:"经济复核材料商"},createdByUserId:f.recorderId}});
    const base={contractType:"material_purchase" as const,counterpartyName:"经济复核材料商",counterpartyVersionId:vendorVersionId,signedAt:"2026-08-01",amountNature:"fixed" as const,amountCents:"100000",advanceAllowed:false,basisType:"oral" as const,description:"同一批真实供货"};
    const a=await business.recordContractFact(f.projectId,f.recorderId,{...base,externalContractReference:randomUUID(),idempotencyKey:randomUUID()});
    const b=await business.recordContractFact(f.projectId,f.recorderId,{...base,externalContractReference:randomUUID(),idempotencyKey:randomUUID()});
    const finance=randomUUID();await prisma.user.create({data:{id:finance,name:"经济复核独立财务",isActive:true}});
    const visibility={visibleProjectIdsInTransaction:async()=>[f.projectId],effectiveRoleKeysByProjectInTransaction:async(_tx:unknown,actor:string)=>new Map([[f.projectId,actor===finance?["finance_director"]:actor===f.directorId?["contract_director"]:["contract_staff"]]])};
    const reviews=new ContractEconomicReviewService(prisma as never,visibility as never,auth as never,audit,replay);
    const refs=[`affiliate:${a.ledgerId}`,`affiliate:${b.ledgerId}`].sort();
    const owner=refs[0]===`affiliate:${a.ledgerId}`?"left":"right";
    const reviewInput={projectId:f.projectId,leftSourceRef:refs[0],rightSourceRef:refs[1],relation:"replacement",coverage:[{scope:"同一供货批次",leftAmountCents:"100000",rightAmountCents:"100000",owner}],reason:"第二份仅为同一履约资料",idempotencyKey:randomUUID(),confirmationPassword:"test-password"};
    const review=await reviews.prepare(f.recorderId,reviewInput);await reviews.decide(f.directorId,review.id,{decision:"confirm",revision:1,confirmationPassword:"test-password"});
    for(const row of [a,b])await business.confirmContractFact(f.projectId,row.id,f.directorId,{confirmationPassword:"test-password",confirmationActionId:randomUUID()});
    const changeA=await business.recordContractFact(f.projectId,f.recorderId,{...base,externalContractReference:a.externalContractReference,entryKind:"correction",adjustsFactId:a.id,effectDirection:"increase",amountCents:"20000",signedAt:"2026-08-02",description:"独立供货增额",idempotencyKey:randomUUID()});
    const change=await business.recordContractFact(f.projectId,f.recorderId,{...base,externalContractReference:b.externalContractReference,entryKind:"correction",adjustsFactId:b.id,effectDirection:"decrease",amountCents:"50000",signedAt:"2026-08-02",description:"同一批真实供货减额",idempotencyKey:randomUUID()});
    await expect(business.confirmContractFact(f.projectId,change.id,f.directorId,{confirmationPassword:"test-password",confirmationActionId:randomUUID()})).rejects.toThrow("经济重复复核");
    await expect(business.recordContractFact(f.projectId,f.recorderId,{...base,externalContractReference:b.externalContractReference,entryKind:"correction",adjustsFactId:b.id,effectDirection:"decrease",amountCents:"1",signedAt:"2026-08-02",idempotencyKey:randomUUID()})).rejects.toThrow("已有待确认更正");
    await expect(reviews.prepare(f.recorderId,{...reviewInput,supersedesReviewId:review.id,idempotencyKey:randomUUID()})).rejects.toThrow("两份文书均有待生效变更");
    const updated=await reviews.prepare(f.recorderId,{...reviewInput,targetSourceRef:`affiliate:${b.ledgerId}`,supersedesReviewId:review.id,coverage:[{scope:"同一供货批次",leftAmountCents:"50000",rightAmountCents:"50000",owner}],reason:"目标合同减额后的剩余覆盖",idempotencyKey:randomUUID()});
    await reviews.decide(f.directorId,updated.id,{decision:"confirm",revision:1,confirmationPassword:"test-password"});await reviews.decide(finance,updated.id,{decision:"confirm",revision:2,confirmationPassword:"test-password"});
    const action={confirmationPassword:"test-password",confirmationActionId:randomUUID()};await business.confirmContractFact(f.projectId,change.id,f.directorId,action);await business.confirmContractFact(f.projectId,change.id,f.directorId,action);
    const fact=await prisma.operatingFact.findFirstOrThrow({where:{projectId:f.projectId,sourceBusinessId:change.id},include:{impacts:true}});expect(fact.impacts[0].amountCents).toBe(0n);
    const all=await prisma.operatingImpactEntry.findMany({where:{projectId:f.projectId,impactKind:"contract_commitment_reference"}});expect(all.reduce((v,i)=>v+(i.direction==="decrease"?-i.amountCents:i.amountCents),0n)).toBe(100000n);
    const ledger=new ContractRelationshipLedgerService(prisma as never,new ProjectVisibilityService(prisma as never));const view=await ledger.list(f.directorId,{projectId:f.projectId,relationship:"outside"});expect(view.totals[0].knownAmountCents).toBe("100000");
    const secondReview=await reviews.prepare(f.recorderId,{...reviewInput,targetSourceRef:`affiliate:${a.ledgerId}`,supersedesReviewId:updated.id,coverage:[{scope:"同一供货批次",leftAmountCents:"50000",rightAmountCents:"50000",owner}],idempotencyKey:randomUUID()});
    await reviews.decide(f.directorId,secondReview.id,{decision:"confirm",revision:1,confirmationPassword:"test-password"});await reviews.decide(finance,secondReview.id,{decision:"confirm",revision:2,confirmationPassword:"test-password"});
    await business.confirmContractFact(f.projectId,changeA.id,f.directorId,{confirmationPassword:"test-password",confirmationActionId:randomUUID()});
    expect((await ledger.list(f.directorId,{projectId:f.projectId,relationship:"outside"})).totals[0].knownAmountCents).toBe("120000");
    const total=await prisma.operatingImpactEntry.findMany({where:{projectId:f.projectId,impactKind:"contract_commitment_reference"}});expect(total.reduce((v,i)=>v+(i.direction==="decrease"?-i.amountCents:i.amountCents),0n)).toBe(120000n);

  },60000);

  it("PG16：施工企业同笔流水跨入口双向排他，统一法人版本及格式后仍不可重复",async()=>{
    const f=await createFixture(prisma);
    const proxy=async(reference:string,version=f.partyVersionId)=>{const file=randomUUID();await prisma.fileObject.create({data:{id:file,bucket:"private-local",objectKey:`tests/${file}.pdf`,originalName:"付款依据.pdf",mimeType:"application/pdf",sizeBytes:100,uploadedByUserId:f.recorderId,contentSha256:"e".repeat(64),storageStatus:"active"}});return prisma.contractProxyExecution.create({data:{projectId:f.projectId,sourceRef:"settlement:synthetic",entryKind:"payment",amountCents:100n,occurredAt:new Date("2026-08-01"),actualPayerKey:`construction_enterprise:${version}`,bankReference:reference,evidenceFileId:file,evidenceSha256:"e".repeat(64),reason:"跨入口唯一事实测试",frozenSource:{actualPayer:{kind:"construction_enterprise",id:version}},recordedByUserId:f.recorderId,idempotencyKey:randomUUID(),requestFingerprint:randomUUID()}});};
    const external=(reference:string)=>{const id=randomUUID();return prisma.projectAffiliatePaymentFact.create({data:{id,ledgerId:id,projectId:f.projectId,contractLedgerId:randomUUID(),counterpartyName:"合成供应商",paidAt:new Date("2026-08-01"),amountCents:100n,paymentKind:"normal",settlementLedgerId:randomUUID(),externalPaymentReference:reference,affiliateAssignmentId:f.assignmentId,affiliateBusinessPartyVersionId:f.partyVersionId,affiliateNameSnapshot:"挂靠建设集团",basisType:"oral",recordedByUserId:f.recorderId,recordedByRoleKey:"finance_staff",idempotencyKey:randomUUID(),requestFingerprint:"a".repeat(64)}});};
    const first=randomUUID();await proxy(first);await expect(external(` ${first.toUpperCase()} `)).rejects.toThrow("不得跨入口重复付款");
    const second=randomUUID();await external(second);await expect(proxy(` ${second.toUpperCase()} `)).rejects.toThrow("不得跨入口重复付款");
    const party=await prisma.businessPartyVersion.findUniqueOrThrow({where:{id:f.partyVersionId}}),other=randomUUID();await prisma.businessPartyVersion.create({data:{id:other,businessPartyId:party.businessPartyId,versionNo:party.versionNo+1,snapshot:party.snapshot as Prisma.InputJsonValue,createdByUserId:f.recorderId}});await expect(proxy(second,other)).rejects.toThrow("不得跨入口重复付款");
    const concurrent=randomUUID(),results=await Promise.allSettled([proxy(concurrent),external(concurrent)]);expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);expect(results.filter(r=>r.status==="rejected")).toHaveLength(1);
  });

  it("PG16：公司之间归还必须同时占用出款和收款流水，缺一侧零确认",async()=>{
    const a=await createFixture(prisma),b=await createFixture(prisma),secret=process.env.OPERATING_LEDGER_DB_WRITE_SECRET!;
    await prisma.$executeRaw`INSERT INTO "OperatingLedgerWriteSecret" ("id","secretHash") VALUES (1,crypt(${secret},gen_salt('bf'))) ON CONFLICT("id") DO UPDATE SET "secretHash"=EXCLUDED."secretHash"`;
    const position=await prisma.position.upsert({where:{key:"finance_director"},create:{key:"finance_director",name:"财务负责人"},update:{}});await prisma.userPosition.create({data:{userId:a.directorId,positionId:position.id}});
    const newFile=async()=>{const id=randomUUID();await prisma.fileObject.create({data:{id,bucket:"private-local",objectKey:`tests/${id}.pdf`,originalName:"银行依据.pdf",mimeType:"application/pdf",sizeBytes:100,uploadedByUserId:a.directorId,contentSha256:"e".repeat(64),storageStatus:"active"}});return id;};
    const bank=async(company:typeof a,direction:"inflow"|"outflow")=>{const id=randomUUID();await prisma.$queryRaw`SELECT * FROM public."jg_issue_payment_execution_payer_verification_trusted"(${JSON.stringify({id,reference:randomUUID(),holderCompanyEntityId:company.companyId,holderNameSnapshot:"我方建设有限公司",holderCreditCodeSnapshot:company.companyCreditCode,verificationReference:randomUUID(),verifiedByUserId:a.directorId,verifiedAt:"2026-07-01T00:00:00Z",verificationEvidenceFileId:await newFile(),verificationEvidenceContentSha256:"e".repeat(64),status:"verified",sourceType:"bank_account_legal_holder",sourceRecordId:randomUUID()})}::JSONB)`;const reference=randomUUID();await new VerifiedBankTransactionObservationService(prisma as never).record({reference,payerVerificationId:id,transactionSourceType:"dual_bank_test",transactionSourceId:randomUUID(),transactionSourceIdentity:randomUUID().replaceAll("-","").repeat(2),transactionEvidenceFileId:await newFile(),transactionExecutedByUserId:a.directorId,amountCents:100n,currencyCode:"CNY",direction,occurredAt:new Date("2026-08-20"),createdByUserId:a.directorId,auditRequestId:randomUUID()});return (await prisma.verifiedBankTransactionObservation.findUniqueOrThrow({where:{reference}})).id;};
    const frozenSource={debtor:{kind:"participating_company",id:a.companyId},actualPayer:{kind:"participating_company",id:b.companyId}};
    const original=await prisma.contractProxyExecution.create({data:{projectId:a.projectId,sourceRef:"settlement:synthetic",entryKind:"payment",amountCents:100n,occurredAt:new Date("2026-08-19"),actualPayerKey:`participating_company:${b.companyId}`,bankReference:randomUUID(),evidenceFileId:await newFile(),evidenceSha256:"e".repeat(64),reason:"双公司流水约束测试",frozenSource,recordedByUserId:a.recorderId,idempotencyKey:randomUUID(),requestFingerprint:"a".repeat(64)}});
    const out=await bank(a,"outflow"),incoming=await bank(b,"inflow");
    const repayment=await prisma.contractProxyExecution.create({data:{...original,frozenSource,id:randomUUID(),entryKind:"repayment",originalId:original.id,actualPayerKey:`participating_company:${a.companyId}`,occurredAt:new Date("2026-08-20"),bankObservationId:out,receivingBankObservationId:incoming,bankReference:randomUUID(),evidenceFileId:await newFile(),idempotencyKey:randomUUID()}});
    const signature=await prisma.handwrittenSignatureVersion.findFirstOrThrow({where:{userId:a.directorId}});
    const confirm=()=>prisma.contractProxyExecution.update({where:{id:repayment.id},data:{status:"confirmed",confirmedByUserId:a.directorId,confirmedAt:new Date(),confirmationSignatureVersionId:signature.id}});
    await prisma.contractProxyBankClaim.create({data:{observationId:out,proxyExecutionId:repayment.id}});await expect(confirm()).rejects.toThrow("receiving_bank_claim_required");
    await prisma.contractProxyBankClaim.create({data:{observationId:incoming,proxyExecutionId:repayment.id}});await confirm();
    expect(await prisma.contractProxyBankClaim.count({where:{proxyExecutionId:repayment.id}})).toBe(2);
    const {requireContractBankEvent}=await import("../contract-ledger/contract-bank-event");const incomingRef=(await prisma.verifiedBankTransactionObservation.findUniqueOrThrow({where:{id:incoming}})).reference;await expect(prisma.$transaction(tx=>requireContractBankEvent(tx,{projectId:a.projectId,reference:incomingRef,companyId:b.companyId,amountCents:100n,occurredAt:new Date("2026-08-20"),direction:"inflow"}))).rejects.toThrow("已认领");
    await expect(prisma.contractProxyBankClaim.delete({where:{observationId:incoming}})).rejects.toThrow("immutable");
  });

  it("复核在真实事务中幂等、分岗、并发单次确认且确认后不可覆盖", async () => {
    const f=await createFixture(prisma);
    const ids=[randomUUID(),randomUUID()];
    for(const id of ids)await prisma.projectAffiliateContractFact.create({data:{id,ledgerId:id,projectId:f.projectId,contractType:"material_purchase",externalContractReference:`EXT-${id}`,counterpartyName:"同一材料商",signedAt:new Date("2026-10-01"),amountNature:"fixed",amountCents:100000n,affiliateAssignmentId:f.assignmentId,affiliateBusinessPartyVersionId:f.partyVersionId,affiliateNameSnapshot:"挂靠建设集团",basisType:"oral",description:"隔离测试道路材料",idempotencyKey:randomUUID(),requestFingerprint:"a".repeat(64),recordedByUserId:f.recorderId,recordedByRoleKey:"contract_staff"}});
    const visibility={visibleProjectIdsInTransaction:async()=>[f.projectId],effectiveRoleKeysByProjectInTransaction:async(_tx:unknown,actor:string)=>new Map([[f.projectId,actor===f.directorId?["contract_director"]:["contract_staff","contract_director"]]])};
    const service=new ContractEconomicReviewService(prisma as never,visibility as never,{confirmPassword:async()=>undefined} as never,new AuditService(),{appendConfirmedSourceIfEnabledInTransaction:async()=>undefined} as never);
    const input={projectId:f.projectId,leftSourceRef:`affiliate:${ids[0]}`,rightSourceRef:`affiliate:${ids[1]}`,relation:"supplement",coverage:[{scope:"第一批材料",leftAmountCents:"40000",rightAmountCents:"40000",owner:"left"}],reason:"核对原件，部分覆盖",idempotencyKey:randomUUID(),confirmationPassword:"test-password"};
    const prepared=await service.prepare(f.recorderId,input);
    expect((await service.prepare(f.recorderId,input)).id).toBe(prepared.id);
    await expect(service.prepare(f.recorderId,{...input,reason:"改变了依据"})).rejects.toThrow("凭据已用于其他");
    await expect(service.decide(f.recorderId,prepared.id,{revision:1,decision:"confirm",confirmationPassword:"test-password"})).rejects.toThrow("须分离");
    const decisions=await Promise.allSettled([1,2].map(()=>service.decide(f.directorId,prepared.id,{revision:1,decision:"confirm",confirmationPassword:"test-password"})));
    expect(decisions.filter(r=>r.status==="fulfilled")).toHaveLength(1);
    expect((await prisma.contractEconomicReview.findUniqueOrThrow({where:{id:prepared.id}})).status).toBe("confirmed");
    expect(await prisma.auditLog.count({where:{businessId:prepared.id,action:"contract.economic_review.review"}})).toBe(1);
    await expect(prisma.contractEconomicReview.update({where:{id:prepared.id},data:{reason:"覆盖历史"}})).rejects.toThrow("不可删除或覆盖");
  });

  it("已生效履约复核必须分开完成合同与财务确认", async () => {
    const f=await createFixture(prisma);
    const financeId=randomUUID(); await prisma.user.create({data:{id:financeId,name:"隔离财务主管",isActive:true}});
    const row=await prisma.contractEconomicReview.create({data:{projectId:f.projectId,leftSourceRef:"contract:a",rightSourceRef:"contract:b",leftFingerprint:"a",rightFingerprint:"b",relation:"supplement",coverage:[],reason:"数据库分岗验证",preparedByUserId:f.recorderId,idempotencyKey:randomUUID(),requestFingerprint:"r",financeRequired:true}});
    await expect(prisma.contractEconomicReview.update({where:{id:row.id},data:{status:"confirmed",confirmedAt:new Date(),contractReviewedById:f.directorId}})).rejects.toThrow();
    await expect(prisma.contractEconomicReview.update({where:{id:row.id},data:{status:"confirmed",confirmedAt:new Date(),contractReviewedById:f.directorId,financeReviewedById:f.directorId}})).rejects.toThrow();
    await prisma.contractEconomicReview.update({where:{id:row.id},data:{status:"pending_finance",contractReviewedById:f.directorId,revision:2}});
    await prisma.contractEconomicReview.update({where:{id:row.id},data:{status:"confirmed",confirmedAt:new Date(),financeReviewedById:financeId,revision:3}});
    const coverage=await prisma.contractEconomicSettlementCoverage.create({data:{projectId:f.projectId,sourceRef:`settlement:${randomUUID()}`,contractRef:"contract:a",amountCents:100n,reviewFingerprint:"r",allocations:[{scopeKey:"uncovered",amountCents:"100"}],preparedByUserId:f.recorderId}});
    await prisma.contractEconomicSettlementCoverage.update({where:{id:coverage.id},data:{status:"confirmed",confirmedAt:new Date()}});
    await expect(prisma.contractEconomicSettlementCoverage.update({where:{id:coverage.id},data:{amountCents:101n}})).rejects.toThrow("immutable");
  });

  it("accepts only a complete signed confirmation and then rejects update and delete", async () => {
    const fixture = await createFixture(prisma);
    const contractId = randomUUID();
    await prisma.projectAffiliateCompanyContract.create({
      data: {
        id: contractId,
        projectId: fixture.projectId,
        contractReference: `GL-${contractId}`,
        contractName: "项目挂靠管理协议",
        amountNature: "fixed",
        amountCents: 800000000n,
        signedAt: new Date("2026-07-20T00:00:00.000Z"),
        rightsObligationsSummary: "双方已线下约定项目管理、资金核对与责任边界。",
        affiliateAssignmentId: fixture.assignmentId,
        affiliateBusinessPartyVersionId: fixture.partyVersionId,
        affiliateNameSnapshot: "挂靠建设集团",
        affiliateCreditCodeSnapshot: fixture.affiliateCreditCode,
        companyEntityId: fixture.companyId,
        companyEntityVersionId: fixture.companyVersionId,
        companyEntityNameSnapshot: "我方建设有限公司",
        companyEntityCreditCodeSnapshot: fixture.companyCreditCode,
        companyEntityRegisteredAddressSnapshot: "厦门市",
        fileId: fixture.contractFileId,
        fileContentSha256Snapshot: "a".repeat(64),
        idempotencyKey: randomUUID(),
        requestFingerprint: "b".repeat(64),
        recordedByUserId: fixture.recorderId,
        recordedByRoleKey: "contract_staff"
      }
    });

    expect((await prisma.projectAffiliateCompanyContract.findUniqueOrThrow({ where: { id: contractId } })).amountCents).toBe(800000000n);
    await expect(prisma.projectAffiliateCompanyContract.update({ where: { id: contractId }, data: { amountCents: 900000000n } })).rejects.toThrow("对上合同金额不可直接改写");

    await expect(
      prisma.$executeRaw(Prisma.sql`
        UPDATE "ProjectAffiliateCompanyContract"
        SET "status" = 'confirmed',
            "confirmedByUserId" = ${fixture.directorId},
            "confirmedAt" = NOW()
        WHERE "id" = ${contractId}
      `)
    ).rejects.toThrow("ProjectAffiliateCompanyContract_confirmation_check");

    await prisma.$executeRaw(Prisma.sql`
      UPDATE "ProjectAffiliateCompanyContract"
      SET "status" = 'confirmed',
          "confirmedByUserId" = ${fixture.directorId},
          "confirmedAt" = NOW(),
          "confirmationActionId" = ${randomUUID()},
          "confirmationSignatureVersionId" = ${fixture.signatureVersionId},
          "confirmationSignatureFileId" = ${fixture.signatureFileId},
          "confirmationSignatureSha256" = ${"c".repeat(64)}
      WHERE "id" = ${contractId}
    `);

    await expect(
      prisma.projectAffiliateCompanyContract.update({
        where: { id: contractId },
        data: { rightsObligationsSummary: "试图覆盖已确认权利义务" }
      })
    ).rejects.toThrow("confirmed affiliate-company contracts are append-only");
    await expect(
      prisma.projectAffiliateCompanyContract.delete({ where: { id: contractId } })
    ).rejects.toThrow("affiliate-company contracts cannot be deleted");
  });

  it("rejects reusing the same signed file for a second contract", async () => {
    const fixture = await createFixture(prisma);
    const firstId = randomUUID();
    const base = {
      projectId: fixture.projectId,
      contractName: "项目挂靠管理协议",
        amountNature: "uncapped",
      signedAt: new Date("2026-07-20T00:00:00.000Z"),
      rightsObligationsSummary: "双方已线下约定项目管理、资金核对与责任边界。",
      affiliateAssignmentId: fixture.assignmentId,
      affiliateBusinessPartyVersionId: fixture.partyVersionId,
      affiliateNameSnapshot: "挂靠建设集团",
      affiliateCreditCodeSnapshot: fixture.affiliateCreditCode,
      companyEntityId: fixture.companyId,
      companyEntityVersionId: fixture.companyVersionId,
      companyEntityNameSnapshot: "我方建设有限公司",
      companyEntityCreditCodeSnapshot: fixture.companyCreditCode,
      companyEntityRegisteredAddressSnapshot: "厦门市",
      fileId: fixture.contractFileId,
      fileContentSha256Snapshot: "a".repeat(64),
      requestFingerprint: "d".repeat(64),
      recordedByUserId: fixture.recorderId,
      recordedByRoleKey: "contract_staff"
    };
    await prisma.projectAffiliateCompanyContract.create({
      data: {
        id: firstId,
        contractReference: `GL-A-${firstId}`,
        idempotencyKey: randomUUID(),
        ...base
      }
    });

    await expect(
      prisma.projectAffiliateCompanyContract.create({
        data: {
          id: randomUUID(),
          contractReference: `GL-B-${firstId}`,
          idempotencyKey: randomUUID(),
          ...base
        }
      })
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("serializes advisory-to-company lock order without a deadlock", async () => {
    const fixture = await createFixture(prisma);
    const first = createTestClient();
    const second = createTestClient();
    const firstHasAdvisory = deferred<number>();
    const releaseFirst = deferred<void>();

    const firstTransaction = first.$transaction(async (tx) => {
      const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>(
        Prisma.sql`SELECT pg_backend_pid()::int AS "pid"`
      );
      await setLocalConcurrencyTimeouts(tx);
      await acquireTestFileBindingLock(tx);
      firstHasAdvisory.resolve(pid);
      await releaseFirst.promise;
      await lockTestCompany(tx, fixture.companyId);
      return "first";
    });

    const firstPid = await firstHasAdvisory.promise;
    const secondStarted = deferred<number>();
    const secondTransaction = second.$transaction(async (tx) => {
      const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>(
        Prisma.sql`SELECT pg_backend_pid()::int AS "pid"`
      );
      await setLocalConcurrencyTimeouts(tx);
      secondStarted.resolve(pid);
      await acquireTestFileBindingLock(tx);
      await lockTestCompany(tx, fixture.companyId);
      return "second";
    });

    try {
      const secondPid = await secondStarted.promise;
      await expectDirectBlocker(prisma, secondPid, firstPid);
    } finally {
      releaseFirst.resolve();
    }

    await expect(
      Promise.all([firstTransaction, secondTransaction])
    ).resolves.toEqual(["first", "second"]);
    await Promise.all([first.$disconnect(), second.$disconnect()]);
  });

  it("waits for an in-flight FileObject discard and refuses to bind the discarded row", async () => {
    const fixture = await createFixture(prisma);
    const discarder = createTestClient();
    const binder = createTestClient();
    const discardHasFileRow = deferred<number>();
    const releaseDiscard = deferred<void>();

    const discardTransaction = discarder.$transaction(async (tx) => {
      const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>(
        Prisma.sql`SELECT pg_backend_pid()::int AS "pid"`
      );
      await setLocalConcurrencyTimeouts(tx);
      await tx.$queryRaw(Prisma.sql`
        SELECT "id"
        FROM "FileObject"
        WHERE "id" = ${fixture.contractFileId}
        FOR UPDATE
      `);
      await tx.fileObject.update({
        where: { id: fixture.contractFileId },
        data: { storageStatus: "discarded" }
      });
      discardHasFileRow.resolve(pid);
      await releaseDiscard.promise;
    });

    const discardPid = await discardHasFileRow.promise;
    const binderStarted = deferred<number>();
    const servicePrisma = withTransactionPidProbe(binder, (pid) =>
      binderStarted.resolve(pid)
    );
    const service = new ProjectAffiliateCompanyContractService(
      servicePrisma as never,
      { record: jest.fn() } as never
    );
    const bindOutcome = service
      .record(fixture.projectId, fixture.recorderId, {
        contractReference: `GL-CONCURRENCY-${randomUUID()}`,
        contractName: "项目挂靠管理协议",
        amountNature: "uncapped",
        signedAt: "2026-07-20",
        rightsObligationsSummary:
          "双方已线下约定项目管理、资金核对与责任边界。",
        companyEntityId: fixture.companyId,
        fileId: fixture.contractFileId,
        idempotencyKey: randomUUID()
      })
      .then(
        (value) => ({ status: "resolved" as const, value }),
        (error: unknown) => ({ status: "rejected" as const, error })
      );

    try {
      const binderPid = await binderStarted.promise;
      await expectDirectBlocker(prisma, binderPid, discardPid);
    } finally {
      releaseDiscard.resolve();
    }

    await discardTransaction;
    const outcome = await bindOutcome;
    expect(outcome.status).toBe("rejected");
    if (outcome.status !== "rejected") {
      throw new Error("discarded FileObject was unexpectedly bound");
    }
    expect(outcome.error).toBeInstanceOf(BadRequestException);
    await expect(
      prisma.projectAffiliateCompanyContract.count({
        where: { fileId: fixture.contractFileId }
      })
    ).resolves.toBe(0);
    await Promise.all([discarder.$disconnect(), binder.$disconnect()]);
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function withTransactionPidProbe(
  client: PrismaClient,
  onTransactionPid: (pid: number) => void
) {
  return new Proxy(client, {
    get(target, property) {
      if (property === "$transaction") {
        return (
          work: (tx: Prisma.TransactionClient) => Promise<unknown>
        ) =>
          target.$transaction(async (tx) => {
            const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>(
              Prisma.sql`SELECT pg_backend_pid()::int AS "pid"`
            );
            await setLocalConcurrencyTimeouts(tx);
            onTransactionPid(pid);
            return work(tx);
          });
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

async function setLocalConcurrencyTimeouts(tx: Prisma.TransactionClient) {
  await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5s'");
  await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '8s'");
}

function acquireTestFileBindingLock(tx: Prisma.TransactionClient) {
  return tx.$queryRaw(Prisma.sql`
    SELECT pg_advisory_xact_lock(190731::int, 13::int)::text AS "lockResult"
  `);
}

function lockTestCompany(
  tx: Prisma.TransactionClient,
  companyEntityId: string
) {
  return tx.$queryRaw(Prisma.sql`
    SELECT "id"
    FROM "CompanyEntity"
    WHERE "id" = ${companyEntityId}
    FOR UPDATE
  `);
}

async function expectDirectBlocker(
  monitor: PrismaClient,
  blockedPid: number,
  expectedBlockerPid: number
) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const [row] = await monitor.$queryRaw<Array<{ blockerPids: number[] }>>(
      Prisma.sql`
        SELECT pg_blocking_pids(${blockedPid}::int)::int[] AS "blockerPids"
      `
    );
    if (row?.blockerPids.includes(expectedBlockerPid)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `backend ${blockedPid} was not directly blocked by ${expectedBlockerPid}`
  );
}

async function createFixture(prisma: PrismaClient) {
  const suffix = randomUUID();
  const recorderId = `contract-recorder-${suffix}`;
  const directorId = `contract-director-${suffix}`;
  const projectId = `project-${suffix}`;
  const partyId = `party-${suffix}`;
  const partyVersionId = `party-version-${suffix}`;
  const assignmentId = `assignment-${suffix}`;
  const companyId = `company-${suffix}`;
  const companyVersionId = `company-version-${suffix}`;
  const contractFileId = `contract-file-${suffix}`;
  const signatureFileId = `signature-file-${suffix}`;
  const signatureVersionId = `signature-version-${suffix}`;
  const affiliateCreditCode = `AFFILIATE-${suffix}`;
  const companyCreditCode = `COMPANY-${suffix}`;

  await prisma.user.createMany({
    data: [
      { id: recorderId, name: "合同人员", isActive: true },
      { id: directorId, name: "合同主管", isActive: true }
    ]
  });
  await prisma.project.create({
    data: { id: projectId, code: `P-${suffix}`, name: "隔离迁移测试项目" }
  });
  await prisma.projectMember.create({
    data: {
      projectId,
      userId: recorderId,
      positionKey: "contract_staff"
    }
  });
  await prisma.businessParty.create({
    data: {
      id: partyId,
      name: "挂靠建设集团",
      normalizedName: `挂靠建设集团-${suffix}`,
      unifiedSocialCreditCode: affiliateCreditCode,
      createdByUserId: recorderId
    }
  });
  await prisma.businessPartyVersion.create({
    data: {
      id: partyVersionId,
      businessPartyId: partyId,
      versionNo: 1,
      snapshot: {
        name: "挂靠建设集团",
        unifiedSocialCreditCode: affiliateCreditCode
      },
      createdByUserId: recorderId
    }
  });
  await prisma.projectAffiliateAssignment.create({
    data: {
      id: assignmentId,
      projectId,
      businessPartyId: partyId,
      businessPartyVersionId: partyVersionId,
      affiliateNameSnapshot: "挂靠建设集团",
      affiliateCreditCodeSnapshot: affiliateCreditCode,
      effectiveFrom: new Date("2026-07-01T00:00:00.000Z"),
      changeReason: "隔离数据库约束验证",
      assignedByUserId: recorderId
    }
  });
  await prisma.companyEntity.create({
    data: {
      id: companyId,
      name: "我方建设有限公司",
      unifiedSocialCreditCode: companyCreditCode,
      registeredAddress: "厦门市",
      dataStatus: "complete",
      currentVersionNo: 1,
      isActive: true
    }
  });
  await prisma.companyEntityVersion.create({
    data: {
      id: companyVersionId,
      companyEntityId: companyId,
      versionNo: 1,
      name: "我方建设有限公司",
      unifiedSocialCreditCode: companyCreditCode,
      registeredAddress: "厦门市",
      isActive: true,
      action: "create",
      actorUserId: recorderId,
      actorRoleKey: "contract_staff"
    }
  });
  await prisma.fileObject.createMany({
    data: [
      {
        id: contractFileId,
        bucket: "private-local",
        objectKey: `tests/${contractFileId}.pdf`,
        originalName: "挂靠管理协议.pdf",
        mimeType: "application/pdf",
        sizeBytes: 100,
        uploadedByUserId: recorderId,
        contentSha256: "a".repeat(64),
        storageStatus: "active"
      },
      {
        id: signatureFileId,
        bucket: "private-local",
        objectKey: `tests/${signatureFileId}.png`,
        originalName: "合同主管签名.png",
        mimeType: "image/png",
        sizeBytes: 100,
        uploadedByUserId: directorId,
        contentSha256: "c".repeat(64),
        storageStatus: "active"
      }
    ]
  });
  await prisma.handwrittenSignatureVersion.create({
    data: {
      id: signatureVersionId,
      userId: directorId,
      fileId: signatureFileId,
      contentSha256: "c".repeat(64),
      source: "canvas"
    }
  });

  return {
    recorderId,
    directorId,
    projectId,
    partyVersionId,
    assignmentId,
    companyId,
    companyVersionId,
    contractFileId,
    signatureFileId,
    signatureVersionId,
    affiliateCreditCode,
    companyCreditCode
  };
}
