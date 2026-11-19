import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { hash } from "bcryptjs";
import { Catch, HttpException, type ArgumentsHost, type INestApplication } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { PrismaClient } from "@prisma/client";
import { Test } from "@nestjs/testing";
import { auditDutyNoticeId } from "../approval/audit-duty-notification-delivery";
import { ApprovalSmsService } from "../approval/approval-sms.service";
import { apiJsonReplacer } from "../api-json-replacer";
import { OperatingSourceReplayService } from "../operating-ledger/operating-source-replay.service";
import { REGISTERED_PAYMENT_IMPACT_READER, readTask16RegisteredPaymentImpacts } from "../payment/registered-payment-impact-reader";
import { createApiValidationPipe } from "../validation/api-validation";
import { PrismaService } from "./prisma.service";
import { buildRegisteredPgFixturePlan } from "./registered-payment-postgres.fixture";
import { registeredPaymentInstalled } from "./registered-payment-catalog";
import { Task16RegistrationErrorFilter, projectTask16RegistrationError } from "./task16-registration-error-diagnostic";
import { Task16SharedPaymentApplicationModule } from "./task16-shared-payment-application";
import { seedSharedPaymentPredecessors } from "./task16-shared-standard-fixture";

const enabled = process.env.RUN_TASK409_PRINCIPAL_PG16 === "1";
const roleCoverage = process.env.TASK409_PRINCIPAL_ROLE_ONLY === "1";
const proveRetry = process.env.TASK419_PRINCIPAL_RETRY_PROOF === "1";
const principalPath = "/fund-accounts/principal-returns";

@Catch()
class Task27FailureCapture extends Task16RegistrationErrorFilter {
  override catch(error: unknown, host: ArgumentsHost) {
    const request = host.switchToHttp().getRequest<{originalUrl?:string}>();
    const privatePath = process.env.TASK409_PRIVATE_FAILURE_PATH;
    if (privatePath && request.originalUrl?.startsWith(principalPath) && error instanceof Error &&
        (!(error instanceof HttpException) || error.getStatus() >= 500)) {
      try {
        appendFileSync(privatePath,JSON.stringify({safe:projectTask16RegistrationError(error),
          message:error.message.slice(0,8192),stack:error.stack?.slice(0,16384)})+"\n",{mode:0o600,flag:"a"});
      } catch { /* retain original runtime failure */ }
    }
    super.catch(error,host);
  }
}

(enabled ? describe : describe.skip)("#409 registered principal return over restricted real PostgreSQL HTTP",()=>{
  it(roleCoverage ? "binds project duties and restricts public cash to the current comprehensive custodian" :
    "locks four-place principal reservations, records a partial and one competing final payment, and recovers the original key", async()=>{
    const supplied = [process.env.TASK398_OWNER_URL,process.env.DATABASE_URL,process.env.TASK398_OBSERVER_URL].map(value=>new URL(value ?? ""));
    const [ownerUrl,runtimeUrl,observerUrl] = supplied;
    const runId = process.env.TASK398_RUN_ID ?? "";
    if (process.env.NODE_ENV !== "test" || !/^[a-f0-9]{32}$/u.test(runId) ||
      !supplied.every(url=>url.hostname === "127.0.0.1" && url.port === ownerUrl.port &&
        url.pathname === "/jiangkong_payment_execution_concurrency") ||
      supplied.map(url=>url.username).join(",") !== "jg_task01_owner,jg_task01_runtime,jg_task01_observer") {
      throw new Error("TASK409_ISOLATED_DATABASE_REQUIRED");
    }
    const [owner,runtime,observer] = [ownerUrl,runtimeUrl,observerUrl].map(url=>new PrismaClient({datasources:{db:{url:url.href}}}));
    let app: INestApplication | undefined;
    try {
      const identify = (client: PrismaClient) => client.$queryRaw<Array<{role:string;run:string;superuser:boolean}>>`SELECT current_user::text AS role,current_setting('jg.task398_run_id',true) AS run,
         (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser`;
      expect((await identify(runtime))[0]).toEqual({role:"jg_task01_runtime",run:runId,superuser:false});
      expect((await identify(observer))[0]).toEqual({role:"jg_task01_observer",run:runId,superuser:false});
      expect(await runtime.$transaction(registeredPaymentInstalled)).toBe(true);
      const plan = buildRegisteredPgFixturePlan(runId.slice(0,12),"2026-11-07","2026-11-01");
      const secrets = await Promise.all(Array.from({length:roleCoverage ? 6 : 4},async()=>{const password=randomUUID();return {password,hash:await hash(password,10)};}));
      const seeded = await seedSharedPaymentPredecessors(owner,plan,{
        financeHash:secrets[0].hash,keeperHash:secrets[1].hash,directorHash:secrets[2].hash,
      },process.env.FILE_STORAGE_ROOT ?? "");
      const leaderPhone = `195${plan.phone.slice(3)}`;
      const leaderId = randomUUID();
      await owner.user.create({data:{id:leaderId,phone:leaderPhone,name:"合成公司负责人",passwordHash:secrets[3].hash,isActive:true,mustChangePassword:false}});
      const position = await owner.position.upsert({where:{key:"general_manager"},create:{key:"general_manager",name:"合成公司负责人"},update:{}});
      await owner.userPosition.create({data:{userId:leaderId,positionId:position.id,projectId:null}});
      let smsAvailable = false;
      const mockSms = {available: () => smsAvailable, sendDutyIntent: jest.fn().mockResolvedValue({status: "accepted"})};
      const module = await Test.createTestingModule({imports:[Task16SharedPaymentApplicationModule]}).overrideProvider(PrismaService)
        .useValue(runtime).overrideProvider(REGISTERED_PAYMENT_IMPACT_READER).useValue(readTask16RegisteredPaymentImpacts)
        .overrideProvider(ApprovalSmsService).useValue(mockSms).compile();
      app = module.createNestApplication({logger:false});
      app.getHttpAdapter().getInstance().set("json replacer",apiJsonReplacer);
      app.useGlobalPipes(createApiValidationPipe());
      app.useGlobalFilters(new Task27FailureCapture(app.get(HttpAdapterHost)));
      await app.listen(0,"127.0.0.1");
      const origin = await app.getUrl();
      const json = async(path:string,method:string,body?:unknown,token?:string)=>{
        const response = await fetch(origin+path,{method,
          headers:{...(body === undefined ? {} : {"content-type":"application/json"}),...(token ? {authorization:`Bearer ${token}`} : {})},
          ...(body === undefined ? {} : {body:JSON.stringify(body)}),
        });
        return {status:response.status,body:await response.json()};
      };
      const login = async(phone:string,index:number)=>{
        const res = await json("/auth/login","POST",{phone,password:secrets[index].password});
        expect(res.status).toBe(201);
        return res.body.tokens.accessToken as string;
      };
      const [finance,keeper,director,leader] = await Promise.all([
        login(plan.phone,0),login(seeded.keeperPhone,1),login(seeded.directorPhone,2),login(leaderPhone,3),
      ]);
      const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=","base64");
      for (const token of [keeper,director,leader]) {
        const signature = new FormData();
        signature.append("file",new Blob([png],{type:"image/png"}),"signature.png");
        expect((await fetch(origin+"/me/signature/canvas",{method:"POST",headers:{authorization:`Bearer ${token}`},body:signature})).status).toBe(201);
      }
      const company = `company:${plan.ids.companyA}`;
      const open = async(scopeKey:string,token:string)=>{
        const result = await json("/fund-accounts/openings","POST",{
          scopeKey,balanceYuan:"100000.0000",asOfDate:plan.openingDate,evidenceReference:"合成期初凭据",reconciliationNote:"合成核对",
          reason:"隔离业务验证",idempotencyKey:randomUUID(),sources:[{amountYuan:"100000.0000",sourceStatus:"known",
            sourceName:"合成登记资金",projectStatus:"pending"}],
        },token);
        expect(result.status).toBe(201);
        return result.body as {id:string;sources:Array<{id:string}>};
      };
      const companyOpening = await open(company,finance);
      const cashOpening = await open("public_cash",keeper);
      const [grants] = await runtime.$queryRaw<Array<{directInsert:boolean;scopedExecute:boolean}>>`
        SELECT has_any_column_privilege(current_user,'public."ApprovalInstance"','INSERT') AS "directInsert",
          has_function_privilege(current_user,'public.jg_open_principal_return_approval(text,text,text,jsonb)','EXECUTE') AS "scopedExecute"`;
      expect(grants).toEqual({directInsert:false,scopedExecute:true});
      const receipt = await json("/fund-account-advance-receipts","POST",{
        scopeKey:company,expectedRegistrationId:companyOpening.id,idempotencyKey:randomUUID(),
        contributorKind:"person",contributorName:"合成具名出资人",amountYuan:"100000.0001",receivedOn:"2026-11-02",
        ...(roleCoverage ? {projectId:plan.ids.project} : {}),
        evidenceReference:"合成具名到账凭据",
      },director);
      expect(receipt).toMatchObject({status:201,body:{amountYuan:"100000.0001"}});
      const apply = (amountYuan:string)=>({sourceKind:"advance_receipt",sourceId:receipt.body.id,amountYuan,reason:"真实本金归还申请",idempotencyKey:randomUUID()});
      const applications = principalPath+"/applications";
      const submit = (input:ReturnType<typeof apply>)=>json(applications,"POST",input,keeper);
      if (roleCoverage) {
        const actorWith = async(index:number,prefix:string,role:string,projectId:string|null)=>{
          const id = randomUUID();
          const phone = prefix+plan.phone.slice(3);
          await owner.user.create({data:{id,phone,name:"合成审批或保管角色",passwordHash:secrets[index].hash,isActive:true,mustChangePassword:false}});
          const actorPosition = await owner.position.upsert({where:{key:role},create:{key:role,name:role},update:{}});
          await owner.userPosition.create({data:{userId:id,positionId:actorPosition.id,projectId}});
          if (projectId) await owner.projectMember.create({data:{userId:id,projectId,positionKey:role}});
          return login(phone,index);
        };
        const manager = await actorWith(4,"193","project_manager",plan.ids.project);
        const nonCustodian = await actorWith(5,"194","comprehensive_director",null);
        const managerSignature = new FormData();
        managerSignature.append("file",new Blob([png],{type:"image/png"}),"signature.png");
        expect((await fetch(origin+"/me/signature/canvas",{method:"POST",headers:{authorization:`Bearer ${manager}`},body:managerSignature})).status).toBe(201);
        expect((await json("/public-cash-handovers/initial-custodian","POST",{idempotencyKey:randomUUID(),expectedRevision:0},keeper)).status).toBe(201);
        const intent = apply("1.0001");
        const request = await submit(intent);
        expect(request).toMatchObject({status:201,body:{status:"recorded"}});
        const id = request.body.applicationId as string;
        const appRow = await observer.registeredPrincipalReturnApplication.findUniqueOrThrow({where:{id}});
        expect(appRow.projectId).toBe(plan.ids.project);
        const round = await observer.approvalInstance.findUniqueOrThrow({where:{id:appRow.approvalInstanceId}});
        expect(round.frozenNodes).toEqual([
          expect.objectContaining({roleKeys:["comprehensive_director"]}),expect.objectContaining({roleKeys:["project_manager"]}),
          expect.objectContaining({roleKeys:["finance_director"]}),expect.objectContaining({roleKeys:["general_manager","chairman"]}),
        ]);
        const queued = () => owner.auditLog.findMany({where: {businessType: "principal_return_duty_notification", businessId: id, action: "queued"}});
        const notices = await queued();
        const reviewMetadata = notices.map(notice => notice.metadata as {kind:string; roundId:string; recipientId:string; nodeIndex:number});
        expect(reviewMetadata.map(item => item.nodeIndex)).toEqual(expect.arrayContaining([0, 1, 2, 3]));
        expect(reviewMetadata.every(item => item.kind === "review" && item.roundId === round.id)).toBe(true);
        expect(new Set(reviewMetadata.map(item => `${item.nodeIndex}:${item.recipientId}`)).size).toBe(notices.length);
        expect(await submit(intent)).toEqual(request);
        expect((await queued()).map(row => row.id).sort()).toEqual(notices.map(row => row.id).sort());
        if (proveRetry) {
          const kind = "principal_return_duty_notification";
          const original = notices.find(notice => {
            const data = notice.metadata as {nodeIndex:number;recipientId:string};
            return data.nodeIndex === 2 && data.recipientId === seeded.director;
          })!;
          expect(original).toBeDefined();
          await owner.auditLog.createMany({data: notices.map(notice => ({
            id: auditDutyNoticeId(kind, notice.id, "terminal"),
            businessType: kind, businessId: id,
            action: notice.id === original.id ? "failed" : "unknown", metadata: {intentId: notice.id},
          }))});
          smsAvailable = true;
          const smsPath = `${applications}/${id}/duty-sms`;
          const retryPath = `${smsPath}/review-2/retry`;
          expect(await json(`${smsPath}/review-2`, "GET", undefined, keeper)).toMatchObject({status: 200, body: {notice: null}});
          expect(await json(`${smsPath}/review-1`, "GET", undefined, manager))
            .toMatchObject({status: 200, body: {notice: {status: "unknown", canRetry: false}}});
          const status = await json(`${smsPath}/review-2`, "GET", undefined, director);
          expect(status).toMatchObject({status: 200, body: {notice: {attemptId: original.id, status: "failed", canRetry: true}}});
          expect((await json(`${smsPath}/review-1/retry`, "POST", {attemptId: original.id}, manager)).status).toBe(409);
          const retry = () => json(retryPath, "POST", {attemptId: original.id}, director);
          const results = await Promise.all([retry(), retry()]);
          expect(results.map(result => result.status)).toEqual([201, 201]);
          const successor = auditDutyNoticeId(kind, original.id, "retry");
          expect(mockSms.sendDutyIntent).toHaveBeenCalledTimes(1);
          expect(await json(`${smsPath}/review-2`, "GET", undefined, director))
            .toMatchObject({status: 200, body: {notice: {attemptId: successor, status: "accepted", canRetry: false}}});
          expect((await json(retryPath, "POST", {attemptId: successor}, director)).status).toBe(409);
          smsAvailable = false;
        }
        const actions = `${applications}/${id}/actions`;
        const approveProject = (token:string,expectedRevision:number,nodeIndex:number,password?:string)=>json(actions,"POST",{
          action:"approve",expectedRevision,nodeIndex,reason:"项目本金归还核对",confirmationPassword:password,idempotencyKey:randomUUID(),
        },token);
        expect((await approveProject(director,1,1)).status).toBe(403);
        expect((await approveProject(manager,1,1)).status).toBe(201);
        expect((await approveProject(director,2,2)).status).toBe(201);
        expect((await approveProject(keeper,3,0,secrets[1].password)).status).toBe(201);
        const payFromCash = (token:string,index:number,expectedRevision:number)=>json(`${applications}/${id}/payments`,"POST",{
          expectedRevision,expectedRegistrationId:cashOpening.id,scopeKey:"public_cash",paidOn:"2026-11-03",amountYuan:"1.0001",
          sourceAllocations:[{sourceBatchId:cashOpening.sources[0].id,amountYuan:"1.0001"}],evidenceReference:"具名保管人实际现金归还",
          confirmationPassword:secrets[index].password,idempotencyKey:randomUUID(),
        },token);
        expect((await payFromCash(keeper,1,4)).status).toBe(409);
        expect((await approveProject(leader,4,3)).status).toBe(201);
        const payNotices = (await queued()).filter(notice => (notice.metadata as {kind:string}).kind === "pay");
        expect(payNotices.length).toBeGreaterThan(0);
        expect(payNotices.map(notice => notice.metadata)).toContainEqual({kind: "pay", roundId: round.id, recipientId: seeded.keeper});
        expect(new Set(payNotices.map(notice => (notice.metadata as {recipientId:string}).recipientId)).size).toBe(payNotices.length);

        expect((await payFromCash(nonCustodian,5,5)).status).toBe(403);
        expect(await observer.registeredPrincipalReturnPayment.count()).toBe(0);
        const payable = async(token:string)=>(await json(principalPath,"GET",undefined,token)).body.payableScopeKeys;
        expect(await payable(keeper)).toContain("public_cash");
        expect(await payable(nonCustodian)).not.toContain("public_cash");
        const paid = await payFromCash(keeper,1,5);
        expect(paid).toMatchObject({status:201,body:{status:"recorded"}});
        const fact = await observer.registeredPrincipalReturnPayment.findUniqueOrThrow({where:{id:paid.body.paymentId}});
        expect(fact).toMatchObject({scopeKey:"public_cash",paidByUserId:seeded.keeper,applicationId:id});
        expect(fact.amountYuan.toFixed(4)).toBe("1.0001");
        const individualBalance = await observer.fundAccountBalanceRegistration.findUniqueOrThrow({where:{id:fact.registrationId},include:{sources:true}});
        expect(individualBalance.balanceYuan?.toFixed(4)).toBe("99998.9999");
        expect(individualBalance.sources[0].amountYuan.toFixed(4)).toBe("99998.9999");
        expect(await observer.operatingFact.count()).toBe(0);
        expect(await observer.operatingImpactEntry.count()).toBe(0);
        return;
      }
      const original = apply("60000.0000");
      const accepted = await submit(original);
      expect(accepted).toMatchObject({status:201,body:{status:"recorded",idempotencyKey:original.idempotencyKey}});
      expect(await submit(original)).toEqual(accepted);
      expect(await json(`${principalPath}/results/${original.idempotencyKey}`,"GET",undefined,keeper)).toEqual({status:200,body:accepted.body});
      const initialApplication = await observer.registeredPrincipalReturnApplication.findUniqueOrThrow({where:{id:accepted.body.applicationId}});
      expect(initialApplication.requestedYuan.toFixed(4)).toBe("60000.0000");
      const inspectRound = await observer.approvalInstance.findUniqueOrThrow({where:{id:initialApplication.approvalInstanceId}});
      expect(inspectRound.frozenNodes).toHaveLength(3);
      const act = (id:string,token:string,expectedRevision:number,nodeIndex:number,password?:string)=>json(`${applications}/${id}/actions`,"POST",{
        action:"approve",expectedRevision,nodeIndex,reason:"核对本金真实及实际归还",confirmationPassword:password,idempotencyKey:randomUUID(),
      },token);
      const approve = async(id:string)=>{
        expect((await act(id,keeper,1,0,secrets[1].password)).status).toBe(201);
        expect((await act(id,director,2,1)).status).toBe(201);
        expect((await act(id,leader,3,2)).status).toBe(201);
      };
      const first=accepted.body.applicationId as string;
      await approve(first);
      const makePayment = (expectedRevision:number,expectedRegistrationId:string,sourceBatchId:string,amountYuan:string)=>({
        expectedRevision,expectedRegistrationId,scopeKey:"public_cash",paidOn:"2026-11-03",amountYuan,
        sourceAllocations:[{sourceBatchId,amountYuan}],evidenceReference:"合成归还资金凭据",confirmationPassword:secrets[0].password,idempotencyKey:randomUUID(),
      });
      const pay = (id:string,input:ReturnType<typeof makePayment>)=>json(`${applications}/${id}/payments`,"POST",input,finance);
      const firstPay = await pay(first,makePayment(4,cashOpening.id,cashOpening.sources[0].id,"60000.0000"));
      expect(firstPay).toMatchObject({status:201,body:{status:"recorded"}});
      const competing = [apply("30000.0000"),apply("30000.0000")];
      const contenders = await Promise.all(competing.map(submit));
      expect(contenders.map(row=>row.status).sort()).toEqual([201,409]);
      expect((await submit(apply("10000.0002"))).status).toBe(409);
      const loserApply = competing[contenders.findIndex(row=>row.status === 409)];
      expect((await json(`${principalPath}/results/${loserApply.idempotencyKey}`,"GET",undefined,keeper)).body.status).toBe("unconfirmed");
      const second = contenders.find(row=>row.status === 201)!.body.applicationId as string;
      for (const action of ["withdraw","reject","reduce"] as const) {
        const request = await submit(apply("10000.0001"));
        expect(request.status).toBe(201);
        const reservation = request.body.applicationId as string;
        if (action === "reduce") await approve(reservation);
        const done = await json(`${applications}/${reservation}/actions`,"POST",{
          action,expectedRevision:action === "reduce" ? 4 : 1,nodeIndex:action === "reject" ? 1 : undefined,
          reducedYuan:action === "reduce" ? "0.0000" : undefined,reason:"核对后释放未实付本金",
          confirmationPassword:action === "reduce" ? secrets[2].password : undefined,idempotencyKey:randomUUID(),
        },action === "withdraw" ? keeper : director);
        expect(done.status).toBe(201);
      }
      expect((await act(second,keeper,1,0,secrets[1].password)).status).toBe(201);
      expect((await act(second,director,2,1)).status).toBe(201);
      const accountIdFor = async(id:string)=>(await observer.fundAccountBalanceRegistration.findUniqueOrThrow({where:{id},select:{accountId:true}})).accountId;
      const readConfirmed = (accountId:string)=>observer.fundAccountBalanceRegistration.findFirstOrThrow({
        where:{accountId,status:"confirmed"},orderBy:{version:"desc"},include:{sources:true},
      });
      const cashAccountId = await accountIdFor(cashOpening.id);
      const readCash = ()=>readConfirmed(cashAccountId);
      let current = await readCash();
      expect(current.balanceYuan?.toFixed(4)).toBe("40000.0000");
      expect((await pay(second,makePayment(3,current.id,current.sources[0].id,"12000.0001"))).status).toBe(409);
      expect((await act(second,leader,3,2)).status).toBe(201);
      const partial = await pay(second,makePayment(4,current.id,current.sources[0].id,"12000.0001"));
      expect(partial.status).toBe(201);
      current = await readCash();
      const finalInputs = [0,1].map(()=>makePayment(5,current.id,current.sources[0].id,"17999.9999"));
      const competingPayments = await Promise.all(finalInputs.map(input=>pay(second,input)));
      expect(competingPayments.map(row=>row.status).sort()).toEqual([201,409]);
      const loserPay = finalInputs[competingPayments.findIndex(row=>row.status === 409)];
      expect((await json(`${principalPath}/results/${loserPay.idempotencyKey}`,"GET",undefined,finance)).body.status).toBe("unconfirmed");
      const winnerIndex = competingPayments.findIndex(row=>row.status===201);
      const winner = competingPayments[winnerIndex];
      expect(await pay(second,finalInputs[winnerIndex])).toEqual(winner);
      expect(await json(`${principalPath}/results/${finalInputs[winnerIndex].idempotencyKey}`,"GET",undefined,finance)).toEqual({status:200,body:winner.body});
      expect((await pay(second,{...finalInputs[winnerIndex],amountYuan:"17999.9998",sourceAllocations:[{sourceBatchId:current.sources[0].id,amountYuan:"17999.9998"}]})).status).toBe(409);
      const after = await readCash();
      expect(after.balanceYuan?.toFixed(4)).toBe("10000.0000");
      expect(after.sources[0].amountYuan.toFixed(4)).toBe("10000.0000");
      expect(await observer.registeredPrincipalReturnPayment.count()).toBe(3);
      expect(await observer.registeredPrincipalReturnAllocation.count()).toBe(3);
      expect(await observer.operatingFact.count()).toBe(0);
      expect(await observer.operatingImpactEntry.count()).toBe(0);
      const balances = await json(principalPath,"GET",undefined,keeper);
      expect(balances.status).toBe(200);
      expect(balances.body.items).toContainEqual(expect.objectContaining({
        sourceId:receipt.body.id,principalYuan:"100000.0001",paidYuan:"90000.0000",reservedYuan:"0.0000",availableYuan:"10000.0001",
      }));
      const oldPayment = await observer.paymentRequest.findUniqueOrThrow({where:{id:plan.ids.payment}});
      const oldRound = await observer.approvalInstance.findUniqueOrThrow({where:{id:plan.ids.approvedRound}});
      expect((await json(`/payments/${plan.ids.payment}/approval`,"POST",{
        decision:"approve",expectedPaymentUpdatedAt:oldPayment.updatedAt.toISOString(),expectedApprovalInstanceId:oldRound.id,
        expectedNodeIndex:0,expectedApprovalUpdatedAt:oldRound.updatedAt.toISOString(),
      },director)).status).toBe(201);
      await app.get(OperatingSourceReplayService).replaySource({projectId:plan.ids.project,sourceType:"settlement",sourceBusinessId:plan.ids.settlement},plan.ids.actor);
      const companyAccountId = await accountIdFor(companyOpening.id);
      const availableSource = (row:Awaited<ReturnType<typeof readConfirmed>>)=>row.sources.find(source=>source.sourceName === "合成登记资金")!;
      const legacyPay = async(amountCents:string)=>{
        const basis = await readConfirmed(companyAccountId);
        const path = `/payment-executions/${plan.ids.payment}`;
        const opts = await json(path+"/registration-options","GET",undefined,finance);
        expect(opts.status).toBe(200);
        const paid = await json(path+"/registrations","POST",{
          idempotencyKey:randomUUID(),expectedPaymentUpdatedAt:opts.body.expectedPaymentUpdatedAt,amountCents,
          paidAt:plan.paidAt.slice(0,10),scopeKey:company,expectedRegistrationId:basis.id,openingTreatment:"not_included",
          openingReason:"实付未含期初",openingEvidence:"合成原付款凭据",
          sourceAllocations:[{sourceBatchId:availableSource(basis).id,amountCents}],confirmationPassword:secrets[0].password,
        },finance);
        expect(paid).toMatchObject({status:201,body:{amountCents}});
        return paid.body.id as string;
      };
      const oldFirst = await legacyPay("1001");
      const byLedger = async()=>({facts:await observer.operatingFact.count(),effects:await observer.operatingImpactEntry.count()});
      const beforeCompanyPrincipal = await byLedger();
      const companyApplication = (await submit(apply("1.0001"))).body.applicationId as string;
      await approve(companyApplication);
      const companyBasis = await readConfirmed(companyAccountId);
      expect(await pay(companyApplication,{
        ...makePayment(4,companyBasis.id,availableSource(companyBasis).id,"1.0001"),scopeKey:company,
      })).toMatchObject({status:201,body:{status:"recorded"}});
      const newBasis = await readConfirmed(companyAccountId);
      expect(newBasis.previousRegistrationId).toBe(companyBasis.id);
      expect(newBasis.coveredExecutionIds).toEqual(companyBasis.coveredExecutionIds);
      expect(availableSource(newBasis).previousSourceBatchId).toBe(availableSource(companyBasis).id);
      expect(await byLedger()).toEqual(beforeCompanyPrincipal);
      const oldSecond = await legacyPay("1002");
      expect((await observer.registeredFundPaymentAllocation.findMany({where:{accountId:companyAccountId},
        select:{executionId:true,amountCents:true}})).sort((a,b)=>Number(a.amountCents-b.amountCents))).toEqual([
        {executionId:oldFirst,amountCents:1001n},{executionId:oldSecond,amountCents:1002n},
      ]);
      const companyView = await json(`/fund-accounts/${encodeURIComponent(company)}`,"GET",undefined,finance);
      expect(companyView).toMatchObject({status:200,body:{balanceYuan:"199978.9700"}});
      expect(companyView.body.sources.find((source:{sourceName:string})=>source.sourceName === "合成登记资金").amountYuan).toBe("99978.9699");

    } finally {
      await app?.close();
      await Promise.all([owner.$disconnect(),runtime.$disconnect(),observer.$disconnect()]);
    }
  }, 120000);
});
