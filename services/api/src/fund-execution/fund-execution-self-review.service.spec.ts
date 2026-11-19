import {FundExecutionService} from "./fund-execution.service";
import {AuthService} from "../auth/auth.service";
import {hash} from "bcryptjs";

async function fixture(creator = "finance", submitter = "finance") {
  const db = {
    $queryRaw: async (query: {strings: readonly string[]}) => {
      const sql=query.strings.join("");
      if(sql.includes('FROM "FundExecutionCase"'))return [{id:"revision-1",caseKey:"case-1",status:"submitted",approvalInstanceId:"approval-1",createdByUserId:creator,submittedByUserId:submitter}];
      if(sql.includes('FROM "ApprovalInstance"'))return [{id:"approval-1",status:"in_progress",currentNodeIndex:0,flowType:"fund_execution_case.approve",businessType:"fund_execution_case",businessId:"case-1",applicantUserId:submitter,frozenNodes:[{name:"财务主管",mode:"any",roleKeys:["finance_director"]}]}];
      if(sql.includes('FROM "UserPosition"'))return [{key:"finance_director"}];
      return [];
    },
    approvalDelegation:{findMany:async()=>[]},user:{findMany:async()=>[],findUnique:async()=>({id:"finance",isActive:true,passwordHash:await hash("synthetic-password",4)})},
    approvalActionLog:{create:jest.fn(async()=>({}))},approvalInstance:{update:jest.fn(async()=>({}))}
  };
  const prisma={...db,$transaction:async<T>(work:(tx:typeof db)=>Promise<T>)=>work(db)};
  return { service: new FundExecutionService(prisma as never,{} as never,{} as never,{} as never,new AuthService(prisma as never,{} as never)), db };
}
it("资金案件实际创建人不能以另一人提交为由绕过本人确认",async()=>{
 const {service}=await fixture("finance","other-submitter");
 await expect(service.reviewApproval("finance",{caseId:"case-1",action:"return_to_applicant",comment:"退回修改"})).rejects.toThrow("自审原因");
});

it.each([undefined, "wrong-password"])("资金自审缺少或使用错误的本人密码均零写入：%s", async password => {
  const {service, db} = await fixture("finance", "other-submitter");
  await expect(service.reviewApproval("finance", {caseId:"case-1",action:"return_to_applicant",comment:"退回修改",selfReviewReason:"本人创建，核对后退回",confirmationPassword:password})).rejects.toThrow(password ? "密码不正确" : "当前密码");
  expect(db.approvalActionLog.create).not.toHaveBeenCalled();
  expect(db.approvalInstance.update).not.toHaveBeenCalled();
});
it("资金创建人使用本人密码确认后只冻结自审原因，绝不留存密码", async () => {
  const {service, db} = await fixture("finance", "other-submitter");
  await expect(service.reviewApproval("finance", {caseId:"case-1",action:"return_to_applicant",comment:"退回修改",selfReviewReason:"  核对本职责  ",confirmationPassword:"synthetic-password"})).resolves.toMatchObject({status:"returned_to_applicant"});
  expect(db.approvalActionLog.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({metadata:expect.objectContaining({selfReview:true,selfReviewReason:"核对本职责"})})}));
  expect(JSON.stringify(db.approvalActionLog.create.mock.calls)).not.toContain("synthetic-password");
});
it("非创建人及提交人的有效审批人保持普通确认路径", async () => {
  const {service} = await fixture("creator", "submitter");
  await expect(service.reviewApproval("finance", {caseId:"case-1",action:"return_to_applicant",comment:"退回修改"})).resolves.toMatchObject({status:"returned_to_applicant"});
});
