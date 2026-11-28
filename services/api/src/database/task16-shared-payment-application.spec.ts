import { Test } from "@nestjs/testing";
import { PrismaService } from "./prisma.service";
import { createRegisteredPaymentSyntheticDb } from "../payment/testing/registered-payment-execution.synthetic-db";
import { Task16SharedPaymentApplicationModule, task16SharedPaymentRequestAllowed, task16SharedPaymentRouteAllowed } from "./task16-shared-payment-application";

it("compiles the actual shared-payment Nest application with synthetic persistence",async()=>{
 const database=createRegisteredPaymentSyntheticDb();
 const module=await Test.createTestingModule({imports:[Task16SharedPaymentApplicationModule]}).overrideProvider(PrismaService).useValue(database.prisma).compile();
 await module.close();
});

it("admits only the current execution, result and file coordinates",()=>{
 const paymentId="10000000-0000-4000-8000-000000000001",execution="10000000-0000-4000-8000-000000000002",key="10000000-0000-4000-8000-000000000003",file="10000000-0000-4000-8000-000000000004";
 const empty={paymentId,executionIds:[],resultKeys:[],fileIds:[]},populated={...empty,executionIds:[execution],resultKeys:[key],fileIds:[file]};
 expect(task16SharedPaymentRouteAllowed("POST",`/payment-executions/${execution}/voucher`,empty)).toBe(false);
 expect(task16SharedPaymentRouteAllowed("POST",`/payment-executions/${execution}/voucher`,populated)).toBe(true);
 expect(task16SharedPaymentRouteAllowed("GET",`/payment-executions/results/${key}`,populated)).toBe(true);
 expect(task16SharedPaymentRouteAllowed("GET",`/files/${file}/download`,populated)).toBe(true);
 expect(task16SharedPaymentRouteAllowed("GET",`/files/${file}/download?token=x`,populated)).toBe(false);
});

it("enforces the fence before the actual Nest controllers",async()=>{
 const database=createRegisteredPaymentSyntheticDb();
 const module=await Test.createTestingModule({imports:[Task16SharedPaymentApplicationModule]}).overrideProvider(PrismaService).useValue(database.prisma).compile();
 const app=module.createNestApplication();
 const id="10000000-0000-4000-8000-000000000001",scope={paymentId:id,executionIds:[],resultKeys:[],fileIds:[]};
 app.use((req:{method:string;originalUrl:string},res:{status:(code:number)=>{end:()=>void}},next:()=>void)=>task16SharedPaymentRequestAllowed(req.method,req.originalUrl,scope)?next():res.status(404).end());
 try {
  await app.listen(0,"127.0.0.1");const origin=await app.getUrl();
  expect((await fetch(`${origin}/payments`)).status).toBe(404);
  expect((await fetch(`${origin}/payments/${id}/approval-transfer`,{method:"POST"})).status).toBe(404);
  expect((await fetch(`${origin}/payment-executions/work-items?extra=1`)).status).toBe(404);
  expect((await fetch(`${origin}/payments/${id}/approval`,{method:"POST"})).status).toBe(401);
 } finally {await app.close();}
});

it("restricts the dedicated ingress to the shared-payment flow",()=>{
 const id="10000000-0000-4000-8000-000000000001";
 const scope={paymentId:id,executionIds:[],resultKeys:[],fileIds:[]};
 for(const [method,path] of [["POST",`/payments/${id}/approval`],["GET","/payment-executions/notifications"],["GET","/payment-executions/work-items"],["POST",`/payment-executions/${id}/registrations`],["GET","/me/work-items"]])expect(task16SharedPaymentRouteAllowed(method,path,scope)).toBe(true);
 for(const [method,path] of [["POST",`/payments/${id}/approval-transfer`],["POST",`/payments/${id}/registrations/extra`],["POST","/payments/10000000-0000-4000-8000-000000000002/approval"],["GET","/payments"],["GET","/me/signature/ticket"],["DELETE",`/payment-executions/${id}`]])expect(task16SharedPaymentRouteAllowed(method,path,scope)).toBe(false);
});

it("permits only the exact ticket query returned for a scoped private file",()=>{
 const paymentId="10000000-0000-4000-8000-000000000001",file="10000000-0000-4000-8000-000000000004";
 const scope={paymentId,executionIds:[],resultKeys:[],fileIds:[file]};
 const ticket=`/files/${file}/download?actorUserId=synthetic&expiresAt=1&downloadReason=test&accessMode=payment&token=opaque`;
 expect(task16SharedPaymentRequestAllowed("GET",ticket,scope,ticket)).toBe(true);
 expect(task16SharedPaymentRequestAllowed("GET",ticket,scope)).toBe(false);
 expect(task16SharedPaymentRequestAllowed("GET",`${ticket}&extra=1`,scope,ticket)).toBe(false);
 expect(task16SharedPaymentRequestAllowed("GET",`/payment-executions/work-items?extra=1`,scope,ticket)).toBe(false);
 expect(task16SharedPaymentRequestAllowed("GET",`//example.invalid${ticket}`,scope,ticket)).toBe(false);
});
