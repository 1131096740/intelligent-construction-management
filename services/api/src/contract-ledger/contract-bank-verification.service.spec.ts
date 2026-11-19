import {ContractBankVerificationService} from "./contract-bank-verification.service";
it("超过500条核验记录仍能翻页办理，公司选项保留且默认待核验",async()=>{
 const tx={$queryRaw:jest.fn().mockResolvedValue([]),contract:{findMany:jest.fn().mockResolvedValue([])},contractVersion:{findMany:jest.fn().mockResolvedValue([])},projectParticipatingCompany:{findMany:jest.fn().mockResolvedValue([])},projectAffiliateAssignment:{findFirst:jest.fn().mockResolvedValue(null)},companyEntity:{findMany:jest.fn().mockResolvedValue([{id:"c",name:"公司"}])},position:{findUnique:jest.fn().mockResolvedValue(null)},contractBankVerificationRequest:{count:jest.fn().mockResolvedValue(501),findMany:jest.fn().mockResolvedValue([])}};
 const service=new ContractBankVerificationService({$transaction:async(f:(t:unknown)=>Promise<unknown>)=>f(tx)} as never,{visibleProjectIdsInTransaction:async()=>["p"],effectiveRoleKeysByProjectInTransaction:async()=>new Map([["p",["finance_staff"]]])} as never,{} as never,{} as never);
 expect(await service.list("actor","p",11)).toMatchObject({total:501,page:11,pageSize:50,companies:[{value:"c",label:"公司"}]});
 expect(tx.contractBankVerificationRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{projectId:"p",status:"pending_confirm"},skip:500,take:50}));
 await service.list("actor","p",1,"confirmed");expect(tx.contractBankVerificationRequest.count).toHaveBeenLastCalledWith({where:{projectId:"p",status:"confirmed"}});
 await expect(service.list("actor","p",0)).rejects.toThrow("页码");
});

it.each(["first", "replay", "aborted", "project", "project-aborted"] as const)("银行流水仅首次成功登记同事务入队 (%s)", async scenario => {
 const {createHash}=await import("node:crypto");
 const projectId=scenario.startsWith("project")?"project":null;
 const aborted=scenario.endsWith("aborted");
 const accountNumber="000000012345";
 const payload={projectId,companyEntityId:"company",accountNumber,bankReference:"合成流水",direction:"inflow" as const,
  amountCents:"125",occurredAt:"2026-11-01",evidenceFileId:"evidence",reason:"合成业务",idempotencyKey:"receipt",
  confirmationPassword:"fixture"};
 const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
 const requestFingerprint=hash(JSON.stringify({...payload,accountNumber:undefined,accountHash:hash(accountNumber),
  confirmationPassword:undefined,actor:"finance"}));
 const row={id:"verification",projectId,status:"pending_confirm",recordedByUserId:"finance"};
 const tx={
  $queryRaw:jest.fn().mockResolvedValueOnce([{key:"finance_staff"}]).mockResolvedValue([]),
  $executeRaw:jest.fn().mockResolvedValue(0),
  contract:{findMany:jest.fn().mockResolvedValue([])},
  contractVersion:{findMany:jest.fn().mockResolvedValue([])},
  projectParticipatingCompany:{findMany:jest.fn().mockResolvedValue([{companyEntityId:"company",companyCreditCodeSnapshot:"fixture"}])},
  projectAffiliateAssignment:{findFirst:jest.fn().mockResolvedValue(null)},
  companyEntity:{findMany:jest.fn().mockResolvedValue([{id:"company",name:"合成公司",unifiedSocialCreditCode:"fixture"}])},
  fileObject:{findUnique:jest.fn().mockResolvedValue({id:"evidence",uploadedByUserId:"finance",storageStatus:"active",contentSha256:"a".repeat(64)})},
  contractBankVerificationRequest:{
   findUnique:jest.fn().mockResolvedValue(scenario==="replay"?{...row,requestFingerprint}:null),
   count:jest.fn().mockResolvedValue(0),create:jest.fn().mockResolvedValue(row)
  }
 };
 const phases:string[]=[];
 const notices={queue:jest.fn().mockImplementation(async()=>{phases.push("queue");}),
  afterCommit:jest.fn().mockImplementation(async()=>{phases.push("dispatch");})};
 const prisma={$transaction:async (op:(db:typeof tx)=>Promise<unknown>)=>{
  const result=await op(tx);
  if(aborted)throw new Error("合成提交失败");
  phases.push("commit");
  return result;
 }};
 const service=new ContractBankVerificationService(prisma as never,{visibleProjectIdsInTransaction:async()=>["project"],
  effectiveRoleKeysByProjectInTransaction:async()=>new Map([["project",["finance_staff"]]])} as never,
  {confirmPassword:async()=>undefined} as never,{record:async()=>undefined} as never,notices as never);
 if(aborted)await expect(service.prepare("finance",payload)).rejects.toThrow("合成提交失败");
 else await expect(service.prepare("finance",payload)).resolves.toEqual({id:"verification",status:"pending_confirm"});
 if(scenario==="replay")expect(notices.queue).not.toHaveBeenCalled();
 else expect(notices.queue).toHaveBeenCalledWith(tx,row);
 expect(phases).toEqual(aborted?["queue"]:scenario==="replay"?["commit","dispatch"]:["queue","commit","dispatch"]);
});

it("银行核验短信入口沿用登录人和核验单，拒绝不合法的重试凭据",async()=>{
 const {ContractBankVerificationController}=await import("./contract-bank-verification.controller");
 const {PATH_METADATA}=await import("@nestjs/common/constants");
 const {RetryDutyNotificationDto}=await import("../approval/retry-duty-notification.dto");
 const {createApiValidationPipe}=await import("../validation/api-validation");
 const notices={notificationStatus:jest.fn().mockResolvedValue({status:"failed"}),retry:jest.fn().mockResolvedValue({status:"queued"})};
 const controller=new ContractBankVerificationController({} as never,notices as never);
 expect(Reflect.getMetadata(PATH_METADATA,ContractBankVerificationController.prototype.dutySmsStatus)).toBe(":id/duty-sms");
 expect(Reflect.getMetadata(PATH_METADATA,ContractBankVerificationController.prototype.retryDutySms)).toBe(":id/duty-sms/retry");
 const actor={id:"reviewer"} as never,attemptId="a".repeat(64);
 await expect(controller.dutySmsStatus(actor,"verification")).resolves.toEqual({notice:{status:"failed"}});
 await expect(controller.retryDutySms(actor,"verification",{attemptId})).resolves.toEqual({status:"queued"});
 expect(notices.retry).toHaveBeenCalledWith("verification","reviewer",attemptId);
 await expect(createApiValidationPipe().transform({attemptId:"invalid"},
  {type:"body",metatype:RetryDutyNotificationDto})).rejects.toMatchObject({status:400});
});
