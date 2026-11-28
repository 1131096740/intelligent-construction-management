import { UpwardReceiptMatchNotificationService } from "./upward-receipt-match-notification.service";

it.each(["match","release","mismatch","revoked","wrong-project","unknown","closed","retry","retry-unknown"] as const)(
  "对上到账核销匹配冻结双方及当下项目财务 (%s)",async scenario=>{
    const row={id:"match",projectId:"project",status:"pending_confirm",recordedByUserId:"author",amountCents:125n,
      receiptFactId:"receipt",settlementLedgerId:"settlement",originalId:scenario==="release"?"prior":null,
      frozenSource:{contractRelationship:"upward",receiptFactId:scenario==="mismatch"?"elsewhere":"receipt",
        settlementLedgerId:"settlement",companyName:"合成公司",affiliate:{name:"合成施工企业"},reference:"合成结算编号"}};
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
      upwardReceiptMatch:{findUnique},
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
    const service=new UpwardReceiptMatchNotificationService(prisma as never,sms as never,visibility as never);
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
    if(scenario==="closed")row.status="returned";
    await service.afterCommit();
    await service.afterCommit();
    const sent=["match","release","unknown"].includes(scenario);
    expect(sms.sendDutyIntent).toHaveBeenCalledTimes(sent?1:0);
    if(sent)expect(sms.sendDutyIntent).toHaveBeenCalledWith("13800000000",expect.objectContaining({
      participants:["施工企业：合成施工企业","我方公司：合成公司"],amountText:"1.25 元",
      dutyName:scenario==="release"?"复核解除到账核销":"复核对上到账核销",
      targetPath:"/审批中心?review=independent%3Aupward_receipt_match%3Amatch"
    }));
    if(scenario!=="wrong-project")expect(findUnique).toHaveBeenCalledWith({where:{id:"match"},select:{
      id:true,status:true,projectId:true,recordedByUserId:true,receiptFactId:true,settlementLedgerId:true,originalId:true,amountCents:true,frozenSource:true
    }});
    expect([...records.values()].map(event=>event.action)).toEqual(sent?["queued","dispatch_claimed",scenario==="unknown"?"unknown":"accepted"]:
      scenario==="wrong-project"?[]:["queued","cancelled"]);
  });
