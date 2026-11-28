import { ContractProxyNotificationService } from "./contract-proxy-notification.service";

it.each(["payment","refund","repayment","mismatch","revoked","wrong-project","unknown","retry","retry-unknown"] as const)(
  "代付资金待确认匹配冻结资金双方及当下项目财务 (%s)",async scenario=>{
    const entryKind=scenario==="refund"||scenario==="repayment"?scenario:"payment";
    const debtor={kind:"participating_company",id:"debtor",name:"合成原债务人"};
    const payee={kind:"downstream_counterparty",id:"payee",name:"合成原收款方"};
    const actualPayer={kind:"construction_enterprise",id:"payer",name:"合成代付方"};
    const outgoing=entryKind==="payment"?actualPayer:entryKind==="refund"?payee:debtor;
    const incoming=entryKind==="payment"?payee:actualPayer;
    const row={id:"proxy",projectId:"project",status:"pending_confirm",recordedByUserId:"author",entryKind,amountCents:125n,
      actualPayerKey:scenario==="mismatch"?"forged":`${outgoing.kind}:${outgoing.id}`,
      frozenSource:{debtor,payee,actualPayer,reference:"合成结算编号"}};
    let revoked=false;
    const records=new Map<string,{id:string;action:string;businessType:string;businessId:string;metadata:{recipientId?:string;retryOf?:string;intentId?:string}}>();
    const findUnique=jest.fn().mockResolvedValue(row);
    const tx={
      $queryRaw:async({strings,values}:{strings:string[];values:string[]})=>{
        const sql=strings.join("");
        if(sql.includes("SELECT queued.*")){
          const all=[...records.values()];
          const queued=all.filter(event=>event.action==="queued"&&event.businessType===values[0]);
          if(sql.includes('ORDER BY queued."createdAt" DESC'))return queued.filter(event=>event.businessId===values[1]&&event.metadata.recipientId===values[2]
            &&!queued.some(retry=>retry.metadata.retryOf===event.id)).reverse().slice(0,1);
          return queued.filter(event=>!all.some(outcome=>outcome.metadata.intentId===event.id));
        }
        return [{projectId:"project",userId:"reviewer",userIsActive:true,roleKey:"finance_director"},
          {projectId:"project",userId:"author",userIsActive:true,roleKey:"finance_director"}];
      },
      contractProxyExecution:{findUnique},
      project:{findUnique:async()=>({name:"合成项目"})},user:{findUnique:async()=>({name:"合成登记人",isActive:true,phone:"13800000000"})},
      auditLog:{
        createMany:async({data}:{data:Array<NonNullable<ReturnType<typeof records.get>>>})=>{
          let count=0;
          for(const item of data)if(!records.has(item.id)){records.set(item.id,item);count++;}
          return {count};
        },
        findFirst:async({where}:{where:{id:{in:string[]}}})=>where.id.in.map(id=>records.get(id)).find(Boolean),
        findMany:async({where}:{where:{id:{in:string[]}}})=>where.id.in.map(id=>records.get(id)).filter(Boolean),
        findUnique:async({where}:{where:{id:string}})=>records.get(where.id)??null
      }
    };
    const visibility={visibleProjectIdsInTransaction:async()=>scenario==="wrong-project"?[]:["project"],
      effectiveRoleKeysByProjectInTransaction:async()=>new Map([["project",revoked?["finance_staff"]:["finance_director"]]])};
    let tail:Promise<unknown>=Promise.resolve();
    const prisma={...tx,$transaction:<T>(run:(db:typeof tx)=>Promise<T>)=>{
      const result=tail.then(()=>run(tx));tail=result.catch(()=>undefined);return result;
    }};
    const sms={available:()=>true,sendDutyIntent:jest.fn().mockResolvedValue({status:scenario==="unknown"?"unknown":"accepted"})};
    const service=new ContractProxyNotificationService(prisma as never,sms as never,visibility as never);
    await service.queue(tx as never,row);
    await service.queue(tx as never,row);
    expect([...records.values()].map(event=>event.metadata.recipientId)).toEqual(scenario==="wrong-project"?[]:["reviewer"]);
    expect(sms.sendDutyIntent).not.toHaveBeenCalled();
    if(scenario==="retry"||scenario==="retry-unknown"){
      sms.sendDutyIntent.mockResolvedValueOnce({status:"failed"});
      await service.afterCommit();
      const {notice}=await service.status(row.id,"reviewer");
      expect(notice).toMatchObject({status:"failed",canRetry:true});
      const old=notice!.attemptId;
      await expect(service.retry(row.id,"author",old)).rejects.toThrow("已变化");
      await expect(service.retry("other-business","reviewer",old)).rejects.toThrow("已变化");
      if(scenario==="retry-unknown")sms.sendDutyIntent.mockRejectedValueOnce(new Error("合成响应丢失"));
      const retry=()=>service.retry(row.id,"reviewer",old);
      await Promise.all([retry(),retry()]);
      const result=await retry();
      expect(result).toMatchObject({status:scenario==="retry"?"accepted":"unknown",canRetry:false});
      await expect(service.retry(row.id,"reviewer",result.attemptId)).rejects.toThrow("仅确认发送失败");
      expect(sms.sendDutyIntent).toHaveBeenCalledTimes(2);
      revoked=true;
      expect(await service.status(row.id,"reviewer")).toEqual({notice:null});
      await expect(retry()).rejects.toThrow("已变化");
      return;
    }
    revoked=scenario==="revoked";
    await service.afterCommit();
    await service.afterCommit();
    const sent=["payment","refund","repayment","unknown"].includes(scenario);
    expect(sms.sendDutyIntent).toHaveBeenCalledTimes(sent?1:0);
    if(sent)expect(sms.sendDutyIntent).toHaveBeenCalledWith("13800000000",expect.objectContaining({
      participants:[`出款方：${outgoing.name}`,`收款方：${incoming.name}`],amountText:"1.25 元",
      targetPath:"/审批中心?review=independent%3Acontract_proxy_execution%3Aproxy"
    }));
    if(scenario!=="wrong-project")expect(findUnique).toHaveBeenCalledWith({where:{id:"proxy"},select:{
      id:true,status:true,projectId:true,recordedByUserId:true,entryKind:true,amountCents:true,actualPayerKey:true,frozenSource:true
    }});
    expect([...records.values()].map(event=>event.action)).toEqual(sent?["queued","dispatch_claimed",scenario==="unknown"?"unknown":"accepted"]:
      scenario==="wrong-project"?[]:["queued","cancelled"]);
  });
