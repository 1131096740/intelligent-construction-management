import { Prisma } from "@prisma/client";
import { SettlementService } from "../settlement/settlement.service";
import { PaymentRequestService } from "../payment/payment-request.service";
import { PaymentAmountService } from "../payment/payment-amount.service";
import { randomUUID } from "node:crypto";
import { ProjectCloseProfitService } from "../project-close-profit/project-close-profit.service";
import { OperatingProjectionService } from "../operating-projection/operating-projection.service";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { ClearingReconciliationReaderService } from "../clearing/clearing-reconciliation-reader.service";
import { CompanyRoleResolverService } from "../auth/company-role-resolver.service";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";

// A database boundary only. Domain projections, current roles, completion and audit are real services.
function completionFixture() {
  const now = new Date("2026-11-05T10:00:00.000Z");
  const project = { id: "p1", code: "P01", name: "完工后继续收尾项目", isActive: true };
  const stages: Array<Record<string, unknown>> = [];
  const receipts: Array<Record<string, unknown>> = [];
  const audit: Array<Record<string, unknown>> = [];
  const empty = () => ({ findMany: async () => [], count: async () => 0 });
  const client = {
    project: { findMany: async ({where}: {where?: {id?: {in?:string[]}}}={}) => !where?.id?.in || where.id.in.includes(project.id) ? [{...project}] : [], findUnique: async ({where}: {where:{id:string}}) => where.id===project.id ? {...project} : null },
    userPosition: { findMany: async () => [] }, position: { findMany: async () => [] },
    projectMember: {findMany: async ({where}: {where:{userId:string;projectId?:string|{in:string[]}}}) => where.userId === "manager" ? [{projectId:"p1",userId:"manager",positionKey:"project_manager"}] : []},
    projectRosterMember: empty(), projectAffiliateAssignment: empty(), projectParticipatingCompany: empty(), companyEntityVersion:empty(),
    clearingCase:empty(), operatingFact:empty(),operatingImpactEntry:empty(), interEntityRelationshipEntry:empty(),companyTransfer:empty(),companyTransferEvent:empty(),
    projectNecessaryExpenseReserveEntry:empty(),projectFundDisputeEntry:empty(),projectNecessaryExpenseReserveReplacement:empty(),projectFundDisputeReplacement:empty(),
    $queryRaw: async (query: { strings: readonly string[] }) => {
      const sql=query.strings.join("?");
      if(sql.includes("CURRENT_TIMESTAMP")) return [{readAt:now}];
      if(sql.includes("ordinary_facts"))return [{workFactCount:0n,workImpactCount:0n,workBytes:0n,targetCount:0n}];
      if(sql.includes("candidate_ids"))return [{replacementCount:0n,snapshotBytes:0n,maxSnapshotBytes:0}];
      if(sql.includes('FROM "Project"')||sql.includes('FROM "ProjectCloseAggregate"'))return [{id:"p1",projectId:"p1"}];
      if(sql.includes("pg_advisory"))return [];
      throw new Error(`Unexpected synthetic DB query: ${sql.slice(0,160)}`);
    },
    projectCloseAggregate:{upsert:async()=>({projectId:"p1",revision:0}),update:async()=>({projectId:"p1",revision:1})},
    projectCloseStageVersion:{findMany:async()=>stages.map(x=>({...x})),create:async({data}:{data:Record<string,unknown>})=>{const row={id:randomUUID(),...data};stages.push(row);return row;}},
    projectCloseCommandReceipt:{findUnique:async({where}:{where:{idempotencyKey:string}})=>receipts.find(r=>r.idempotencyKey===where.idempotencyKey)??null,create:async({data}:{data:Record<string,unknown>})=>{receipts.push(data);return data;}},
    auditLog:{create:async({data}:{data:Record<string,unknown>})=>{audit.push(data);return data;}}
  };
  const db={...client,$transaction:async(run:(tx:typeof client)=>unknown)=>run(client)} as unknown as PrismaService;
  const visibility=new ProjectVisibilityService(db);const roles=new CompanyRoleResolverService(db);const auditService=new AuditService(db);
  const projections=new OperatingProjectionService(db,visibility,new ClearingReconciliationReaderService(db,roles),auditService,undefined as never);
  const completion=new ProjectCloseProfitService(db,projections,visibility,auditService);
  return {db,client,project,stages,receipts,audit,projections,completion};
}

it("项目经理通过真实公共投影和完工服务确认第一阶段，保持启用及历史投影可读",async()=>{
  const f=completionFixture();
  const before=await f.projections.readProjectInTransaction(f.client as never,"manager",{projectId:"p1"});
  const input={stageKey:"construction_completed" as const,expectedProjectionFingerprint:before.fingerprint,idempotencyKey:randomUUID(),basis:{summary:"现场工程已完成，仍办理结算尾款",evidenceFileIds:[]}};
  const result=await f.completion.completeStage("manager","p1",input);
  expect(result).toMatchObject({stageKey:"construction_completed",status:"completed",revision:1});
  await expect(f.completion.completeStage("manager","p1",input)).resolves.toEqual(result);
  expect(f.project.isActive).toBe(true);
  expect(f.stages).toHaveLength(1);expect(f.receipts).toHaveLength(1);
  await expect(f.projections.readProjectInTransaction(f.client as never,"manager",{projectId:"p1"})).resolves.toMatchObject({fingerprint:before.fingerprint});
  await expect(f.completion.completeStage("outsider","p1",{...input,idempotencyKey:randomUUID()})).rejects.toThrow("无权");
});

it("工程完工后，同一项目的合同员仍可提交新结算、财务仍可基于原生效结算申请付款",async()=>{
  const f=completionFixture();
  const originalQuery=f.client.$queryRaw;
  const version={id:"contract-v1",contractId:"contract-1",versionNo:1,status:"effective",changeType:"original",baseVersionId:null,changeDirection:null,changeAmountCents:null,cumulativeIncreaseCents:0n,amountCents:100000n,pricingNature:"fixed_total",amountLimitType:"capped",effectiveAt:new Date("2026-01-01T00:00:00Z"),invoiceType:"vat_special",defaultTaxRatePercent:new Prisma.Decimal("13"),taxFactStatus:"frozen",taxFactRevision:1,signingSubjectType:"our_company"};
  const oldEffectiveSettlement={id:"old-effective-settlement",code:"JS-OLD",projectId:"p1",contractId:"contract-1",contractVersionId:"contract-v1",paymentTermsVersionId:"terms",status:"effective",amountCents:10000n,payableAmountCents:8000n,paidAmountCents:0n};
  const createdSettlements:Array<Record<string,unknown>>=[];
  const payments:Array<Record<string,unknown>>=[];
  Object.assign(f.client,{
    contractVersion:{findUnique:async()=>version,findFirst:async()=>version,findMany:async()=>[version]},
    contract:{findUnique:async()=>({id:"contract-1",projectId:"p1",contractTypeKey:"material_purchase"})},
    paymentTermsVersion:{findFirst:async()=>({id:"terms",status:"effective"})},paymentTermsStage:{findFirst:async()=>({id:"terms-stage",ratioBps:8000})},
    settlement:{findFirst:async()=>null,findMany:async()=>[],findUnique:async()=>oldEffectiveSettlement,create:async({data}:{data:Record<string,unknown>})=>{const row={id:"new-settlement",...data};createdSettlements.push(row);return row;}},
    paymentRequest:{findMany:async()=>[],create:async({data}:{data:Record<string,unknown>})=>{const row={id:"new-payment",...data};payments.push(row);return row;}},
    projectUpstreamSettlement:{findMany:async()=>[{approvedAmountCents:100000n}]},projectSettlementExceptionQuota:{findMany:async()=>[]},projectSettlementExceptionQuotaUsage:{findMany:async()=>[],createMany:async()=>({count:0}),updateMany:async()=>({count:0})},
    contractDuePaymentSettlementAllocation:{findMany:async()=>[]},contractProxyExecution:{findMany:async()=>[]},
    approvalInstance:{create:async({data}:{data:object})=>({id:randomUUID(),...data})},
    $queryRaw:async(query:{strings:readonly string[]})=>{
      const sql=query.strings.join("?");
      if(sql.includes("WITH members"))return [{projectId:"p1",userId:"contractstaff",roleKey:"contract_staff",userIsActive:true},{projectId:"p1",userId:"manager",roleKey:"project_manager",userIsActive:true}];
      if(sql.includes('FROM "UserPosition"'))return ["finance_director","chairman","general_manager","comprehensive_director"].map(roleKey=>({userId:roleKey,roleKey}));
      if(sql.includes('FROM "Settlement"'))return [];
      if(sql.includes('FROM "ContractVersion"'))return [{id:"contract-v1"}];
      if(sql.includes('FROM "Contract"'))return [{id:"contract-1"}];
      return originalQuery(query);
    }
  });
  const before=await f.projections.readProjectInTransaction(f.client as never,"manager",{projectId:"p1"});
  await f.completion.completeStage("manager","p1",{stageKey:"construction_completed",expectedProjectionFingerprint:before.fingerprint,idempotencyKey:randomUUID(),basis:{summary:"仅工程完工，结算付款继续",evidenceFileIds:[]}});
  const settlement=await new SettlementService(f.db,new AuditService(f.db)).create({contractVersionId:"contract-v1",code:"JS-AFTER-COMPLETION",periodLabel:"2026-11",amountCents:"10000"},"contractstaff");
  expect(settlement).toMatchObject({code:"JS-AFTER-COMPLETION",status:"approval_pending",amountCents:"10000",payableAmountCents:"8000"});
  const payment=await new PaymentRequestService(new PaymentAmountService(),f.db,new AuditService(f.db)).create({settlementId:"old-effective-settlement",code:"FK-AFTER-COMPLETION",requestedAmountCents:"5000"},"finance");
  expect(payment).toMatchObject({code:"FK-AFTER-COMPLETION",status:"approval_pending",requestedAmountCents:"5000",paidAmountCents:"0"});
  expect(createdSettlements).toHaveLength(1);expect(payments).toHaveLength(1);expect(f.project.isActive).toBe(true);
  await expect(f.projections.readProjectInTransaction(f.client as never,"manager",{projectId:"p1"})).resolves.toMatchObject({fingerprint:before.fingerprint});
});
