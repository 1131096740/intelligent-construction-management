import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { normalizeBusinessAmount, requiredPastChinaDate, sumBusinessAmounts, type RoleKey } from "@jiangkong/shared-domain";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import { CompanyRoleResolverService } from "../auth/company-role-resolver.service";
import { PrismaService } from "../database/prisma.service";
import { availableRegisteredBalance, RegisteredBalanceDecimal, sameTransferSourceIdentity } from "../payment/registered-payment-funding";
import { assertPublicCashCustodian, currentPublicCashCustodian } from "./public-cash-custodian";
import { FundAccountTransferNotificationService } from "./fund-account-transfer-notification.service";
import { ActOnFundAccountTransferDto, RegisterFundAccountTransferDto } from "./fund-account-transfer.dto";
import { rejectedTransferWithoutWrite, supersededTransferCommand, transferStateAfterAction, type FundAccountTransferState } from "./fund-account-transfer-state";
import { currentFundTransferDuty, fundTransferCashAccess, fundTransferRoles as rolesFor, FUND_TRANSFER_CASH_ROLES as CASH, FUND_TRANSFER_FINANCE_ROLES as FINANCE } from "./fund-account-transfer-duty";

type Transaction = Prisma.TransactionClient;
type Registration = Prisma.FundAccountBalanceRegistrationGetPayload<{ include: { sources: true } }>;
const fingerprint = (input: unknown) => createHash("sha256").update(JSON.stringify(input)).digest("hex");

@Injectable()
export class FundAccountTransferService {
  private readonly roles: CompanyRoleResolverService;
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService,
    @Optional() private readonly transferNotifications?: FundAccountTransferNotificationService) {
    this.roles = new CompanyRoleResolverService(prisma);
  }

  async list(actorId: string) {
    return this.transaction(async tx => {
      const roles = await this.authorize(tx, actorId, [...CASH, ...FINANCE]);
      const rows = await tx.registeredFundTransfer.findMany({
        include: { sourceAccount: true, destinationAccount: true, actions: { orderBy: { revision: "asc" } } },
        orderBy: { createdAt: "desc" }
      });
      const cashAccount = await tx.registeredFundAccount.findUnique({ where: { scopeKey: "public_cash" }, select: { id: true } });
      const cashAccess = await fundTransferCashAccess(tx, actorId, cashAccount?.id ?? null);
      const canRegisterCash = roles.some(role => role === "comprehensive_director") && (!cashAccess.custodian || cashAccess.custodian === actorId);
      return { canRegisterCash, canRegisterCompany: roles.some(role => role === "finance_staff" || role === "finance_director"),
        transfers: rows.map(row => {
          const duty = currentFundTransferDuty(row, actorId, roles, cashAccess);
          return {
            id: row.id, sourceScopeKey: row.sourceAccount.scopeKey, destinationScopeKey: row.destinationAccount.scopeKey,
            amountYuan: row.amountYuan.toFixed(4), status: row.status, revision: row.revision, transferredOn: row.transferredOn,
            evidenceReference: row.evidenceReference, actions: row.actions.map(action => ({
              action: action.action, evidenceReference: action.evidenceReference, createdAt: action.createdAt
            })),
            canReceive: duty === "receive",
            canResolveRejection: duty === "resolve_rejection"
          };
        })
      };
    });
  }

  async register(actorId: string, input: RegisterFundAccountTransferDto) {
    const evidence = this.evidence(input.evidenceReference);
    let amountYuan: string;
    let lines: Array<{ sourceBatchId: string; amountYuan: string }>;
    try {
      if (!/^\d{4}-\d{2}-\d{2}$/u.test(input.transferredOn)) throw new Error();
      requiredPastChinaDate(input.transferredOn, "转款日期");
      lines = input.lines.map(line => {
        const amount = normalizeBusinessAmount(line.amountYuan);
        if (amount === null || amount === "0.0000") throw new Error();
        return { sourceBatchId: line.sourceBatchId, amountYuan: amount };
      }).sort((a, b) => a.sourceBatchId.localeCompare(b.sourceBatchId));
      if (!lines.length || new Set(lines.map(line => line.sourceBatchId)).size !== lines.length) throw new Error();
      amountYuan = sumBusinessAmounts(lines.map(line => line.amountYuan))!;
    } catch { throw new BadRequestException("请核对实际转款日期和每项正数来源金额"); }
    const requestHash = fingerprint({ action: "register", actorId, sourceScopeKey: input.sourceScopeKey,
      destinationScopeKey: input.destinationScopeKey, expectedRegistrationId: input.expectedRegistrationId,
      transferredOn: input.transferredOn, evidence, lines });
    const result = await this.transaction(async tx => {
      const source = await tx.registeredFundAccount.findUnique({ where: { scopeKey: input.sourceScopeKey } });
      const destination = await tx.registeredFundAccount.findUnique({ where: { scopeKey: input.destinationScopeKey } });
      if (!source || !destination || new Set([source.kind, destination.kind]).size !== 2 ||
          ![source.kind, destination.kind].includes("public_cash") || ![source.kind, destination.kind].includes("company")) {
        throw new BadRequestException("请选择公共现金和一个公司资金账户");
      }
      await this.authorize(tx, actorId, rolesFor(source.kind));
      const replay = await this.replay(tx, actorId, input.idempotencyKey, requestHash);
      if (replay) return replay;
      const companyId = source.companyEntityId ?? destination.companyEntityId;
      const company = companyId ? await tx.companyEntity.findUnique({ where: { id: companyId }, select: { isActive: true } }) : null;
      if (!company?.isActive) throw rejectedTransferWithoutWrite("所选公司已停用，不能登记新的转款");
      await this.lockAccounts(tx, source.id, destination.id);
      if (source.kind === "public_cash") await assertPublicCashCustodian(tx, source.id, actorId);
      const current = await this.current(tx, source.id);
      await this.current(tx, destination.id);
      if (current.id !== input.expectedRegistrationId) {
        const original = await tx.fundAccountBalanceRegistration.findFirst({
          where: { id: input.expectedRegistrationId, accountId: source.id, status: "confirmed", version: { lt: current.version } },
          select: { id: true }
        });
        if (original) throw supersededTransferCommand();
        throw rejectedTransferWithoutWrite("资金核对版本已变化，请刷新后重新选择资金来源");
      }
      const available = await availableRegisteredBalance(tx, current);
      if (available.balanceYuan?.lt(amountYuan) || available.heldTransferAllocations.some(hold => hold.candidateSourceIds.length !== 1)) {
        throw rejectedTransferWithoutWrite("可用资金不足或已有转款来源待核对");
      }
      for (const line of lines) {
        const sourceLine = available.sources.find(row => row.id === line.sourceBatchId);
        if (!sourceLine || sourceLine.amountYuan.lt(line.amountYuan) || available.pendingAllocations.some(row => row.candidateSourceIds.includes(line.sourceBatchId))) {
          throw rejectedTransferWithoutWrite("所选资金来源可用余额不足或待核对");
        }
      }
      const transfer = await tx.registeredFundTransfer.create({ data: {
        sourceAccountId: source.id, destinationAccountId: destination.id, amountYuan, status: "pending_receipt",
        transferredOn: input.transferredOn, evidenceReference: evidence, createdByUserId: actorId,
        lines: { create: lines }
      } });
      return this.record(tx, actorId, transfer, input.idempotencyKey, requestHash, "register", evidence);
    }, { actorId, key: input.idempotencyKey, requestHash, authorize: async tx => {
      const source = await tx.registeredFundAccount.findUnique({ where: { scopeKey: input.sourceScopeKey } });
      if (!source) throw new NotFoundException("转出账户不存在");
      await this.authorize(tx, actorId, rolesFor(source.kind));
    } });
    void this.transferNotifications?.afterCommit();
    return result;
  }

  async act(actorId: string, transferId: string, input: ActOnFundAccountTransferDto) {
    const evidence = this.evidence(input.evidenceReference);
    const requestHash = fingerprint({ transferId, actorId, action: input.action, expectedRevision: input.expectedRevision, evidence });
    const forOrigin = input.action === "resubmit" || input.action === "return";
    const authorizeAction = async (tx: Transaction, transfer: { sourceAccount: { kind: string }; destinationAccount: { kind: string } }) => {
      await this.authorize(tx, actorId, rolesFor(forOrigin ? transfer.sourceAccount.kind : transfer.destinationAccount.kind));
    };
    const result = await this.transaction(async tx => {
      const transfer = await tx.registeredFundTransfer.findUnique({
        where: { id: transferId }, include: { sourceAccount: true, destinationAccount: true, lines: { include: { sourceBatch: true } } }
      });
      if (!transfer) throw new NotFoundException("转款记录不存在");
      await authorizeAction(tx, transfer);
      const replay = await this.replay(tx, actorId, input.idempotencyKey, requestHash);
      if (replay) return replay;
      await this.lockAccounts(tx, transfer.sourceAccountId, transfer.destinationAccountId);
      if (!forOrigin && transfer.destinationAccount.kind === "public_cash") {
        await assertPublicCashCustodian(tx, transfer.destinationAccountId, actorId);
      }
      let handoverId: string | undefined;
      if (forOrigin && transfer.createdByUserId !== actorId) {
        if (transfer.sourceAccount.kind === "public_cash" &&
            await currentPublicCashCustodian(tx, transfer.sourceAccountId) === actorId) {
          const handover = await tx.publicCashHandover.findFirst({
            where: { accountId: transfer.sourceAccountId, fromCustodianId: transfer.createdByUserId,
              fromCustodian: { isActive: false }, receipt: { isNot: null } },
            select: { id: true }, orderBy: { startedRevision: "desc" }
          });
          handoverId = handover?.id;
        }
        if (!handoverId) throw new ForbiddenException("仅原经办人或已完成离职交接的现任现金保管人可以处理驳回转款");
      }
      // This snapshot saw the newer revision and no receipt for this key.
      // The database only permits a one-step increment, so the original action cannot now commit.
      if (transfer.revision > input.expectedRevision) throw supersededTransferCommand();
      if (transfer.revision !== input.expectedRevision) throw rejectedTransferWithoutWrite("转款已更新，请刷新后核对");
      const status = transferStateAfterAction(transfer.status as FundAccountTransferState, input.action);
      const revision = transfer.revision + 1;
      const touched = await tx.registeredFundTransfer.updateMany({ where: { id: transferId, revision: transfer.revision }, data: { status, revision } });
      if (touched.count !== 1) throw new ConflictException("转款已更新，请刷新后核对");
      if (status === "received") {
        const source = await this.current(tx, transfer.sourceAccountId);
        const destination = await this.current(tx, transfer.destinationAccountId);
        const ancestry = await tx.fundAccountSourceBatch.findMany({ where: { registration: { accountId: source.accountId } }, select: { id: true, previousSourceBatchId: true } });
        const parent = new Map(ancestry.map(row => [row.id, row.previousSourceBatchId]));
        const debits = new Map<string, Prisma.Decimal>();
        for (const line of transfer.lines) {
          const candidates = source.sources.filter(batch => {
            const visited = new Set<string>();
            for (let id: string | null | undefined = batch.id; id && !visited.has(id); id = parent.get(id)) {
              if (id === line.sourceBatchId) return true;
              visited.add(id);
            }
            return false;
          });
          if (candidates.length !== 1 || !sameTransferSourceIdentity(line.sourceBatch, candidates[0])) {
            throw rejectedTransferWithoutWrite("转款来源或项目归属已变化，不能确认实收");
          }
          const id = candidates[0].id;
          debits.set(id, (debits.get(id) ?? new RegisteredBalanceDecimal(0)).plus(line.amountYuan));
        }
        const activeSource = await availableRegisteredBalance(tx, source);
        if (activeSource.balanceYuan!.lt(transfer.amountYuan) || activeSource.sources.some(batch => batch.amountYuan.lt(debits.get(batch.id) ?? 0))) {
          throw rejectedTransferWithoutWrite("转款余额或来源已变化，不能确认实收");
        }
        await this.appendReceipt(tx, source, transfer, actorId, evidence, source.sources.map(batch =>
          this.sourceSnapshot(batch, new RegisteredBalanceDecimal(batch.amountYuan.toFixed(4)).minus(debits.get(batch.id) ?? 0), batch.id)));
        await this.appendReceipt(tx, destination, transfer, actorId, evidence, [
          ...destination.sources.map(batch => this.sourceSnapshot(batch, batch.amountYuan, batch.id)),
          ...transfer.lines.map(line => ({ ...this.sourceSnapshot(line.sourceBatch, line.amountYuan, null), receivedTransferLineId: line.id }))
        ]);
      }
      return this.record(tx, actorId, { ...transfer, status, revision }, input.idempotencyKey, requestHash, input.action, evidence, handoverId);
    }, { actorId, key: input.idempotencyKey, requestHash, authorize: async tx => {
      const transfer = await tx.registeredFundTransfer.findUnique({
        where: { id: transferId }, include: { sourceAccount: true, destinationAccount: true }
      });
      if (!transfer) throw new NotFoundException("转款记录不存在");
      await authorizeAction(tx, transfer);
    } });
    void this.transferNotifications?.afterCommit();
    return result;
  }

  private sourceSnapshot(batch: Registration["sources"][number], amountYuan: Prisma.Decimal, previousSourceBatchId: string | null) {
    return { amountYuan, previousSourceBatchId, sourceStatus: batch.sourceStatus, sourceName: batch.sourceName, projectStatus: batch.projectStatus, projectId: batch.projectId };
  }

  private async appendReceipt(tx: Transaction, previous: Registration, transfer: { id: string }, actorId: string, evidence: string,
      sources: Array<ReturnType<FundAccountTransferService["sourceSnapshot"]> & { receivedTransferLineId?: string }>) {
    const latest = await tx.fundAccountBalanceRegistration.findFirstOrThrow({ where: { accountId: previous.accountId }, orderBy: { version: "desc" } });
    let balanceYuan: string;
    try { balanceYuan = sumBusinessAmounts(sources.map(source => source.amountYuan.toFixed(4)))!; }
    catch { throw rejectedTransferWithoutWrite("实收后登记余额超出可保存范围，请先核对账户"); }
    const registration = await tx.fundAccountBalanceRegistration.create({ data: {
      accountId: previous.accountId, previousRegistrationId: previous.id, version: latest.version + 1,
      kind: "transfer", status: "confirmed", transferId: transfer.id, balanceYuan,
      coveredExecutionIds: previous.coveredExecutionIds, asOfDate: previous.asOfDate, evidenceReference: evidence,
      reconciliationNote: "登记转款已确认实收", reason: "现金与公司资金转款", idempotencyKey: `fund-transfer:${transfer.id}:${previous.accountId}`,
      payloadFingerprint: fingerprint({ transferId: transfer.id, accountId: previous.accountId }),
      createdByUserId: actorId, confirmedByUserId: actorId, confirmedAt: new Date()
    } });
    await tx.fundAccountSourceBatch.createMany({ data: sources.map((source, index) => ({ ...source, registrationId: registration.id, lineNo: index + 1 })) });
  }

  private async current(tx: Transaction, accountId: string) {
    const row = await tx.fundAccountBalanceRegistration.findFirst({
      where: { accountId, status: "confirmed" }, orderBy: { version: "desc" }, include: { sources: true }
    });
    if (!row || row.balanceYuan === null) throw rejectedTransferWithoutWrite("资金余额尚未核对，不能办理转款");
    return row;
  }

  private async lockAccounts(tx: Transaction, source: string, destination: string) {
    const accounts = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "RegisteredFundAccount" WHERE "id" IN (${source}, ${destination}) ORDER BY "id" FOR UPDATE`);
    if (accounts.length !== 2) throw new ConflictException("转款账户已变化，请刷新后核对");
    for (const { id } of accounts) await tx.registeredFundAccount.update({ where: { id }, data: { writeRevision: { increment: 1 } } });
  }

  private async authorize(tx: Transaction, actorId: string, allowed: readonly RoleKey[]) {
    let roles: RoleKey[];
    try { roles = await this.roles.resolveActiveRoleScopesInTransaction(tx, actorId); }
    catch { throw new ForbiddenException("当前账号缺少有效公司级资金岗位"); }
    if (!roles.some(role => allowed.includes(role))) throw new ForbiddenException("当前公司级岗位无权办理该转款");
    return roles;
  }

  private evidence(value: string) {
    const evidence = value.trim();
    if (!evidence) throw new BadRequestException("请填写实际转款、实收或退回的核对依据");
    return evidence;
  }

  private async record(tx: Transaction, actorId: string, transfer: { id: string; status: string; revision: number }, key: string, requestHash: string, action: string, evidence: string, handoverId?: string) {
    await tx.registeredFundTransferAction.create({ data: { idempotencyKey: key, transferId: transfer.id, actorUserId: actorId,
      revision: transfer.revision, status: transfer.status, action, evidenceReference: evidence, payloadFingerprint: requestHash } });
    await this.audit.record(tx, { actorUserId: actorId, action: `fund_account.transfer.${action}`, businessType: "registered_fund_transfer",
      businessId: transfer.id, metadata: { revision: transfer.revision, status: transfer.status, evidenceReference: evidence,
        ...(handoverId ? { cashCustodyHandoverId: handoverId } : {}) } });
    if (transfer.status === "pending_receipt" || transfer.status === "rejected_held") {
      await this.transferNotifications?.queue(tx, transfer.id, actorId);
    }
    await tx.$executeRaw`SET CONSTRAINTS public."RegisteredFundTransfer_consistency",
      public."RegisteredFundTransferAction_consistency",
      public."FundAccountBalanceRegistration_transfer_consistency" IMMEDIATE`;
    return { id: transfer.id, revision: transfer.revision, status: transfer.status };
  }

  private async replay(tx: Transaction, actorId: string, key: string, requestHash: string) {
    const action = await tx.registeredFundTransferAction.findUnique({ where: { idempotencyKey: key } });
    if (!action) return null;
    if (action.actorUserId !== actorId || action.payloadFingerprint !== requestHash) throw new ConflictException("办理凭据已用于另一份转款，请核对原记录");
    return { id: action.transferId, revision: action.revision, status: action.status };
  }

  private async transaction<T>(run: (tx: Transaction) => Promise<T>, retry?: { actorId: string; key: string; requestHash: string; authorize(tx: Transaction): Promise<void> }) {
    try { return await this.prisma.$transaction(run, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
    catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) ||
        !(["P2002", "P2034"].includes(error.code) || (error.code === "P2010" && error.meta?.code === "40001"))) throw error;
      if (retry) {
        const { actorId, key, requestHash } = retry;
        const receipt = await this.prisma.$transaction(async tx => {
          await retry.authorize(tx);
          return this.replay(tx, actorId, key, requestHash);
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        if (receipt) return receipt;
      }
      throw new ConflictException("资金或转款状态已变化，请保留原凭据并刷新核对");
    }
  }
}
