import { Prisma } from "@prisma/client";
import * as fixtureApi from "./registered-payment-postgres.fixture";
import * as prerequisiteApi from "./registered-payment-public-cash-prerequisite";
import { runRegisteredPublicCashPayment } from "./registered-payment-postgres.cases";

describe("fixed public cash payment case (simulated HTTP and observer)",()=>{
 afterEach(()=>jest.restoreAllMocks());
 it.each(["success","bad-root","http-failure","connection-lost"] as const)("records a bounded registration response and preserves the case result: %s",async scenario=>{
  const badRoot=scenario==="bad-root";
  let paid=false, posts=0;
  const ids={payment:"payment",project:"project",settlement:"settlement"};
  const fixture={plan:{ids,paidAt:"2026-11-07"},cashRegistrationId:"cash-reg",cashSourceId:"cash-source",companyARegistrationId:"company-reg",companyBRegistrationId:"company-b-reg",companyBSourceId:"company-b-source",contender:{actorId:"keeper",requestKey:"key",accessToken:"token"},cashSourceDocument:{verify:jest.fn()},settlementFactId:"settlement-fact",settlementBaseline:{costCents:"4000",payableCents:"4000"}};
  const paymentRows=()=>paid?[{id:"exec",idempotencyKey:"key",amountCents:4000n,paymentRequestId:"payment",voucherFileId:null}]:[];
  const allocations=()=>paid?[{executionId:"exec",accountId:"cash-account",sourceBatchId:"cash-source",amountCents:4000n}]:[];
  const impact=(kind:string)=>({factId:"payment-fact",projectId:"project",impactKind:kind,direction:"decrease",subjectKind:kind==="public_cash_funds_decrease"?"public_cash":"downstream_counterparty",subjectId:kind==="public_cash_funds_decrease"?"public_cash":"supplier",amountCents:4000n,numericProtocolVersion:1});
  const tx={ $executeRawUnsafe:jest.fn().mockResolvedValue(0),
   paymentRequest:{findUniqueOrThrow:jest.fn(async()=>({approvedAmountCents:4000n,paidAmountCents:paid?4000n:0n,status:paid?"paid":"approved_pending_payment"}))},
   settlement:{findUniqueOrThrow:jest.fn(async()=>({payableAmountCents:4000n,paidAmountCents:paid?4000n:0n}))},
   paymentExecution:{findMany:jest.fn(async()=>paymentRows())},
   registeredPaymentFunding:{findMany:jest.fn(async()=>paid?[{executionId:"exec",operatingLedgerEffectiveDateAtRegistration:new Date("2026-11-01"),actualPayerId:"public_cash",actualPayerKind:"public_cash"}]:[])},
   registeredFundPaymentAllocation:{findMany:jest.fn(async()=>allocations())},
   registeredFundTransferLine:{findMany:jest.fn(async()=>[])},
   registeredPaymentEvent:{findMany:jest.fn(async()=>paid?[{executionId:"exec"}]:[])},
   interEntityRelationshipEntry:{findMany:jest.fn(async()=>paid&&badRoot?[{id:"invented-debt"}]:[])},
   operatingFact:{findMany:jest.fn(async(args:{select:Record<string,unknown>})=>paid?[args.select.actualPayerSubjectKind?{id:"payment-fact",projectId:"project",actualPayerSubjectKind:"public_cash",actualPayerSubjectId:"public_cash"}:{id:"payment-fact"}]:[])},
   operatingImpactEntry:{findMany:jest.fn(async(args:{select:Record<string,unknown>})=>paid?(args.select.impactKind?[impact("public_cash_funds_decrease"),impact("payable_decrease")]:[{id:"i1"},{id:"i2"}]):[])},
   auditLog:{findMany:jest.fn(async()=>paid?[{actorUserId:"keeper",metadata:{}}]:[])},
   fundAccountBalanceRegistration:{findUniqueOrThrow:jest.fn(async(args:{where:{id:string}})=>({accountId:args.where.id==="company-reg"?"company-account":"cash-account",balanceYuan:new Prisma.Decimal("100"),coveredExecutionIds:[]})),findUnique:jest.fn(async()=>({accountId:"cash-account"}))},
   registeredFundAccount:{findUnique:jest.fn(async()=>({id:"cash-account",scopeKey:"public_cash",kind:"public_cash",companyEntityId:null}))}
  };
  const observer={$transaction:jest.fn(async(fn:(tx:unknown)=>Promise<unknown>)=>fn(tx))};
  const primary={observer}, contender={password:"synthetic"};
  jest.spyOn(fixtureApi,"assertRegisteredPgCompetitionRoles").mockResolvedValue({primary:{database:"synthetic",ownerPid:1,runtimePid:2,observerPid:3},contender:{database:"synthetic",ownerPid:1,runtimePid:4,observerPid:3}});
  jest.spyOn(prerequisiteApi,"readCashSettlementPrerequisite").mockResolvedValue({settlementId:"settlement",factId:"settlement-fact",costCents:"4000",payableCents:"4000"});
  jest.spyOn(fixtureApi,"registeredPgHttp").mockImplementation(async(_ctx,route,method)=>{
   if(route.endsWith("registration-options"))return {status:200,body:{paymentId:"payment",projectId:"project",expectedPaymentUpdatedAt:"revision",remainingAmountCents:"4000",accounts:[{scopeKey:"public_cash",eligible:true,currentRegistrationId:"cash-reg"}]}};
   if(method==="POST"){posts++;if(scenario==="connection-lost")throw Error("synthetic connection lost");if(scenario==="http-failure")return {status:500,body:{}};paid=true;return {status:201,body:{}};}
   return {status:200,body:{status:"recorded",execution:{executionId:"exec",amountCents:"4000"},intercompany:[]}};
  });
  const lane={checkLight:jest.fn(),fetch:jest.fn(),recordCashRegistrationStatus:jest.fn()};
  const operation=runRegisteredPublicCashPayment(primary as never,contender as never,fixture as never,[lane as never,lane as never]);
  if(scenario==="connection-lost"){await expect(operation).rejects.toThrow("synthetic connection lost");expect(posts).toBe(1);expect(lane.recordCashRegistrationStatus).not.toHaveBeenCalled();}
  else if(scenario==="http-failure"){await expect(operation).rejects.toThrow("PG_CASH_REGISTRATION");expect(posts).toBe(1);expect(lane.recordCashRegistrationStatus).toHaveBeenCalledWith(500);}
  else if(badRoot){await expect(operation).rejects.toThrow("PG_CASH_AFTER");expect(posts).toBe(1);}
  else {await expect(operation).resolves.toMatchObject({caseId:"registered.public-cash.payment",cashBalanceYuan4:"60.0000",rootCount:0,replayUnchanged:true});expect(posts).toBe(2);}
 });
});
