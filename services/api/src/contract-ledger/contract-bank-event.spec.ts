import {requireContractBankEvent,claimContractBankEvent} from "./contract-bank-event";
const date=new Date("2026-10-18T17:00:00Z");
const input={projectId:"project",reference:"bank",companyId:"company",amountCents:12000n,occurredAt:date,direction:"outflow" as const};
function db(){return {$queryRaw:jest.fn(),verifiedBankTransactionObservation:{findUnique:jest.fn().mockResolvedValue({id:"o",reference:"bank",holderCompanyEntityId:"company",amountCents:12000n,occurredAt:new Date("2026-10-19T02:00:00Z"),direction:"outflow"})},bankTransactionClaim:{count:jest.fn().mockResolvedValue(0)},contractProxyBankClaim:{count:jest.fn().mockResolvedValue(0)},companyTransferBankClaim:{count:jest.fn().mockResolvedValue(0),findMany:jest.fn().mockResolvedValue([])},contractBankEventClaim:{count:jest.fn().mockResolvedValue(0),create:jest.fn()}};}
describe("所有公司合同实付/对上拨款同一银行事件",()=>{
 it("缺少银行事件不得用附件绕开认领",async()=>{await expect(requireContractBankEvent(db() as never,{...input,reference:undefined})).rejects.toThrow("已核验银行流水");});
 it.each(["bankTransactionClaim","contractProxyBankClaim","contractBankEventClaim"] as const)("任何入口 %s 已认领都拒绝",async table=>{const tx=db();tx[table].count.mockResolvedValue(1);await expect(requireContractBankEvent(tx as never,input)).rejects.toThrow("已认领");});
 it("按上海业务日核对，跨UTC日不误拒",async()=>{expect((await requireContractBankEvent(db() as never,input)).id).toBe("o");});
 it.each([{companyId:"other"},{amountCents:1n},{direction:"inflow" as const},{occurredAt:new Date("2026-10-20")}])("拒绝跨公司、错金额、错方向、错日 %s",async change=>{await expect(requireContractBankEvent(db() as never,{...input,...change})).rejects.toThrow("不符");});
 it("认领只建立原执行关联，不再写经营金额",async()=>{const tx=db();await claimContractBankEvent(tx as never,"o","payment_execution","payment","actor");expect(tx.contractBankEventClaim.create).toHaveBeenCalledWith({data:{observationId:"o",sourceType:"payment_execution",sourceId:"payment",createdByUserId:"actor"}});});
});
