import {validateProxyBank} from "./contract-proxy-bank";
import type {ProxySource} from "./contract-proxy-source";
const company={kind:"participating_company",id:"a",name:"甲公司"} as const,enterprise={kind:"construction_enterprise",id:"e",name:"施工企业"} as const;
const source={debtor:enterprise,actualPayer:company} as ProxySource;
const date=new Date("2026-08-15T04:00:00Z");
function db(){return {companyTransferBankClaim:{count:jest.fn().mockResolvedValue(0),findMany:jest.fn().mockResolvedValue([])},contractBankEventClaim:{count:jest.fn().mockResolvedValue(0)},$queryRaw:jest.fn(),verifiedBankTransactionObservation:{findUnique:jest.fn().mockResolvedValue({id:"bank",holderCompanyEntityId:"a",amountCents:500n,direction:"outflow",occurredAt:date})},bankTransactionClaim:{count:jest.fn().mockResolvedValue(0)},contractProxyBankClaim:{count:jest.fn().mockResolvedValue(0)}};}
describe("代付与原资金执行共用银行交易排他",()=>{
 it("没有已核验银行记录不能确认公司代付",async()=>{await expect(validateProxyBank(db() as never,source,"payment",500n,date)).rejects.toThrow("已核验银行");});
 it.each(["bankTransactionClaim","contractProxyBankClaim"] as const)("%s 已认领时拒绝另一入口登记",async table=>{const tx=db();tx[table].count.mockResolvedValue(1);await expect(validateProxyBank(tx as never,source,"payment",500n,date,"bank")).rejects.toThrow("已在付款或资金执行中认领");});
 it.each([{holderCompanyEntityId:"b"},{amountCents:501n},{direction:"inflow"},{occurredAt:new Date("2026-08-16")}])("拒绝真实持有人、方向、金额或日期不符 %s",async override=>{const tx=db();tx.verifiedBankTransactionObservation.findUnique.mockResolvedValue({id:"bank",holderCompanyEntityId:"a",amountCents:500n,direction:"outflow",occurredAt:date,...override});await expect(validateProxyBank(tx as never,source,"payment",500n,date,"bank")).rejects.toThrow("不符");});
 it("退款与施工企业归还使用原代付公司的入账流水",async()=>{for(const kind of ["refund","repayment"]){const tx=db();tx.verifiedBankTransactionObservation.findUnique.mockResolvedValue({id:"bank",holderCompanyEntityId:"a",amountCents:500n,direction:"inflow",occurredAt:date});expect((await validateProxyBank(tx as never,source,kind,500n,date,"bank"))?.id).toBe("bank");}});
 it("我方归还给另一公司使用债务公司的出账流水",async()=>{const tx=db();expect((await validateProxyBank(tx as never,{...source,debtor:company,actualPayer:{...company,id:"b"}},"repayment",500n,date,"bank"))?.id).toBe("bank");});
});

it("公司间归还必须核验收款公司入账；原出款流水不能冒充收款证明",async()=>{
 const {validateProxyReceivingBank}=await import("./contract-proxy-bank");
 const s={...source,debtor:{...company,id:"debtor"}};
 await expect(validateProxyReceivingBank(db() as never,s,"repayment",500n,date)).rejects.toThrow("已核验银行流水");
 const tx=db();await expect(validateProxyReceivingBank(tx as never,s,"repayment",500n,date,"bank")).rejects.toThrow("方向");
 tx.verifiedBankTransactionObservation.findUnique.mockResolvedValue({id:"bank",holderCompanyEntityId:"a",amountCents:500n,direction:"inflow",occurredAt:date});
 expect((await validateProxyReceivingBank(tx as never,s,"repayment",500n,date,"bank"))?.id).toBe("bank");
 tx.contractBankEventClaim.count.mockResolvedValue(1);await expect(validateProxyReceivingBank(tx as never,s,"repayment",500n,date,"bank")).rejects.toThrow("已在付款或资金执行中认领");
});
