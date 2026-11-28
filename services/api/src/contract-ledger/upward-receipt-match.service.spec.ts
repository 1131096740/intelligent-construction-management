import { createHash } from "node:crypto";
import { UpwardReceiptMatchService } from "./upward-receipt-match.service";

it.each(["commit","rollback","replay"] as const)("原核销登记与通知意图共用原事务 (%s)",async phase=>{
 const phases:string[]=[];
 const settled=new Date("2026-11-04");
 const input={projectId:"project",receiptFactId:"receipt",settlementLedgerId:"settlement",originalId:"original",
  amountCents:"125",occurredAt:"2026-11-09",reason:"合成用途",idempotencyKey:"key",confirmationPassword:"synthetic"};
 const requestFingerprint=createHash("sha256").update(JSON.stringify({...input,confirmationPassword:undefined,actor:"author"})).digest("hex");
 const row={id:"match",projectId:"project",status:"pending_confirm",recordedByUserId:"author"};
 const receipt={id:"receipt",fundExecutionId:"execution",payeeSubjectKind:"participating_company",payeeSubjectId:"company",
  affiliateAssignmentId:"assignment",affiliateBusinessPartyVersionId:"party",affiliateNameSnapshot:"合成施工企业",occurredAt:settled,
  impacts:[{impactKind:"company_project_funds_increase",direction:"increase"}]};
 const tx={
  $queryRaw:jest.fn().mockResolvedValue([]),
  operatingFact:{findFirst:async()=>receipt},
  fundExecution:{count:async()=>0},
  projectAffiliateSettlementFact:{findMany:async()=>[{entryKind:"original",affiliateCompanyContractId:"contract",
    ledgerId:"settlement",periodLabel:"合成结算",settledAt:settled}]},
  projectAffiliateCompanyContract:{findUnique:async()=>({id:"contract",companyEntityId:"company",
    companyEntityNameSnapshot:"合成公司",affiliateAssignmentId:"assignment"})},
  project:{findUniqueOrThrow:async()=>({operatingLedgerEffectiveDate:settled})},
  upwardReceiptMatch:{
    findUnique:async()=>phase==="replay"?{...row,requestFingerprint}:null,
    findFirst:async()=>({id:"original",occurredAt:settled,amountCents:125n}),
    aggregate:async()=>({_sum:{amountCents:0n}}),create:async()=>row
  }
 };
 const visibility={
  visibleProjectIdsInTransaction:async()=>["project"],
  effectiveRoleKeysByProjectInTransaction:async()=>new Map([["project",["finance_staff"]]])
 };
 const prisma={$transaction:async(run:(db:typeof tx)=>Promise<unknown>)=>{
  const result=await run(tx);
  if(phase==="rollback")throw new Error("合成提交失败");
  phases.push("commit");return result;
 }};
 const notices={queue:jest.fn().mockImplementation(async()=>{phases.push("queue");}),
  afterCommit:jest.fn().mockImplementation(async()=>{phases.push("dispatch");})};
 const service=new UpwardReceiptMatchService(prisma as never,visibility as never,
  {confirmPassword:async()=>undefined} as never,{record:async()=>undefined} as never,{} as never,notices as never);
 if(phase==="rollback")await expect(service.prepare("author",input)).rejects.toThrow("合成提交失败");
 else await expect(service.prepare("author",input)).resolves.toEqual({id:"match",status:"pending_confirm"});
 if(phase==="replay")expect(notices.queue).not.toHaveBeenCalled();
 else expect(notices.queue).toHaveBeenCalledWith(tx,row);
 expect(phases).toEqual(phase==="commit"?["queue","commit","dispatch"]:phase==="replay"?["commit","dispatch"]:["queue"]);
});
