import { UpwardAmountNotificationService } from "./upward-amount-notification.service";

it.each(["eligible","revoked","wrong-project","closed","unknown","uncapped","retry","retry-unknown"] as const)(
  "对上合同金额修订通知核对当下独立复核权 (%s)",async scenario=>{
    const row={id:"revision",projectId:"project",contractId:"contract",status:"pending_confirm",recordedByUserId:"author",
      amountNature:scenario==="uncapped"?"uncapped":"fixed",amountCents:scenario==="uncapped"?null:125n};
    let revoked=false;
    const events=new Map<string,{id:string;action:string;businessType:string;businessId:string;metadata:{recipientId?:string;retryOf?:string;intentId?:string}}>();
    const tx={
      $queryRaw:async({strings,values}:{strings:string[];values:string[]})=>{
        const sql=strings.join("");
        if(sql.includes("SELECT queued.*")){
          const all=[...events.values()];
          const queued=all.filter(event=>event.action==="queued"&&event.businessType===values[0]);
          if(sql.includes('ORDER BY queued."createdAt" DESC'))return queued.filter(event=>event.businessId===values[1]&&event.metadata.recipientId===values[2]
            &&!queued.some(retry=>retry.metadata.retryOf===event.id)).reverse().slice(0,1);
          return queued.filter(event=>!all.some(outcome=>outcome.metadata.intentId===event.id));
        }
        return [{projectId:"project",userId:"reviewer",userIsActive:true,roleKey:"contract_director"},
          {projectId:"project",userId:"author",userIsActive:true,roleKey:"contract_director"}];
      },
      upwardContractAmountRevision:{findUnique:async()=>row},
      projectAffiliateCompanyContract:{findFirst:async()=>({contractName:"合成合同",contractReference:"CON-1",
        affiliateNameSnapshot:"合成施工企业",companyEntityNameSnapshot:"合成参与公司"})},
      project:{findUnique:async()=>({name:"合成项目"})},user:{findUnique:async()=>({name:"合成登记人",isActive:true,phone:"13800000000"})},
      auditLog:{
        createMany:async({data}:{data:Array<NonNullable<ReturnType<typeof events.get>>>})=>{
          let count=0;
          for(const item of data)if(!events.has(item.id)){events.set(item.id,item);count++;}
          return {count};
        },
        findFirst:async({where}:{where:{id:{in:string[]}}})=>where.id.in.map(id=>events.get(id)).find(Boolean),
        findMany:async({where}:{where:{id:{in:string[]}}})=>where.id.in.map(id=>events.get(id)).filter(Boolean),
        findUnique:async({where}:{where:{id:string}})=>events.get(where.id)??null
      }
    };
    const visibility={visibleProjectIdsInTransaction:async()=>scenario==="wrong-project"?[]:["project"],
      effectiveRoleKeysByProjectInTransaction:async()=>new Map([["project",revoked?["contract_staff"]:["contract_director"]]])};
    let tail:Promise<unknown>=Promise.resolve();
    const prisma={...tx,$transaction:<T>(run:(db:typeof tx)=>Promise<T>)=>{
      const result=tail.then(()=>run(tx));tail=result.catch(()=>undefined);return result;
    }};
    const sms={available:()=>true,sendDutyIntent:jest.fn().mockResolvedValue({status:scenario==="unknown"?"unknown":"accepted"})};
    const service=new UpwardAmountNotificationService(prisma as never,sms as never,visibility as never);
    await service.queue(tx as never,row);
    await service.queue(tx as never,row);
    expect([...events.values()].map(event=>event.metadata.recipientId)).toEqual(scenario==="wrong-project"?[]:["reviewer"]);
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
    if(scenario==="closed")row.status="returned";
    await service.afterCommit();
    await service.afterCommit();
    const sent=["eligible","unknown","uncapped"].includes(scenario);
    expect(sms.sendDutyIntent).toHaveBeenCalledTimes(sent?1:0);
    if(sent)expect(sms.sendDutyIntent).toHaveBeenCalledWith("13800000000",expect.objectContaining({
      businessCode:"CON-1",participants:["合成施工企业","合成参与公司"],amountText:scenario==="uncapped"?"未约定总额":"修订为 1.25 元",
      targetPath:"/审批中心?review=independent%3Aupward_contract_amount_revision%3Arevision"
    }));
    expect([...events.values()].map(row=>row.action)).toEqual(sent?["queued","dispatch_claimed",scenario==="unknown"?"unknown":"accepted"]:
      scenario==="wrong-project"?[]:["queued","cancelled"]);
  });
