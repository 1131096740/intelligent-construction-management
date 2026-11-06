import { availableRegisteredBalance, registeredPaymentSummaries } from "../payment/registered-payment-funding";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { normalizeBusinessAmount, sumBusinessAmounts, requiredPastChinaDate, type RoleKey } from "@jiangkong/shared-domain";
import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { PrismaService } from "../database/prisma.service";
import { CompanyRoleResolverService } from "../auth/company-role-resolver.service";
import { readFundReviewReceipt, makeFundReviewReceipt, fundReviewReceiptMetadata } from "./fund-account-receipt";
import { confirmApprovalSelfReview } from "../approval/approval-self-review";
import { snapshotApprovalSignature, withApprovalIdentity } from "../approval/approval-signature-snapshot";
import { fundReviewerAvailable, fundReviewNodes, FUND_REVIEW_BUSINESS_TYPE, fundReviewDutyId, loadFundReviewDuty, resolveFundReviewIdentity } from "./fund-account-duty";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { CorrectFundBalanceDto, ConfirmFundBalanceDto, RegisterFundBalanceDto } from "./fund-account.dto";

type Registration = Prisma.FundAccountBalanceRegistrationGetPayload<{ include: { sources: true } }>;
const normalizedOpeningPermission = (kind: string, roles: readonly RoleKey[]) => kind === "public_cash" ? roles.includes("comprehensive_director") : roles.includes("finance_staff");
const READ_ROLES: readonly RoleKey[] = ["finance_staff", "finance_director", "comprehensive_director"];
@Injectable()
export class FundAccountService {
  private readonly roles: CompanyRoleResolverService;
  constructor(private readonly prisma: PrismaService, private readonly auth: AuthService, private readonly auditLog: AuditService) { this.roles = new CompanyRoleResolverService(prisma); }
  async list(actorUserId: string) {
    return this.prisma.$transaction(async tx => {
      const roles = await this.authorize(tx, actorUserId, READ_ROLES);
      const [companies, persisted] = await Promise.all([
        tx.companyEntity.findMany({ orderBy: { name: "asc" } }),
        tx.registeredFundAccount.findMany({ include: { registrations: { include: { sources: true } } } })
      ]);
      const availableByAccount = new Map<string, Awaited<ReturnType<typeof availableRegisteredBalance>>>();
      for (const account of persisted) {
        const current = [...account.registrations].sort((a,b)=>b.version-a.version).find(row=>row.status === "confirmed");
        if (current) availableByAccount.set(account.id, await availableRegisteredBalance(tx, current));
      }
      const payments = await registeredPaymentSummaries(tx,{accountIds:persisted.map(row=>row.id)});
      const roundIds = persisted.flatMap(account => account.registrations.map(row => row.approvalInstanceId).filter((id): id is string => Boolean(id)));
      const approvalLogs = roundIds.length ? await tx.approvalActionLog.findMany({ where: { approvalInstanceId: { in: roundIds } }, orderBy: { createdAt: "asc" } }) : [];
      const reviewerAvailable = await fundReviewerAvailable(tx);
      const validPending = new Set<string>();
      const reviewable = new Set<string>();
      for (const row of persisted.flatMap(account => account.registrations).filter(row => row.status === "pending_review")) {
        try {
          if (!row.approvalInstanceId) continue;
          await loadFundReviewDuty(tx, fundReviewDutyId(row.approvalInstanceId)); validPending.add(row.id);
          await resolveFundReviewIdentity(tx, row.id, actorUserId, row.approvalInstanceId); reviewable.add(row.id);
        } catch (error) { if (!(error instanceof ForbiddenException) && !(error instanceof ConflictException)) throw error; }
      }
      const actorIds = [...new Set(persisted.flatMap(account => account.registrations.flatMap(row => [row.createdByUserId, row.confirmedByUserId, row.closedByUserId].filter((id): id is string => Boolean(id)))))];
      const actors = actorIds.length ? await tx.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } }) : [];
      const actorName = (id: string | null) => actors.find(actor => actor.id === id)?.name ?? "原登记人员";
      const scopes = [...companies.map(company => ({ scopeKey: `company:${company.id}`, name: company.name, companyEntityId: company.id as string | null, kind: "company", active: company.isActive })), { scopeKey: "public_cash", name: "公共现金", companyEntityId: null, kind: "public_cash", active: true }];
      return { accounts: scopes.map(scope => {
        const account = persisted.find(account => account.scopeKey === scope.scopeKey);
        const history = [...(account?.registrations ?? [])].sort((a, b) => b.version - a.version);
        const current = history.find(row => row.status === "confirmed");
        const available = account ? availableByAccount.get(account.id) : undefined;
        const pendingReview = history.some(row => row.status === "pending_review");
        return { ...scope, label: "系统登记余额", balanceYuan: available?.balanceYuan?.toFixed(4) ?? null,
          currentRegistrationId: current?.id ?? null, asOfDate: current?.asOfDate ?? null,
          custodianLabel: scope.kind === "public_cash" ? "当前综合部主管" : "财务",
          registeredPayments: payments.filter(row=>row.accountId===account?.id),
          unallocatedPaymentAmountYuan: new Prisma.Decimal((available?.pendingAllocations.reduce((sum,row)=>sum+row.amountCents,0n)??0n).toString()).div(100).toFixed(4),
          sources: current && available ? this.availableSources(current,available) : [], projectBalances: this.projectBalances(available?.sources ?? [], available?.pendingAllocations ?? []), history: history.map(row => ({ ...this.registrationView(row), coveredPayments: payments.filter(payment=>(row.coveredExecutionIds??[]).includes(payment.executionId)), pendingConfiguration: row.status === "pending_review" && !reviewerAvailable, approvalEvidence: approvalLogs.filter(log => log.approvalInstanceId === row.approvalInstanceId).map(log => ({ actorUserId: log.actorUserId, representedUserId: log.representedUserId, action: log.action, signed: Boolean(log.signatureVersionIdSnapshot && log.signatureSha256Snapshot && log.signatureFileIdSnapshot), signatureVersionId: log.signatureVersionIdSnapshot, signedAt: log.createdAt.toISOString(), metadata: log.metadata })), createdByName: actorName(row.createdByUserId), confirmedByName: row.confirmedByUserId ? actorName(row.confirmedByUserId) : null, closedByName: row.closedByUserId ? actorName(row.closedByUserId) : null, canWithdraw: validPending.has(row.id) && row.createdByUserId === actorUserId && roles.some(role => role === "finance_staff" || role === "finance_director"), canConfirm: reviewable.has(row.id), requiresSelfPassword: row.createdByUserId === actorUserId })),
          canRegisterBalance: !pendingReview && (roles.includes("finance_director") || (current ? roles.includes("finance_staff") : normalizedOpeningPermission(scope.kind, roles))),
          canRegisterOpening: !history.length && roles.some(role => scope.kind === "public_cash" ? role === "comprehensive_director" || role === "finance_director" : role === "finance_staff" || role === "finance_director"),
          canRequestCorrection: !pendingReview && Boolean(current) && roles.some(role => role === "finance_staff" || role === "finance_director"),
          canReview: roles.includes("finance_director")
        };
      }), projects: await tx.project.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
      notice: "仅为核对后的系统登记余额；不代表银行实时余额。期初已含的历史支出不再扣减；补录须明确期初归属。" };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
  async readAccount(actorUserId: string, scopeKey: string) {
    const result = await this.list(actorUserId);
    const account = result.accounts.find(account => account.scopeKey === scopeKey);
    if (!account) throw new NotFoundException("资金账户不存在，请刷新公司资料");
    return account;
  }
  async readRegistration(actorUserId: string, registrationId: string) {
    const result = await this.list(actorUserId);
    const row = result.accounts.flatMap(account => account.history).find(row => row.id === registrationId);
    if (!row) throw new NotFoundException("资金核对记录不存在，请刷新账户");
    return row;
  }
  async readReview(actorUserId: string, registrationId: string) {
    return this.prisma.$transaction(async tx => {
      const duty = await resolveFundReviewIdentity(tx, registrationId, actorUserId);
      const previous = await tx.fundAccountBalanceRegistration.findUnique({ where: { id: duty.row.previousRegistrationId! }, include: { sources: true } });
      if (!previous) throw new ConflictException("原登记缺失，不能办理复核");
      const company = duty.account.companyEntityId ? await tx.companyEntity.findUnique({ where: { id: duty.account.companyEntityId } }) : null;
      const users = await tx.user.findMany({ where: { id: { in: [duty.row.createdByUserId, previous.createdByUserId, actorUserId, duty.identity.representedUserId] } }, select: { id: true, name: true } });
      const name = (id: string) => users.find(user => user.id === id)?.name ?? "原登记人员";
      const coveredPayments = await registeredPaymentSummaries(tx,{executionIds:duty.row.coveredExecutionIds??[]});
      const available = await availableRegisteredBalance(tx,previous);
      const row = { ...this.registrationView(duty.row), coveredPayments, createdByName: name(duty.row.createdByUserId), canConfirm: true, canWithdraw: duty.row.createdByUserId === actorUserId && duty.actorRoles.some(role => role === "finance_staff" || role === "finance_director"), requiresSelfPassword: duty.row.createdByUserId === actorUserId };
      const account = { scopeKey: duty.account.scopeKey, name: company?.name ?? "公共现金", kind: duty.account.kind, companyEntityId: duty.account.companyEntityId, active: company?.isActive ?? true, balanceYuan: available.balanceYuan?.toFixed(4) ?? null, currentRegistrationId: previous.id, asOfDate: previous.asOfDate, custodianLabel: duty.account.kind === "public_cash" ? "当前综合部主管" : "财务", sources: this.availableSources(previous,available), projectBalances: this.projectBalances(available.sources,available.pendingAllocations), history: [row, { ...this.registrationView(previous), createdByName: name(previous.createdByUserId), canConfirm: false, canWithdraw: false }], canRegisterOpening: false, canRegisterBalance: false, canRequestCorrection: false, canReview: true };
      const projectIds = [...new Set([...duty.row.sources, ...previous.sources].map(source => source.projectId).filter((id): id is string => Boolean(id)))];
      return { ...row, account, projects: projectIds.length ? await tx.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, name: true } }) : [] };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
  async registerOpening(actorUserId: string, input: RegisterFundBalanceDto) {
    const normalized = this.normalize(input);
    const fingerprint = this.fingerprint({ ...normalized, kind: "opening" });
    return this.command(async tx => {
      await this.authorize(tx, actorUserId, normalized.scopeKey === "public_cash" ? ["comprehensive_director", "finance_director"] : ["finance_staff", "finance_director"]);
      const companyEntityId = await this.companyId(tx, normalized.scopeKey);
      const prior = await tx.fundAccountBalanceRegistration.findUnique({ where: { idempotencyKey: normalized.idempotencyKey }, include: { sources: true } });
      if (prior) return this.replay(prior, actorUserId, fingerprint);
      let account = await tx.registeredFundAccount.findUnique({ where: { scopeKey: normalized.scopeKey } });
      if (!account) account = await tx.registeredFundAccount.create({ data: { writeRevision: 0, scopeKey: normalized.scopeKey, kind: companyEntityId === null ? "public_cash" : "company", companyEntityId } });
      if ((await tx.fundAccountBalanceRegistration.findMany({ where: { accountId: account.id } })).length) throw new ConflictException("该账户已登记期初，请通过余额核对更正保留原记录");
      if (normalized.sources.some(source => source.previousSourceBatchId !== null)) throw new BadRequestException("期初来源不得关联其它登记来源");
      await this.validateProjects(tx, normalized.sources);
      const registration = await tx.fundAccountBalanceRegistration.create({ data: { ...this.registrationData(normalized), accountId: account.id, version: 1, kind: "opening", status: "confirmed", previousRegistrationId: null, payloadFingerprint: fingerprint, createdByUserId: actorUserId, confirmedByUserId: actorUserId, confirmedAt: new Date() } });
      const sources = await this.writeSources(tx, registration.id, normalized.sources);
      await this.audit(tx, actorUserId, "fund_account.opening.register", registration.id, { reason: normalized.reason, evidenceReference: normalized.evidenceReference, balanceYuan: normalized.balanceYuan, asOfDate: normalized.asOfDate });
      return this.registrationView({ ...registration, sources });
    });
  }
  async requestCorrection(actorUserId: string, input: CorrectFundBalanceDto) {
    const normalized = this.normalize(input);
    const coveredExecutionIds = [...(input.coveredExecutionIds ?? [])].sort();
    if (new Set(coveredExecutionIds).size !== coveredExecutionIds.length) throw new BadRequestException("核对已包含实付清单不能重复");
    const fingerprint = this.fingerprint({ ...normalized, kind: "correction", previousRegistrationId: input.previousRegistrationId, ...(input.coveredExecutionIds === undefined ? {} : { coveredExecutionIds }) });
    return this.command(async tx => {
      await this.authorize(tx, actorUserId, ["finance_staff", "finance_director"]);
      const prior = await tx.fundAccountBalanceRegistration.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { sources: true } });
      if (prior) return this.replay(prior, actorUserId, fingerprint);
      const account = await tx.registeredFundAccount.findUnique({ where: { scopeKey: input.scopeKey } });
      if (!account) throw new ConflictException("尚未登记期初，请先核对期初余额");
      const recorded = await tx.registeredPaymentFunding.findMany({ where: { accountId: account.id } });
      if (recorded.length && input.coveredExecutionIds === undefined) throw new BadRequestException("请明确本次核对余额已包含的实付清单；没有则确认空清单");
      if (coveredExecutionIds.some(id=>!recorded.some(row=>row.executionId===id))) throw new BadRequestException("核对清单只能选择此资金账户已有的正式实付，不能添加来源成员");
      const versions = await tx.fundAccountBalanceRegistration.findMany({ where: { accountId: account.id }, include: { sources: true }, orderBy: { version: "desc" } });
      const current = versions.find(row => row.status === "confirmed");
      if (!current || current.id !== input.previousRegistrationId) throw new ConflictException("原登记已变化或不属于该账户，请刷新核对");
      if (versions.some(row => row.status === "pending_review")) throw new ConflictException("该账户已有待复核更正，请先完成复核");
      if (input.asOfDate < current.asOfDate) throw new BadRequestException("核对日期不能早于原有效登记，请核对资料");
      for (const source of normalized.sources) {
        if (current.sources.length ? !current.sources.some(previous => previous.id === source.previousSourceBatchId) : source.previousSourceBatchId !== null) throw new BadRequestException("更正来源快照必须关联原登记来源，不得当作新到账或新本金");
      }
      await this.validateProjects(tx, normalized.sources);
      const registrationId = randomUUID();
      const round = await tx.approvalInstance.create({ data: { flowType: "fund_account_balance_correction", businessType: FUND_REVIEW_BUSINESS_TYPE, businessId: registrationId, status: "approval_pending", currentNodeIndex: 0, frozenNodes: fundReviewNodes(), applicantUserId: actorUserId } });
      const row = await tx.fundAccountBalanceRegistration.create({ data: { id: registrationId, ...this.registrationData(normalized), coveredExecutionIds, accountId: account.id, version: Math.max(...versions.map(row => row.version)) + 1, kind: "correction", status: "pending_review", previousRegistrationId: current.id, approvalInstanceId: round.id, payloadFingerprint: fingerprint, createdByUserId: actorUserId } });
      const sources = await this.writeSources(tx, row.id, normalized.sources);
      await this.audit(tx, actorUserId, "fund_account.correction.request", row.id, { previousRegistrationId: current.id, previousBalanceYuan: current.balanceYuan?.toFixed(4) ?? null, balanceYuan: normalized.balanceYuan, coveredExecutionIds, reason: normalized.reason, evidenceReference: normalized.evidenceReference });
      return this.registrationView({ ...row, sources });
    });
  }
  async confirmCorrection(actorUserId: string, registrationId: string, input: ConfirmFundBalanceDto) {
    if (!input.reviewNote?.trim()) throw new BadRequestException("请填写财务主管复核依据与结论");
    return this.reviewCommand(actorUserId, registrationId, input, "approve", async tx => {
      const priorReceipt = await readFundReviewReceipt(tx, actorUserId, registrationId, input, "approve");
      if (priorReceipt) return priorReceipt;
      const row = await tx.fundAccountBalanceRegistration.findUnique({ where: { id: registrationId }, include: { sources: true } });
      if (!row || row.kind !== "correction") throw new ConflictException("该更正登记不存在，请刷新账户");
      if (row.approvalInstanceId !== input.expectedApprovalInstanceId) throw new ConflictException("复核轮次不匹配，请刷新后重试");
      if (row.status !== "pending_review") throw new ConflictException("该登记当前不可复核");
      const versions = await tx.fundAccountBalanceRegistration.findMany({ where: { accountId: row.accountId, status: "confirmed" }, orderBy: { version: "desc" } });
      if (versions[0]?.id !== row.previousRegistrationId) throw new ConflictException("有效余额已变化，请重新核对原登记");
      const prospective = await availableRegisteredBalance(tx, row);
      if (prospective.balanceYuan !== null && prospective.balanceYuan.lt(0)) throw new ConflictException("本次已知核对金额不足以覆盖未包含的实际支出，请保留待复核并重新核对依据");
      const account = await tx.registeredFundAccount.findUnique({where:{id:row.accountId}});
      if (!account) throw new ConflictException("资金账户不存在，请刷新后核对");
      const touched = await tx.registeredFundAccount.updateMany({where:{id:account.id,writeRevision:account.writeRevision},data:{writeRevision:account.writeRevision+1}});
      if (touched.count !== 1) throw new ConflictException("资金实付或核对版本已变化，请刷新后继续复核");
      const receipt = await this.recordReview(tx, row.id, actorUserId, input, "approve");
      const confirmedAt = new Date();
      const updated = await tx.fundAccountBalanceRegistration.updateMany({ where: { id: row.id, status: "pending_review" }, data: { status: "confirmed", confirmedByUserId: actorUserId, confirmedAt, reviewNote: input.reviewNote.trim() } });
      if (updated.count !== 1) throw new ConflictException("该更正已处理，请刷新账户");
      await this.audit(tx, actorUserId, "fund_account.correction.confirm", row.id, { previousRegistrationId: row.previousRegistrationId, reason: row.reason, reviewNote: input.reviewNote.trim(), balanceYuan: row.balanceYuan?.toFixed(4) ?? null });
      return receipt;
    });
  }
  async returnCorrection(actorUserId: string, registrationId: string, input: ConfirmFundBalanceDto) {
    if (!input.reviewNote?.trim()) throw new BadRequestException("请填写退回原因，原登记金额和来源不会改变");
    return this.reviewCommand(actorUserId, registrationId, input, "reject", async tx => {
      const priorReceipt = await readFundReviewReceipt(tx, actorUserId, registrationId, input, "reject");
      if (priorReceipt) return priorReceipt;
      const row = await tx.fundAccountBalanceRegistration.findUnique({ where: { id: registrationId }, include: { sources: true } });
      if (!row || row.kind !== "correction") throw new ConflictException("该更正登记不存在，请刷新账户");
      if (row.approvalInstanceId !== input.expectedApprovalInstanceId) throw new ConflictException("复核轮次不匹配，请刷新后重试");
      if (row.status !== "pending_review") throw new ConflictException("只能退回尚未复核的更正登记");
      const receipt = await this.recordReview(tx, row.id, actorUserId, input, "reject");
      const closedAt = new Date();
      const updated = await tx.fundAccountBalanceRegistration.updateMany({ where: { id: row.id, status: "pending_review" }, data: { status: "returned", closedByUserId: actorUserId, closedAt, closeReason: input.reviewNote.trim() } });
      if (updated.count !== 1) throw new ConflictException("该更正已处理，请刷新账户");
      await this.audit(tx, actorUserId, "fund_account.correction.return", row.id, { reason: input.reviewNote.trim(), previousRegistrationId: row.previousRegistrationId });
      return receipt;
    });
  }
  async withdrawCorrection(actorUserId: string, registrationId: string, input: ConfirmFundBalanceDto) {
    if (!input.reviewNote?.trim()) throw new BadRequestException("请填写撤回原因，原登记金额和来源不会改变");
    return this.reviewCommand(actorUserId, registrationId, input, "withdraw", async tx => {
      const priorReceipt = await readFundReviewReceipt(tx, actorUserId, registrationId, input, "withdraw");
      if (priorReceipt) return priorReceipt;
      await this.authorize(tx, actorUserId, ["finance_staff", "finance_director"]);
      const row = await tx.fundAccountBalanceRegistration.findUnique({ where: { id: registrationId }, include: { sources: true } });
      if (!row || row.kind !== "correction") throw new ConflictException("该更正登记不存在，请刷新账户");
      if (row.approvalInstanceId !== input.expectedApprovalInstanceId) throw new ConflictException("复核轮次不匹配，请刷新后重试");
      if (row.createdByUserId !== actorUserId) throw new ForbiddenException("仅原发起人可撤回尚未复核的更正");
      if (row.status !== "pending_review") throw new ConflictException("只能撤回尚未复核的更正登记");
      if (row.createdByUserId === actorUserId) {
        if (!input.confirmationPassword) throw new BadRequestException("处理本人发起的更正须核验当前密码");
        await this.auth.confirmPassword(actorUserId, input.confirmationPassword, tx);
      }
      const receipt = await this.recordWithdrawal(tx, row, actorUserId, input);
      const closedAt = new Date();
      const updated = await tx.fundAccountBalanceRegistration.updateMany({ where: { id: row.id, status: "pending_review" }, data: { status: "withdrawn", closedByUserId: actorUserId, closedAt, closeReason: input.reviewNote.trim() } });
      if (updated.count !== 1) throw new ConflictException("该更正已处理，请刷新账户");
      await this.audit(tx, actorUserId, "fund_account.correction.withdraw", row.id, { reason: input.reviewNote.trim(), previousRegistrationId: row.previousRegistrationId });
      return receipt;
    });
  }
  private async recordWithdrawal(tx: Prisma.TransactionClient, row: Registration, actorUserId: string, input: ConfirmFundBalanceDto) {
    if (!row.approvalInstanceId || row.approvalInstanceId !== input.expectedApprovalInstanceId) throw new ConflictException("撤回轮次不匹配，请刷新后重试");
    const duty = await loadFundReviewDuty(tx, fundReviewDutyId(row.approvalInstanceId));
    if (duty.row.id !== row.id || duty.round.applicantUserId !== actorUserId) throw new ForbiddenException("只能撤回本人发起的本轮更正");
    const updated = await tx.approvalInstance.updateMany({ where: { id: duty.round.id, status: "approval_pending" }, data: { status: "withdrawn" } });
    if (updated.count !== 1) throw new ConflictException("复核轮次已结束，不能撤回");
    const receipt = makeFundReviewReceipt(row, actorUserId, actorUserId, input, "withdraw", null);
    await tx.approvalActionLog.create({ data: { approvalInstanceId: duty.round.id, action: "withdraw", actorUserId, representedUserId: actorUserId, comment: input.reviewNote.trim(), metadata: { nodeName: "财务主管余额核对复核", nodeIndex: 0, ...fundReviewReceiptMetadata(row.id, input, "withdraw", receipt) } } });
    return receipt;
  }
  private async recordReview(tx: Prisma.TransactionClient, registrationId: string, actorUserId: string, input: ConfirmFundBalanceDto, decision: "approve" | "reject") {
    const duty = await resolveFundReviewIdentity(tx, registrationId, actorUserId, input.expectedApprovalInstanceId);
    const effectiveRoles = [...new Set([...duty.actorRoles, duty.identity.approvedRoleKey])];
    // Same effective delegated-role seam as the existing spot review service;
    // the audit below separately freezes the true represented identity.
    const selfReview = await confirmApprovalSelfReview({ applicantUserId: duty.row.createdByUserId, actorUserId, actorRoleKeys: effectiveRoles, approvedRoleKey: duty.identity.approvedRoleKey, originatorUserIds: [duty.row.createdByUserId], selfReviewReason: input.selfReviewReason, confirmationPassword: input.confirmationPassword, confirmPassword: password => this.auth.confirmPassword(actorUserId, password, tx) });
    const signature = decision === "approve" ? await snapshotApprovalSignature(tx, actorUserId, { required: true }) : null;
    const receipt = makeFundReviewReceipt(duty.row, actorUserId, duty.identity.representedUserId, input, decision, signature?.versionId ?? null);
    const decidedAt = new Date();
    if (duty.delegationEndsAt && duty.delegationEndsAt <= decidedAt) throw new ForbiddenException("委托已到期，请由当前有效职责人员办理");
    await tx.approvalActionLog.create({ data: await withApprovalIdentity(tx, { approvalInstanceId: duty.round.id, createdAt: decidedAt, action: decision, actorUserId, representedUserId: duty.identity.representedUserId, approvedRoleKey: duty.identity.approvedRoleKey, comment: input.reviewNote.trim(), ...(signature ? { signatureFileIdSnapshot: signature.fileId, signatureSha256Snapshot: signature.sha256, signatureVersionIdSnapshot: signature.versionId } : {}), metadata: { nodeName: "财务主管余额核对复核", nodeIndex: 0, ...fundReviewReceiptMetadata(duty.row.id, input, decision, receipt), ...selfReview.metadata, ...(duty.delegationId ? { delegationId: duty.delegationId } : {}) } }, signature) });
    const nodes = fundReviewNodes();
    if (decision === "approve") nodes[0].approvedRoleKeys = ["finance_director"];
    const updated = await tx.approvalInstance.updateMany({ where: { id: duty.round.id, status: "approval_pending", currentNodeIndex: 0 }, data: { status: decision === "approve" ? "approved" : "rejected", currentNodeIndex: decision === "approve" ? 1 : 0, frozenNodes: nodes } });
    if (updated.count !== 1) throw new ConflictException("该复核职责已处理，请刷新后重试");
    return receipt;
  }
  private normalize(input: RegisterFundBalanceDto) {
    let balanceYuan: string | null;
    let sources: Array<{ amountYuan: string; sourceStatus: string; sourceName: string | null; projectStatus: string; projectId: string | null; previousSourceBatchId: string | null }>;
    try {
      balanceYuan = normalizeBusinessAmount(input.balanceYuan ?? null);
      sources = input.sources.map(source => ({ amountYuan: normalizeBusinessAmount(source.amountYuan)!, sourceStatus: source.sourceStatus, sourceName: source.sourceName?.trim() || null, projectStatus: source.projectStatus, projectId: source.projectId?.trim() || null, previousSourceBatchId: source.previousSourceBatchId ?? null }));
    } catch { throw new BadRequestException("金额请填写非负数字，最多保留四位小数，未知余额留空"); }
    if (sources.length > 200 || sources.some(source => !["pending", "known"].includes(source.sourceStatus) || !["pending", "project", "company_daily"].includes(source.projectStatus) || source.amountYuan === null || (source.sourceStatus === "known") !== Boolean(source.sourceName) || (source.projectStatus === "project") !== Boolean(source.projectId))) throw new BadRequestException("请分别核对资金来源和项目归属，未知项选择待核对");
    try {
      if (balanceYuan === null ? sources.length > 0 : sumBusinessAmounts(sources.map(source => source.amountYuan)) !== balanceYuan) throw new Error("unbalanced reconciliation");
    } catch { throw new BadRequestException("来源金额合计须等于核对余额；余额未知时不要填写来源金额"); }
    for (const text of [input.evidenceReference, input.reconciliationNote, input.reason, input.idempotencyKey]) if (!text?.trim()) throw new BadRequestException("请填写核对依据、核对说明、原因及重试凭据");
    try {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.asOfDate)) throw new Error("date-only reconciliation required");
      requiredPastChinaDate(input.asOfDate, "核对日期");
    } catch { throw new BadRequestException("核对日期请填写真实且不晚于北京时间今天的日期"); }
    return { scopeKey: input.scopeKey, balanceYuan, sources, asOfDate: input.asOfDate, evidenceReference: input.evidenceReference.trim(), reconciliationNote: input.reconciliationNote.trim(), reason: input.reason.trim(), idempotencyKey: input.idempotencyKey };
  }
  private registrationData(input: ReturnType<FundAccountService["normalize"]>) {
    return { coveredExecutionIds: [] as string[], balanceYuan: input.balanceYuan === null ? null : new Prisma.Decimal(input.balanceYuan), asOfDate: input.asOfDate, evidenceReference: input.evidenceReference, reconciliationNote: input.reconciliationNote, reason: input.reason, idempotencyKey: input.idempotencyKey };
  }
  private async companyId(tx: Prisma.TransactionClient, scopeKey: string) {
    if (scopeKey === "public_cash") return null;
    if (!scopeKey.startsWith("company:")) throw new BadRequestException("请选择公司资金或公共现金");
    const company = await tx.companyEntity.findUnique({ where: { id: scopeKey.slice(8) } });
    if (!company) throw new BadRequestException("所选公司不存在，请刷新公司资料");
    return company.id;
  }
  private async authorize(tx: Prisma.TransactionClient, actor: string, allowed: readonly RoleKey[]) {
    let roles: RoleKey[];
    try { roles = await this.roles.resolveActiveRoleScopesInTransaction(tx, actor); }
    catch { throw new ForbiddenException("当前账号缺少有效公司级资金岗位"); }
    if (!roles.some(role => allowed.includes(role))) throw new ForbiddenException("当前公司级岗位无权办理该资金事项");
    return roles;
  }
  private async validateProjects(tx: Prisma.TransactionClient, sources: ReturnType<FundAccountService["normalize"]>["sources"]) {
    for (const source of sources) if (source.projectId && !await tx.project.findUnique({ where: { id: source.projectId } })) throw new BadRequestException("来源所属项目不存在，请核对原始资料");
  }
  private async writeSources(tx: Prisma.TransactionClient, registrationId: string, sources: ReturnType<FundAccountService["normalize"]>["sources"]) {
    const rows = [];
    for (const [index, source] of sources.entries()) rows.push(await tx.fundAccountSourceBatch.create({ data: { registrationId, lineNo: index + 1, amountYuan: new Prisma.Decimal(source.amountYuan), sourceStatus: source.sourceStatus, sourceName: source.sourceName, projectStatus: source.projectStatus, projectId: source.projectId, previousSourceBatchId: source.previousSourceBatchId } }));
    return rows;
  }
  private availableSources(original: Registration, available: Awaited<ReturnType<typeof availableRegisteredBalance>>) {
    return available.sources.map(source=>({...this.sourceView(source),reconciledAmountYuan:original.sources.find(row=>row.id===source.id)?.amountYuan.toFixed(4)??null,
      ...(available.pendingAllocations.some(row=>row.candidateSourceIds.includes(source.id))?{amountYuan:null,pendingAllocation:true}:{pendingAllocation:false})}));
  }
  private projectBalances(sources: Registration["sources"], pending: Array<{amountCents:bigint;candidateSourceIds:string[]}> = []) {
    const keyFor = (source: Registration["sources"][number]) => JSON.stringify([source.projectStatus,source.projectId]);
    const groups = new Map<string, {projectStatus:string;projectId:string|null;amountYuan:string|null;pendingAllocation:boolean}>();
    for (const source of sources) {
      const key = keyFor(source); const group = groups.get(key);
      groups.set(key,{projectStatus:source.projectStatus,projectId:source.projectId,amountYuan:sumBusinessAmounts([group?.amountYuan??"0",source.amountYuan.toFixed(4)])!,pendingAllocation:false});
    }
    for (const allocation of pending) {
      const keys = new Set(sources.filter(source=>allocation.candidateSourceIds.includes(source.id)).map(keyFor));
      if (keys.size === 1) {
        const group = groups.get([...keys][0])!;
        if (group.amountYuan !== null) group.amountYuan = new Prisma.Decimal(group.amountYuan).minus(new Prisma.Decimal(allocation.amountCents.toString()).div(100)).toFixed(4);
      } else for (const key of keys) { const group=groups.get(key)!; group.amountYuan=null;group.pendingAllocation=true; }
    }
    return [...groups.values()].map(group=>({projectStatus:group.projectStatus,projectId:group.projectId,amountYuan:group.amountYuan}));
  }
  private sourceView(source: Registration["sources"][number]) { return { ...source, amountYuan: source.amountYuan.toFixed(4) }; }
  private registrationView(row: Registration) { return { id: row.id, coveredExecutionIds: row.coveredExecutionIds ?? [], version: row.version, kind: row.kind, status: row.status, previousRegistrationId: row.previousRegistrationId, approvalInstanceId: row.approvalInstanceId, balanceYuan: row.balanceYuan?.toFixed(4) ?? null, asOfDate: row.asOfDate, evidenceReference: row.evidenceReference, reconciliationNote: row.reconciliationNote, reason: row.reason, reviewNote: row.reviewNote ?? null, closedByUserId: row.closedByUserId, closedAt: row.closedAt?.toISOString() ?? null, closeReason: row.closeReason, createdByUserId: row.createdByUserId, confirmedByUserId: row.confirmedByUserId, confirmedAt: row.confirmedAt?.toISOString() ?? null, sources: row.sources.map(source => this.sourceView(source)) }; }
  private replay(prior: Registration, actor: string, fingerprint: string) { if (prior.createdByUserId !== actor || prior.payloadFingerprint !== fingerprint) throw new ConflictException("重试凭据已用于另一份登记，请核对原登记"); return this.registrationView(prior); }
  private fingerprint(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
  private audit(tx: Prisma.TransactionClient, actorUserId: string, action: string, businessId: string, metadata: Prisma.InputJsonObject) { return this.auditLog.record(tx, { actorUserId, action, businessType: "fund_account_balance", businessId, metadata }); }
  private async reviewCommand<T>(actor: string, id: string, input: ConfirmFundBalanceDto, action: "approve" | "reject" | "withdraw", run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T | Awaited<ReturnType<typeof readFundReviewReceipt>>> {
    try { return await this.prisma.$transaction(run, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
    catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || !["P2002", "P2034"].includes(error.code)) throw error;
      // The failed transaction has ended. Only a fresh committed receipt may
      // resolve a lost concurrent response; never retry the write closure.
      const receipt = await this.prisma.$transaction(tx => readFundReviewReceipt(tx, actor, id, input, action));
      if (receipt) return receipt;
      throw new ConflictException("资金复核已变化，请保留原办理凭据核对重试");
    }
  }
  private async command<T>(run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try { return await this.prisma.$transaction(run, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
    catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code)) throw new ConflictException("资金登记已变化，请刷新核对；重试请保留原凭据"); throw error; }
  }
}
