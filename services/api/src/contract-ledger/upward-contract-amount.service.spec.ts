import { createHash } from "node:crypto";
import { UpwardContractAmountService } from "./upward-contract-amount.service";

it.each(["commit","rollback","replay"] as const)("对上金额登记原事务与短信意图共用结果 (%s)",async phase=>{
  const phases:string[]=[];
  const input={projectId:"project",contractId:"contract",amountNature:"fixed" as const,amountCents:"125",
    effectiveAt:"2026-11-09",reason:"合成用途",evidenceFileId:"file",idempotencyKey:"key",confirmationPassword:"synthetic"};
  const requestFingerprint=createHash("sha256").update(JSON.stringify({...input,confirmationPassword:undefined,actor:"author"})).digest("hex");
  const row={id:"revision",projectId:"project",recordedByUserId:"author",status:"pending_confirm"};
  const tx={
    $queryRaw:jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([])
      .mockResolvedValueOnce([{state:"absent",ownerSettlementVoucher:false}]).mockResolvedValue([]),
    projectAffiliateCompanyContract:{findFirst:async()=>({id:"contract",signedAt:new Date("2026-11-08")})},
    upwardContractAmountRevision:{
      findUnique:async()=>phase==="replay"?{...row,requestFingerprint}:null,
      findFirst:async()=>null,count:async()=>0,create:async()=>row
    },
    fileObject:{findUnique:async()=>({id:"file",uploadedByUserId:"author",storageStatus:"active",contentSha256:"a".repeat(64)})}
  };
  const visibility={
    visibleProjectIdsInTransaction:async()=>["project"],
    effectiveRoleKeysByProjectInTransaction:async()=>new Map([["project",["contract_staff"]]])
  };
  const prisma={$transaction:async(run:(db:typeof tx)=>Promise<unknown>)=>{
    const result=await run(tx);
    if(phase==="rollback")throw new Error("合成提交失败");
    phases.push("commit");
    return result;
  }};
  const notices={queue:jest.fn().mockImplementation(async()=>{phases.push("queue");}),
    afterCommit:jest.fn().mockImplementation(async()=>{phases.push("dispatch");})};
  const service=new UpwardContractAmountService(prisma as never,visibility as never,
    {confirmPassword:async()=>undefined} as never,{record:async()=>undefined} as never,notices as never);
  if(phase==="rollback")await expect(service.prepare("author",input)).rejects.toThrow("合成提交失败");
  else await expect(service.prepare("author",input)).resolves.toEqual({id:"revision",status:"pending_confirm"});
  if(phase==="replay")expect(notices.queue).not.toHaveBeenCalled();
  else expect(notices.queue).toHaveBeenCalledWith(tx,row);
  expect(phases).toEqual(phase==="commit"?["queue","commit","dispatch"]:phase==="replay"?["commit","dispatch"]:["queue"]);
});
