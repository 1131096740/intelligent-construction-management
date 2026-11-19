import {CompanyTransferService} from "./company-transfer.service";

it.each(["committed","aborted"] as const)("公司互转终审意图随原申请事务提交 (%s)",async outcome=>{
 const phases:string[]=[];
 const candidates=[{id:"candidate",key:"chairman"}];
 const company={id:"company",name:"合成公司",isActive:true,unifiedSocialCreditCode:"合成档案"};
 const tx={
  $queryRaw:jest.fn().mockResolvedValueOnce([{key:"finance_staff"}]).mockResolvedValue(candidates),
  $executeRaw:jest.fn().mockResolvedValue(0),
  companyTransfer:{findUnique:jest.fn().mockResolvedValue(null),
   create:jest.fn().mockImplementation(({data})=>({...data,status:"submitted"}))},
  companyEntity:{findUnique:jest.fn().mockResolvedValue(company)},
  fileObject:{findUnique:jest.fn().mockResolvedValue({id:"doc",uploadedByUserId:"applicant",storageStatus:"active",contentSha256:"hash"})},
  approvalInstance:{create:jest.fn().mockImplementation(({data})=>({...data,id:"round"}))}
 };
 const prisma={$transaction:async (operation:(db:typeof tx)=>Promise<unknown>)=>{
  const value=await operation(tx);
  if(outcome==="aborted")throw new Error("合成提交失败");
  phases.push("commit");
  return value;
 }};
 const notifications={queueFinalReview:jest.fn().mockImplementation(async()=>{phases.push("queue");}),
  afterCommit:jest.fn().mockImplementation(async()=>{phases.push("dispatch");})};
 const service=new CompanyTransferService(prisma as never,{} as never,{confirmPassword:async()=>undefined} as never,
  {record:async()=>undefined} as never,{} as never,{} as never,notifications as never);
 const create=()=>service.create("applicant",{kind:"storage",sourceCompanyId:"a",destinationCompanyId:"b",sourceAccount:"0000000001",
  destinationAccount:"0000000002",amountCents:"125",reason:"合成用途",evidenceFileId:"doc",confirmationPassword:"fixture",idempotencyKey:"key"});
 if(outcome==="aborted")await expect(create()).rejects.toThrow("合成提交失败");
 else await expect(create()).resolves.toMatchObject({status:"submitted"});
 expect(notifications.queueFinalReview).toHaveBeenCalledWith(tx,expect.objectContaining({applicantUserId:"applicant"}),
  expect.objectContaining({id:"round",status:"in_progress"}),["candidate"]);
 expect(phases).toEqual(outcome==="committed"?["queue","commit","dispatch"]:["queue"]);
});

it("原公司互转控制器只透传登录人和指定尝试凭据",async()=>{
 const {CompanyTransferController}=await import("./company-transfer.controller");
 const {PATH_METADATA}=await import("@nestjs/common/constants");
 const notices={notificationStatus:jest.fn().mockResolvedValue([{status:"failed"}]),retry:jest.fn().mockResolvedValue({status:"queued"})};
 const controller=new CompanyTransferController({} as never,{} as never,{} as never,{} as never,{} as never,notices as never);
 expect(Reflect.getMetadata(PATH_METADATA,CompanyTransferController.prototype.dutySmsStatus)).toBe(":id/duty-sms");
 expect(Reflect.getMetadata(PATH_METADATA,CompanyTransferController.prototype.retryDutySms)).toBe(":id/duty-sms/retry");
 const actor={id:"actor"} as never,attemptId="a".repeat(64);
 await expect(controller.dutySmsStatus(actor,"transfer")).resolves.toEqual({notices:[{status:"failed"}]});
 await expect(controller.retryDutySms(actor,"transfer",{attemptId})).resolves.toEqual({status:"queued"});
 expect(notices.notificationStatus).toHaveBeenCalledWith("transfer","actor");
 expect(notices.retry).toHaveBeenCalledWith("transfer","actor",attemptId);
});
