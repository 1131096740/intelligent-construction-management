import {assertContractBankProject,contractBankProjectWhere} from "./contract-bank-project";
const observation={transactionSourceType:"contract_bank_verification",transactionSourceId:"bank-request"};
it("同公司跨项目也不能使用核验流水，未确认核验不能提前认领",async()=>{
 const tx={contractBankVerificationRequest:{findUnique:jest.fn().mockResolvedValue({projectId:"a",status:"confirmed"})}};
 await expect(assertContractBankProject(tx as never,observation,"b")).rejects.toThrow("跨项目");
 await expect(assertContractBankProject(tx as never,observation,"a")).resolves.toBeUndefined();
 tx.contractBankVerificationRequest.findUnique.mockResolvedValue({projectId:"a",status:"pending_confirm"});
 await expect(assertContractBankProject(tx as never,observation,"a")).rejects.toThrow("已确认");
});
it("原受控全局银行来源保留现有权限链；项目来源候选按冻结项目过滤",async()=>{
 await expect(assertContractBankProject({} as never,{transactionSourceType:"original_verified_feed",transactionSourceId:"old"},"a")).resolves.toBeUndefined();
 const tx={contractBankVerificationRequest:{findMany:jest.fn().mockResolvedValue([{id:"bank-request"}])}};
 expect(await contractBankProjectWhere(tx as never,"a")).toMatchObject({OR:[{}, {transactionSourceId:{in:["bank-request"]}}]});
 expect(tx.contractBankVerificationRequest.findMany).toHaveBeenCalledWith({where:{projectId:"a",status:"confirmed"},select:{id:true}});
});
