import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { normalizeBusinessAmount, requiredPastChinaDate, sumBusinessAmounts, type RoleKey } from "@jiangkong/shared-domain";
import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { activeScopedApprovalDelegatorIds } from "../approval/active-approval-delegations";
import { resolveApprovalReviewIdentity, type FrozenApprovalNode } from "../approval/approval-review-identity";
import { confirmApprovalSelfReview } from "../approval/approval-self-review";
import { snapshotApprovalSignature, withApprovalIdentity } from "../approval/approval-signature-snapshot";
import { activeApprovalNodeIndexes, isParallelApprovalRound } from "../approval/parallel-approval-protocol";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { CompanyRoleResolverService } from "../auth/company-role-resolver.service";
import { PrismaService } from "../database/prisma.service";
import { availableRegisteredBalance, RegisteredBalanceDecimal } from "../payment/registered-payment-funding";
import { isPostgresSerializationFailure } from "../project/project-operating-constraint";
import { currentFundCompanyRoles } from "./fund-account-duty";
import { ActPrincipalReturnDto, ApplyPrincipalReturnDto, PayPrincipalReturnDto } from "./fund-principal-return.dto";
import { FundPrincipalReturnNotificationService } from "./fund-principal-return-notification.service";
import { principalReturnAmounts, principalReturnDuties, type PrincipalReturnStatus } from "./fund-principal-return-state";
import { assertPublicCashCustodian } from "./public-cash-custodian";

type Tx = Prisma.TransactionClient;
type OriginKind = ApplyPrincipalReturnDto["sourceKind"];
export const PRINCIPAL_RETURN_BUSINESS_TYPE = "registered_principal_return";
export const PRINCIPAL_RETURN_REVIEW_ACTION = "fund_account.principal_return.review";
const PAY_ROLES: RoleKey[] = ["finance_staff", "finance_director", "comprehensive_director"];
const GLOBAL_READ_ROLES: RoleKey[] = [...PAY_ROLES, "general_manager", "chairman"];
const rejected = (message: string) => new ConflictException({ code:"REGISTERED_PRINCIPAL_RETURN_REJECTED", message });
const normalize = (value: string, allowZero = false) => {
  try {
    const result = normalizeBusinessAmount(value);
    if (result && (allowZero || result !== "0.0000")) return result;
  } catch { /* invalid input is translated at the command boundary */ }
  throw new BadRequestException("请填写有效金额，最多保留4位小数");
};
const text = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) throw new BadRequestException("请填写办理原因或核对依据");
  return trimmed;
};
const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

@Injectable()
export class FundPrincipalReturnService {
  constructor(private readonly prisma: PrismaService, private readonly auth: AuthService, private readonly audit: AuditService,
    @Optional() private readonly notices?: FundPrincipalReturnNotificationService) {}

  async apply(actor: string, input: ApplyPrincipalReturnDto) {
    const amountYuan = normalize(input.amountYuan);
    const reason = text(input.reason);
    return this.command(actor, "apply", input.idempotencyKey, [input.sourceKind,input.sourceId,amountYuan,reason], async tx => {
      if (!(await currentFundCompanyRoles(tx, actor)).includes("comprehensive_director")) {
        throw new ForbiddenException("仅综合部主管可发起本金归还");
      }
      const origin = await this.origin(tx, input.sourceKind, input.sourceId);
      if (!origin) throw rejected("垫资本金来源未核实或已不可办理");
      await this.lockOrigin(tx, input.sourceKind, input.sourceId);
      const applications = await tx.registeredPrincipalReturnApplication.findMany({where:{sourceKind:input.sourceKind,sourceId:input.sourceId}});
      const balance = this.amounts(origin.principalYuan, applications);
      if (new RegisteredBalanceDecimal(balance.availableYuan).lt(amountYuan)) throw rejected("归还申请超过尚可申请的原本金");
      const id = randomUUID();
      const approvalInstanceId = randomUUID();
      const duties = JSON.stringify(principalReturnDuties(origin.projectId));
      await tx.$queryRaw(Prisma.sql`SELECT public."jg_open_principal_return_approval"(
        ${approvalInstanceId},${id},${actor},${duties}::jsonb)`);
      const application = await tx.registeredPrincipalReturnApplication.create({data:{
        id,sourceKind:input.sourceKind,sourceId:input.sourceId,projectId:origin.projectId,contributorName:origin.contributorName,
        requestedYuan:amountYuan,reason,status:"pending",approvalInstanceId,createdByUserId:actor,
      }});
      await this.notices?.queueReview(tx, application, actor);
      return {application};
    });
  }

  async act(actor: string, id: string, input: ActPrincipalReturnDto) {
    const reason = text(input.reason);
    const reducedYuan = input.action === "reduce" && input.reducedYuan !== undefined ? normalize(input.reducedYuan,true) : null;
    return this.command(actor,input.action,input.idempotencyKey,[id,input.expectedRevision,input.nodeIndex,reason,reducedYuan],async tx => {
      await this.assertActionAccess(tx, actor, id, input);
      const row = await this.lockApplication(tx,id,input.expectedRevision);
      const round = await tx.approvalInstance.findUniqueOrThrow({where:{id:row.approvalInstanceId}});
      let status = row.status as PrincipalReturnStatus;
      let approvedYuan = row.approvedYuan;
      if (input.action === "reduce") {
        if (!(await currentFundCompanyRoles(tx,actor)).includes("finance_director")) throw new ForbiddenException("仅财务主管可核减未归还本金");
        if (!input.confirmationPassword) throw new BadRequestException("请输入本人密码");
        await this.auth.confirmPassword(actor,input.confirmationPassword,tx);
        if (!reducedYuan || !approvedYuan || !["approved","partially_paid"].includes(status) ||
            approvedYuan.lte(reducedYuan) || row.paidYuan.gt(reducedYuan)) throw rejected("只能核减尚未实付部分");
        approvedYuan = new RegisteredBalanceDecimal(reducedYuan);
        if (approvedYuan.eq(row.paidYuan)) status = row.paidYuan.eq(0) ? "withdrawn" : "paid";
      } else {
        if (status !== "pending" || round.status !== "approval_pending" || round.businessId !== row.id ||
            round.businessType !== PRINCIPAL_RETURN_BUSINESS_TYPE || !isParallelApprovalRound(round.frozenNodes)) throw rejected("当前审批轮已结束");
        const nodes = round.frozenNodes;
        if (input.action === "withdraw") {
          if (row.createdByUserId !== actor || !(await currentFundCompanyRoles(tx,actor)).includes("comprehensive_director")) {
            throw new ForbiddenException("仅本轮有效申请人可撤回");
          }
          status = "withdrawn";
          await tx.approvalActionLog.create({data:{approvalInstanceId:round.id,actorUserId:actor,action:"withdraw",comment:reason}});
        } else {
          if (input.nodeIndex === undefined || !activeApprovalNodeIndexes(nodes,round.currentNodeIndex).includes(input.nodeIndex)) {
            throw rejected("该职责已办理或不属于当前审批");
          }
          const node = nodes[input.nodeIndex];
          const review = await resolvePrincipalReturnReviewIdentity(tx,actor,row.projectId,round.id,input.nodeIndex,node as FrozenApprovalNode);
          if (!review) throw new ForbiddenException("当前账号无权办理此审批职责");
          const self = await confirmApprovalSelfReview({
            applicantUserId:row.createdByUserId,actorUserId:actor,actorRoleKeys:review.roles,
            approvedRoleKey:review.identity.approvedRoleKey,representedUserId:review.identity.representedUserId,
            viaAssignment:review.identity.viaAssignment,selfReviewReason:reason,confirmationPassword:input.confirmationPassword,
            confirmPassword:password=>this.auth.confirmPassword(actor,password,tx),
          });
          const signature = input.action === "approve" ? await snapshotApprovalSignature(tx,actor,{required:true}) : null;
          await tx.approvalActionLog.create({data:await withApprovalIdentity(tx,{
            approvalInstanceId:round.id,actorUserId:actor,action:input.action,comment:reason,
            representedUserId:review.identity.representedUserId,approvedRoleKey:review.identity.approvedRoleKey,
            ...(signature ? {signatureFileIdSnapshot:signature.fileId,signatureSha256Snapshot:signature.sha256,signatureVersionIdSnapshot:signature.versionId} : {}),
            metadata:{nodeIndex:input.nodeIndex,...self.metadata},
          },signature)});
          if (input.action === "reject") status = "rejected";
          else {
            node.approvedRoleKeys = [review.identity.approvedRoleKey];
            if (!activeApprovalNodeIndexes(nodes,round.currentNodeIndex).length) {
              status = "approved";
              approvedYuan = row.requestedYuan;
            }
          }
        }
        await tx.approvalInstance.update({where:{id:round.id},data:{
          status:status === "pending" ? "approval_pending" : status,
          frozenNodes:nodes as Prisma.InputJsonValue,
        }});
      }
      const application = await tx.registeredPrincipalReturnApplication.update({where:{id},data:{
        status,approvedYuan,revision:{increment:1},
      }});
      if (row.status === "pending" && status === "approved") await this.notices?.queuePayment(tx, application, actor);
      return {application};
    });
  }

  private async assertActionAccess(tx: Tx, actor: string, id: string, input: ActPrincipalReturnDto) {
    const denied = () => new ForbiddenException("当前账号无权办理此归还申请");
    const row = await tx.registeredPrincipalReturnApplication.findUnique({ where: { id }, select: {
      createdByUserId: true, projectId: true, approvalInstanceId: true
    } });
    if (!row) throw denied();
    if (input.action === "reduce" || input.action === "withdraw") {
      const roles = await currentFundCompanyRoles(tx, actor);
      if (input.action === "reduce" ? !roles.includes("finance_director") :
        row.createdByUserId !== actor || !roles.includes("comprehensive_director")) throw denied();
      return;
    }
    const round = await tx.approvalInstance.findUnique({ where: { id: row.approvalInstanceId }, select: {
      id: true, businessId: true, businessType: true, flowType: true, currentNodeIndex: true, frozenNodes: true, status: true
    } });
    if (!round || round.businessId !== id || round.businessType !== PRINCIPAL_RETURN_BUSINESS_TYPE ||
        round.flowType !== PRINCIPAL_RETURN_BUSINESS_TYPE || !isParallelApprovalRound(round.frozenNodes) ||
        input.nodeIndex === undefined) throw denied();
    const node = round.frozenNodes[input.nodeIndex];
    if (!node) throw denied();
    const active = round.status === "approval_pending" &&
      activeApprovalNodeIndexes(round.frozenNodes,round.currentNodeIndex).includes(input.nodeIndex);
    // A direct holder can receive stale-state guidance. Delegation authorizes only a still-active duty.
    const review = await resolvePrincipalReturnReviewIdentity(tx, actor, row.projectId, round.id, input.nodeIndex,
      { ...(node as FrozenApprovalNode), approvedRoleKeys: [] }, !active);
    if (!review) throw denied();
  }

  async pay(actor: string, id: string, input: PayPrincipalReturnDto) {
    const amountYuan = normalize(input.amountYuan);
    const evidence = text(input.evidenceReference);
    try { requiredPastChinaDate(input.paidOn,"实际归还日期"); }
    catch { throw new BadRequestException("请选择真实的实际归还日期"); }
    const lines = input.sourceAllocations.map(line=>({...line,amountYuan:normalize(line.amountYuan)}))
      .sort((a,b)=>a.sourceBatchId.localeCompare(b.sourceBatchId));
    if (new Set(lines.map(line=>line.sourceBatchId)).size !== lines.length ||
        sumBusinessAmounts(lines.map(line=>line.amountYuan)) !== amountYuan) throw new BadRequestException("资金来源必须逐笔明确且合计等于实付归还");
    return this.command(actor,"pay",input.idempotencyKey,[id,input.expectedRevision,input.scopeKey,input.expectedRegistrationId,input.paidOn,amountYuan,lines,evidence],async tx => {
      const roles = await currentFundCompanyRoles(tx,actor);
      if (!roles.some(role=>PAY_ROLES.includes(role))) throw new ForbiddenException("仅财务或综合部主管可登记实际归还");
      await this.auth.confirmPassword(actor,input.confirmationPassword,tx);
      const row = await this.lockApplication(tx,id,input.expectedRevision);
      const paidYuan = new RegisteredBalanceDecimal(row.paidYuan.toFixed(4)).plus(amountYuan);
      if (!row.approvedYuan || !["approved","partially_paid"].includes(row.status) ||
        paidYuan.gt(row.approvedYuan)) throw rejected("本次归还超过已批准且尚未实付的本金");
      const account = await tx.registeredFundAccount.findUnique({where:{scopeKey:input.scopeKey},include:{company:true}});
      if (!account || (account.kind === "company" && !account.company?.isActive)) throw rejected("实际付款账户未启用");
      await tx.$queryRaw(Prisma.sql`SELECT id FROM public."RegisteredFundAccount" WHERE id = ${account.id} FOR UPDATE`);
      if (account.kind === "public_cash" && !roles.some(role=>role === "finance_staff" || role === "finance_director")) {
        await assertPublicCashCustodian(tx,account.id,actor);
      }
      const current = await tx.fundAccountBalanceRegistration.findFirst({
        where:{accountId:account.id,status:"confirmed"},orderBy:{version:"desc"},include:{sources:true},
      });
      if (!current || current.id !== input.expectedRegistrationId) throw rejected("资金核对版本已变化，请刷新后重新选择来源");
      const available = await availableRegisteredBalance(tx,current);
      if (available.balanceYuan === null || available.balanceYuan.lt(amountYuan) ||
          available.heldTransferAllocations.some(hold=>hold.candidateSourceIds.length !== 1)) throw rejected("实际付款账户余额不足或待核对");
      for (const line of lines) {
        const source = available.sources.find(candidate=>candidate.id === line.sourceBatchId);
        if (!source || source.amountYuan.lt(line.amountYuan) ||
            available.pendingAllocations.some(pending=>pending.candidateSourceIds.includes(line.sourceBatchId))) {
          throw rejected("所选资金来源余额不足或待核对");
        }
      }
      await tx.registeredFundAccount.update({where:{id:account.id},data:{writeRevision:{increment:1}}});
      const paymentId = randomUUID();
      const latest = await tx.fundAccountBalanceRegistration.findFirstOrThrow({where:{accountId:account.id},orderBy:{version:"desc"}});
      const registration = await tx.fundAccountBalanceRegistration.create({data:{
        kind:"principal_return",status:"confirmed",accountId:account.id,previousRegistrationId:current.id,version:latest.version+1,
        balanceYuan:new RegisteredBalanceDecimal(current.balanceYuan!.toFixed(4)).minus(amountYuan),
        coveredExecutionIds:current.coveredExecutionIds,asOfDate:current.asOfDate,evidenceReference:evidence,
        reconciliationNote:"实际本金归还",reason:"本金归还资金扣减",idempotencyKey:`principal-return:${paymentId}`,
        payloadFingerprint:fingerprint([paymentId,account.id,amountYuan]),createdByUserId:actor,confirmedByUserId:actor,confirmedAt:new Date(),
      }});
      const debits = new Map(lines.map(line=>[line.sourceBatchId,line.amountYuan]));
      await tx.fundAccountSourceBatch.createMany({data:current.sources.map(source=>({
        registrationId:registration.id,lineNo:source.lineNo,previousSourceBatchId:source.id,sourceStatus:source.sourceStatus,
        sourceName:source.sourceName,projectStatus:source.projectStatus,projectId:source.projectId,
        amountYuan:new RegisteredBalanceDecimal(source.amountYuan.toFixed(4)).minus(debits.get(source.id) ?? "0"),
      }))});
      const payment = await tx.registeredPrincipalReturnPayment.create({data:{
        id:paymentId,registrationId:registration.id,applicationId:id,accountId:account.id,scopeKey:account.scopeKey,previousRegistrationId:current.id,amountYuan,
        paidOn:input.paidOn,evidenceReference:evidence,paidByUserId:actor,allocations:{create:lines},
      }});
      const application = await tx.registeredPrincipalReturnApplication.update({where:{id},data:{
        paidYuan,status:paidYuan.eq(row.approvedYuan) ? "paid" : "partially_paid",revision:{increment:1},
      }});
      return {application,paymentId:payment.id};
    });
  }

  async list(actor: string) {
    return this.prisma.$transaction(async tx => {
      const globalRoles = await currentFundCompanyRoles(tx,actor);
      const global = globalRoles.some(role=>GLOBAL_READ_ROLES.includes(role));
      const current = await tx.user.findUnique({where:{id:actor},select:{isActive:true}});
      if (!current?.isActive) throw new ForbiddenException("当前账号不可查看垫资本金归还");
      const managementPositions = await tx.position.findMany({where:{key:"project_manager"},select:{id:true}});
      const positions = await tx.userPosition.findMany({where:{userId:actor,projectId:{not:null},positionId:{in:managementPositions.map(position=>position.id)}},select:{projectId:true}});
      const projectIds = positions.flatMap(row=>row.projectId ? [row.projectId] : []);
      const delegated = global ? [] : await this.delegatedApplications(tx,actor,projectIds);
      if (!global && !projectIds.length) {
        if (!delegated.length) throw new ForbiddenException("当前账号不可查看垫资本金归还");
        return {items:delegated,payableScopeKeys:[]};
      }
      const scoped = global ? {} : {projectId:{in:projectIds}};
      const [receipts,advances,proxies,applications,payableScopeKeys] = await Promise.all([
        tx.registeredFundAdvanceReceipt.findMany({where:{...scoped,companyOwned:null,contributorId:{not:null},contributorNameSnapshot:{not:null}}}),
        tx.registeredPaymentProjectAdvance.findMany({where:scoped,include:{execution:{select:{registeredFunding:{select:{actualPayerSnapshot:true}}}}}}),
        tx.interEntityRelationshipEntry.findMany({where:{...scoped,entryKind:"proxy_payment",direction:"increase",status:"confirmed",sourceType:"registered_payment_execution"}}),
        tx.registeredPrincipalReturnApplication.findMany({where:scoped,include:{payments:{include:{allocations:true}}},orderBy:{createdAt:"desc"}}),
        principalReturnPayableScopeKeys(tx,actor,globalRoles),
      ]);
      const origins = [
        ...receipts.map(row=>({sourceKind:"advance_receipt",sourceId:row.id,principalYuan:row.amountYuan.toFixed(4),projectId:row.projectId,contributorName:row.contributorNameSnapshot!})),
        ...advances.flatMap(row=>{
          const contributorName = this.companySnapshotName(row.execution.registeredFunding?.actualPayerSnapshot);
          return contributorName ? [{sourceKind:"payment_advance",sourceId:row.executionId,
            principalYuan:new RegisteredBalanceDecimal(row.amountCents.toString()).div(100).toFixed(4),
            projectId:row.projectId,contributorName}] : [];
        }),
        ...proxies.map(row=>({sourceKind:"proxy_payment",sourceId:row.id,principalYuan:new RegisteredBalanceDecimal(row.amountCents.toString()).div(100).toFixed(4),projectId:row.projectId,contributorName:this.companySnapshotName(row.creditorSnapshot) ?? "原被代付公司"})),
      ];
      const projects = await tx.project.findMany({where:{id:{in:origins.flatMap(row=>row.projectId ? [row.projectId] : [])}},select:{id:true,name:true}});
      const rounds = await tx.approvalInstance.findMany({where:{id:{in:applications.map(row=>row.approvalInstanceId)},status:"approval_pending"}});
      const batches = await tx.fundAccountSourceBatch.findMany({where:{id:{in:applications.flatMap(app=>app.payments.flatMap(pay=>pay.allocations.map(line=>line.sourceBatchId)))}}});
      return {
        payableScopeKeys,
        items:[...delegated,...await Promise.all(origins.map(async origin=>{
          const rows = applications.filter(row=>row.sourceKind === origin.sourceKind && row.sourceId === origin.sourceId);
          const balance = this.amounts(origin.principalYuan,rows);
          return {...origin,...balance,projectName:projects.find(project=>project.id === origin.projectId)?.name ?? null,
            canApply:origin.sourceKind !== "proxy_payment" && globalRoles.includes("comprehensive_director") && new RegisteredBalanceDecimal(balance.availableYuan).gt(0),
            applications:await Promise.all(rows.map(async row=>{
              const round = rounds.find(round=>round.id === row.approvalInstanceId);
              const approved = ["approved","partially_paid"].includes(row.status);
              const approvalDuties: Array<{nodeIndex:number;roleKeys:RoleKey[];requiresSelfPassword:boolean}> = [];
              if (round && isParallelApprovalRound(round.frozenNodes)) {
                const nodes = round.frozenNodes;
                for (const index of activeApprovalNodeIndexes(nodes,round.currentNodeIndex)) {
                  const review = await resolvePrincipalReturnReviewIdentity(tx,actor,row.projectId,round.id,index,nodes[index] as FrozenApprovalNode);
                  if (review && (row.createdByUserId !== actor ||
                      (!review.identity.viaAssignment && review.identity.representedUserId === actor))) {
                    approvalDuties.push({nodeIndex:index,roleKeys:[review.identity.approvedRoleKey],requiresSelfPassword:row.createdByUserId === actor});
                  }
                }
              }
              return {id:row.id,status:row.status,requestedYuan:row.requestedYuan.toFixed(4),approvedYuan:row.approvedYuan?.toFixed(4) ?? null,
                paidYuan:row.paidYuan.toFixed(4),revision:row.revision,approvalInstanceId:row.approvalInstanceId,approvalDuties,
                canApprove:approvalDuties.length>0,canWithdraw:row.status === "pending" && row.createdByUserId === actor && globalRoles.includes("comprehensive_director"),
                canReduce:approved && globalRoles.includes("finance_director"),canPay:approved && payableScopeKeys.length>0,
                payments:row.payments.map(pay=>({id:pay.id,amountYuan:pay.amountYuan.toFixed(4),paidOn:pay.paidOn,scopeKey:pay.scopeKey,evidenceReference:pay.evidenceReference,
                  sourceAllocations:pay.allocations.map(line=>({sourceBatchId:line.sourceBatchId,
                    sourceLabel:batches.find(batch=>batch.id === line.sourceBatchId)?.sourceName ?? "原资金来源待核对",amountYuan:line.amountYuan.toFixed(4)})),
                })),
              };
            })),
          };
        }))],
      };
    },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
  }

  private async delegatedApplications(tx: Tx, actor: string, directProjectIds: string[]) {
    const now = new Date();
    const mandates = await tx.approvalDelegation.findMany({
      where:{toUserId:actor,enabled:true,startsAt:{lte:now},endsAt:{gt:now},
        actionKey:PRINCIPAL_RETURN_REVIEW_ACTION,resourceType:PRINCIPAL_RETURN_BUSINESS_TYPE},
      select:{resourceId:true},
    });
    const dutyIds = new Set(mandates.flatMap(row=>row.resourceId ? [row.resourceId] : []));
    if (!dutyIds.size) return [];
    const rounds = await tx.approvalInstance.findMany({where:{id:{in:[...dutyIds].map(id=>id.split(":")[0])},
      businessType:PRINCIPAL_RETURN_BUSINESS_TYPE,flowType:PRINCIPAL_RETURN_BUSINESS_TYPE,status:"approval_pending"}});
    if (!rounds.length) return [];
    const applications = await tx.registeredPrincipalReturnApplication.findMany({where:{
      approvalInstanceId:{in:rounds.map(round=>round.id)},status:"pending",
    }});
    return (await Promise.all(applications.map(async row=>{
      if (row.createdByUserId === actor || (row.projectId && directProjectIds.includes(row.projectId))) return null;
      const round = rounds.find(candidate=>candidate.id === row.approvalInstanceId);
      if (!round || round.businessId !== row.id || !isParallelApprovalRound(round.frozenNodes)) return null;
      const nodes = round.frozenNodes;
      const approvalDuties: Array<{nodeIndex:number;roleKeys:RoleKey[];requiresSelfPassword:boolean}> = [];
      for (const index of activeApprovalNodeIndexes(nodes,round.currentNodeIndex)) {
        if (!dutyIds.has(`${round.id}:${index}`)) continue;
        const review = await resolvePrincipalReturnReviewIdentity(tx,actor,row.projectId,round.id,index,nodes[index] as FrozenApprovalNode);
        if (review && review.identity.representedUserId !== actor) {
          approvalDuties.push({nodeIndex:index,roleKeys:[review.identity.approvedRoleKey],requiresSelfPassword:false});
        }
      }
      if (!approvalDuties.length) return null;
      const project = row.projectId ? await tx.project.findUnique({where:{id:row.projectId},select:{name:true}}) : null;
      return {
        delegatedOnly:true,sourceKind:row.sourceKind,sourceId:row.id,contributorName:row.contributorName,projectId:null,
        projectName:project?.name ?? null,principalYuan:null,paidYuan:null,reservedYuan:null,availableYuan:null,canApply:false,
        applications:[{id:row.id,status:row.status,revision:row.revision,approvalInstanceId:round.id,
          requestedYuan:row.requestedYuan.toFixed(4),approvedYuan:null,paidYuan:row.paidYuan.toFixed(4),approvalDuties,
          canApprove:true,canWithdraw:false,canReduce:false,canPay:false,payments:[]}],
      };
    }))).filter(item=>item !== null);
  }

  async result(actor: string, idempotencyKey: string) {
    return this.prisma.$transaction(async tx=>{
      const user = await tx.user.findUnique({where:{id:actor},select:{isActive:true}});
      if (!user?.isActive) throw new ForbiddenException("当前账号不可查询归还结果");
      const prior = await tx.registeredPrincipalReturnCommand.findUnique({where:{idempotencyKey}});
      if (!prior || prior.actorUserId !== actor) return {status:"unconfirmed",idempotencyKey};
      return this.receipt(prior);
    });
  }

  private async command(actor: string, action: string, idempotencyKey: string, payload: unknown,
      work: (tx: Tx)=>Promise<{application:{id:string;revision:number};paymentId?:string}>) {
    const hash = fingerprint([actor,action,payload]);
    const found = async (tx: Tx) => {
      const prior = await tx.registeredPrincipalReturnCommand.findUnique({where:{idempotencyKey}});
      if (prior && (prior.actorUserId !== actor || prior.payloadFingerprint !== hash)) {
        throw new ConflictException("原请求已关联不同归还内容，请先核对原结果");
      }
      return prior;
    };
    try {
      await this.prisma.$transaction(async tx=>{
        const user = await tx.user.findUnique({where:{id:actor},select:{isActive:true}});
        if (!user?.isActive) throw new ForbiddenException("当前账号不可办理本金归还");
        if (await found(tx)) return;
        const {application,paymentId} = await work(tx);
        await tx.registeredPrincipalReturnCommand.create({data:{
          idempotencyKey,applicationId:application.id,applicationRevision:application.revision,actorUserId:actor,paymentId,
          action,payloadFingerprint:hash,
        }});
        await this.audit.record(tx,{actorUserId:actor,businessType:PRINCIPAL_RETURN_BUSINESS_TYPE,businessId:application.id,action:`fund_account.principal_return.${action}`,
          metadata:{idempotencyKey,applicationRevision:application.revision,...(paymentId ? {paymentId} : {})}});
        await tx.$executeRaw(Prisma.sql`SET CONSTRAINTS public."RegisteredPrincipalReturnApplication_principal",
          public."RegisteredPrincipalReturnPayment_conservation", public."FundAccountBalanceRegistration_principal_return" IMMEDIATE`);
        if (action === "apply") {
          await tx.$executeRaw(Prisma.sql`SET CONSTRAINTS public."RegisteredPrincipalReturnApproval_binding" IMMEDIATE`);
        }
        if (paymentId) {
          await tx.$executeRaw(Prisma.sql`SET CONSTRAINTS public."FundAccountBalanceRegistration_conserve",
            public."FundAccountSourceBatch_conserve", public."FundAccountBalanceRegistration_payment_capacity",
            public."FundAccountBalanceRegistration_transfer_capacity" IMMEDIATE`);
        }
      },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") &&
          !isPostgresSerializationFailure(error)) throw error;
    }
    const row = await this.prisma.$transaction(found,{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
    if (!row) throw new ConflictException({code:"REGISTERED_PRINCIPAL_RETURN_UNCONFIRMED",message:"归还结果暂未确认，请用原请求查询"});
    if (action === "apply" || action === "approve") void this.notices?.afterCommit();
    return this.receipt(row);
  }

  private receipt(row: {idempotencyKey:string;applicationId:string;paymentId:string|null}) {
    return {status:"recorded",idempotencyKey:row.idempotencyKey,applicationId:row.applicationId,...(row.paymentId ? {paymentId:row.paymentId} : {})};
  }

  private async lockOrigin(tx: Tx, kind: string, sourceId: string) {
    await tx.$executeRaw(Prisma.sql`INSERT INTO public."RegisteredPrincipalReturnSource" ("kind","sourceId","writeRevision")
      VALUES (${kind},${sourceId},1) ON CONFLICT ("kind","sourceId") DO UPDATE
      SET "writeRevision" = "RegisteredPrincipalReturnSource"."writeRevision" + 1`);
  }

  private async lockApplication(tx: Tx, id: string, expectedRevision: number) {
    const before = await tx.registeredPrincipalReturnApplication.findUnique({where:{id}});
    if (!before) throw new NotFoundException("找不到本金归还申请");
    await this.lockOrigin(tx,before.sourceKind,before.sourceId);
    const locked = await tx.$queryRaw<Array<{id:string}>>(Prisma.sql`SELECT id FROM public."RegisteredPrincipalReturnApplication" WHERE id = ${id} FOR UPDATE`);
    if (!locked.length || before.revision !== expectedRevision) throw rejected("归还申请已变化，请刷新后核对");
    return before;
  }

  private async origin(tx: Tx, kind: OriginKind, sourceId: string) {
    if (kind === "advance_receipt") {
      const row = await tx.registeredFundAdvanceReceipt.findUnique({where:{id:sourceId},include:{companyOwned:true}});
      if (!row || row.companyOwned || !row.contributorId || !row.contributorNameSnapshot || row.contributorKind === "unknown") return null;
      return {principalYuan:row.amountYuan.toFixed(4),projectId:row.projectId,contributorName:row.contributorNameSnapshot};
    }
    const row = await tx.registeredPaymentProjectAdvance.findUnique({where:{executionId:sourceId},include:{execution:{select:{registeredFunding:{select:{actualPayerSnapshot:true}}}}}});
    if (!row) return null;
    const contributorName = this.companySnapshotName(row.execution.registeredFunding?.actualPayerSnapshot);
    return contributorName ? {principalYuan:new RegisteredBalanceDecimal(row.amountCents.toString()).div(100).toFixed(4),
      projectId:row.projectId,contributorName} : null;
  }

  private amounts(principalYuan: string, rows: Array<{status:string;requestedYuan:Prisma.Decimal;approvedYuan:Prisma.Decimal|null;paidYuan:Prisma.Decimal}>) {
    return principalReturnAmounts(principalYuan,rows.map(row=>({status:row.status as PrincipalReturnStatus,
      requestedYuan:row.requestedYuan.toFixed(4),approvedYuan:row.approvedYuan?.toFixed(4) ?? null,paidYuan:row.paidYuan.toFixed(4)})));
  }

  private companySnapshotName(snapshot: Prisma.JsonValue | undefined) {
    return snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) && typeof snapshot.name === "string" && snapshot.name.trim() ? snapshot.name : null;
  }

}

export async function resolvePrincipalReturnReviewIdentity(
  tx: Tx, actor: string, projectId: string|null, roundId: string, index: number, node: FrozenApprovalNode, directHolderOnly = false,
) {
  const actorRow = await tx.user.findUnique({where:{id:actor},select:{isActive:true}});
  if (!actorRow?.isActive) return null;
  const resolver = new CompanyRoleResolverService(tx as never);
  const scope = async (userId: string) => {
    const globalRoleKeys = await currentFundCompanyRoles(tx,userId);
    let projectRoleKeys: RoleKey[] = [];
    if (projectId) {
      try { projectRoleKeys = await resolver.resolveActiveRoleScopesInTransaction(tx,userId,projectId); }
      catch { /* no eligible project assignment */ }
    }
    return {globalRoleKeys,projectRoleKeys};
  };
  const actorRoleScopes = await scope(actor);
  const eligibleRoles = (roleScopes: typeof actorRoleScopes) => [...new Set([
    ...roleScopes.globalRoleKeys.filter(role=>role !== "project_manager"),
    ...roleScopes.projectRoleKeys.filter(role=>role === "project_manager"),
  ])];
  const roles = eligibleRoles(actorRoleScopes);
  if (roles.length === 1 && roles[0] === "super_admin") return null;
  const ids = directHolderOnly ? [] : await activeScopedApprovalDelegatorIds(tx,actor,{actionKey:PRINCIPAL_RETURN_REVIEW_ACTION,resourceType:PRINCIPAL_RETURN_BUSINESS_TYPE,resourceId:`${roundId}:${index}`});
  const activeDelegators = await Promise.all(ids.map(async userId=>{
    const roleScopes = await scope(userId);
    return {userId,roleKeys:eligibleRoles(roleScopes),roleScopes};
  }));
  const identity = resolveApprovalReviewIdentity({node,actorUserId:actor,actorRoleKeys:roles,actorRoleScopes,activeDelegators});
  return identity ? {identity,roles} : null;
}

export async function principalReturnPayableScopeKeys(tx: Tx, actorId: string, knownGlobalRoles?: readonly RoleKey[]) {
  const roles = knownGlobalRoles ?? await currentFundCompanyRoles(tx,actorId);
  if (!roles.some(role=>PAY_ROLES.includes(role))) return [];
  const finance = roles.some(role=>role === "finance_staff" || role === "finance_director");
  const accounts = await tx.registeredFundAccount.findMany({
    where:{OR:[{kind:"public_cash"},{kind:"company",company:{isActive:true}}]},
    include:{publicCashCustody:true,registrations:{where:{status:"confirmed"},orderBy:{version:"desc"},take:1,include:{sources:true}}},
  });
  const result: string[] = [];
  for (const account of accounts) {
    if (account.kind === "public_cash" && !finance && account.publicCashCustody &&
        account.publicCashCustody.currentCustodianId !== actorId) continue;
    const current = account.registrations[0];
    if (!current || current.balanceYuan === null) continue;
    const available = await availableRegisteredBalance(tx,current);
    if (available.balanceYuan?.gt(0) && !available.heldTransferAllocations.some(hold=>hold.candidateSourceIds.length !== 1) &&
        available.sources.some(source=>source.amountYuan.gt(0) &&
          !available.pendingAllocations.some(row=>row.candidateSourceIds.includes(source.id)))) result.push(account.scopeKey);
  }
  return result;
}
