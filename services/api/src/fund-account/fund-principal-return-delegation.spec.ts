import { ForbiddenException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { FundPrincipalReturnService } from "./fund-principal-return.service";
import { principalReturnDuties } from "./fund-principal-return-state";
import type { PrismaService } from "../database/prisma.service";
import type { AuthService } from "../auth/auth.service";
import type { AuditService } from "../audit/audit.service";

function fixture() {
  let enabled = true;
  const duties = principalReturnDuties(null);
  const readUnrelatedFunding = jest.fn();
  const stored = {
    id:"application",sourceKind:"advance_receipt",sourceId:"private-source",createdByUserId:"keeper",approvalInstanceId:"round",
    requestedYuan:new Prisma.Decimal("4.0001"),paidYuan:new Prisma.Decimal("0"),
    contributorName:"合成出资方",projectId:null,status:"pending",revision:2,
  };
  const round = {id:"round",businessId:"application",businessType:"registered_principal_return",
    flowType:"registered_principal_return",status:"approval_pending",currentNodeIndex:0,frozenNodes:duties};
  const originWrite = jest.fn().mockResolvedValue(1);
  const tx = {
    user:{findUnique:async()=>({isActive:true}),findMany:async()=>[{id:"delegate",isActive:true},{id:"director",isActive:true}]},
    userPosition:{findMany:async({where}:{where:{userId:string;projectId?:unknown}})=>
      where.userId === "director" && where.projectId === null ? [{positionId:"position-finance"}] : []},
    position:{findMany:async({where}:{where:{id?:unknown}})=>where.id ? [{id:"position-finance",key:"finance_director"}] : []},
    approvalDelegation:{findMany:async({select}:{select:{resourceId?:boolean}})=>{
      if (!enabled) return [];
      return select.resourceId ? [{resourceId:"round:1"}] : [{fromUserId:"director"}];
    }},
    approvalInstance:{findMany:async()=>[round],findUnique:async()=>round},
    registeredPrincipalReturnCommand:{findUnique:async()=>null},
    registeredPrincipalReturnApplication:{findMany:async()=>[stored],
      findUnique:async({where}:{where:{id:string}})=>where.id === stored.id ? stored : null},
    $executeRaw:originWrite,$queryRaw:async()=>[{id:stored.id}],
    registeredFundAdvanceReceipt:{findMany:readUnrelatedFunding},
    registeredFundAccount:{findMany:readUnrelatedFunding},
  };
  const prisma = {$transaction:(run:(client:typeof tx)=>unknown)=>run(tx)} as unknown as PrismaService;
  const service = new FundPrincipalReturnService(prisma,{} as AuthService,{} as AuditService);
  return {service,readUnrelatedFunding,originWrite,completeDuty:()=>{duties[1].approvedRoleKeys=["finance_director"];},revoke:()=>{enabled=false;}};
}

it("projects only the delegated pending application without reading source or account history", async () => {
  const {service,readUnrelatedFunding} = fixture();
  const result = await service.list("delegate");
  expect(result).toEqual({payableScopeKeys:[],items:[{
    delegatedOnly:true,sourceKind:"advance_receipt",sourceId:"application",contributorName:"合成出资方",
    projectId:null,projectName:null,canApply:false,principalYuan:null,paidYuan:null,reservedYuan:null,availableYuan:null,
    applications:[{
      id:"application",status:"pending",revision:2,approvalInstanceId:"round",requestedYuan:"4.0001",
      approvedYuan:null,paidYuan:"0.0000",canApprove:true,canWithdraw:false,canReduce:false,canPay:false,payments:[],
      approvalDuties:[{nodeIndex:1,roleKeys:["finance_director"],requiresSelfPassword:false}],
    }],
  }]});
  expect(readUnrelatedFunding).not.toHaveBeenCalled();
});

it.each(["completion","revocation"])("removes delegated visibility after %s", async change => {
  const fixtureState = fixture();
  if (change === "completion") fixtureState.completeDuty();
  else fixtureState.revoke();
  await expect(fixtureState.service.list("delegate")).rejects.toBeInstanceOf(ForbiddenException);
  expect(fixtureState.readUnrelatedFunding).not.toHaveBeenCalled();
});

it("conceals the application and its revision without the original role or an active delegation", async () => {
  const state = fixture();
  const act = (id: string, expectedRevision: number) => state.service.act("delegate", id, {
    action:"approve",nodeIndex:1,reason:"合成复核依据",expectedRevision,idempotencyKey:"isolated-command"
  });
  // Same active mandate is authorized and still receives the expected stale-version result.
  await expect(act("application",1)).rejects.toMatchObject({
    status:409,response:{code:"REGISTERED_PRINCIPAL_RETURN_REJECTED"}
  });
  expect(state.originWrite).toHaveBeenCalledTimes(1);
  state.originWrite.mockClear();
  state.revoke();
  await expect(act("missing",2)).rejects.toMatchObject({status:403,message:"当前账号无权办理此归还申请"});
  await expect(act("application",2)).rejects.toMatchObject({status:403,message:"当前账号无权办理此归还申请"});
  await expect(act("application",1)).rejects.toMatchObject({status:403,message:"当前账号无权办理此归还申请"});
  expect(state.originWrite).not.toHaveBeenCalled();
});
