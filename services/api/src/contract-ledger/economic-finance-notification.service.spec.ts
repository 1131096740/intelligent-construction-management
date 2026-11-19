import { EconomicFinanceNotificationService } from "./economic-finance-notification.service";

it.each(["eligible","changed-revision","revoked","wrong-project","unknown","closed","contract-stage","retry","retry-unknown"] as const)(
  "履约财务复核通知匹配修订及当下项目财务 (%s)",async scenario=>{
    const row={id:"review",projectId:"project",status:scenario==="contract-stage"?"pending_review":"pending_finance",preparedByUserId:"author",
      contractReviewedById:"contracts",financeRequired:true,revision:2};
    const documents=[{reference:"DOC-A",title:"原合同",counterparty:"合成甲方"},{reference:"DOC-B",title:"补充合同",counterparty:"合成乙方"}];
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
          {projectId:"project",userId:"author",userIsActive:true,roleKey:"finance_director"},
          {projectId:"project",userId:"contracts",userIsActive:true,roleKey:"finance_director"}];
      },
      contractEconomicReview:{findUnique},
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
    const service=new EconomicFinanceNotificationService(prisma as never,sms as never,visibility as never);
    await service.queue(tx as never,row,documents);
    await service.queue(tx as never,row,documents);
    expect([...records.values()].map(event=>event.metadata.recipientId)).toEqual(["wrong-project","contract-stage"].includes(scenario)?[]:["reviewer"]);
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

      if(scenario==="retry"){
        row.revision++;
        sms.sendDutyIntent.mockResolvedValueOnce({status:"failed"});
        await service.queue(tx as never,row,documents);
        await service.afterCommit();
        const latest=await service.status(row.id,"reviewer");
        expect(latest.notice).toMatchObject({status:"failed",canRetry:true});
        expect(latest.notice?.attemptId).not.toBe(old);
        await expect(retry()).rejects.toThrow("已变化");
        expect(sms.sendDutyIntent).toHaveBeenCalledTimes(3);
      }
      revoked=true;
      expect(await service.status(row.id,"reviewer")).toEqual({notice:null});
      await expect(retry()).rejects.toThrow("已变化");
      return;
    }
    revoked=scenario==="revoked";
    if(scenario==="closed")row.status="returned";
    if(scenario==="changed-revision")row.revision++;
    await service.afterCommit();
    await service.afterCommit();
    const sent=["eligible","unknown"].includes(scenario);
    expect(sms.sendDutyIntent).toHaveBeenCalledTimes(sent?1:0);
    if(sent)expect(sms.sendDutyIntent).toHaveBeenCalledWith("13800000000",expect.objectContaining({
      participants:["合成甲方","合成乙方"],amountText:"按文书分项复核",
      dutyName:"复核履约重复金额", businessCode:"DOC-A、DOC-B",
      targetPath:"/审批中心?review=independent%3Acontract_economic_review%3Areview"
    }));
    if(!["wrong-project","contract-stage"].includes(scenario))expect(findUnique).toHaveBeenCalledWith({where:{id:"review"},select:{
      id:true,status:true,projectId:true,preparedByUserId:true,contractReviewedById:true,financeRequired:true,revision:true
    }});
    expect([...records.values()].map(event=>event.action)).toEqual(sent?["queued","dispatch_claimed",scenario==="unknown"?"unknown":"accepted"]:
      ["wrong-project","contract-stage"].includes(scenario)?[]:["queued","cancelled"]);
  });
