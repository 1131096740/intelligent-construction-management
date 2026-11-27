import { CompanyTransferNotificationService } from "./company-transfer-notification.service";

it.each(["accepted","revoked","closed","unknown","retry"] as const)("互转终审只通知冻结且仍在岗的候选人 (%s)",async scenario=>{
 const row={id:"transfer",status:"submitted",approvalInstanceId:"round",applicantUserId:"author",code:"HZ-FIXTURE",
  amountCents:125n,sourceProjectId:null,destinationProjectId:null,
  frozenParties:{source:{name:"合成甲"},destination:{name:"合成乙"}}};
 const round={id:"round",status:"in_progress",currentNodeIndex:0,businessType:"company_transfer",flowType:"company_transfer.approve",
  businessId:row.id,applicantUserId:"author",frozenNodes:[{mode:"any",roleKeys:["chairman"],
   candidateUserIdsByRole:{chairman:["candidate","author"]}}]};
 const events=new Map<string,{id:string;action:string;businessType:string;businessId:string;metadata:{recipientId?:string;retryOf?:string}}>();
 let revoked=false;
 const tx={
  companyTransfer:{findUnique:async()=>row},
  approvalInstance:{findUnique:async()=>round},
  user:{findUnique:async()=>({isActive:true,name:"合成发起人",phone:"13800000000"})},
  auditLog:{
   createMany:async({data}:{data:Array<NonNullable<ReturnType<typeof events.get>>>})=>{
    let count=0;
    for(const item of data)if(!events.has(item.id)){events.set(item.id,item);count++;}
    return {count};
   },
   findUnique:async({where}:{where:{id:string}})=>events.get(where.id),
   findMany:async({where}:{where:{id:{in:string[]}}})=>where.id.in.flatMap(id=>events.has(id)?[events.get(id)!]:[]),
   findFirst:async({where}:{where:{id:{in:string[]}}})=>where.id.in.map(id=>events.get(id)).find(Boolean)
  },
  $executeRaw:async()=>0,
  $queryRaw:async({strings,values}:{strings:string[];values:unknown[]})=>{
   if(strings.join("").includes("SELECT queued.*"))return [...events.values()].filter(event=>event.action==="queued"&&values.includes(event.businessType)&&
    (!strings.join("").includes("'recipientId'")||(values.includes(event.businessId)&&values.includes(event.metadata.recipientId))));
   return revoked?[]:[{key:"chairman"}];
  }
 };
 const prisma={...tx,$transaction:async(run:(db:typeof tx)=>unknown)=>run(tx)};
 const sms={available:()=>true,sendDutyIntent:jest.fn().mockResolvedValue({status:scenario==="unknown"?"unknown":"accepted"})};
 if(scenario==="retry")sms.sendDutyIntent.mockResolvedValueOnce({status:"failed"});
 const service=new CompanyTransferNotificationService(prisma as never,sms as never);
 const candidates=["candidate","author","new-chairman"];
 await service.queueFinalReview(tx as never,row,round as never,candidates);
 await service.queueFinalReview(tx as never,row,round as never,candidates);
 expect([...events.values()].map(event=>event.metadata.recipientId)).toEqual(["candidate"]);
 expect(sms.sendDutyIntent).not.toHaveBeenCalled();
 if(scenario==="revoked")revoked=true;
 if(scenario==="closed")round.status="approved";
 await service.afterCommit();
 await service.afterCommit();
 expect(sms.sendDutyIntent).toHaveBeenCalledTimes(["accepted","unknown","retry"].includes(scenario)?1:0);
 if(scenario==="accepted")expect(sms.sendDutyIntent).toHaveBeenCalledWith("13800000000",expect.objectContaining({
  participants:["合成甲","合成乙"],amountText:"1.25 元",targetPath:"/公司互转台账"
 }));
 expect([...events.values()].map(event=>event.action)).toEqual(scenario==="closed"||scenario==="revoked"?
  ["queued","cancelled"]:["queued","dispatch_claimed",scenario==="retry"?"failed":scenario]);
 if(scenario==="unknown"){
  const [unknown]=await service.notificationStatus(row.id,"candidate");
  expect(unknown).toMatchObject({status:"unknown",canRetry:false});
  await expect(service.retry(row.id,"candidate",unknown.attemptId)).rejects.toThrow("仅确认发送失败");
 }
 if(scenario==="retry"){
  const [failed]=await service.notificationStatus(row.id,"candidate");
  expect(failed).toMatchObject({status:"failed",canRetry:true,dutyName:"董事长或总经理终审"});
  await expect(service.retry(row.id,"new-chairman",failed.attemptId)).rejects.toThrow("当前待办");
  const wake=jest.spyOn(service,"afterCommit").mockResolvedValue(undefined);
  const next=await service.retry(row.id,"candidate",failed.attemptId);
  expect(next).toMatchObject({status:"queued",canRetry:false});
  wake.mockRestore();
  await service.afterCommit();
  expect(await service.retry(row.id,"candidate",failed.attemptId)).toMatchObject({attemptId:next.attemptId,status:"accepted"});
  expect(sms.sendDutyIntent).toHaveBeenCalledTimes(2);
 }
});

it("批准未出款与多笔独立核对均有稳定键，排除本人出款和结清的出款",async()=>{
 const {currentCompanyTransferCashDuties}=await import("./company-transfer.domain");
 const createdAt=new Date();
 const row={status:"approved",amountCents:1200n,createdAt,approvedAt:createdAt};
 const own={id:"own",kind:"outgoing",amountCents:300n,outgoingEventId:null,recordedByUserId:"actor",createdAt};
 const other={...own,id:"other",amountCents:450n,recordedByUserId:"reviewer"};
 const remaining={...other,id:"third",amountCents:100n};
 const received={...other,id:"received",kind:"incoming",outgoingEventId:"other",amountCents:100n};
 const returned={...other,id:"returned",kind:"returned",outgoingEventId:"third",amountCents:100n};
 expect(currentCompanyTransferCashDuties(row,[own,other,remaining,received,returned],"actor")
  .map(duty=>[duty.key,duty.amountCents])).toEqual([["outgoing",350n],["other",350n]]);
 expect(currentCompanyTransferCashDuties(row,[own,other,remaining,received,returned],"reviewer")
  .map(duty=>[duty.key,duty.amountCents])).toEqual([["outgoing",350n],["own",300n]]);
 const settledRefund={...received,id:"refund",kind:"returned",returnedIncomingEventId:received.id};
 expect(currentCompanyTransferCashDuties(row,[own,other,remaining,received,returned,settledRefund],"actor")
  .map(duty=>[duty.key,duty.amountCents])).toEqual([["outgoing",350n],["other",350n]]);
});

it("两笔出款分别通知另一有效财务，撤岗与结清仅取消各自候选",async()=>{
 const createdAt=new Date();
 const transfer={id:"transfer",status:"approved",code:"HZ-FIXTURE",applicantUserId:"origin",approvalInstanceId:"round",
  amountCents:1200n,createdAt,approvedAt:createdAt,sourceProjectId:null,destinationProjectId:null,requiresParallelRepaymentApproval:false,
  frozenParties:{source:{name:"合成甲"},destination:{name:"合成乙"}}};
 const first={id:"leg1",kind:"outgoing",amountCents:300n,outgoingEventId:null,recordedByUserId:"a",createdAt};
 const second={...first,id:"leg2",amountCents:450n,recordedByUserId:"b"};
 const legs: Array<Omit<typeof first,"outgoingEventId"> & {outgoingEventId:string|null;returnedIncomingEventId?:string}>=[first,second];
 const revoked=new Set<string>();
 const events=new Map<string,{id:string;action:string;metadata:{recipientId?:string;key?:string}}>();
 const tx={
  position:{findMany:async()=>[{id:"finance-role"}]},
  userPosition:{findMany:async()=>["a","b","c"].map(userId=>({userId}))},
  companyTransfer:{findUnique:async()=>transfer},
  companyTransferEvent:{findMany:async({select}:{select:Record<string,boolean>})=>legs.map(leg=>
   Object.fromEntries(Object.keys(select).map(key=>[key,leg[key as keyof typeof leg]])))},
  user:{findUnique:async({where}:{where:{id:string}})=>({name:where.id,isActive:true,phone:where.id})},
  auditLog:{
   createMany:async({data}:{data:Array<NonNullable<ReturnType<typeof events.get>>>})=>{
    let count=0;
    for(const item of data)if(!events.has(item.id)){events.set(item.id,item);count++;}
    return {count};
   },
   findFirst:async({where}:{where:{id:{in:string[]}}})=>where.id.in.map(id=>events.get(id)).find(Boolean)
  },
  $executeRaw:async()=>0,
  $queryRaw:async({strings,values}:{strings:string[];values:unknown[]})=>{
   if(strings.join("").includes("SELECT queued.*"))return values.includes("company_transfer_cash_duty_notification")
    ? [...events.values()].filter(event=>event.action==="queued") : [];
   return revoked.has(String(values[0]))?[]:[{key:"finance_staff"}];
  }
 };
 const prisma={...tx,$transaction:async(run:(db:typeof tx)=>unknown)=>run(tx)};
 const sms={available:()=>true,sendDutyIntent:jest.fn().mockResolvedValue({status:"accepted"})};
 const service=new CompanyTransferNotificationService(prisma as never,sms as never);
 for(const key of ["leg1","leg2","leg2","outgoing"])await service.queueCashDuty(tx as never,transfer,key,"origin");
 expect([...events.values()].map(row=>[row.metadata.key,row.metadata.recipientId])).toEqual([
  ["leg1","b"],["leg1","c"],["leg2","a"],["leg2","c"],["outgoing","a"],["outgoing","b"],["outgoing","c"]
 ]);
 revoked.add("c");
 legs.push({...first,id:"returned",kind:"returned",outgoingEventId:"leg1"});
 legs.push({...second,id:"received",kind:"incoming",outgoingEventId:"leg2",amountCents:100n},
  {...second,id:"settled-refund",kind:"returned",outgoingEventId:"leg2",returnedIncomingEventId:"received",amountCents:100n});
 await service.afterCommit();
 await service.afterCommit();
 expect(sms.sendDutyIntent.mock.calls.map(([phone,intent])=>[phone,intent.dutyName,intent.amountText])).toEqual([
  ["a","独立核对该笔到账或退回","3.50 元"],["a","登记实际出款","4.50 元"],["b","登记实际出款","4.50 元"]
 ]);
 expect([...events.values()].filter(event=>event.action==="cancelled")).toHaveLength(4);
});

it("原债更正待办使用部分退款后的净额并在全额退回后结束", async () => {
 const {currentCompanyTransferCorrectionDuties}=await import("./company-transfer-correction-duty");
 const transfer={requiresParallelRepaymentApproval:true,sourceProjectId:"p",originalProxyId:"proxy"};
 const outgoing={id:"out",kind:"outgoing",outgoingEventId:null,amountCents:800n};
 const incoming={id:"in",kind:"incoming",outgoingEventId:outgoing.id,amountCents:800n};
 const refund={id:"refund",kind:"returned",outgoingEventId:outgoing.id,returnedIncomingEventId:incoming.id,amountCents:300n};
 const tx={companyTransferOriginalDebtCorrection:{findMany:jest.fn().mockResolvedValue([
  {outgoingEventId:outgoing.id,status:"pending",requestedAt:new Date(),requestedByUserId:"finance"},
 ])}};
 expect(await currentCompanyTransferCorrectionDuties(tx as never,transfer,[outgoing,incoming,refund]))
  .toEqual([expect.objectContaining({event:expect.objectContaining({amountCents:500n})})]);
 expect(await currentCompanyTransferCorrectionDuties(tx as never,transfer,[outgoing,incoming,{...refund,amountCents:800n}]))
  .toEqual([]);
});

it("项目财务两边都有效才具有实际互转权限",async()=>{
 const {companyTransferCashAccess}=await import("./company-transfer.access");
 const visibility={
  visibleProjectIdsInTransaction:jest.fn().mockResolvedValue(["one","two"]),
  effectiveRoleKeysByProjectInTransaction:jest.fn().mockResolvedValue(new Map([["one",["finance_staff"]],["two",["project_manager"]]]))
 };
 expect(await companyTransferCashAccess({} as never,visibility as never,"actor",["one","two"],[])).toBe(false);
 visibility.effectiveRoleKeysByProjectInTransaction.mockResolvedValue(new Map([["one",["finance_staff"]],["two",["finance_director"]]]));
 expect(await companyTransferCashAccess({} as never,visibility as never,"actor",["one","two"],[])).toBe(true);
 visibility.visibleProjectIdsInTransaction.mockResolvedValue(["one"]);
 expect(await companyTransferCashAccess({} as never,visibility as never,"actor",["one","two"],[])).toBe(false);
 expect(await companyTransferCashAccess({} as never,visibility as never,"actor",["one",null],[])).toBe(false);
 expect(await companyTransferCashAccess({} as never,visibility as never,"actor",["one",null],["finance_staff"])).toBe(true);
});

it("出款与两个独立到账职责各自重试，旧凭据不跨腿、当前权限变化时不发",async()=>{
 const createdAt=new Date();
 const transfer={id:"transfer",status:"approved",code:"HZ-FIXTURE",applicantUserId:"origin",approvalInstanceId:"round",
  amountCents:1200n,createdAt,approvedAt:createdAt,sourceProjectId:null,destinationProjectId:null,requiresParallelRepaymentApproval:false,
  frozenParties:{source:{name:"甲"},destination:{name:"乙"}}};
 const events=[
  {id:"leg-a",kind:"outgoing",amountCents:350n,outgoingEventId:null as string|null,recordedByUserId:"origin",createdAt},
  {id:"leg-b",kind:"outgoing",amountCents:450n,outgoingEventId:null as string|null,recordedByUserId:"origin",createdAt}
 ];
 type Notice={id:string;action:string;businessType:string;businessId:string;metadata:{recipientId?:string;intentId?:string;key?:string;retryOf?:string}};
 const notices=new Map<string,Notice>();
 let revoked=false;
 const tx={
  position:{findMany:async()=>[{id:"finance"}]},
  userPosition:{findMany:async()=>[{userId:"reviewer"}]},
  companyTransfer:{findUnique:async()=>transfer},companyTransferEvent:{findMany:async()=>events},
  user:{findUnique:async()=>({name:"合成收件人",isActive:true,phone:"13800000000"})},
  auditLog:{
   findUnique:async({where}:{where:{id:string}})=>notices.get(where.id),
   findMany:async({where}:{where:{id:{in:string[]}}})=>where.id.in.flatMap(id=>notices.has(id)?[notices.get(id)!]:[]),
   findFirst:async({where}:{where:{id:{in:string[]}}})=>where.id.in.map(id=>notices.get(id)).find(Boolean),
   createMany:async({data}:{data:Notice[]})=>{
    let count=0;
    for(const item of data)if(!notices.has(item.id)){notices.set(item.id,item);count++;}
    return {count};
   }
  },
  $executeRaw:async()=>0,
  $queryRaw:async({strings,values}:{strings:string[];values:unknown[]})=>{
   const sql=strings.join("");
   if(!sql.includes("SELECT queued.*"))return revoked?[]:[{key:"finance_staff"}];
   return [...notices.values()].filter(item=>item.action==="queued"&&values.includes(item.businessType)&&
    (!sql.includes("'recipientId'")||(values.includes(item.metadata.recipientId)&&values.includes(item.businessId))));
  }
 };
 let serial:Promise<unknown>=Promise.resolve();
 const prisma={...tx,$transaction:(run:(db:typeof tx)=>unknown)=>{
  const next=serial.then(()=>run(tx));serial=next.catch(()=>undefined);return next;
 }};
 const send=jest.fn().mockResolvedValue({status:"failed"});
 const notifier=new CompanyTransferNotificationService(prisma as never,{available:()=>true,sendDutyIntent:send} as never);
 for(const key of ["outgoing","leg-a","leg-b"])await notifier.queueCashDuty(tx as never,transfer,key,"origin");
 await notifier.afterCommit();
 expect(send).toHaveBeenCalledTimes(3);
 const [outgoing,a,b]=[...notices.values()].filter(item=>item.action==="queued");
 const snapshot=await notifier.notificationStatus(transfer.id,"reviewer");
 expect(snapshot).toHaveLength(3);
 expect(snapshot.every(entry=>entry.status==="failed"&&entry.canRetry)).toBe(true);
 expect(await notifier.notificationStatus(transfer.id,"other")).toEqual([]);
 await expect(notifier.retry(transfer.id,"other",a.id)).rejects.toThrow("当前待办");
 await expect(notifier.retry("other-transfer","reviewer",a.id)).rejects.toThrow("当前待办");
 revoked=true;
 await expect(notifier.retry(transfer.id,"reviewer",a.id)).rejects.toThrow("当前待办");
 revoked=false;
 const wake=jest.spyOn(notifier,"afterCommit").mockResolvedValue(undefined);
 const [first,replayed]=await Promise.all([notifier.retry(transfer.id,"reviewer",a.id),notifier.retry(transfer.id,"reviewer",a.id)]);
 expect(first).toEqual(replayed);
 expect(first).toMatchObject({status:"queued",canRetry:false});
 expect(wake).toHaveBeenCalledTimes(1);
 const pending=await notifier.notificationStatus(transfer.id,"reviewer");
 expect(pending.find(notice=>notice.attemptId===b.id)).toMatchObject({status:"failed",canRetry:true});
 expect(pending.find(notice=>notice.attemptId===outgoing.id)).toMatchObject({status:"failed",canRetry:true});
 await expect(notifier.retry(transfer.id,"reviewer",first.attemptId)).rejects.toThrow("仅确认发送失败");
 send.mockResolvedValue({status:"accepted"});
 wake.mockRestore();
 await notifier.afterCommit();
 expect(send).toHaveBeenCalledTimes(4);
 expect(send.mock.calls.at(-1)?.[1]).toMatchObject({amountText:"3.50 元"});
 expect(await notifier.retry(transfer.id,"reviewer",a.id)).toMatchObject({attemptId:first.attemptId,status:"accepted"});
 await expect(notifier.retry(transfer.id,"reviewer",first.attemptId)).rejects.toThrow("仅确认发送失败");
 events.push({...events[0],id:"settled",kind:"incoming",outgoingEventId:"leg-a"});
 expect(await notifier.notificationStatus(transfer.id,"reviewer")).toHaveLength(2);
 await expect(notifier.retry(transfer.id,"reviewer",a.id)).rejects.toThrow("当前待办");
});
