import { OperatingLedgerService } from "../operating-ledger/operating-ledger.service";
import { ContractWorkCompletionOperatingSourceAdapter } from "./contract-work-completion-operating-source.adapter";
import { ContractWorkCompletionNotificationService } from "./contract-work-completion-notification.service";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type { RoleKey } from "@jiangkong/shared-domain";
import { Prisma } from "@prisma/client";
import { activeApprovalDelegatorIds } from "../approval/active-approval-delegations";
import { resolveApprovalReviewIdentity } from "../approval/approval-review-identity";
import { confirmApprovalSelfReview } from "../approval/approval-self-review";
import { activeApprovalNodeIndexes, isParallelApprovalRound } from "../approval/parallel-approval-protocol";
import { loadEffectiveProjectApprovalAssignments, type ProjectApprovalAssignment } from "../approval/project-approval-assignments";
import { fundBalanceWitnessBinding, signFundBalanceWitness } from "../fund-account/fund-balance-witness-signing";
import { contractWorkCompletionWitnessKey } from "./contract-work-completion.service";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";
import { resolveGovernedFinalArchiveAccess } from "./contract-final-archive-access";
import type { ReviewContractWorkCompletionDto } from "./dto/contract-work-completion.dto";

const businessType = "contract_work_completion";
const flowType = "contract.work_completion.approve";
const duties: { name: string; roleKeys: RoleKey[] }[] = [
  { name: "合同部主管", roleKeys: ["contract_director"] },
  { name: "项目经理", roleKeys: ["project_manager"] },
  { name: "财务", roleKeys: ["finance_staff", "finance_director"] }
];
const subjectConflictMessages = [
  "合同生效时项目施工企业关系不唯一，请核对历史资料",
  "合同生效时缺少项目施工企业关系，请核对历史资料",
  "原合同施工企业签约快照不匹配，请核对归属",
  "原合同施工企业在履约确认日期已变更，请先核对归属"
] as const;
const allRoles = duties.flatMap(duty => duty.roleKeys);
type Result = { id: string; approvalInstanceId: string; status: string };
type Snapshot = {
  completion: { id: string; status: string; createdByUserId: string; approvalInstanceId: string | null };
  projectId: string;
  round: Pick<Prisma.ApprovalInstanceGetPayload<object>, "id" | "status" | "businessType" | "businessId" |
    "flowType" | "applicantUserId" | "frozenNodes"> | null;
};

@Injectable()
export class ContractWorkCompletionApprovalService {
  constructor(private readonly prisma: PrismaService, private readonly auth: AuthService,
    private readonly ledger: OperatingLedgerService,
    @Optional() private readonly notifications?: ContractWorkCompletionNotificationService) {}

  view(versionId: string, actorId: string) {
    return this.inTransaction(async tx => {
      const key = contractWorkCompletionWitnessKey();
      const binding = await fundBalanceWitnessBinding(tx);
      const proof = signFundBalanceWitness(key, ["contract_work_completion_view_v1", binding.database,
        binding.role, binding.xid, binding.backend, binding.expires, versionId, actorId]);
      const [row] = await tx.$queryRaw<{ result: {
        projectId: string; entries: { id: string; status: string; work: string; amountYuan: string;
          exceedsContractAmount: boolean; createdByUserId: string; approvalInstanceId: string | null;
          applicantUserId: string | null; frozenNodes: unknown; rejectionReason?: string | null }[];
      } | null }[]>`SELECT public.jg_contract_work_completion_view_v1(
        ${versionId}::text,${actorId}::text,${binding.expires}::text,${proof}::text) AS result`;
      if (!row.result) return { canRegister: false, entries: [] };
      const { projectId, entries } = row.result;
      const access = await resolveGovernedFinalArchiveAccess(tx, { actorUserId: actorId, projectId, handlerUserId: actorId });
      const own = (await loadEffectiveProjectApprovalAssignments(tx, projectId, allRoles, actorId, false))
        .map(row => row.roleKey as RoleKey);
      const delegated = await Promise.all((await activeApprovalDelegatorIds(tx, actorId, new Date())).map(async userId => ({
        userId, roleKeys: (await loadEffectiveProjectApprovalAssignments(tx, projectId, allRoles, userId, false))
          .map(row => row.roleKey as RoleKey)
      })));
      return { canRegister: access.canUpload, entries: entries.flatMap(entry => {
        const creator = entry.createdByUserId === actorId;
        const frozenNodes = entry.frozenNodes;
        const identities = entry.status === "in_approval" && isParallelApprovalRound(frozenNodes)
          && this.isOriginalDutySet(frozenNodes) ? activeApprovalNodeIndexes(frozenNodes, 0).flatMap(index => {
            const { mode, roleKeys, approvedRoleKeys, candidateUserIdsByRole } = frozenNodes[index];
            const identity = resolveApprovalReviewIdentity({
              node: { mode, roleKeys, approvedRoleKeys, candidateUserIdsByRole },
              actorUserId: actorId, actorRoleKeys: own, activeDelegators: delegated
            });
            return identity ? [{ index, name: duties[index].name, selfReview:
              entry.applicantUserId === actorId, canReview: true }] : [];
          }) : [];
        if (entry.status === "draft" ? !creator || !access.canUpload : !creator && !own.length && !identities.length) return [];
        return [{ id: entry.id, work: entry.work, amountYuan: entry.amountYuan, status: entry.status,
          approvalInstanceId: entry.approvalInstanceId, exceedsContractAmount: entry.exceedsContractAmount,
          canSubmit: creator && access.canUpload && entry.status === "draft",
          canRevise: creator && access.canUpload && entry.status === "draft",
          rejectionReason: entry.rejectionReason ?? null, duties: identities }];
      }) };
    });
  }

  submit(versionId: string, completionId: string, actorId: string) {
    return this.inTransaction(async tx => {
      const { completion, projectId, round } = await this.call<Snapshot>(tx, "lock", versionId, completionId, actorId, null);
      const access = await resolveGovernedFinalArchiveAccess(tx, { actorUserId: actorId, projectId, handlerUserId: completion.createdByUserId });
      if (!access.canUpload) throw new ForbiddenException("只有当前经办人可以提交本次履约登记");
      if (completion.status === "in_approval" && round?.applicantUserId === actorId) {
        return { id: completion.id, approvalInstanceId: round.id, status: completion.status };
      }
      if (completion.status !== "draft") throw new ConflictException("该履约登记已确认");
      const assignments = await loadEffectiveProjectApprovalAssignments(tx, projectId, allRoles, undefined, false);
      const nodes = duties.map(({ name, roleKeys }) => {
        const byRole = Object.fromEntries(roleKeys.map(role => [
          role, [...new Set(assignments.filter(assignment => assignment.roleKey === role).map(assignment => assignment.userId))].sort()
        ]));
        if (!Object.values(byRole).some(users => users.length)) throw new ConflictException(`缺少${name}，请配置后再提交履约登记`);
        return { name, protocolVersion: 1, executionMode: "parallel", mode: "any",
          roleKeys, approvedRoleKeys: [] as string[], candidateUserIdsByRole: byRole };
      });
      const result = await this.call<Result>(tx, "submit", versionId, completionId, actorId, { nodes });
      // 与业务同事务写入待办短信 outbox；提交失败或回滚时不会留下通知。
      await this.notifications?.queueDuty(tx, completionId, result.approvalInstanceId);
      return result;
    });
  }

  review(versionId: string, completionId: string, actorId: string, input: ReviewContractWorkCompletionDto) {
    return this.inTransaction(async tx => {
      const { completion, projectId, round } = await this.call<Snapshot>(tx, "lock", versionId, completionId, actorId, null);
      if (completion.status !== "in_approval" || completion.approvalInstanceId !== input.approvalInstanceId) {
        throw new ConflictException("原履约确认轮次已变化，请刷新后重试");
      }
      if (!round || round.status !== "in_progress" || round.businessType !== businessType || round.businessId !== completion.id ||
        round.flowType !== flowType || !isParallelApprovalRound(round.frozenNodes) ||
        !this.isOriginalDutySet(round.frozenNodes) || !activeApprovalNodeIndexes(round.frozenNodes, 0).includes(input.dutyIndex)) {
        throw new ConflictException("该履约职责已处理或审批轮次已变化");
      }
      const node = round.frozenNodes[input.dutyIndex];
      const matchingRoles = duties[input.dutyIndex].roleKeys;
      const currentRoles = (assignments: ProjectApprovalAssignment[]) => assignments.map(row => row.roleKey as RoleKey);
      const ownRoles = currentRoles(await loadEffectiveProjectApprovalAssignments(tx, projectId, matchingRoles, actorId, false));
      const now = new Date();
      const delegators = await activeApprovalDelegatorIds(tx, actorId, now);
      const delegatedRoles = await Promise.all(delegators.map(async userId => ({
        userId, roleKeys: currentRoles(await loadEffectiveProjectApprovalAssignments(tx, projectId, matchingRoles, userId, false))
      })));
      const identity = resolveApprovalReviewIdentity({
        node: { mode: node.mode, roleKeys: node.roleKeys, approvedRoleKeys: node.approvedRoleKeys,
          candidateUserIdsByRole: node.candidateUserIdsByRole },
        actorUserId: actorId, actorRoleKeys: ownRoles, activeDelegators: delegatedRoles
      });
      if (!identity) throw new ForbiddenException("当前账号无权处理该履约职责");
      const comment = input.comment?.trim() || null;
      if (input.decision === "reject" && !comment) throw new BadRequestException("驳回履约登记时请填写原因");
      const selfReview = await confirmApprovalSelfReview({ applicantUserId: round.applicantUserId, actorUserId: actorId,
        actorRoleKeys: ownRoles, ...identity, selfReviewReason: input.selfReviewReason,
        confirmationPassword: input.confirmationPassword, confirmPassword: password => this.auth.confirmPassword(actorId, password, tx) });
      const nodes = round.frozenNodes.map((entry, index) => input.decision === "approve" && index === input.dutyIndex
        ? { ...entry, approvedRoleKeys: [identity.approvedRoleKey] } : entry);
      const pending = activeApprovalNodeIndexes(nodes, 0);
      const result = await this.call<Result>(tx, "review", versionId, completionId, actorId, {
        roundId: round.id, decision: input.decision, dutyIndex: input.dutyIndex, ...identity, comment,
        nodes, nextIndex: pending[0] ?? duties.length, metadata: selfReview.metadata
      });
      if (result.status === "draft") {
        await this.notifications?.queueCorrection(tx, completionId, round.id);
      }
      if (result.status === "confirmed") {
        const adapter = new ContractWorkCompletionOperatingSourceAdapter();
        const source = await adapter.readCompletionSnapshot(tx, projectId, completionId);
        if (!source) throw new ConflictException("履约成本缺少原合同主体快照");
        await this.ledger.appendConfirmedSourceInTransaction(tx, adapter.toOperatingFactInput(source).input, actorId);
        // Prisma 5.22 can resolve an interactive transaction whose deferred COMMIT check rolled back.
        await tx.$executeRaw`SET CONSTRAINTS "ContractWorkCompletionFact_cost_posting" IMMEDIATE`;
      }
      return result;
    });
  }

  private async call<T>(tx: Prisma.TransactionClient, operation: "lock" | "submit" | "review",
    versionId: string, completionId: string, actorId: string, command: object | null): Promise<T> {
    const payload = command === null ? null : JSON.stringify(command);
    const key = contractWorkCompletionWitnessKey();
    const binding = await fundBalanceWitnessBinding(tx);
    const proof = signFundBalanceWitness(key, ["contract_work_completion_approval_v1", binding.database, binding.role,
      binding.xid, binding.backend, binding.expires, operation, versionId, completionId, actorId, payload]);
    const [row] = await tx.$queryRaw<{ result: T }[]>`
      SELECT public.jg_contract_work_completion_approval_v1(
        ${operation}::text, ${versionId}::text, ${completionId}::text, ${actorId}::text,
        ${payload}::text, ${binding.expires}::text, ${proof}::text
      ) AS result`;
    return row.result;
  }

  private async inTransaction<T>(run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(run, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError)) throw error;
        const sqlState = error.meta?.code;
        const serializationConflict = error.code === "P2034" ||
          (error.code === "P2010" && (sqlState === "40001" || sqlState === "40P01"));
        if (serializationConflict) continue;
        if (error.code !== "P2010") throw error;
        switch (sqlState) {
          case "42501": throw new ForbiddenException("当前账号无权处理该履约登记");
          case "P0002": throw new NotFoundException("未找到履约登记");
          case "23514": {
            const detail = error.meta?.message;
            const subjectError = typeof detail === "string"
              ? subjectConflictMessages.find(message => detail.includes(message))
              : undefined;
            throw new ConflictException(subjectError ?? "项目、合同版本或履约确认状态已变化");
          }
          default: throw error;
        }
      }
    }
    throw new ConflictException("履约确认状态已变化，请按原请求重试");
  }

  private isOriginalDutySet(nodes: readonly Record<string, unknown>[]): boolean {
    return nodes.length === duties.length && nodes.every((node, index) =>
      node.mode === "any" && JSON.stringify(node.roleKeys) === JSON.stringify(duties[index].roleKeys));
  }
}
