import {beforeEach,describe,expect,it,vi} from "vitest";
const api=vi.hoisted(()=>vi.fn());
vi.mock("./api-fetch",()=>({apiFetch:api}));
import {recordRegisteredPayment,verifyRegisteredPaymentRecovery,RegisteredPaymentApiError} from "./registered-payment-execution.api";
const input={idempotencyKey:"key",expectedPaymentUpdatedAt:"t",amountCents:"100",paidAt:"2026-11-01",scopeKey:"a",expectedRegistrationId:"r",openingTreatment:"included" as const,openingReason:"r",openingEvidence:"e",sourceAllocations:[],confirmationPassword:"synthetic"};
describe("付款错误响应分类",()=>{
 beforeEach(()=>api.mockReset());
 it.each([null,{}, {id:"",idempotencyKey:"key",paymentRequestId:"p",amountCents:"100",paidAt:"2026-10-31T16:00:00.000Z"}, {id:"e",idempotencyKey:"other",paymentRequestId:"p",amountCents:"100",paidAt:"2026-10-31T16:00:00.000Z"}, {id:"e",idempotencyKey:"key",paymentRequestId:"other",amountCents:"100",paidAt:"2026-10-31T16:00:00.000Z"}, {id:"e",idempotencyKey:"key",paymentRequestId:"p",amountCents:"101",paidAt:"2026-10-31T16:00:00.000Z"}, {id:"e",idempotencyKey:"key",paymentRequestId:"p",amountCents:"100",paidAt:"2026-11-01T16:00:00.000Z"}])("无效成功响应 %o 保持未确认",async body=>{api.mockResolvedValue({ok:true,status:201,json:async()=>body});await expect(recordRegisteredPayment("p",input)).rejects.toThrow();});
 it("接受真实合同的中国时区日期成功响应",async()=>{const body={id:"execution",idempotencyKey:"key",paymentRequestId:"p",amountCents:"100",paidAt:"2026-10-31T16:00:00.000Z"};api.mockResolvedValue({ok:true,status:201,json:async()=>body});await expect(recordRegisteredPayment("p",input)).resolves.toEqual(body);});
 it("只将无密码的原载荷发送给恢复证明接口",async()=>{api.mockResolvedValue({ok:true,json:async()=>({status:"matched",executionId:"e"})});const {confirmationPassword,...recovery}=input;await expect(verifyRegisteredPaymentRecovery("p",recovery)).resolves.toEqual({status:"matched",executionId:"e"});const [path,init]=api.mock.calls[0]!;expect(path).toBe("/payment-executions/p/recovery-proof");expect(JSON.parse(init.body)).toEqual(recovery);expect(init.body).not.toContain(confirmationPassword);});
 it.each([400,409])("响应体无法读取时不认定 %i 是明确失败",async status=>{
  api.mockResolvedValue({ok:false,status,json:async()=>{throw Error("body read failed");}});
  const error=await recordRegisteredPayment("p",input).catch(e=>e);expect(error).toBeInstanceOf(RegisteredPaymentApiError);expect(error.definitiveFailure).toBe(false);
 });
 it("原请求冲突保留待查询",async()=>{api.mockResolvedValue({ok:false,status:409,json:async()=>({message:"原请求已绑定不同的实付登记内容，请查询原结果"})});const error=await recordRegisteredPayment("p",input).catch(e=>e);expect(error.definitiveFailure).toBe(false);});
 it("可解析的普通输入错误及已知付款版本冲突可明确处理",async()=>{for(const [status,message] of [[400,"金额不正确"],[409,"付款申请已变化，请刷新后重试"]] as const){api.mockResolvedValueOnce({ok:false,status,json:async()=>({message})});const error=await recordRegisteredPayment("p",input).catch(e=>e);expect(error.definitiveFailure).toBe(true);}});
});

it("clears only a typed pre-write gap with a valid positive amount", async () => {
 for (const [differenceCents,definitive] of [["300",true],["0",false],["-3",false],[null,false]] as const) {
  api.mockResolvedValueOnce({ok:false,status:409,json:async()=>({
   code:"REGISTERED_PROJECT_ADVANCE_CONFIRMATION_REQUIRED",message:"差额待确认",differenceCents,
  })});
  const error=await recordRegisteredPayment("p",input).catch(e=>e);
  expect(error).toBeInstanceOf(RegisteredPaymentApiError);
  expect(error.definitiveFailure).toBe(definitive);
  expect(error.differenceCents ?? null).toBe(definitive ? differenceCents : null);
 }
});
