import { SettlementReadService } from "../settlement/settlement-read.service";
import { PaymentReadService } from "../payment/payment-read.service";

function fixture(roles: string[], participant = false) {
  const now = new Date("2026-11-05T00:00:00Z");
  const settlement = {id:"settlement-other",projectId:"project-1",contractId:"contract",contractVersionId:"version",paymentTermsVersionId:"terms",code:"JS-1",status:"effective",amountCents:50000n,paidAmountCents:0n,preparedByUserId:"other",periodLabel:"本期",updatedAt:now,createdAt:now};
  const payment = {id:"payment-other",projectId:"project-1",contractId:"contract",contractVersionId:"version",paymentTermsVersionId:"terms",settlementId:null,sourceType:"contract_due",code:"FK-1",status:"approval_pending",requestedAmountCents:50000n,approvedAmountCents:null,paidAmountCents:0n,updatedAt:now,createdAt:now};
  const db = {
    settlement:{findMany:async()=>[settlement],findFirst:async()=>settlement},
    paymentRequest:{findMany:async()=>[payment],findFirst:async()=>payment},
    contract:{findMany:async()=>[{id:"contract",code:"HT-1",name:"敏感合同"}]},
    contractVersion:{findMany:async()=>[]},paymentTermsVersion:{findMany:async()=>[]},project:{findMany:async()=>[{id:"project-1",name:"项目一"}]},paymentExecution:{findMany:async()=>[]},
    approvalInstance:{findMany:async()=>[]},
    $queryRaw:async()=> participant ? [{id:"participation"}] : []
  };
  const visibility={effectiveRoleKeys:async()=>roles};
  return {settlement:new SettlementReadService(db as never,visibility as never),payment:new PaymentReadService(db as never,visibility as never)};
}
it("普通同项目员工不能读取他人结算及付款敏感台账",async()=>{
 const services=fixture(["employee"]);
 expect((await services.settlement.listRecent(undefined,["project-1"],{actorUserId:"employee"} as never)).rows).toEqual([]);
 expect((await services.payment.listRecent(undefined,["project-1"],{actorUserId:"employee"})).rows).toEqual([]);
});
it("普通同项目员工不能用已知业务编号读取他人敏感详情",async()=>{
 const services=fixture(["employee"]);
 await expect(services.settlement.getDetail("JS-1",["project-1"],"employee")).rejects.toThrow("未找到该结算单");
 await expect(services.payment.getDetail("FK-1",["project-1"],"employee")).rejects.toThrow("未找到付款申请");
});

it.each(["finance_staff","finance_director","comprehensive_director","contract_director","material_director","project_manager"])("有权岗位保持本范围台账读取：%s", async role => {
 const services=fixture([role]);
 expect((await services.settlement.listRecent(undefined,["project-1"],{actorUserId:"reader"})).rows).toHaveLength(1);
 expect((await services.payment.listRecent(undefined,["project-1"],{actorUserId:"reader"})).rows).toHaveLength(1);
});
it("普通员工仅凭自己真实审批参与事实读取相关单据",async()=>{
 const services=fixture(["employee"],true);
 expect((await services.settlement.listRecent(undefined,["project-1"],{actorUserId:"employee"})).rows).toHaveLength(1);
 expect((await services.payment.listRecent(undefined,["project-1"],{actorUserId:"employee"})).rows).toHaveLength(1);
});

it("技术管理员无业务岗位不自动取得结算付款敏感读取权",async()=>{
 const services=fixture(["super_admin"]);
 expect((await services.settlement.listRecent(undefined,["project-1"],{actorUserId:"admin"})).rows).toEqual([]);
 expect((await services.payment.listRecent(undefined,["project-1"],{actorUserId:"admin"})).rows).toEqual([]);
});
