import { ContractBankVerificationNotificationService } from "./contract-bank-verification-notification.service";

it.each(["accepted", "revoked", "project", "wrong-project", "project-role-revoked", "unknown", "owned-retry", "project-retry"] as const)("自有资金核验严格依赖当前独立财务主管 (%s)", async state => {
  const project = ["project","wrong-project","project-role-revoked","project-retry"].includes(state);
  const retry = state.endsWith("-retry");
  const row = {
    id:"verification", projectId: project ? "project" : null, status:"pending_confirm",
    recordedByUserId:"author", companyName:"合成付款公司", amountCents:125n, direction:"outflow"
  };
  const outbox = new Map<string,{id:string;action:string;metadata:{recipientId?:string;retryOf?:string};businessType:string;businessId:string}>();
  let revoked = false;
  const verifyProjection = jest.fn(async () => row);
  const tx = {
    project:{findUnique:async()=>({name:"合成项目"})},
    contractBankVerificationRequest:{findUnique:verifyProjection},
    position:{findUnique:async()=>({id:"director"})},
    userPosition:{findMany:async()=>[{userId:"reviewer"},{userId:"author"}]},
    user:{findUnique:async()=>({isActive:true,name:"合成登记人",phone:"13800000000"})},
    auditLog:{
      createMany:async({data}:{data:Array<NonNullable<ReturnType<typeof outbox.get>>>})=>{
        let count=0;for(const item of data)if(!outbox.has(item.id)){outbox.set(item.id,item);count++;}
        return {count};
      },
      findUnique:async({where}:{where:{id:string}})=>outbox.get(where.id),
      findMany:async({where}:{where:{id:{in:string[]}}})=>where.id.in.flatMap(id=>outbox.has(id)?[outbox.get(id)!]:[]),
      findFirst:async({where}:{where:{id:{in:string[]}}})=>where.id.in.map(id=>outbox.get(id)).find(Boolean)
    },
    $queryRaw:async({strings,values}:{strings:string[];values:unknown[]})=> {
      const query=strings.join("");
      if(query.includes("SELECT queued.*")) {
        const queued=[...outbox.values()].filter(row=>row.action==="queued"&&values.includes(row.businessType));
        if(query.includes("retryOf"))return queued.filter(row=>values.includes(row.businessId)&&values.includes(row.metadata.recipientId)&&
          !queued.some(child=>child.metadata.retryOf===row.id)).slice(-1);
        return queued;
      }
      if(query.includes('SELECT p."key"'))return !project&&revoked?[]:[{key:"finance_director"}];
      return [];
    }
  };
  let serial:Promise<unknown>=Promise.resolve();
  const prisma={...tx,$transaction:(run:(db:typeof tx)=>unknown)=>{
    const next=serial.then(()=>run(tx));serial=next.catch(()=>undefined);return next;
  }};
  const sms={available:()=>true,sendDutyIntent:jest.fn().mockResolvedValue({status:state==="unknown"?"unknown":"accepted"})};
  if(retry)sms.sendDutyIntent.mockResolvedValueOnce({status:"failed"});
  const visibility={
    visibleProjectIdsInTransaction:async()=>state==="wrong-project"?["other"]:["project"],
    effectiveRoleKeysByProjectInTransaction:async()=>new Map([["project",revoked?["project_manager"]:["finance_staff"]]])
  };
  const service=new ContractBankVerificationNotificationService(prisma as never,sms as never,visibility as never);
  await service.queue(tx as never,row);
  await service.queue(tx as never,row);
  expect(sms.sendDutyIntent).not.toHaveBeenCalled();
  expect([...outbox.values()].map(item=>item.metadata.recipientId)).toEqual(state==="wrong-project"?[]:["reviewer"]);
  revoked=state==="revoked" || state==="project-role-revoked";
  await service.afterCommit();
  await service.afterCommit();
  expect(sms.sendDutyIntent).toHaveBeenCalledTimes(state==="wrong-project"||revoked?0:1);
  if(state==="accepted"||state==="unknown"||state==="project"){
    expect(sms.sendDutyIntent).toHaveBeenCalledWith("13800000000",expect.objectContaining({
      participants:["合成付款公司"],amountText:"1.25 元",scopeName:project?"合成项目":"公司自有资金",
      targetPath:"/审批中心?review=independent%3Acontract_bank_verification%3Averification"
    }));
    expect(verifyProjection).toHaveBeenCalledWith({where:{id:"verification"},select:{
      id:true, projectId:true, status:true, recordedByUserId:true, companyName:true, amountCents:true, direction:true
    }});
  }
  expect([...outbox.values()].map(item=>item.action)).toEqual(state==="wrong-project"?[]:
    revoked?["queued","cancelled"]:["queued","dispatch_claimed",state==="project"?"accepted":retry?"failed":state]);
  if (state==="accepted" || state==="unknown") {
    const current=await service.notificationStatus(row.id,"reviewer");
    expect(current).toMatchObject({status:state,canRetry:false});
    await expect(service.retry(row.id,"reviewer",current!.attemptId)).rejects.toThrow("仅确认发送失败");
  }
  if (!retry) return;
  verifyProjection.mockClear();
  const failed=await service.notificationStatus(row.id,"reviewer");
  expect(verifyProjection.mock.calls).toEqual([
    [{where:{id:row.id},select:{projectId:true,status:true}}],
    [{where:{id:row.id},select:{id:true,projectId:true,status:true,recordedByUserId:true}}]
  ]);
  expect(failed).toMatchObject({status:"failed",canRetry:true});
  const attemptId=failed!.attemptId;
  expect(await service.notificationStatus(row.id,"author")).toBeNull();
  await expect(service.retry(row.id,"author",attemptId)).rejects.toThrow("当前待办");
  await expect(service.retry("other-verification","reviewer",attemptId)).rejects.toThrow("当前待办");
  revoked=true;
  expect(await service.notificationStatus(row.id,"reviewer")).toBeNull();
  await expect(service.retry(row.id,"reviewer",attemptId)).rejects.toThrow("当前待办");
  revoked=false;
  const dispatch=jest.spyOn(service,"afterCommit").mockResolvedValue(undefined);
  const [first,second]=await Promise.all([service.retry(row.id,"reviewer",attemptId),service.retry(row.id,"reviewer",attemptId)]);
  expect(first).toEqual(second);
  expect(first).toMatchObject({status:"queued",canRetry:false});
  expect(dispatch).toHaveBeenCalledTimes(1);
  await expect(service.retry(row.id,"reviewer",first.attemptId)).rejects.toThrow("仅确认发送失败");
  dispatch.mockRestore();
  await service.afterCommit();
  expect(await service.retry(row.id,"reviewer",attemptId)).toMatchObject({attemptId:first.attemptId,status:"accepted"});
  expect(sms.sendDutyIntent).toHaveBeenCalledTimes(2);
  row.status="returned";
  expect(await service.notificationStatus(row.id,"reviewer")).toBeNull();
  await expect(service.retry(row.id,"reviewer",attemptId)).rejects.toThrow("当前待办");
  expect([...outbox.values()].filter(item=>item.metadata.retryOf===attemptId)).toHaveLength(1);
});
