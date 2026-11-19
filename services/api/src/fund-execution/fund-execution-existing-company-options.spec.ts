import { createHash } from "node:crypto";
import { FundExecutionSelectionOptionsService } from "./fund-execution-selection-options.service";
import { FundExecutionSelectionRefService } from "./fund-execution-selection-ref.service";
import { ProjectFundingAvailabilityService } from "../project-funding/project-funding-availability.service";

function existingDebtFixture(directoryActive = false, confirmed = true, accountValid = true, sourceFault = "") {
  const occurredAt=new Date("2026-11-04T04:00:00.000Z");
  const payable={id:"old-payable",confirmedVersionId:"wage-confirmed-v1",projectAllocationId:"project-allocation",creditorBreakdownId:"creditor",debtorCompanyId:"old-company",projectId:"p1",amountCents:1000n,direction:"increase",adjustsPayableRefId:null,debtorCompanySnapshot:{companyId:"old-company"},projectSnapshot:{projectId:"p1"},creditorSnapshot:{subjectType:"business_party",identityKey:"business_party:creditor-version",name:"历史债权人"},creditorBreakdown:{creditorSubjectType:"business_party",creditorSubjectIdentityKey:"business_party:creditor-version",creditorNameSnapshot:"历史债权人"},confirmedVersion:{status:confirmed?"confirmed":"draft"},adjustments:[]};
  const company={id:"old-company",name:"历史债务公司",unifiedSocialCreditCode:"91350211M000100Y46",isActive:directoryActive};
  const actualCompany = sourceFault === "proxy" ? {...company,id:"actual-company",name:"既有代付公司"} : company;
  const observation={id:"observation",reference:"bank-reference",payerVerificationId:"verified-account",holderCompanyEntityId:actualCompany.id,holderNameSnapshot:actualCompany.name,holderCreditCodeSnapshot:actualCompany.unifiedSocialCreditCode,verificationEvidenceFileId:"bank-proof",verificationEvidenceContentSha256:"a".repeat(64),verificationReference:"bank-check",transactionSourceType:"contract_bank_verification",transactionSourceId:"bank-request",transactionEvidenceFileId:"transaction-proof",transactionEvidenceContentSha256:"b".repeat(64),occurredAt,amountCents:1000n,direction:"outflow",currencyCode:"CNY"};
  const empty=()=>({findMany:async()=>[],count:async()=>0});
  const tx={
    fundExecutionCase:{findFirst:async()=>({id:"case",caseKey:"case-key",status:"draft",revision:1,fundExecutionId:"execution"})},
    fundExecution:{findUnique:async()=>({id:"execution",executionKind:"bank_transaction",direction:"outflow",currencyCode:"CNY",amountCents:sourceFault === "amount" ? 999n : 1000n,occurredAt})},
    bankTransactionClaim:{findUnique:async()=>sourceFault === "missing_claim" ? null : ({observationId:"observation",fundExecutionId:"execution",targetType:"fund_execution"})},verifiedBankTransactionObservation:{findUnique:async()=>observation},
    paymentExecutionPayerVerification:{findUnique:async()=>({id:"verified-account",status:accountValid?"verified":"revoked",sourceType:"bank_account_legal_holder",sourceRecordId:"bank-account-source",holderCompanyEntityId:actualCompany.id,holderNameSnapshot:actualCompany.name,holderCreditCodeSnapshot:actualCompany.unifiedSocialCreditCode,verificationEvidenceFileId:observation.verificationEvidenceFileId,verificationEvidenceContentSha256:observation.verificationEvidenceContentSha256})},
    fileObject:{findUnique:async()=>({id:"bank-proof",storageStatus:"active",contentSha256:"a".repeat(64)})},
    contractBankVerificationRequest:{findUnique:async()=>({projectId:"p1",status:"confirmed"})},
    wagePayableRef:{findMany:async()=>[payable]},
    project:{findMany:async()=>[{id:"p1",name:"收尾项目"}],findUnique:async()=>({id:"p1",isActive:true})},
    companyEntity:{findMany:async({where}:{where:{isActive?:boolean}})=>where.isActive&&!directoryActive?[]:[company],findUnique:async({where}:{where:{id:string}})=>where.id===actualCompany.id?actualCompany:where.id===company.id?company:null},
    projectAffiliateAssignment:{findFirst:async()=>({id:"affiliate",businessPartyVersionId:"affiliate-version",affiliateNameSnapshot:"施工企业",affiliateCreditCodeSnapshot:"affiliate-credit"})},
    projectParticipatingCompany:{findFirst:async()=>({id:"participant",companyEntityId:actualCompany.id,companyEntityVersionId:"company-v1",companyNameSnapshot:actualCompany.name,companyCreditCodeSnapshot:actualCompany.unifiedSocialCreditCode})},
    projectReceipt:{findMany:async()=>[{amountCents:1000n}]},projectUpstreamFundFact:empty(),projectFinancingQuota:empty(),projectFundingAllocation:empty(),
    payableSettlementAllocation:empty(),paymentExecutionAllocation:empty(),interEntityRelationshipEntry:empty(),contractProxyExecution:empty(),
    $queryRaw:async(query:{strings:readonly string[]; values: readonly unknown[]})=>{
      const sql=query.strings.join("?");
      if(sql.includes("public.digest"))return (JSON.parse(String(query.values[0])) as unknown[]).map((value,index)=>({ordinal:BigInt(index+1),fingerprint:createHash("sha256").update(JSON.stringify(value)).digest("hex")}));
      if(sql.includes('FROM "User"'))return [{id:"finance"}];
      if(sql.includes('FROM "Project"'))return [{id:"p1"}];
      if(sql.includes('FROM "ProjectFinancingQuota"'))return [];
      if(sql.includes('AS amount'))return [{amount:0n}];
      if(sql.includes('PayableSettlementAllocation'))return [];
      throw new Error(`Unmodelled synthetic DB read: ${sql.slice(0,140)}`);
    }
  };
  const db={...tx,$transaction:async(run:(tx:object)=>unknown)=>run(tx)};
  const service=new FundExecutionSelectionOptionsService(db as never,new FundExecutionSelectionRefService(),new ProjectFundingAvailabilityService());
  return {service,tx,payable,company};
}

it("已确认历史债务不会因目录停用从公开资金候选消失，原签名候选仍可选择",async()=>{
  const f=existingDebtFixture();const now=new Date("2026-11-05T10:00:00Z");
  const plans=await f.service.listCasePlans("case-key","finance",now);
  expect(plans.length).toBeGreaterThan(0);
  const refs=plans[0]!.lines.flatMap(line=>line.axes.map(axis=>axis.selectionRef));
  expect(refs).toHaveLength(4);
  await expect(f.service.resolveCasePlanInTransaction(f.tx as never,{caseKey:"case-key",actorUserId:"finance",expectedRevision:1,selectionRefs:refs,now})).resolves.toHaveLength(4);
});

it("历史主体目录停用后，撤销的账户核验不能继续提供可选资金方案",async()=>{
  const f=existingDebtFixture(false,true,false);
  await expect(f.service.listCasePlans("case-key","finance")).rejects.toThrow();
});
it("没有已确认债务来源时不因存在公司与草稿而提供候选",async()=>{
  const f=existingDebtFixture(false,false,true);
  await expect(f.service.listCasePlans("case-key","finance")).rejects.toThrow();
});

it("真实出款B已由不可变执行和银行占用冻结、目录停用后仍可为已确认旧债A继续待分类代付",async()=>{
  const f=existingDebtFixture(false,true,true,"proxy");
  const now=new Date("2026-11-05T10:00:00Z");
  const plans=await f.service.listCasePlans("case-key","finance",now);
  expect(plans[0]!.lines[0]!.axes.find(axis=>axis.axis==="relationship")).toMatchObject({status:"applied"});
  const refs=plans[0]!.lines.flatMap(line=>line.axes.map(axis=>axis.selectionRef));
  await expect(f.service.resolveCasePlanInTransaction(f.tx as never,{caseKey:"case-key",actorUserId:"finance",expectedRevision:1,selectionRefs:refs,now})).resolves.toHaveLength(4);
});
it.each(["missing_claim","amount"])("无可靠既有实际出款来源%s时不得为停用主体生成候选",async(fault)=>{
  const f=existingDebtFixture(false,true,true,fault);
  await expect(f.service.listCasePlans("case-key","finance")).rejects.toThrow();
});
