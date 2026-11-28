import {ContractProxyExecutionService} from "./contract-proxy-execution.service";
it("银行办理候选包括本项目既有表内合同法人，不要求迁移或补造参与关系",async()=>{
 const tx={contractBankVerificationRequest:{findMany:jest.fn().mockResolvedValue([])},contract:{findMany:jest.fn().mockResolvedValue([{id:"contract"}])},contractVersion:{findMany:jest.fn().mockResolvedValue([{companyEntityIdSnapshot:"original-company"}])},projectParticipatingCompany:{findMany:jest.fn().mockResolvedValue([])},projectAffiliateAssignment:{findFirst:jest.fn().mockResolvedValue(null)},bankTransactionClaim:{findMany:jest.fn().mockResolvedValue([])},contractProxyBankClaim:{findMany:jest.fn().mockResolvedValue([])},companyTransferBankClaim:{count:jest.fn().mockResolvedValue(0),findMany:jest.fn().mockResolvedValue([])},contractBankEventClaim:{findMany:jest.fn().mockResolvedValue([])},verifiedBankTransactionObservation:{findMany:jest.fn().mockResolvedValue([{reference:"bank-reference",holderNameSnapshot:"原签约公司",direction:"outflow",amountCents:100n,occurredAt:new Date("2026-08-01")}])}};
 const service=new ContractProxyExecutionService({$transaction:async(f:(t:unknown)=>Promise<unknown>)=>f(tx)} as never,{visibleProjectIdsInTransaction:async()=>["project"],effectiveRoleKeysByProjectInTransaction:async()=>new Map([["project",["finance_staff"]]])} as never,{} as never,{} as never,{} as never,{} as never);
 expect(await service.bankOptions("finance","project")).toEqual([expect.objectContaining({value:"bank-reference"})]);expect(tx.verifiedBankTransactionObservation.findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({holderCompanyEntityId:{in:["original-company"]}})}));
 await expect(service.decide("finance","id",undefined as never)).rejects.toThrow("处理动作");
});

it.each(["commit","rollback"] as const)("原代付退款登记与通知意图共用原事务 (%s)",async phase=>{
 const phases:string[]=[];
 const occurredAt=new Date("2026-11-09");
 const row={id:"proxy",projectId:"project",status:"pending_confirm",recordedByUserId:"author"};
 const tx={
  $queryRaw:jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{amount:0n}]).mockResolvedValueOnce([])
   .mockResolvedValueOnce([{state:"absent",ownerSettlementVoucher:false}]).mockResolvedValue([]),
  contractProxyExecution:{
   findUnique:async()=>null,findFirst:async()=>({
    id:"original",sourceRef:"settlement:original",amountCents:125n,occurredAt,status:"confirmed",
    frozenSource:{actualPayer:{kind:"construction_enterprise",id:"payer"},payee:{kind:"downstream_counterparty",id:"payee"},debtor:{kind:"participating_company",id:"debtor"}}
   }),aggregate:async()=>({_sum:{amountCents:0n}}),create:async()=>row
  },
  fileObject:{findUnique:async()=>({id:"file",uploadedByUserId:"author",storageStatus:"active",contentSha256:"a".repeat(64)})}
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
 const service=new ContractProxyExecutionService(prisma as never,visibility as never,
  {confirmPassword:async()=>undefined} as never,{record:async()=>undefined} as never,{} as never,{} as never,notices as never);
 const action=()=>service.prepare("author",{projectId:"project",sourceRef:"settlement:original",entryKind:"refund",originalId:"original",
  amountCents:"125",occurredAt:"2026-11-09",actualPayerKey:"downstream_counterparty:payee",bankReference:"合成凭据",
  evidenceFileId:"file",reason:"合成用途",idempotencyKey:"key",confirmationPassword:"synthetic"});
 if(phase==="rollback")await expect(action()).rejects.toThrow("合成提交失败");
 else await expect(action()).resolves.toEqual({id:"proxy",status:"pending_confirm"});
 expect(notices.queue).toHaveBeenCalledWith(tx,row);
 expect(phases).toEqual(phase==="commit"?["queue","commit","dispatch"]:["queue"]);
});
