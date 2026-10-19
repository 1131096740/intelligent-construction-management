import {ContractBankVerificationService} from "./contract-bank-verification.service";
it("超过500条核验记录仍能翻页办理，公司选项保留且默认待核验",async()=>{
 const tx={$queryRaw:jest.fn().mockResolvedValue([]),contract:{findMany:jest.fn().mockResolvedValue([])},contractVersion:{findMany:jest.fn().mockResolvedValue([])},projectParticipatingCompany:{findMany:jest.fn().mockResolvedValue([])},projectAffiliateAssignment:{findFirst:jest.fn().mockResolvedValue(null)},companyEntity:{findMany:jest.fn().mockResolvedValue([{id:"c",name:"公司"}])},position:{findUnique:jest.fn().mockResolvedValue(null)},contractBankVerificationRequest:{count:jest.fn().mockResolvedValue(501),findMany:jest.fn().mockResolvedValue([])}};
 const service=new ContractBankVerificationService({$transaction:async(f:(t:unknown)=>Promise<unknown>)=>f(tx)} as never,{visibleProjectIdsInTransaction:async()=>["p"],effectiveRoleKeysByProjectInTransaction:async()=>new Map([["p",["finance_staff"]]])} as never,{} as never,{} as never);
 expect(await service.list("actor","p",11)).toMatchObject({total:501,page:11,pageSize:50,companies:[{value:"c",label:"公司"}]});
 expect(tx.contractBankVerificationRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{projectId:"p",status:"pending_confirm"},skip:500,take:50}));
 await service.list("actor","p",1,"confirmed");expect(tx.contractBankVerificationRequest.count).toHaveBeenLastCalledWith({where:{projectId:"p",status:"confirmed"}});
 await expect(service.list("actor","p",0)).rejects.toThrow("页码");
});
