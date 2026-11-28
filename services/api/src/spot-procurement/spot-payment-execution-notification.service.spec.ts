import { SpotPaymentExecutionNotificationService } from "./spot-payment-execution-notification.service";

it.each(["partial","blocked","revoked","fully-paid","unknown","failed-retry"] as const)(
  "零采实付出站重核项目财务及当前可付额度 (%s)",async scenario=>{
    const payment={id:"payment",projectId:"project",procurementId:"procurement",procurementVersionId:"version",code:"LX-1",
      status:"approved_pending_payment",companyPaymentAmountCents:850n,canceledCompanyPaymentAmountCents:100n,paidAmountCents:0n,
      updatedAt:new Date(),handlerUserId:"author",payeeNameSnapshot:"合成收款人",payerCompanyNameSnapshot:"合成付款方"};
    let blocked=false,revoked=false;
    const notices=new Map<string,{id:string;action:string;businessType:string;businessId:string;metadata:{recipientId?:string;retryOf?:string}}>();
    const tx={
      spotProcurement:{findUnique:async()=>({projectId:"project",currentVersionId:"version",status:"approved_in_progress"})},
      spotProcurementVersion:{findUnique:async()=>({id:"version",procurementId:"procurement",status:"approved"})},
      spotProcurementDiscrepancy:{findFirst:async()=>blocked?{id:"discrepancy"}:null},
      spotProcurementPayment:{findUnique:async()=>payment},
      approvalInstance:{findUnique:async()=>({businessId:payment.id,businessType:"spot_procurement_payment",flowType:"spot_procurement.payment.approve",
        status:"approved",applicantUserId:"author"})},
      user:{findUnique:async()=>({name:"合成角色",isActive:true,phone:"13800000000"})},
      project:{findUnique:async()=>({name:"合成项目"})},
      auditLog:{
        createMany:async({data}:{data:Array<NonNullable<ReturnType<typeof notices.get>>>})=>{
          let count=0;
          for(const item of data)if(!notices.has(item.id)){notices.set(item.id,item);count++;}
          return {count};
        },
        findUnique:async({where}:{where:{id:string}})=>notices.get(where.id),
        findMany:async({where}:{where:{id:{in:string[]}}})=>where.id.in.flatMap(id=>notices.has(id)?[notices.get(id)!]:[]),
        findFirst:async({where}:{where:{id:{in:string[]}}})=>where.id.in.map(id=>notices.get(id)).find(Boolean)
      },
      $queryRaw:async({strings,values}:{strings:string[];values:unknown[]})=>{
        const sql=strings.join("");
        if (sql.includes("SELECT queued.*")) {
          const queued=[...notices.values()].filter(row=>row.action==="queued");
          if (sql.includes("retryOf")) return queued.filter(row=>values.includes(row.businessId) && values.includes(row.metadata.recipientId) &&
            !queued.some(retry=>retry.metadata.retryOf===row.id)).slice(-1);
          return queued;
        }
        return revoked?[]:[{projectId:"project",userId:"finance",roleKey:"finance_staff",userIsActive:true},
          {projectId:"different",userId:"other",roleKey:"finance_staff",userIsActive:true}];
      }
    };
    let serial:Promise<unknown>=Promise.resolve();
    const prisma={...tx,$transaction:(run:(db:typeof tx)=>unknown)=>{
      const next=serial.then(()=>run(tx));
      serial=next.catch(()=>undefined);
      return next;
    }};
    const sms={available:()=>true,sendDutyIntent:jest.fn().mockResolvedValue({status:scenario==="unknown"?"unknown":"accepted"})};
    if (scenario==="failed-retry") sms.sendDutyIntent.mockResolvedValueOnce({status:"failed"});
    const service=new SpotPaymentExecutionNotificationService(prisma as never,sms as never,{isEnabled:()=>true} as never);
    await service.queue(tx as never,payment,"round","approver");
    await service.queue(tx as never,payment,"round","approver");
    expect([...notices.values()].map(row=>row.metadata.recipientId)).toEqual(["finance"]);
    expect(sms.sendDutyIntent).not.toHaveBeenCalled();
    payment.status="partially_paid";payment.paidAmountCents=scenario==="fully-paid"?750n:200n;
    blocked=scenario==="blocked";revoked=scenario==="revoked";
    await service.afterCommit();
    await service.afterCommit();
    const original=[...notices.values()].find(row=>row.action==="queued")!;
    if(scenario==="failed-retry") {
      expect(await service.notificationStatus("payment","finance")).toMatchObject({status:"failed",canRetry:true});
      expect(await service.notificationStatus("payment","other")).toBeNull();
      await expect(service.retry("payment","other",original.id)).rejects.toThrow("当前待办");
      revoked=true;
      await expect(service.retry("payment","finance",original.id)).rejects.toThrow("当前待办");
      revoked=false;
      const dispatch=jest.spyOn(service,"afterCommit").mockResolvedValue(undefined);
      const [first,concurrent]=await Promise.all([
        service.retry("payment","finance",original.id),service.retry("payment","finance",original.id)
      ]);
      expect(first).toEqual(concurrent);
      expect(first).toMatchObject({status:"queued",canRetry:false});
      expect(dispatch).toHaveBeenCalledTimes(1);
      await expect(service.retry("payment","finance",first.attemptId)).rejects.toThrow("仅确认发送失败");
      dispatch.mockRestore();
      await service.afterCommit();
      const replay=await service.retry("payment","finance",original.id);
      expect(replay).toMatchObject({attemptId:first.attemptId,status:"accepted",canRetry:false});
      await expect(service.retry("payment","finance",first.attemptId)).rejects.toThrow("仅确认发送失败");
      expect(sms.sendDutyIntent).toHaveBeenCalledTimes(2);
      expect([...notices.values()].filter(row=>row.metadata.retryOf===original.id)).toHaveLength(1);
      return;
    }
    if(scenario==="partial"||scenario==="unknown") {
      expect(await service.notificationStatus("payment","finance")).toMatchObject({status:scenario==="unknown"?"unknown":"accepted",canRetry:false});
      await expect(service.retry("payment","finance",original.id)).rejects.toThrow("仅确认发送失败");
    }
    const emitted=scenario==="partial"||scenario==="unknown";
    expect(sms.sendDutyIntent).toHaveBeenCalledTimes(emitted?1:0);
    if(emitted)expect(sms.sendDutyIntent).toHaveBeenCalledWith("13800000000",expect.objectContaining({
      targetPath:"/零星材料付款/payment",amountText:"待实付 5.50 元",details:["已实付 2.00 元"]
    }));
    expect([...notices.values()].map(row=>row.action)).toEqual(emitted?["queued","dispatch_claimed",scenario==="unknown"?"unknown":"accepted"]:["queued","cancelled"]);
  });
