import { isLegacySettlementApproval } from "../settlement/legacy-settlement-approval";
import { isRetiredProjectEmployeeLoan } from "../project-expense/project-employee-loan-retirement";
import { currentSpotPaymentDuty, spotPaymentDutyAssignments, spotPaymentDutySelect } from "../spot-procurement/spot-payment-execution-duty";
import { workItemNoticeKey, workItemNoticeSnapshot } from "./work-item-notice-snapshot";
import {
  groupWorkItems,
  workItemActionGroup,
  type WorkItemActionGroupKey
} from "./work-item-action-group";
import { approvalDutyTarget } from "../approval/approval-duty-sms-intent";
import { SpotProcurementPilotService } from "../spot-procurement/spot-procurement-pilot.service";
import { IndependentApprovalProgressService } from "../approval/independent-approval-progress.service";
import { isPureExpenseReimbursement, projectIncidentalExpenseWhere, pureExpenseReimbursementWhere, resolveExpenseParallelDutyIdentity, supportsExpenseParallelApproval } from "../expense-claim/expense-claim-parallel-approval";
import { expenseClaimFundingDuty, expenseFundingFacets } from "../expense-claim/expense-claim-funding-duty";
import { workItemNoticeAt } from "./work-item-notice-order";
import { contractParallelDutyIdentity, contractRoundSubmissionSnapshot, hasActiveContractGlobalRole } from "../contract/contract-parallel-duty-access";
import { resolveContractOriginators } from "../contract/contract-originators";
import { resolveGovernedFinalArchiveAccess } from "../contract/contract-final-archive-access";
import { readContractV2LifecycleContext } from "../contract/contract-v2-lifecycle-context";
import { RegisteredPaymentExecutionService } from "../payment/registered-payment-execution.service";
import { spotPurchaseWorkItems } from "../spot-procurement/spot-purchase-work-items";
import { fundReviewWorkItems, fundTransferWorkItems } from "../fund-account/fund-account-work-items";
import { principalReturnWorkItems } from "./principal-return-work-items";
import { generalRequestWorkItems } from "../general-procurement/general-procurement-request-work-items";
import { generalRequestActor } from "../general-procurement/general-procurement-request-access";
import {scopedSpotDutyNodeIndexes, SPOT_APPROVAL_DUTY_RESOURCE} from "../approval/spot-approval-duty-access";
import { activeApprovalNodeIndexes, hasVersionedApprovalNodes, isApprovalDutyComplete, isParallelApprovalRound } from "../approval/parallel-approval-protocol";
import {companyTransferWorkItems} from "../company-transfer/company-transfer-workitems";
import {contractHandlingWorkItems} from "../contract-ledger/contract-handling-workitems";
import { addContractRelationshipSummaries } from "../contract-ledger/contract-relationship-summary";
import { generalProcurementActor } from "../general-procurement/general-procurement-access";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, Optional } from "@nestjs/common";
import { Prisma, type ContractVersion } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import {
  canPerform,
  isApprovalOverdue,
  resolveEffectiveRoleKeys,
  type BusinessAction,
  type RoleKey
} from "@jiangkong/shared-domain";
import { activeApprovalDelegatorIds } from "../approval/active-approval-delegations";
import {
  frozenCandidateUserIds,
  isGovernedFrozenApprovalNode,
  resolveApprovalReviewIdentity,
  type ApprovalActorRoleScopes,
  type FrozenApprovalNode
} from "../approval/approval-review-identity";
import { requiresApprovalSelfReviewConfirmation } from "../approval/approval-self-review";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";
import { dbMoneyToBigInt, formatMoneyCentsAsYuan } from "../money/decimal-money";
import {
  CONTRACT_TAKEOVER_HANDOVER_DUTIES,
  parseTakeoverHandoverSnapshot,
  type ContractTakeoverHandoverDuty
} from "../contract-takeover/contract-takeover-handover";

export interface UploadSignatureInput {
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  buffer: Buffer;
}

interface CanvasSignatureHandoffOptions {
  handoffToken?: string;
}

export type WorkbenchCardTone = "default" | "primary" | "warning" | "danger" | "success";

export interface WorkbenchCard {
  id:
    | "contract_takeover_todo"
    | "contract_takeover_review"
    | "contract_takeover_continuation"
    | "approval_todo"
    | "approved_pending_payment"
    | "historical_balance_missing"
    | "payment_blocked";
  title: string;
  count: number;
  description: string;
  targetPath: string;
  actionText: string;
  tone: WorkbenchCardTone;
}

export interface WorkbenchSummary {
  generatedAt: string;
  visibleProjectCount: number;
  cards: WorkbenchCard[];
}

export type WorkItemQueueKey = "pending" | "blocked" | "started" | "drafts";

function isNonInsideContractSubject(signingSubjectType: string) {
  return signingSubjectType === "affiliate" || signingSubjectType === "upward";
}

/** 审批中心四视图：委托并入待审批、逾期为筛选；我参与的与我可查看由审批进度接口提供。 */
export type ApprovalCenterViewKey =
  | "pendingApproval"
  | "startedByMe"
  | "handledByMe";
export type WorkItemKind =
  | "draft"
  | "contract_takeover"
  | "archive"
  | "approval"
  | "payment_execution"
  | "procurement"
  | "blocker";

const workItemExpenseDutyIndexes = Symbol("expenseDutyIndexes");

export interface WorkItem {
  contractRelationshipLabel?: string; signingParty?: string; accountingEffect?: string;
  id: string;
  reminderId?: string;
  noticeKey?: string;
  [workItemNoticeAt]?: Date;
  [workItemExpenseDutyIndexes]?: number[];
  type: WorkItemKind;
  title: string;
  projectName: string;
  projectId?: string;
  businessCode: string;
  businessType?: string;
  businessId?: string;
  amountText: string;
  currentNode: string;
  stayedText: string;
  nextAction: string;
  targetPath: string;
  tone: WorkbenchCardTone;
  ageDays?: number;
  agingStatus?: "current" | "long_running" | "stale";
  applicantName?: string;
  businessStatus?: string;
  /** 超过统一审批 SLA（48小时）未动作，仅用于审批中心筛选。 */
  overdue?: boolean;
  /** 当前账号此刻是否持有有效职责可办理；查看权不等于办理权。 */
  canHandle?: boolean;
  /** 并联轮完成职责数/必需职责数，用于摘要。 */
  parallelCompletion?: { completed: number; total: number };
  /** 首页动作分组（待审批/待复核/待采购/待付款/待补资料/其他），由投影层集中计算。 */
  actionGroup?: WorkItemActionGroupKey;
}

export interface WorkItemActionGroupView {
  key: Exclude<WorkItemActionGroupKey, "other">;
  title: string;
  description: string;
  count: number;
  targetPath: string;
  items: WorkItem[];
}

export interface FundsPendingReadBudget {
  remaining(): number;
  consume(rowCount: number): void;
}

export interface FundsPendingBusinessIds {
  contractPaymentIds: string[];
  spotPaymentIds: string[];
}

interface FundsDelegatorRoleIndex {
  globalKeysByUserId: Map<string, RoleKey[]>;
  localKeysByUserProject: Map<string, RoleKey[]>;
  globalUserIdsByRole: Map<RoleKey, Set<string>>;
  localUserIdsByProjectRole: Map<string, Set<string>>;
}

function emptyFundsDelegatorRoleIndex(): FundsDelegatorRoleIndex {
  return {
    globalKeysByUserId: new Map(),
    localKeysByUserProject: new Map(),
    globalUserIdsByRole: new Map(),
    localUserIdsByProjectRole: new Map()
  };
}

function appendMapValue<K>(map: Map<K, Set<string>>, key: K, value: string): void {
  const values = map.get(key) ?? new Set<string>();
  values.add(value);
  map.set(key, values);
}

function fundsDelegatorCandidates(
  node: ApprovalNode,
  projectId: string,
  activeDelegatorIds: ReadonlySet<string>,
  roleIndex: FundsDelegatorRoleIndex
): string[] {
  const governed = isGovernedFrozenApprovalNode(node as unknown);
  if (governed) {
    return frozenCandidateUserIds(node).filter((userId) => activeDelegatorIds.has(userId));
  }
  const approvedRoleKeys = new Set(
    Array.isArray(node.approvedRoleKeys)
      ? node.approvedRoleKeys.filter((value: unknown): value is string => typeof value === "string")
      : []
  );
  const pendingRoleKeys = Array.isArray(node.roleKeys)
    ? node.roleKeys
        .filter((value: unknown): value is string => typeof value === "string")
        .filter((role: string) => !approvedRoleKeys.has(role)) as RoleKey[]
    : [];
  const candidates = new Set<string>();
  for (const role of pendingRoleKeys) {
    const globalCandidate = roleIndex.globalUserIdsByRole.get(role)?.values().next().value;
    const localCandidate = roleIndex.localUserIdsByProjectRole.get(
      `${projectId}\u0000${role}`
    )?.values().next().value;
    if (globalCandidate) candidates.add(globalCandidate);
    if (localCandidate) candidates.add(localCandidate);
  }
  return [...candidates];
}

export interface WorkItemsReadModel {
  noticePage?: { offset: number; size: number };
  noticeIndexVersion?: string;
  recentNotices?: WorkItem[];
  generatedAt: string;
  visibleProjectCount: number;
  queues: Record<WorkItemQueueKey, WorkItem[]>;
  queueMeta: Record<WorkItemQueueKey, {
    total: number;
    returned: number;
    truncated: boolean;
  }>;
  approvalCenter: Record<ApprovalCenterViewKey, WorkItem[]>;
  /** 首页动作分组；缺失时客户端降级到四队列（旧接口桩兼容）。 */
  groups?: WorkItemActionGroupView[];
}

interface ProjectRoleScope {
  projectId: string;
  roleKeys: RoleKey[];
}

interface ApprovalNode extends FrozenApprovalNode {
  name?: unknown;
  roleKeys?: unknown;
  approvedRoleKeys?: unknown;
  assignments?: unknown;
}

interface ApprovalAssignment {
  toUserId?: unknown;
  fromRoleKey?: unknown;
}

const LEGACY_APPROVAL_TYPES = [
  "contract_version",
  "contract_work_completion",
  "settlement",
  "payment_request",
  "project_expense_request",
  "general_procurement",
  "expense_claim"
] as const;
const SPOT_APPROVAL_TYPES = ["spot_procurement_version", "spot_procurement_payment"] as const;
const RELEVANT_APPROVAL_TYPES = [...LEGACY_APPROVAL_TYPES, ...SPOT_APPROVAL_TYPES] as const;

const activeTakeoverStatuses = ["draft", "pending_review", "confirmed", "needs_supplement"];

type ApprovalInstanceForWorkItem = {
  id: string;
  businessType: string;
  businessId: string;
  flowType: string;
  status: string;
  currentNodeIndex: number;
  frozenNodes: unknown;
  applicantUserId: string;
  createdAt: Date;
  updatedAt: Date;
};

interface ApprovalBusinessDetail {
  historicalEmployeeLoan?: boolean;
  requestProtocolVersion?: number;
  contractApprovalVersion?: Pick<ContractVersion, "status" | "documentContentRevision" | "documentContentFingerprint">;
  expenseApproval?: {
    status: string;
    approvalInstanceId: string | null;
    countKey: "reimbursement" | "incidentalExpense" | "procurementPayment";
  };
  projectId: string | null;
  projectName: string;
  businessCode: string;
  title: string;
  amountCents: bigint | null;
  targetPath: string;
}

function queueMeta(items: WorkItem[]) {
  return {
    total: items.length,
    returned: Math.min(items.length, 30),
    truncated: items.length > 30
  };
}

function supportsDraftAggregation(prisma: PrismaService) {
  const delegates = prisma as unknown as Record<string, unknown>;
  return [
    "settlementDraft",
    "spotProcurement",
    "spotProcurementPayment",
    "contractBusinessTemplate",
    "contractBusinessTemplateVersion",
    "contractLayoutTemplate",
    "contractLayoutTemplateVersion",
    "standardClause",
    "standardClauseVersion",
    "settlementTemplate",
    "settlementTemplateVersion"
  ].every((name) => Boolean(delegates[name]));
}

function supportsSpotPaymentExecutionAggregation(prisma: PrismaService) {
  const delegates = prisma as unknown as Record<string, unknown>;
  return Boolean(delegates.spotProcurementPayment);
}

@Injectable()
export class MeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FileService,
    private readonly audit: AuditService = new AuditService(),
    @Optional() private readonly independentApprovals?: IndependentApprovalProgressService,
    @Optional() private readonly spotPilot?: SpotProcurementPilotService
  ) {}

  getCanvasSignatureCapabilities(userId: string) {
    void userId;
    return {
      availableActions: [
        "upload_canvas_signature",
        "create_canvas_signature_handoff"
      ] as const
    };
  }

  // 历史上传图入口：仅保留给已存在的签名资料预览，不会创建未来审批可用的手写签名版本。
  async setSignature(userId: string, input: UploadSignatureInput) {
    if (!input.mimeType.startsWith("image/")) {
      throw new Error("个人签名图片只能上传 PNG 或 JPEG 格式");
    }
    // 仅接受 PNG/JPEG 魔数，挡掉伪装 mime 的非图片字节（避免渲染时解码异常）。
    const b = input.buffer;
    const isPng = b.length > 3 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
    const isJpeg = b.length > 2 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    if (!isPng && !isJpeg) {
      throw new Error("个人签名图片只能上传 PNG 或 JPEG 格式");
    }

    const file = await this.files.uploadPrivateFile({
      originalName: input.originalName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      uploadedByUserId: userId,
      buffer: input.buffer
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { signatureFileId: file.id }
    });

    return { signatureFileId: file.id };
  }

  // Canvas 输出必须是透明 PNG；每次签名都保存不可变版本，旧版本仍由文件绑定保护。
  async setCanvasSignature(
    userId: string,
    input: UploadSignatureInput,
    options: CanvasSignatureHandoffOptions = {}
  ) {
    const isPng = input.mimeType === "image/png"
      && input.buffer.length > 3
      && input.buffer[0] === 0x89
      && input.buffer[1] === 0x50
      && input.buffer[2] === 0x4e
      && input.buffer[3] === 0x47;
    if (!isPng) {
      throw new BadRequestException("签名图片无法识别，请保留当前笔迹并重试保存。");
    }

    const file = await this.files.uploadPrivateFile({
      originalName: "手写签名.png",
      mimeType: "image/png",
      sizeBytes: input.sizeBytes,
      uploadedByUserId: userId,
      buffer: input.buffer
    });
    const contentSha256 = createHash("sha256").update(input.buffer).digest("hex");
    const signatureVersion = await this.prisma.$transaction(async (tx) => {
      const handoff = options.handoffToken
        ? await this.lockCanvasSignatureHandoff(tx, userId, options.handoffToken)
        : null;
      const storedFile = await tx.fileObject.findUnique({
        where: { id: file.id },
        select: { contentSha256: true, storageStatus: true }
      });
      if (storedFile?.storageStatus !== "active" || storedFile.contentSha256 !== contentSha256) {
        throw new Error("手写签名文件校验失败，请重新签名后重试");
      }
      const version = await tx.handwrittenSignatureVersion.create({
        data: { userId, fileId: file.id, contentSha256, source: "canvas" }
      });
      // 继续维护旧字段，保证既有个人设置预览和历史回退入口可读；审批快照不再读取它。
      await tx.user.update({ where: { id: userId }, data: { signatureFileId: file.id } });
      if (handoff) {
        await tx.handwrittenSignatureHandoff.update({
          where: { id: handoff.id },
          data: { completedAt: new Date(), signatureVersionId: version.id }
        });
      }
      await this.audit.record(tx, {
        actorUserId: userId,
        action: "me.signature.canvas.update",
        businessType: "handwritten_signature_version",
        businessId: version.id,
        metadata: handoff
          ? { fileId: file.id, source: "handoff", handoffId: handoff.id }
          : { fileId: file.id, source: "direct" }
      });
      return version;
    });
    return { signatureFileId: file.id, signatureVersionId: signatureVersion.id };
  }

  async createCanvasSignatureHandoff(userId: string) {
    const token = randomBytes(32).toString("base64url");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5 * 60 * 1000);
    await this.prisma.$transaction(async (tx) => {
      await tx.handwrittenSignatureHandoff.updateMany({
        where: { ownerUserId: userId, completedAt: null, invalidatedAt: null, expiresAt: { gt: now } },
        data: { invalidatedAt: now }
      });
      await tx.handwrittenSignatureHandoff.create({
        data: { ownerUserId: userId, tokenHash: this.hashCanvasSignatureHandoff(token), expiresAt }
      });
    });
    return { token, expiresAt: expiresAt.toISOString() };
  }

  async getCanvasSignatureHandoff(userId: string, token: string) {
    const handoff = await this.prisma.handwrittenSignatureHandoff.findUnique({
      where: { tokenHash: this.hashCanvasSignatureHandoff(token) },
      select: { ownerUserId: true, expiresAt: true, invalidatedAt: true, completedAt: true, signatureVersionId: true }
    });
    this.assertCanvasSignatureHandoff(handoff, userId, { allowCompleted: true });
    return {
      expiresAt: handoff!.expiresAt.toISOString(),
      completedAt: handoff!.completedAt?.toISOString() ?? null,
      signatureVersionId: handoff!.signatureVersionId,
      availableActions: handoff!.completedAt ? [] : ["complete_canvas_signature_handoff"]
    };
  }

  async getSignatureTicket(userId: string) {
    const [activeVersion, user] = await Promise.all([
      this.prisma.handwrittenSignatureVersion.findFirst({
        where: { userId, source: "canvas" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { fileId: true }
      }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { signatureFileId: true } })
    ]);
    const fileId = activeVersion?.fileId ?? user?.signatureFileId;
    if (!fileId) {
      return null;
    }

    const ticket = await this.files.createDownloadTicket(fileId, {
      actorUserId: userId,
      downloadReason: "个人签名预览"
    });
    return { ...ticket, signatureSource: activeVersion ? "canvas" as const : "legacy" as const };
  }

  private hashCanvasSignatureHandoff(token: string) {
    return createHash("sha256").update(token).digest("hex");
  }

  private async lockCanvasSignatureHandoff(
    tx: Prisma.TransactionClient,
    userId: string,
    token: string
  ) {
    const [handoff] = await tx.$queryRaw<Array<{
      id: string;
      ownerUserId: string;
      expiresAt: Date;
      invalidatedAt: Date | null;
      completedAt: Date | null;
    }>>(Prisma.sql`
      SELECT "id", "ownerUserId", "expiresAt", "invalidatedAt", "completedAt"
      FROM "HandwrittenSignatureHandoff"
      WHERE "tokenHash" = ${this.hashCanvasSignatureHandoff(token)}
      FOR UPDATE
    `);
    this.assertCanvasSignatureHandoff(handoff, userId);
    return handoff!;
  }

  private assertCanvasSignatureHandoff(
    handoff: { ownerUserId: string; expiresAt: Date; invalidatedAt: Date | null; completedAt: Date | null } | null | undefined,
    userId: string,
    options: { allowCompleted?: boolean } = {}
  ) {
    if (!handoff) throw new BadRequestException("签名二维码无效或已失效，请在电脑端重新生成");
    if (handoff.ownerUserId !== userId) throw new ForbiddenException("请使用电脑端同一账号完成手写签名");
    if (handoff.invalidatedAt || handoff.expiresAt.getTime() <= Date.now() || (handoff.completedAt && !options.allowCompleted)) {
      throw new BadRequestException("签名二维码已过期或已使用，请在电脑端重新生成");
    }
  }

  async getWorkbenchSummary(userId: string): Promise<WorkbenchSummary> {
    const scopes = await this.loadProjectRoleScopes(userId);
    const cards: WorkbenchCard[] = [];

    const takeoverProjects = this.projectIdsFor(scopes, ["contract.create", "contract.submit"]);
    if (takeoverProjects.length) {
      cards.push({
        id: "contract_takeover_todo",
        title: "待接管合同",
        count: await this.countTakeovers(takeoverProjects, {
          takeoverStatus: { in: ["draft", "needs_supplement"] }
        }),
        description: "历史合同草稿或待补充资料，需要补录后提交复核。",
        targetPath: "/历史合同接管",
        actionText: "去接管",
        tone: "primary"
      });
    }

    const takeoverConfirmProjects = this.projectIdsFor(scopes, ["contract.archive.confirm"]);
    if (takeoverConfirmProjects.length) {
      cards.push({
        id: "contract_takeover_review",
        title: "待复核/确认接管",
        count: await this.countTakeovers(takeoverConfirmProjects, {
          takeoverStatus: "pending_review"
        }),
        description: "历史合同已提交复核，等待合同部主管确认接管。",
        targetPath: "/历史合同接管",
        actionText: "去确认",
        tone: "warning"
      });
    }

    const handoverContinuation = await this.contractTakeoverHandoverWorkItems(
      userId,
      scopes,
      new Map()
    );
    if (handoverContinuation.length) {
      cards.push({
        id: "contract_takeover_continuation",
        title: "接管后继续办理",
        count: handoverContinuation.length,
        description: "接管分工已登记，按合同、财务职责继续办理新结算和付款。",
        targetPath: "/结算工作台",
        actionText: "去办理",
        tone: "primary"
      });
    }

    const approvalProjects = this.projectIdsFor(scopes, [
      "contract.approve",
      "payment.approve",
      "project_expense.approve",
      "spot_procurement.approve",
      "spot_procurement.payment.approve"
    ]);
    const scopedSpotMandate = typeof this.prisma.approvalDelegation?.findFirst === "function" ? await this.prisma.approvalDelegation.findFirst({where: {
      toUserId: userId, enabled: true, actionKey: "spot_procurement.approve", resourceType: SPOT_APPROVAL_DUTY_RESOURCE,
      startsAt: {lte: new Date()}, endsAt: {gt: new Date()}
    }, select: {id: true}}) : null;
    const fundReviewTodos = await fundReviewWorkItems(this.prisma, userId);
    const hasOtherApprovalScope = Boolean(approvalProjects.length || scopedSpotMandate || fundReviewTodos.length);
    const canApproveCompanyExpense = !hasOtherApprovalScope && await this.hasCompanyExpenseApprovalRole(userId);
    const approvalCounts = hasOtherApprovalScope || canApproveCompanyExpense
      ? await this.countApprovalTodos(scopes, userId, !hasOtherApprovalScope) : null;
    if (approvalCounts && (hasOtherApprovalScope || approvalCounts.total)) {
      approvalCounts.total += fundReviewTodos.length;
      cards.push({
        id: "approval_todo",
        title: "待审批",
        count: approvalCounts.total,
        description: `${fundReviewTodos.length ? `余额核对 ${fundReviewTodos.length} · ` : ""}${approvalCounts.procurement || approvalCounts.procurementPayment ? `综合采购 ${approvalCounts.procurement} · 采购付款 ${approvalCounts.procurementPayment} · ` : ""}${approvalCounts.reimbursement ? `报销 ${approvalCounts.reimbursement} · ` : ""}${approvalCounts.incidentalExpense ? `零星费用 ${approvalCounts.incidentalExpense} · ` : ""}合同 ${approvalCounts.contract} · 结算 ${approvalCounts.settlement} · 付款 ${approvalCounts.payment} · 支出 ${approvalCounts.expense}${
          approvalCounts.spotProcurement || approvalCounts.spotPayment
            ? ` · 零星采购 ${approvalCounts.spotProcurement} · 零星付款 ${approvalCounts.spotPayment}`
            : ""
        }`,
        targetPath: fundReviewTodos.length ? "/审批中心" : this.approvalTargetPath(approvalCounts),
        actionText: "去处理",
        tone: "primary"
      });
    }

    const paymentExecution = await new RegisteredPaymentExecutionService(this.prisma).visibleWorkItems(userId);
    if (paymentExecution) {
      cards.push({
        id: "approved_pending_payment",
        title: "已批待付款",
        count: paymentExecution.total,
        description: "财务人员和综合部主管共同办理，实际付款后登记，凭证可后补。",
        targetPath: "/付款管理",
        actionText: "登记实付",
        tone: "warning"
      });
    }

    const balanceProjects = this.projectIdsFor(scopes, [
      "contract.create",
      "contract.archive.confirm"
    ]);
    if (balanceProjects.length) {
      cards.push({
        id: "historical_balance_missing",
        title: "历史余额未确认",
        count: await this.countTakeovers(balanceProjects, {
          takeoverStatus: { in: activeTakeoverStatuses },
          historicalBalanceConfirmedAt: null
        }),
        description: "历史已付、待付或占用余额未确认，付款容量还不能放心使用。",
        targetPath: "/历史合同接管",
        actionText: "补资料",
        tone: "danger"
      });
    }

    const paymentCreateProjects = this.projectIdsFor(scopes, ["payment.create"]);
    if (paymentCreateProjects.length) {
      cards.push({
        id: "payment_blocked",
        title: "付款阻断风险",
        count: await this.countTakeovers(paymentCreateProjects, {
          takeoverStatus: { in: activeTakeoverStatuses },
          OR: [{ takeoverStatus: { not: "confirmed" } }, { historicalBalanceConfirmedAt: null }]
        }),
        description: "历史接管或余额未确认的合同，发起付款会被后端拦截。",
        targetPath: "/付款管理",
        actionText: "看付款",
        tone: "danger"
      });
    }

    return {
      generatedAt: new Date().toISOString(),
      visibleProjectCount: scopes.length,
      cards
    };
  }

  async getWorkItems(userId: string): Promise<WorkItemsReadModel> {
    const evaluatedAt = new Date();
    const scopes = await this.loadProjectRoleScopes(userId);
    const projectIds = scopes.map((scope) => scope.projectId);
    const projectNameById = await this.projectNames(projectIds);

    const contractDraftProjectIds = this.projectIdsFor(scopes, [
      "contract.create",
      "contract.submit"
    ]);
    const contractLifecycleItems = await this.contractV2LifecycleWorkItems(userId, projectIds, projectNameById);
    const pending = await this.collectCurrentPending(userId, scopes, projectNameById, evaluatedAt, contractLifecycleItems.pending);

    const draftResult = await this.myDraftWorkItems(
      userId,
      contractDraftProjectIds,
      projectIds,
      projectNameById
    );

    const blocked = [
      ...(await this.contractTakeoverWorkItems(
        this.projectIdsFor(scopes, ["contract.create", "contract.archive.confirm", "payment.create"]),
        activeTakeoverStatuses.filter((status) => status !== "draft"),
        projectNameById,
        "历史余额未确认",
        "确认余额后付款容量才可信",
        "danger",
        {
          OR: [
            { takeoverStatus: { not: "confirmed" } },
            { historicalBalanceConfirmedAt: null }
          ]
        }
      )),
      ...contractLifecycleItems.blocked
    ];

    const started = await this.approvalWorkItems(scopes, userId, "started", evaluatedAt);
    const handledByMe = await this.handledApprovalWorkItems(scopes, userId);

    await addContractRelationshipSummaries(this.prisma,[...pending,...blocked,...started,...draftResult.items,...handledByMe]);
    for (const item of pending) item.actionGroup ??= workItemActionGroup(item);

    return {
      generatedAt: evaluatedAt.toISOString(),
      visibleProjectCount: scopes.length,
      queues: {
        pending: pending.slice(0, 30),
        blocked: blocked.slice(0, 30),
        started: started.slice(0, 30),
        drafts: draftResult.items
      },
      queueMeta: {
        pending: queueMeta(pending),
        blocked: queueMeta(blocked),
        started: queueMeta(started),
        drafts: {
          total: draftResult.total,
          returned: draftResult.items.length,
          truncated: draftResult.total > draftResult.items.length
        }
      },
      approvalCenter: {
        // 委托待办已在 pending 中按当前职责产生，不再单列视图；逾期由 overdue 筛选。
        pendingApproval: pending.filter((item) => item.type === "approval").slice(0, 30),
        startedByMe: started.slice(0, 30),
        handledByMe
      },
      // 分组计数取全量 pending（不受 30 条截断影响），摘要由投影层取前 3 条。
      groups: groupWorkItems(pending)
    };
  }

  async getWorkItemNotices(userId: string, requestedOffset: number): Promise<WorkItemsReadModel> {
    const pageSize = 30;
    const { evaluatedAt, scopes, pending, noticeItems } = await this.readAuthorizedNotices(userId);
    const offset = Math.min(requestedOffset, Math.floor(Math.max(0, pending.length - 1) / pageSize) * pageSize);
    const items = pending.slice(offset, offset + pageSize);
    const snapshot = workItemNoticeSnapshot(noticeItems);
    const recentNotices = [...noticeItems].sort((left, right) =>
      (right[workItemNoticeAt]?.getTime() ?? 0) - (left[workItemNoticeAt]?.getTime() ?? 0)).slice(0, 10)
      .map(item => ({ ...item, noticeKey: workItemNoticeKey(item) }));
    return {
      generatedAt: evaluatedAt.toISOString(),
      visibleProjectCount: scopes.length,
      noticePage: { offset, size: pageSize },
      noticeIndexVersion: snapshot.version,
      recentNotices,
      queues: { pending: items, blocked: [], started: [], drafts: [] },
      queueMeta: {
        pending: { total: pending.length, returned: items.length, truncated: items.length < pending.length },
        blocked: queueMeta([]), started: queueMeta([]), drafts: queueMeta([])
      },
      approvalCenter: { pendingApproval: pending.filter(item => item.type === "approval").slice(0, pageSize),
        startedByMe: [], handledByMe: [] }
    };
  }

  private async readAuthorizedNotices(userId: string) {
    const evaluatedAt = new Date();
    const scopes = await this.loadProjectRoleScopes(userId);
    const projectIds = scopes.map(scope => scope.projectId);
    const projectNameById = await this.projectNames(projectIds);
    const lifecycle = await this.contractV2LifecycleWorkItems(userId, projectIds, projectNameById);
    const pending = await this.collectCurrentPending(userId, scopes, projectNameById, evaluatedAt, lifecycle.pending);
    const independent = await this.attachIndependentApprovalReminders(userId, pending, evaluatedAt);
    await this.attachActiveApprovalReminders(userId, pending, evaluatedAt);
    return { evaluatedAt, scopes, pending, noticeItems: [...pending, ...independent] };
  }

  async getWorkItemNoticeKeys(userId: string, version: string, after?: string) {
    const snapshot = workItemNoticeSnapshot((await this.readAuthorizedNotices(userId)).noticeItems);
    if (snapshot.version !== version) return { version: snapshot.version, keys: [], nextCursor: null };
    const start = after === undefined ? 0 : snapshot.keys.findIndex(key => key > after);
    const keys = start < 0 ? [] : snapshot.keys.slice(start, start + 100);
    return { version, keys, nextCursor: start >= 0 && start + keys.length < snapshot.keys.length ? keys.at(-1) ?? null : null };
  }

  async getWorkItemNoticeDetails(userId: string, version: string, keys: string[]): Promise<{ version: string; items: WorkItem[] }> {
    const snapshot = workItemNoticeSnapshot((await this.readAuthorizedNotices(userId)).noticeItems);
    if (snapshot.version !== version) return { version: snapshot.version, items: [] };
    return { version, items: keys.flatMap(key => {
      const item = snapshot.entries.get(key);
      return item ? [{ ...item, noticeKey: key }] : [];
    }) };
  }

  private async collectCurrentPending(userId: string, scopes: ProjectRoleScope[], projectNameById: Map<string, string>,
    evaluatedAt: Date, contractLifecyclePending: WorkItem[]): Promise<WorkItem[]> {
    const projectIds = scopes.map(scope => scope.projectId);
    const contractDraftProjectIds = this.projectIdsFor(scopes, ["contract.create", "contract.submit"]);
    return [
      ...(await spotPurchaseWorkItems(this.prisma as Prisma.TransactionClient, userId, this.projectIdsFor(scopes, ["spot_procurement.create"]))),
      ...(await generalRequestWorkItems(this.prisma as Prisma.TransactionClient, new ProjectVisibilityService(this.prisma), userId, "procurement")),
      ...(await contractHandlingWorkItems(this.prisma as Prisma.TransactionClient,userId,scopes,projectNameById)),
      ...(await companyTransferWorkItems(this.prisma as Prisma.TransactionClient, userId, new ProjectVisibilityService(this.prisma))),
      ...(await fundTransferWorkItems(this.prisma, userId)),
      ...(await this.contractTakeoverWorkItems(
        contractDraftProjectIds,
        ["needs_supplement"],
        projectNameById,
        "补录历史合同",
        "补齐资料后提交复核",
        "primary"
      )),
      ...(await this.contractTakeoverWorkItems(
        this.projectIdsFor(scopes, ["contract.takeover.payment_evidence.upload"]),
        ["needs_supplement"],
        projectNameById,
        "补充历史付款凭证",
        "上传后请通知合同岗核对并重新提交复核",
        "primary",
        {},
        {
          idPrefix: "takeover-payment-evidence",
          requiresMissingHistoricalPaymentVoucher: true
        }
      )),
      ...(await this.contractTakeoverWorkItems(
        this.projectIdsFor(scopes, ["contract.takeover.finance_facts.edit"]),
        ["pending_finance"],
        projectNameById,
        "核对历史收付",
        "合同部已提交，请核对历史实际收付，完成财务核对后交合同主管复核",
        "primary"
      )),
      ...(await this.contractTakeoverWorkItems(
        this.projectIdsFor(scopes, ["contract.archive.confirm"]),
        ["pending_review"],
        projectNameById,
        "复核历史合同接管",
        "财务已核对金额，请复核后作为系统事实起点",
        "warning"
      )),
      ...(await this.contractTakeoverHandoverWorkItems(userId, scopes, projectNameById)),
      ...(await this.paymentExecutionWorkItems(
        userId,
        projectNameById
      )),
      ...(await this.expenseFundingWorkItems(scopes, projectNameById)),
      ...(await this.spotPaymentExecutionWorkItems(
        userId,
        this.projectIdsFor(scopes, ["spot_procurement.payment.execute"]),
        projectNameById
      )),
      ...contractLifecyclePending,
      ...(await this.contractSealFinalUploadWorkItems(
        userId,
        projectNameById
      )),
      ...(await this.contractFinalUploadSubstituteWorkItems(
        userId,
        projectIds,
        projectNameById
      )),
      ...(await this.contractArchiveWorkItems(
        this.projectIdsFor(scopes, ["contract.archive.upload"]),
        ["seal_approved_pending_archive"],
        projectNameById,
        "上传盖章合同",
        "上传后等待合同部主管确认归档",
        "primary"
      )),
      ...(await this.contractArchiveWorkItems(
        this.projectIdsFor(scopes, ["contract.archive.confirm"]),
        ["pending_archive_confirm"],
        projectNameById,
        "确认合同归档",
        "确认后合同版本生效",
        "warning",
        userId
      )),
      ...(await this.settlementArchiveWorkItems(
        this.projectIdsFor(scopes, ["settlement.archive.upload"]),
        ["approved_pending_archive"],
        projectNameById,
        "上传结算签认件",
        "上传后等待合同部主管确认归档",
        "primary",
        "legacy"
      )),
      ...(await this.settlementArchiveWorkItems(
        this.projectIdsFor(scopes, ["settlement.archive.confirm"]),
        ["archive_pending", "pending_archive_confirm"],
        projectNameById,
        "确认结算归档",
        "确认后结算生效，可申请付款",
        "warning",
        "legacy"
      )),
      ...(await this.settlementArchiveWorkItems(
        this.projectIdsFor(scopes, ["settlement.archive.confirm"]),
        ["pending_archive_confirm"],
        projectNameById,
        "确认最终结算文件",
        "确认后结算生效，可申请付款",
        "warning",
        "governed"
      )),
      ...(await this.failedSettlementGenerationWorkItems(
        this.projectIdsFor(scopes, ["settlement.archive.confirm"]),
        projectNameById
      )),
      ...(await this.approvalWorkItems(scopes, userId, "pending", evaluatedAt))
    ];
  }

  async getFundsPendingWorkItems(userId: string): Promise<WorkItem[]> {
    const evaluatedAt = new Date();
    const scopes = await this.loadProjectRoleScopes(userId);
    const projectIds = scopes.map((scope) => scope.projectId);
    const projectNameById = await this.projectNames(projectIds);
    const pending = [
      ...(await contractHandlingWorkItems(this.prisma as Prisma.TransactionClient,userId,scopes,projectNameById)),
      ...(await companyTransferWorkItems(this.prisma as Prisma.TransactionClient, userId, new ProjectVisibilityService(this.prisma))),
      ...(await fundTransferWorkItems(this.prisma, userId)),
      ...(await this.paymentExecutionWorkItems(
        userId,
        projectNameById,
        undefined
      )),
      ...(await this.spotPaymentExecutionWorkItems(
        userId,
        this.projectIdsFor(scopes, ["spot_procurement.payment.execute"]),
        projectNameById,
        undefined
      )),
      ...(await this.approvalWorkItems(scopes, userId, "pending", evaluatedAt))
    ];
    await addContractRelationshipSummaries(this.prisma,pending);
    return pending.filter((item) =>
      ["registered_fund_transfer","company_transfer","contract_bank_verification","upward_receipt_match","contract_proxy_execution"].includes(item.businessType??"") ||
      item.businessType === "registered_principal_return" ||
      item.businessType === "payment_request" ||
      item.businessType === "spot_procurement_payment" ||
      item.businessType === "spot_payment"
    );
  }

  async getFundsPendingBusinessIdsInTransaction(
    tx: Prisma.TransactionClient,
    userId: string,
    visibleProjectIds: string[],
    evaluatedAt: Date,
    budget: FundsPendingReadBudget
  ): Promise<FundsPendingBusinessIds> {
    if (!visibleProjectIds.length) {
      return { contractPaymentIds: [], spotPaymentIds: [] };
    }
    const read = async <T>(reader: (take: number) => Promise<T[]>): Promise<T[]> => {
      const rows = await reader(budget.remaining() + 1);
      budget.consume(rows.length);
      return rows;
    };
    const globalPositions = await read((take) => tx.userPosition.findMany({
        where: { userId, projectId: null },
        select: { positionId: true, projectId: true },
        take
      }));
    const projectPositions = await read((take) => tx.userPosition.findMany({
        where: { userId, projectId: { in: visibleProjectIds } },
        select: { positionId: true, projectId: true },
        take
      }));
    const projectMembers = await read((take) => tx.projectMember.findMany({
        where: { userId, projectId: { in: visibleProjectIds } },
        select: { projectId: true, positionKey: true },
        take
      }));
    const positionIds = Array.from(new Set(
      [...globalPositions, ...projectPositions].map((position) => position.positionId)
    ));
    const positions = positionIds.length
      ? await read((take) => tx.position.findMany({
          where: { id: { in: positionIds } },
          select: { id: true, key: true },
          take
        }))
      : [];
    const positionKeyById = new Map(
      positions.map((position) => [position.id, position.key as RoleKey])
    );
    const globalRoleKeys = globalPositions
      .map((position) => positionKeyById.get(position.positionId))
      .filter((role): role is RoleKey => Boolean(role));
    const localPositionKeysByProject = new Map<string, RoleKey[]>();
    for (const position of projectPositions) {
      if (!position.projectId) continue;
      const role = positionKeyById.get(position.positionId);
      if (!role) continue;
      localPositionKeysByProject.set(position.projectId, [
        ...(localPositionKeysByProject.get(position.projectId) ?? []),
        role
      ]);
    }
    for (const member of projectMembers) {
      localPositionKeysByProject.set(member.projectId, [
        ...(localPositionKeysByProject.get(member.projectId) ?? []),
        member.positionKey as RoleKey
      ]);
    }
    const roleKeysByProject = new Map(visibleProjectIds.map((projectId) => [
      projectId,
      resolveEffectiveRoleKeys(
        globalRoleKeys,
        localPositionKeysByProject.get(projectId) ?? []
      )
    ]));
    const projectIdsFor = (action: BusinessAction) => visibleProjectIds.filter((projectId) =>
      canPerform(action, roleKeysByProject.get(projectId) ?? [])
    );
    const executablePaymentProjectIds = projectIdsFor("payment.execution");
    const executableSpotProjectIds = projectIdsFor("spot_procurement.payment.execute");
    const contractExecutionRows = executablePaymentProjectIds.length
      ? await read((take) => tx.paymentRequest.findMany({
          where: {
            projectId: { in: executablePaymentProjectIds },
            status: { in: ["approved_pending_payment", "partially_paid"] },
            remainingWithdrawnCents: null
          },
          select: { id: true },
          orderBy: { id: "asc" },
          take
        }))
      : [];
    const spotExecutionRows = executableSpotProjectIds.length
      ? await read((take) => tx.spotProcurementPayment.findMany({
          where: {
            projectId: { in: executableSpotProjectIds },
            status: { in: ["approved_pending_payment", "partially_paid"] }
          },
          select: { id: true },
          orderBy: { id: "asc" },
          take
        }))
      : [];
    const approvalPayments = await read((take) => tx.paymentRequest.findMany({
        where: {
          projectId: { in: visibleProjectIds },
          status: "approval_pending"
        },
        select: { id: true, projectId: true },
        orderBy: { id: "asc" },
        take
      }));
    const approvalSpotPayments = await read((take) => tx.spotProcurementPayment.findMany({
        where: {
          projectId: { in: visibleProjectIds },
          status: "approval_pending"
        },
        select: { id: true, projectId: true },
        orderBy: { id: "asc" },
        take
      }));
    const approvalInstances = approvalPayments.length || approvalSpotPayments.length
      ? await read((take) => tx.approvalInstance.findMany({
          where: {
            ...this.activeApprovalWhere(),
            OR: [
              ...(approvalPayments.length ? [{
                businessType: "payment_request",
                businessId: { in: approvalPayments.map((payment) => payment.id) }
              }] : []),
              ...(approvalSpotPayments.length ? [{
                businessType: "spot_procurement_payment",
                businessId: { in: approvalSpotPayments.map((payment) => payment.id) }
              }] : [])
            ]
          },
          select: {
            id: true,
            businessType: true,
            businessId: true,
            status: true,
            currentNodeIndex: true,
            frozenNodes: true,
            applicantUserId: true,
            createdAt: true,
            updatedAt: true
          },
          orderBy: { id: "asc" },
          take
        })) as ApprovalInstanceForWorkItem[]
      : [];
    const paymentProjectById = new Map(
      approvalPayments.map((payment) => [payment.id, payment.projectId])
    );
    const spotProjectById = new Map(
      approvalSpotPayments.map((payment) => [payment.id, payment.projectId])
    );
    const delegationRows = approvalInstances.some((instance) =>
      this.supportsIndirectApproval(instance.businessType)
    )
      ? await read((take) => tx.approvalDelegation.findMany({
          where: {
            toUserId: userId,
            actionKey: null,
            resourceType: null,
            resourceId: null,
            enabled: true,
            startsAt: { lte: evaluatedAt },
            endsAt: { gt: evaluatedAt }
          },
          select: { fromUserId: true },
          orderBy: { id: "asc" },
          take
        }))
      : [];
    const rawDelegatorIds = Array.from(new Set(
      delegationRows.map((delegation) => delegation.fromUserId)
    ));
    const activeDelegatorIds = rawDelegatorIds.length
      ? await this.activeFundsDelegatorIds(tx, userId, rawDelegatorIds, read)
      : [];
    const activeDelegatorIdSet = new Set(activeDelegatorIds);
    const delegatorRoleIndex = activeDelegatorIds.length
      ? await this.fundsDelegatorRoles(
          tx,
          activeDelegatorIds,
          visibleProjectIds,
          read
        )
      : emptyFundsDelegatorRoleIndex();
    const contractPaymentIds = new Set(contractExecutionRows.map((row) => row.id));
    const spotPaymentIds = new Set(spotExecutionRows.map((row) => row.id));
    for (const instance of approvalInstances) {
      const projectId = instance.businessType === "payment_request"
        ? paymentProjectById.get(instance.businessId)
        : spotProjectById.get(instance.businessId);
      const node = this.currentApprovalNode(instance.frozenNodes, instance.currentNodeIndex, roleKeysByProject.get(projectId ?? "") ?? []);
      if (!projectId || !node) continue;
      const roleKeys = roleKeysByProject.get(projectId) ?? [];
      const supportsIndirect = this.supportsIndirectApproval(instance.businessType);
      const hasRoleTodo = ["general_procurement", "expense_claim"].includes(instance.businessType)
        ? await this.canActOnProcurementNode(node, userId, projectId)
        : supportsIndirect ? this.canActOnApprovalNode(node, roleKeys, userId) : this.hasDirectRoleTodo(node, roleKeys);
      const hasDirectTodo = hasRoleTodo &&
        this.canShowSpotApplicantTodo(instance, node, roleKeys, userId);
      const relevantDelegatorIds = supportsIndirect && !hasDirectTodo
        ? fundsDelegatorCandidates(
            node,
            projectId,
            activeDelegatorIdSet,
            delegatorRoleIndex
          )
        : [];
      const activeDelegators = relevantDelegatorIds.map((delegatorId) => ({
            userId: delegatorId,
            roleKeys: resolveEffectiveRoleKeys(
              delegatorRoleIndex.globalKeysByUserId.get(delegatorId) ?? [],
              delegatorRoleIndex.localKeysByUserProject.get(
                `${delegatorId}\u0000${projectId}`
              ) ?? []
            )
          }));
      const hasDelegatedTodo = supportsIndirect && !hasDirectTodo && Boolean(
        resolveApprovalReviewIdentity({
          node,
          actorUserId: userId,
          actorRoleKeys: [],
          activeDelegators
        })
      );
      if (!hasDirectTodo && !hasDelegatedTodo) continue;
      if (instance.businessType === "payment_request") {
        contractPaymentIds.add(instance.businessId);
      } else {
        spotPaymentIds.add(instance.businessId);
      }
    }
    return {
      contractPaymentIds: [...contractPaymentIds],
      spotPaymentIds: [...spotPaymentIds]
    };
  }

  async getContractPendingWorkItems(userId: string): Promise<WorkItem[]> {
    const evaluatedAt = new Date();
    const scopes = await this.loadProjectRoleScopes(userId);
    const projectIds = scopes.map((scope) => scope.projectId);
    const projectNameById = await this.projectNames(projectIds);
    const pending = [
      ...(await this.contractV2LifecycleWorkItems(userId, projectIds, projectNameById)).pending,
      ...(await this.contractSealFinalUploadWorkItems(userId, projectNameById, undefined)),
      ...(await this.contractFinalUploadSubstituteWorkItems(userId, projectIds, projectNameById)),
      ...(await this.contractArchiveWorkItems(
        this.projectIdsFor(scopes, ["contract.archive.upload"]), ["seal_approved_pending_archive"], projectNameById,
        "上传盖章合同", "上传后等待合同部主管确认归档", "primary", undefined, undefined
      )),
      ...(await this.contractArchiveWorkItems(
        this.projectIdsFor(scopes, ["contract.archive.confirm"]), ["pending_archive_confirm"], projectNameById,
        "确认合同归档", "确认后合同版本生效", "warning", userId, undefined
      )),
      ...(await this.approvalWorkItems(scopes, userId, "pending", evaluatedAt, "contract"))
    ];
    await addContractRelationshipSummaries(this.prisma,pending);
    return pending.filter((item) =>
      ["company_transfer","contract_bank_verification","upward_receipt_match","contract_proxy_execution"].includes(item.businessType??"") ||
      item.businessType === "contract_version" || item.businessType === "contract_work_completion");
  }

  async getSettlementPendingWorkItems(userId: string): Promise<WorkItem[]> {
    const evaluatedAt = new Date();
    const scopes = await this.loadProjectRoleScopes(userId);
    const projectIds = scopes.map((scope) => scope.projectId);
    const projectNameById = await this.projectNames(projectIds);
    const pending = [
      ...(await this.settlementArchiveWorkItems(
        this.projectIdsFor(scopes, ["settlement.archive.upload"]), ["approved_pending_archive"],
        projectNameById, "上传结算签认件", "上传后等待合同部主管确认归档", "primary", "legacy", true
      )),
      ...(await this.settlementArchiveWorkItems(
        this.projectIdsFor(scopes, ["settlement.archive.confirm"]), ["archive_pending", "pending_archive_confirm"],
        projectNameById, "确认结算归档", "确认后结算生效，可申请付款", "warning", "legacy", true
      )),
      ...(await this.settlementArchiveWorkItems(
        this.projectIdsFor(scopes, ["settlement.archive.confirm"]), ["pending_archive_confirm"],
        projectNameById, "确认最终结算文件", "确认后结算生效，可申请付款", "warning", "governed", true
      )),
      ...(await this.failedSettlementGenerationWorkItems(
        this.projectIdsFor(scopes, ["settlement.archive.confirm"]), projectNameById, true
      )),
      ...(await this.approvalWorkItems(scopes, userId, "pending", evaluatedAt))
    ];
    await addContractRelationshipSummaries(this.prisma,pending);
    return pending.filter((item) =>
      ["company_transfer","contract_bank_verification","upward_receipt_match","contract_proxy_execution"].includes(item.businessType??"") || item.businessType === "settlement");
  }

  private async myDraftWorkItems(
    userId: string,
    contractProjectIds: string[],
    visibleProjectIds: string[],
    projectNameById: ReadonlyMap<string, string>
  ): Promise<{ items: WorkItem[]; total: number }> {
    if (!supportsDraftAggregation(this.prisma)) {
      const items = await this.contractTakeoverWorkItems(
        contractProjectIds,
        ["draft"],
        projectNameById,
        "草稿填写",
        "继续补录后提交复核",
        "default"
      );
      return { items: items.slice(0, 30), total: items.length };
    }

    const [contracts, settlementDrafts, takeovers, procurements, payments] = await Promise.all([
      contractProjectIds.length
        ? this.prisma.contract.findMany({
            where: {
              projectId: { in: contractProjectIds },
              ownerUserId: userId,
              source: { not: "historical_takeover" },
              voidedAt: null
            },
            select: { id: true, projectId: true, code: true, temporaryCode: true, name: true }
          })
        : Promise.resolve([]),
      visibleProjectIds.length
        ? this.prisma.settlementDraft.findMany({
            where: { projectId: { in: visibleProjectIds }, ownerUserId: userId, status: "draft" },
            orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
            select: { id: true, projectId: true, periodLabel: true, code: true, updatedAt: true }
          })
        : Promise.resolve([]),
      contractProjectIds.length
        ? this.prisma.contractTakeover.findMany({
            where: {
              projectId: { in: contractProjectIds },
              takeoverStatus: "draft",
              OR: [{ responsibleUserId: userId }, { createdByUserId: userId }]
            },
            orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
            select: {
              id: true,
              projectId: true,
              contractId: true,
              contractVersionId: true,
              updatedAt: true
            }
          })
        : Promise.resolve([]),
      visibleProjectIds.length
        ? this.prisma.spotProcurement.findMany({
            where: {
              projectId: { in: visibleProjectIds },
              status: "draft",
              OR: [{ applicantUserId: userId }, { handlerUserId: userId }]
            },
            orderBy: [{ updatedAt: "desc" }, { id: "desc" }]
          })
        : Promise.resolve([]),
      visibleProjectIds.length
        ? this.prisma.spotProcurementPayment.findMany({
            where: {
              projectId: { in: visibleProjectIds },
              status: "draft",
              OR: [{ createdByUserId: userId }, { handlerUserId: userId }]
            },
            orderBy: [{ updatedAt: "desc" }, { id: "desc" }]
          })
        : Promise.resolve([])
    ]);

    const [settlementTotal, takeoverTotal, procurementTotal, paymentTotal] = await Promise.all([
      visibleProjectIds.length
        ? this.prisma.settlementDraft.count({
            where: { projectId: { in: visibleProjectIds }, ownerUserId: userId, status: "draft" }
          })
        : Promise.resolve(0),
      contractProjectIds.length
        ? this.prisma.contractTakeover.count({
            where: {
              projectId: { in: contractProjectIds },
              takeoverStatus: "draft",
              OR: [{ responsibleUserId: userId }, { createdByUserId: userId }]
            }
          })
        : Promise.resolve(0),
      visibleProjectIds.length
        ? this.prisma.spotProcurement.count({
            where: {
              projectId: { in: visibleProjectIds },
              status: "draft",
              OR: [{ applicantUserId: userId }, { handlerUserId: userId }]
            }
          })
        : Promise.resolve(0),
      visibleProjectIds.length
        ? this.prisma.spotProcurementPayment.count({
            where: {
              projectId: { in: visibleProjectIds },
              status: "draft",
              OR: [{ createdByUserId: userId }, { handlerUserId: userId }]
            }
          })
        : Promise.resolve(0)
    ]);

    const contractIds = contracts.map((contract) => contract.id);
    const contractVersions = contractIds.length
      ? await this.prisma.contractVersion.findMany({
          where: { contractId: { in: contractIds }, status: "draft" },
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
          select: { id: true, contractId: true, amountCents: true, amountYuan: true, numericProtocolVersion: true, changeType: true, draftData: true, updatedAt: true }
        })
      : [];
    const contractTotal = contractIds.length
      ? await this.prisma.contractVersion.count({
          where: { contractId: { in: contractIds }, status: "draft" }
        })
      : 0;
    const contractById = new Map(contracts.map((contract) => [contract.id, contract]));

    const takeoverContractIds = [...new Set(takeovers.map((row) => row.contractId))];
    const takeoverVersionIds = [...new Set(takeovers.map((row) => row.contractVersionId))];
    const [takeoverContracts, takeoverVersions, templateDrafts] = await Promise.all([
      takeoverContractIds.length
        ? this.prisma.contract.findMany({
            where: { id: { in: takeoverContractIds } },
            select: { id: true, code: true, temporaryCode: true, name: true }
          })
        : Promise.resolve([]),
      takeoverVersionIds.length
        ? this.prisma.contractVersion.findMany({
            where: { id: { in: takeoverVersionIds } },
            select: { id: true, amountCents: true }
          })
        : Promise.resolve([]),
      this.myTemplateDraftWorkItems(userId)
    ]);
    const takeoverContractById = new Map(takeoverContracts.map((row) => [row.id, row]));
    const takeoverVersionById = new Map(takeoverVersions.map((row) => [row.id, row]));

    const directPresentations = await this.directDraftPresentations(contractVersions);

    const businessDrafts: Array<WorkItem & { updatedAt: Date }> = [
      ...contractVersions.flatMap((version) => {
        const contract = contractById.get(version.contractId);
        if (!contract) return [];
        const direct = directPresentations.get(version.id);
        return [{
          id: `contract-draft:${version.id}`,
          type: "draft" as const,
          title: contract.name,
          projectName: projectNameById.get(contract.projectId) ?? contract.projectId,
          projectId: contract.projectId,
          businessCode: direct?.businessCode ?? contract.code ?? contract.temporaryCode ?? contract.id,
          businessType: "contract",
          businessId: contract.id,
          amountText: direct?.amountText ?? this.amountText(version.amountCents),
          currentNode: direct?.invalid ? "资料待核对" : "合同草稿",
          [workItemNoticeAt]: version.updatedAt,
          stayedText: this.stayedText(version.updatedAt),
          nextAction: direct?.invalid ? "请核对合同资料" : "继续填写合同",
          targetPath: direct?.invalid
            ? `/合同管理/${encodeURIComponent(contract.id)}?versionId=${encodeURIComponent(version.id)}`
            : direct ? `/合同工作台/${encodeURIComponent(contract.id)}?versionId=${encodeURIComponent(version.id)}` : `/contracts/${encodeURIComponent(contract.id)}/workbench`,
          tone: direct?.invalid ? "warning" as const : "default" as const,
          updatedAt: version.updatedAt
        }];
      }),
      ...settlementDrafts.map((draft) => ({
        id: `settlement-draft:${draft.id}`,
        type: "draft" as const,
        title: `${draft.periodLabel} 结算草稿`,
        projectName: projectNameById.get(draft.projectId) ?? draft.projectId,
        projectId: draft.projectId,
        businessCode: draft.code,
        businessType: "settlement",
        businessId: draft.id,
        amountText: "—",
        currentNode: "结算草稿",
        stayedText: this.stayedText(draft.updatedAt),
        nextAction: "继续填写结算",
        targetPath: `/结算工作台?project=${encodeURIComponent(draft.projectId)}&draftId=${encodeURIComponent(draft.id)}`,
        tone: "default" as const,
        updatedAt: draft.updatedAt
      })),
      ...takeovers.map((takeover) => {
        const contract = takeoverContractById.get(takeover.contractId);
        return {
          id: `takeover:${takeover.id}`,
          type: "contract_takeover" as const,
          title: contract?.name ?? "历史合同接管",
          projectName: projectNameById.get(takeover.projectId) ?? takeover.projectId,
          projectId: takeover.projectId,
          businessCode: contract?.code ?? contract?.temporaryCode ?? takeover.contractId,
          businessType: "contract_takeover",
          businessId: takeover.id,
          amountText: this.amountText(takeoverVersionById.get(takeover.contractVersionId)?.amountCents ?? 0n),
          currentNode: "历史接管草稿",
          [workItemNoticeAt]: takeover.updatedAt,
          stayedText: this.stayedText(takeover.updatedAt),
          nextAction: "继续补录后提交复核",
          targetPath: "/历史合同接管",
          tone: "default" as const,
          updatedAt: takeover.updatedAt
        };
      }),
      ...procurements.map((draft) => ({
        id: `spot-procurement-draft:${draft.id}`,
        type: "draft" as const,
        title: "零星采购草稿",
        projectName: projectNameById.get(draft.projectId) ?? draft.projectId,
        projectId: draft.projectId,
        businessCode: draft.code,
        businessType: "spot_procurement",
        businessId: draft.id,
        amountText: "—",
        currentNode: "采购草稿",
        stayedText: this.stayedText(draft.updatedAt),
        nextAction: "继续填写采购",
        targetPath: `/零星采购/${encodeURIComponent(draft.id)}`,
        tone: "default" as const,
        updatedAt: draft.updatedAt
      })),
      ...payments.map((draft) => ({
        id: `spot-payment-draft:${draft.id}`,
        type: "draft" as const,
        title: "零星材料付款草稿",
        projectName: projectNameById.get(draft.projectId) ?? draft.projectId,
        projectId: draft.projectId,
        businessCode: draft.code,
        businessType: "spot_payment",
        businessId: draft.id,
        amountText: this.amountText(draft.approvalAmountCents),
        currentNode: "付款草稿",
        stayedText: this.stayedText(draft.updatedAt),
        nextAction: "继续填写付款",
        targetPath: `/零星材料付款/${encodeURIComponent(draft.id)}`,
        tone: "default" as const,
        updatedAt: draft.updatedAt
      })),
      ...templateDrafts.items
    ];

    for (const draft of businessDrafts) {
      const ageDays = Math.max(0, Math.floor((Date.now() - draft.updatedAt.getTime()) / 86_400_000));
      draft.ageDays = ageDays;
      draft.agingStatus = ageDays > 90
        ? "stale"
        : ageDays > 30
          ? "long_running"
          : "current";
      if (draft.agingStatus !== "current") {
        draft.tone = "warning";
      }
    }

    const total = contractTotal + settlementTotal + takeoverTotal +
      procurementTotal + paymentTotal + templateDrafts.total;
    const sorted = businessDrafts
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
    const recent = sorted.filter((entry) => entry.agingStatus !== "stale").slice(0, 30);
    const stale = sorted.filter((entry) => entry.agingStatus === "stale").slice(0, 30);
    return {
      items: [...recent, ...stale]
        .map((entry) => {
          const item: WorkItem & { updatedAt?: Date } = { ...entry };
          delete item.updatedAt;
          return item;
        }),
      total
    };
  }

  private async myTemplateDraftWorkItems(userId: string): Promise<{
    items: Array<WorkItem & { updatedAt: Date }>;
    total: number;
  }> {
    const [businessRoots, layoutRoots, clauseRoots, settlementRoots] = await Promise.all([
      this.prisma.contractBusinessTemplate.findMany({
        where: { createdByUserId: userId },
        select: { id: true, code: true, name: true }
      }),
      this.prisma.contractLayoutTemplate.findMany({
        where: { createdByUserId: userId },
        select: { id: true, name: true }
      }),
      this.prisma.standardClause.findMany({
        where: { createdByUserId: userId },
        select: { id: true, code: true, name: true }
      }),
      this.prisma.settlementTemplate.findMany({
        where: { createdByUserId: userId },
        select: { id: true, code: true, name: true }
      })
    ]);
    const businessById = new Map(businessRoots.map((row) => [row.id, row]));
    const layoutById = new Map(layoutRoots.map((row) => [row.id, row]));
    const clauseById = new Map(clauseRoots.map((row) => [row.id, row]));
    const settlementById = new Map(settlementRoots.map((row) => [row.id, row]));
    const [businessVersions, layoutVersions, clauseVersions, settlementVersions] = await Promise.all([
      businessRoots.length
        ? this.prisma.contractBusinessTemplateVersion.findMany({
            where: { templateId: { in: businessRoots.map((row) => row.id) }, status: "draft" },
            orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
            select: { id: true, templateId: true, versionNo: true, updatedAt: true }
          })
        : Promise.resolve([]),
      layoutRoots.length
        ? this.prisma.contractLayoutTemplateVersion.findMany({
            where: { layoutTemplateId: { in: layoutRoots.map((row) => row.id) }, status: "draft" },
            orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
            select: { id: true, layoutTemplateId: true, versionNo: true, updatedAt: true }
          })
        : Promise.resolve([]),
      clauseRoots.length
        ? this.prisma.standardClauseVersion.findMany({
            where: { clauseId: { in: clauseRoots.map((row) => row.id) }, status: "draft" },
            orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
            select: { id: true, clauseId: true, versionNo: true, updatedAt: true }
          })
        : Promise.resolve([]),
      settlementRoots.length
        ? this.prisma.settlementTemplateVersion.findMany({
            where: { settlementTemplateId: { in: settlementRoots.map((row) => row.id) }, status: "draft" },
            orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
            select: { id: true, settlementTemplateId: true, versionNo: true, updatedAt: true }
          })
        : Promise.resolve([])
    ]);
    const [businessTotal, layoutTotal, clauseTotal, settlementTotal] = await Promise.all([
      businessRoots.length
        ? this.prisma.contractBusinessTemplateVersion.count({
            where: { templateId: { in: businessRoots.map((row) => row.id) }, status: "draft" }
          })
        : Promise.resolve(0),
      layoutRoots.length
        ? this.prisma.contractLayoutTemplateVersion.count({
            where: { layoutTemplateId: { in: layoutRoots.map((row) => row.id) }, status: "draft" }
          })
        : Promise.resolve(0),
      clauseRoots.length
        ? this.prisma.standardClauseVersion.count({
            where: { clauseId: { in: clauseRoots.map((row) => row.id) }, status: "draft" }
          })
        : Promise.resolve(0),
      settlementRoots.length
        ? this.prisma.settlementTemplateVersion.count({
            where: { settlementTemplateId: { in: settlementRoots.map((row) => row.id) }, status: "draft" }
          })
        : Promise.resolve(0)
    ]);

    const item = (
      id: string,
      title: string,
      code: string,
      currentNode: string,
      targetPath: string,
      updatedAt: Date
    ): WorkItem & { updatedAt: Date } => ({
      id,
      type: "draft",
      title,
      projectName: "系统模板",
      businessCode: code,
      businessType: "template",
      amountText: "—",
      currentNode,
      stayedText: this.stayedText(updatedAt),
      nextAction: "继续维护模板",
      targetPath,
      tone: "default",
      updatedAt
    });
    return {
      items: [
        ...businessVersions.flatMap((version) => {
          const root = businessById.get(version.templateId);
          return root ? [item(
            `contract-template-draft:${version.id}`,
            root.name,
            `${root.code} v${version.versionNo}`,
            "合同业务模板草稿",
            `/合同模板库/${encodeURIComponent(root.id)}`,
            version.updatedAt
          )] : [];
        }),
        ...layoutVersions.flatMap((version) => {
          const root = layoutById.get(version.layoutTemplateId);
          return root ? [item(
            `layout-template-draft:${version.id}`,
            root.name,
            `版式 v${version.versionNo}`,
            "合同版式草稿",
            `/合同模板库/版式/${encodeURIComponent(root.id)}`,
            version.updatedAt
          )] : [];
        }),
        ...clauseVersions.flatMap((version) => {
          const root = clauseById.get(version.clauseId);
          return root ? [item(
            `clause-template-draft:${version.id}`,
            root.name,
            `${root.code} v${version.versionNo}`,
            "标准条款草稿",
            "/合同模板库/标准条款",
            version.updatedAt
          )] : [];
        }),
        ...settlementVersions.flatMap((version) => {
          const root = settlementById.get(version.settlementTemplateId);
          return root ? [item(
            `settlement-template-draft:${version.id}`,
            root.name,
            `${root.code} v${version.versionNo}`,
            "结算模板草稿",
            `/结算模板库/${encodeURIComponent(root.id)}`,
            version.updatedAt
          )] : [];
        })
      ],
      total: businessTotal + layoutTotal + clauseTotal + settlementTotal
    };
  }

  private async loadProjectRoleScopes(userId: string): Promise<ProjectRoleScope[]> {
    const [globalPositions, projectPositions, projectMembers, activeProjects] = await Promise.all([
      this.prisma.userPosition.findMany({ where: { userId, projectId: null } }),
      this.prisma.userPosition.findMany({ where: { userId, projectId: { not: null } } }),
      this.prisma.projectMember.findMany({ where: { userId } }),
      this.prisma.project.findMany({ where: { isActive: true }, select: { id: true } })
    ]);
    const positionIds = Array.from(
      new Set([...globalPositions, ...projectPositions].map((position) => position.positionId))
    );
    const positions = positionIds.length
      ? await this.prisma.position.findMany({ where: { id: { in: positionIds } } })
      : [];
    const positionKeyById = new Map(positions.map((position) => [position.id, position.key as RoleKey]));
    const globalRoleKeys = globalPositions
      .map((position) => positionKeyById.get(position.positionId))
      .filter((role): role is RoleKey => Boolean(role));
    const localProjectIds = new Set<string>([
      ...projectPositions
        .map((position) => position.projectId)
        .filter((projectId): projectId is string => typeof projectId === "string"),
      ...projectMembers.map((member) => member.projectId)
    ]);

    return activeProjects
      .filter((project) => globalRoleKeys.length > 0 || localProjectIds.has(project.id))
      .map((project) => {
        const projectRoleKeys = [
          ...projectPositions
            .filter((position) => position.projectId === project.id)
            .map((position) => positionKeyById.get(position.positionId))
            .filter((role): role is RoleKey => Boolean(role)),
          ...projectMembers
            .filter((member) => member.projectId === project.id)
            .map((member) => member.positionKey as RoleKey)
        ];

        return {
          projectId: project.id,
          roleKeys: resolveEffectiveRoleKeys(globalRoleKeys, projectRoleKeys)
        };
      });
  }

  private projectIdsFor(scopes: ProjectRoleScope[], actions: BusinessAction[]) {
    return scopes
      .filter((scope) => actions.some((action) => canPerform(action, scope.roleKeys)))
      .map((scope) => scope.projectId);
  }

  private async projectNames(projectIds: string[]) {
    if (!projectIds.length) {
      return new Map<string, string>();
    }

    const projects = await this.prisma.project.findMany({
      where: { id: { in: [...new Set(projectIds)] } },
      select: { id: true, name: true }
    });
    return new Map(projects.map((project) => [project.id, project.name]));
  }

  private async contractTakeoverWorkItems(
    projectIds: string[],
    statuses: string[],
    projectNameById: ReadonlyMap<string, string>,
    currentNode: string,
    nextAction: string,
    tone: WorkbenchCardTone,
    extraWhere: Prisma.ContractTakeoverWhereInput = {},
    options: {
      idPrefix?: string;
      requiresMissingHistoricalPaymentVoucher?: boolean;
    } = {}
  ): Promise<WorkItem[]> {
    if (!projectIds.length) {
      return [];
    }

    const takeovers = await this.prisma.contractTakeover.findMany({
      where: {
        projectId: { in: projectIds },
        takeoverStatus: { in: statuses },
        ...extraWhere
      },
      orderBy: { updatedAt: "desc" },
      take: 30,
      select: {
        id: true,
        projectId: true,
        contractId: true,
        contractVersionId: true,
        historicalApprovalPendingPaymentCents: true,
        historicalApprovedPendingPaymentCents: true,
        historicalPaidCents: true,
        historicalProxyPaidCents: true,
        historicalAdvancePaidCents: true,
        historicalRetentionWithheldCents: true,
        otherConfirmedOccupancyCents: true,
        updatedAt: true
      }
    });
    const missingVoucherTakeoverIds = options.requiresMissingHistoricalPaymentVoucher
      ? await this.missingHistoricalPaymentVoucherTakeoverIds(takeovers)
      : null;
    const visibleTakeovers = missingVoucherTakeoverIds
      ? takeovers.filter((takeover) => missingVoucherTakeoverIds.has(takeover.id))
      : takeovers;
    const [contracts, versions] = await Promise.all([
      visibleTakeovers.length
        ? this.prisma.contract.findMany({
            where: { id: { in: [...new Set(visibleTakeovers.map((item) => item.contractId))] } },
            select: { id: true, code: true, temporaryCode: true, name: true, counterparty: true }
          })
        : Promise.resolve([]),
      visibleTakeovers.length
        ? this.prisma.contractVersion.findMany({
            where: { id: { in: [...new Set(visibleTakeovers.map((item) => item.contractVersionId))] } },
            select: { id: true, amountCents: true }
          })
        : Promise.resolve([])
    ]);
    const contractById = new Map(contracts.map((contract) => [contract.id, contract]));
    const versionById = new Map(versions.map((version) => [version.id, version]));

    return visibleTakeovers.map((takeover) => {
      const contract = contractById.get(takeover.contractId);
      const code = contract?.code ?? contract?.temporaryCode ?? takeover.contractId;
      return {
        id: `${options.idPrefix ?? "takeover"}:${takeover.id}`,
        type: tone === "danger" ? "blocker" : "contract_takeover",
        title: contract?.name ?? "历史合同接管",
        projectName: projectNameById.get(takeover.projectId) ?? takeover.projectId,
        businessCode: code,
        amountText: this.amountText(versionById.get(takeover.contractVersionId)?.amountCents ?? 0n),
        currentNode,
        [workItemNoticeAt]: takeover.updatedAt,
        stayedText: this.stayedText(takeover.updatedAt),
        nextAction,
        targetPath: "/历史合同接管",
        tone
      };
    });
  }

  /**
   * 接管分工登记后的继续办理待办：只给被登记的当前负责人，后端按接管结果解析。
   * 历史事实不因分工变化而重写，待办在完成新结算/付款后自然消失。
   */
  private async contractTakeoverHandoverWorkItems(
    userId: string,
    scopes: ProjectRoleScope[],
    projectNameById: ReadonlyMap<string, string>
  ): Promise<WorkItem[]> {
    const projectIds = [...new Set(scopes.map((scope) => scope.projectId))];
    if (!projectIds.length) return [];
    if (typeof this.prisma.contractTakeover?.findMany !== "function") return [];
    const takeovers = await this.prisma.contractTakeover.findMany({
      where: {
        projectId: { in: projectIds },
        takeoverStatus: "confirmed",
        confirmedAt: { not: null }
      },
      orderBy: [{ confirmedAt: "desc" }, { id: "desc" }],
      take: 50,
      select: {
        id: true,
        projectId: true,
        contractId: true,
        contractVersionId: true,
        confirmedAt: true
      }
    });
    if (!takeovers.length) return [];
    if (typeof this.prisma.contractTakeoverConfirmationEvent?.findMany !== "function") return [];
    const events = await this.prisma.contractTakeoverConfirmationEvent.findMany({
      where: {
        takeoverId: { in: takeovers.map((takeover) => takeover.id) },
        side: "handover"
      },
      orderBy: [{ revision: "asc" }, { createdAt: "asc" }],
      select: { takeoverId: true, responseSnapshot: true }
    });
    const latestByTakeover = new Map<string, ReturnType<typeof parseTakeoverHandoverSnapshot>>();
    for (const event of events) {
      const snapshot = parseTakeoverHandoverSnapshot(event.responseSnapshot);
      if (snapshot) latestByTakeover.set(event.takeoverId, snapshot);
    }
    const dutiesByTakeover = new Map<string, ContractTakeoverHandoverDuty>();
    for (const takeover of takeovers) {
      const snapshot = latestByTakeover.get(takeover.id);
      if (!snapshot) continue;
      const duty = CONTRACT_TAKEOVER_HANDOVER_DUTIES.find(
        (candidate) => snapshot.assignments[candidate] === userId
      );
      if (duty) dutiesByTakeover.set(takeover.id, duty);
    }
    const assigned = takeovers.filter((takeover) => dutiesByTakeover.has(takeover.id));
    if (!assigned.length) return [];
    if (
      typeof this.prisma.settlement?.groupBy !== "function" ||
      typeof this.prisma.paymentRequest?.groupBy !== "function"
    ) {
      return [];
    }
    const versionIds = [...new Set(assigned.map((takeover) => takeover.contractVersionId))];
    const [settlementCounts, paymentCounts, contracts] = await Promise.all([
      this.prisma.settlement.groupBy({
        by: ["contractVersionId"],
        where: {
          contractVersionId: { in: versionIds },
          sourceType: { not: "historical_takeover" }
        },
        _count: { _all: true }
      }),
      this.prisma.paymentRequest.groupBy({
        by: ["contractVersionId"],
        where: { contractVersionId: { in: versionIds } },
        _count: { _all: true }
      }),
      this.prisma.contract.findMany({
        where: { id: { in: [...new Set(assigned.map((takeover) => takeover.contractId))] } },
        select: { id: true, code: true, temporaryCode: true, name: true }
      })
    ]);
    const settlementCountByVersion = new Map(
      settlementCounts.map((row) => [row.contractVersionId, row._count._all])
    );
    const paymentCountByVersion = new Map(
      paymentCounts.map((row) => [row.contractVersionId, row._count._all])
    );
    const contractById = new Map(contracts.map((contract) => [contract.id, contract]));
    const items: WorkItem[] = [];
    for (const takeover of assigned) {
      const duty = dutiesByTakeover.get(takeover.id)!;
      const settlementCount = settlementCountByVersion.get(takeover.contractVersionId) ?? 0;
      const paymentCount = paymentCountByVersion.get(takeover.contractVersionId) ?? 0;
      if (duty === "contract" && settlementCount === 0) {
        items.push(this.takeoverContinuationItem(
          takeover,
          duty,
          contractById,
          projectNameById,
          "继续办理新结算",
          "接管已确认，可按新分工发起后续结算"
        ));
      } else if (duty === "finance" && settlementCount > 0 && paymentCount === 0) {
        items.push(this.takeoverContinuationItem(
          takeover,
          duty,
          contractById,
          projectNameById,
          "登记后续付款",
          "已有接管后结算，请按实际资金办理付款"
        ));
      }
    }
    return items;
  }

  private takeoverContinuationItem(
    takeover: {
      id: string;
      projectId: string;
      contractId: string;
      confirmedAt: Date | null;
    },
    duty: ContractTakeoverHandoverDuty,
    contractById: ReadonlyMap<
      string,
      { id: string; code: string | null; temporaryCode: string | null; name: string }
    >,
    projectNameById: ReadonlyMap<string, string>,
    currentNode: string,
    nextAction: string
  ): WorkItem {
    const contract = contractById.get(takeover.contractId);
    const code = contract?.code ?? contract?.temporaryCode ?? takeover.contractId;
    const notifiedAt = takeover.confirmedAt ?? new Date();
    return {
      id: `takeover-continuation:${takeover.id}:${duty}`,
      type: "contract_takeover",
      title: contract?.name ?? "历史合同接管",
      projectName: projectNameById.get(takeover.projectId) ?? takeover.projectId,
      businessCode: code,
      amountText: "",
      currentNode,
      [workItemNoticeAt]: notifiedAt,
      stayedText: this.stayedText(notifiedAt),
      nextAction,
      targetPath:
        duty === "finance"
          ? `/付款工作台?project=${encodeURIComponent(takeover.projectId)}&contract=${encodeURIComponent(takeover.contractId)}`
          : `/结算工作台/新建?project=${encodeURIComponent(takeover.projectId)}&contract=${encodeURIComponent(takeover.contractId)}`,
      tone: "primary"
    };
  }

  private async missingHistoricalPaymentVoucherTakeoverIds(
    takeovers: Array<{
      id: string;
      historicalApprovalPendingPaymentCents: bigint;
      historicalApprovedPendingPaymentCents: bigint;
      historicalPaidCents: bigint;
      historicalProxyPaidCents: bigint;
      historicalAdvancePaidCents: bigint;
      historicalRetentionWithheldCents: bigint;
      otherConfirmedOccupancyCents: bigint;
    }>
  ) {
    const paymentRelatedTakeoverIds = takeovers
      .filter((takeover) => [
        takeover.historicalApprovalPendingPaymentCents,
        takeover.historicalApprovedPendingPaymentCents,
        takeover.historicalPaidCents,
        takeover.historicalProxyPaidCents,
        takeover.historicalAdvancePaidCents,
        takeover.historicalRetentionWithheldCents,
        takeover.otherConfirmedOccupancyCents
      ].some((amount) => dbMoneyToBigInt(amount, "历史付款金额") > 0n))
      .map((takeover) => takeover.id);
    if (!paymentRelatedTakeoverIds.length) {
      return new Set<string>();
    }

    const archiveRecords = await this.prisma.archiveRecord.findMany({
      where: {
        businessType: "contract_takeover",
        businessId: { in: paymentRelatedTakeoverIds },
        departmentScope: "historical_payment_voucher"
      },
      select: { businessId: true }
    });
    const uploadedTakeoverIds = new Set(archiveRecords.map((record) => record.businessId));
    return new Set(paymentRelatedTakeoverIds.filter((id) => !uploadedTakeoverIds.has(id)));
  }

  private async paymentExecutionWorkItems(
    userId: string,
    projectNameById: ReadonlyMap<string, string>,
    limit: number | undefined = 30
  ): Promise<WorkItem[]> {
    const result = await new RegisteredPaymentExecutionService(this.prisma).visibleWorkItems(userId);
    const payments = result?.items ?? [];
    return payments.slice(0, limit).map((payment) => ({
      id: `payment-execution:${payment.paymentId}`,
      type: "payment_execution",
      projectId: payment.projectId,
      businessType: "payment_request",
      businessId: payment.paymentId,
      title: "登记实际付款",
      projectName: projectNameById.get(payment.projectId) ?? "项目付款",
      businessCode: payment.code,
      amountText: this.amountText(BigInt(payment.remainingAmountCents)),
      currentNode: "财务人员/综合部主管共同办理",
      [workItemNoticeAt]: new Date(payment.expectedPaymentUpdatedAt),
      stayedText: this.stayedText(new Date(payment.expectedPaymentUpdatedAt)),
      nextAction: "实际付款后登记，凭证可后补",
      targetPath: `/付款管理/${payment.code}`,
      tone: "warning"
    }));
  }

  private async expenseFundingWorkItems(scopes: ProjectRoleScope[], names: ReadonlyMap<string, string>): Promise<WorkItem[]> {
    const allowed = expenseFundingFacets.map(facet => ({
      ...facet, projectIds: new Set(this.projectIdsFor(scopes, [facet.action]))
    }));
    const filters = allowed.filter(facet => facet.projectIds.size).map(facet => ({
      projectId: { in: [...facet.projectIds] },
      claimType: { in: [...facet.claimTypes] },
      status: { in: [facet.initial, facet.partial] }
    }));
    if (!filters.length || !this.prisma.expenseClaim?.findMany) return [];
    const claims = await this.prisma.expenseClaim.findMany({
      where: { voidedAt: null, OR: filters },
      orderBy: [{ approvedAt: "desc" }, { id: "asc" }],
      select: { id: true, projectId: true, code: true, claimType: true, status: true,
        requestedAmountCents: true, companyPayableAmountCents: true, fundedAmountCents: true, approvedAt: true, updatedAt: true }
    });
    return claims.flatMap(claim => {
      const duty = expenseClaimFundingDuty(claim, true);
      const projectId = claim.projectId;
      if (!projectId || !duty || !allowed.some(facet => facet.duty === duty.duty && facet.projectIds.has(projectId))) return [];
      const started = claim.approvedAt ?? claim.updatedAt;
      return [{
        id: `expense-funding:${duty.duty}:${claim.id}`,
        type: "payment_execution" as const,
        businessType: "expense_claim", businessId: claim.id, businessCode: claim.code, projectId,
        title: claim.claimType === "reimbursement" ? "待登记报销实付" : "待登记费用实付",
        projectName: names.get(projectId) ?? "所属项目",
        amountText: this.amountText(duty.remaining), currentNode: duty.label,
        stayedText: this.stayedText(started), nextAction: duty.label,
        [workItemNoticeAt]: started, targetPath: `/费用与报销/${encodeURIComponent(claim.id)}`, tone: "warning" as const
      }];
    });
  }

  private async spotPaymentExecutionWorkItems(
    userId:string,
    projectIds: string[],
    projectNameById: ReadonlyMap<string, string>,
    limit?: number
  ): Promise<WorkItem[]> {
    const pilot=this.spotPilot;
    if (!pilot || !projectIds.length || !supportsSpotPaymentExecutionAggregation(this.prisma)) return [];
    const eligible:string[]=[];
    for (const projectId of projectIds) {
      if (pilot.isEnabled(projectId) && (await spotPaymentDutyAssignments(this.prisma,projectId,userId))
        .some(row=>row.userIsActive && row.projectId===projectId && row.roleKey==="finance_staff" && row.userId===userId)) eligible.push(projectId);
    }
    if (!eligible.length) return [];
    const payments = await this.prisma.spotProcurementPayment.findMany({
      where: {projectId:{in:eligible},status:{in:["approved_pending_payment","partially_paid"]}},
      orderBy: {updatedAt:"desc"},
      select: spotPaymentDutySelect
    });
    const items:WorkItem[]=[];
    for(const payment of payments) {
      const remaining=await currentSpotPaymentDuty(this.prisma,pilot,payment);
      if (remaining===null) continue;
      items.push({
        id: `spot-payment-execution:${payment.id}`,
        type: "payment_execution",
        title: "登记零星材料实付与凭证",
        projectName: projectNameById.get(payment.projectId) ?? "所属项目",
        projectId: payment.projectId,
        businessCode: payment.code,
        businessType: "spot_payment",
        businessId: payment.id,
        amountText: this.amountText(remaining),
        currentNode: "财务登记实际付款",
        [workItemNoticeAt]: payment.updatedAt,
        stayedText: this.stayedText(payment.updatedAt),
        nextAction: "登记实付并上传凭证",
        targetPath: `/零星材料付款/${encodeURIComponent(payment.id)}?tab=current`,
        tone: "warning"
      });
      if (items.length===limit) break;
    }
    return items;
  }

  private async contractV2LegacySigningExclusions(versions: Array<Pick<ContractVersion, "id" | "numericProtocolVersion" | "signingSubjectType">>) {
    const excluded = new Set<string>();
    const versionIds: string[] = [];
    for (const version of versions) {
      if (version.numericProtocolVersion !== 2) continue;
      // A missing frozen round cannot restore a legacy signing action for these V2 subjects.
      if (isNonInsideContractSubject(version.signingSubjectType)) excluded.add(version.id);
      else versionIds.push(version.id);
    }
    if (!versionIds.length) return excluded;
    const rounds = await this.prisma.approvalInstance.findMany({ where: { businessId: { in: versionIds }, businessType: "contract_version", flowType: "contract.approve", status: "approved" } });
    for (const round of rounds) {
      if (contractRoundSubmissionSnapshot(round.frozenNodes)?.contractVersionId === round.businessId) excluded.add(round.businessId);
    }
    return excluded;
  }

  private async contractV2LifecycleWorkItems(userId: string, projectIds: string[], names: ReadonlyMap<string, string>) {
    const result: { pending: WorkItem[]; blocked: WorkItem[] } = { pending: [], blocked: [] };
    if (!projectIds.length) return result;
    const contracts = await this.prisma.contract.findMany({ where: { projectId: { in: projectIds }, voidedAt: null } });
    const byId = new Map(contracts.map(contract => [contract.id, contract]));
    const versions = (await this.prisma.contractVersion.findMany({ where: { contractId: { in: contracts.map(contract => contract.id) }, numericProtocolVersion: 2, status: { in: ["approved_pending_seal", "seal_approved_pending_archive"] } } })).filter(version => version.numericProtocolVersion === 2);
    if (!versions.length || !(await this.prisma.user.findUnique({ where: { id: userId } }))?.isActive) return result;
    for (const version of versions) {
      const contract = byId.get(version.contractId);
      if (!contract) continue;
      const task = await this.prisma.contractSealTask.findFirst({ where: { contractVersionId: version.id, status: { in: ["in_seal", "completed"] } }, orderBy: { createdAt: "desc" } });
      if (!task) continue;
      const round = await this.prisma.approvalInstance.findUnique({ where: { id: task.approvalInstanceId } });
      const snapshot = contractRoundSubmissionSnapshot(round?.frozenNodes);
      if (!round || round.status !== "approved" || round.businessType !== "contract_version" || round.flowType !== "contract.approve" || round.businessId !== version.id || !snapshot || snapshot.contractVersionId !== version.id || snapshot.documentContentRevision !== version.documentContentRevision || snapshot.documentContentFingerprint !== version.documentContentFingerprint || round.applicantUserId !== contract.ownerUserId || task.handlerUserId !== contract.ownerUserId) continue;
      const seal = version.status === "approved_pending_seal" && task.status === "in_seal";
      const archive = version.status === "seal_approved_pending_archive" && task.status === "completed" && task.completedAt && task.completedByUserId;
      if (!seal && (!archive || task.handlerUserId !== userId)) continue;
      const code = contract.code ?? contract.temporaryCode;
      if (!code) continue;
      const hasCurrentRole = async (tx: Prisma.TransactionClient) => seal
        ? hasActiveContractGlobalRole(tx, userId, "comprehensive_director")
        : (await resolveGovernedFinalArchiveAccess(tx, {
          actorUserId: userId, projectId: contract.projectId, handlerUserId: task.handlerUserId
        })).canUpload;
      const identity = snapshot.signingIdentity;
      const relationship = identity && typeof identity === "object" && "relationship" in identity ? identity.relationship : null;
      const external = isNonInsideContractSubject(version.signingSubjectType) || relationship === "outside" || relationship === "upward";
      const blocked = external ? await this.prisma.$transaction(async tx => {
        if (!await hasCurrentRole(tx)) return null;
        const readCurrentContract = async () => {
          const current = await tx.contract.findUnique({ where: { id: contract.id } });
          return current && !current.voidedAt && current.projectId === contract.projectId &&
            current.ownerUserId === contract.ownerUserId ? current : null;
        };
        const currentContract = await readCurrentContract();
        if (!currentContract) return null;
        const latest = await tx.contractVersion.findFirst({
          where: { contractId: contract.id, status: { not: "deleting" } }, orderBy: { versionNo: "desc" }
        });
        if (latest?.id !== version.id || latest.status !== version.status) return null;
        const lifecycle = await readContractV2LifecycleContext(tx, currentContract, latest, userId, false);
        // Readiness can change independently of the right to see this task.
        const project = await tx.project.findUnique({ where: { id: contract.projectId }, select: { isActive: true } });
        if (!project?.isActive || !await readCurrentContract() || !await hasCurrentRole(tx)) return null;
        if (lifecycle?.status !== "ready") return true;
        const expectedState = seal ? "pending_seal" : "pending_archive";
        if (lifecycle.approvalInstanceId !== round.id || lifecycle.sealTaskId !== task.id ||
          lifecycle.state !== expectedState) return null;
        return !lifecycle.webWriteReleased || !(seal ? lifecycle.sealAction.enabled : lifecycle.archiveAction.enabled);
      }) : await hasCurrentRole(this.prisma) ? false : null;
      if (blocked === null) continue;
      const queue = blocked ? result.blocked : result.pending;
      queue.push({ id: `contract-v2-${seal ? "seal" : "archive"}:${version.id}`, type: blocked ? "blocker" : "archive", businessType: "contract_version", businessId: version.id,
        title: contract.name, projectName: names.get(contract.projectId) ?? "所属项目", businessCode: code,
        amountText: version.amountYuan === null ? "金额待确定" : `${version.amountYuan.toFixed(4)} 元`,
        currentNode: blocked ? (seal ? "盖章办理暂不可用" : "归档办理暂不可用") : (seal ? "确认已盖章" : "归档双方签章原件"),
        nextAction: blocked ? "查看合同详情并保留当前资料" : (seal ? "核对线下盖章完成后确认" : "上传双方签章PDF后直接归档生效"),
        [workItemNoticeAt]: version.updatedAt,
        stayedText: this.stayedText(version.updatedAt), targetPath: `/合同管理/${code}`, tone: blocked || seal ? "warning" : "primary" });
    }
    return result;
  }

  private async contractArchiveWorkItems(
    projectIds: string[],
    statuses: string[],
    projectNameById: ReadonlyMap<string, string>,
    currentNode: string,
    nextAction: string,
    tone: WorkbenchCardTone,
    actorUserId?: string,
    limit: number | undefined = 30
  ): Promise<WorkItem[]> {
    if (!projectIds.length) {
      return [];
    }

    const contracts = await this.prisma.contract.findMany({
      where: { projectId: { in: projectIds } },
      select: { id: true, projectId: true, code: true, temporaryCode: true, name: true }
    });
    const contractById = new Map(contracts.map((contract) => [contract.id, contract]));
    const versions = contracts.length
      ? await this.prisma.contractVersion.findMany({
          where: {
            contractId: { in: contracts.map((contract) => contract.id) },
            status: { in: statuses }
          },
          orderBy: { updatedAt: "desc" },
          ...(limit === undefined ? {} : { take: limit }),
          select: {
            id: true,
            contractId: true,
            amountCents: true, numericProtocolVersion: true, signingSubjectType: true,
            updatedAt: true,
            contractGovernanceVersion: true
          }
        })
      : [];
    const v2Exclusions = await this.contractV2LegacySigningExclusions(versions);
    const governedPendingIds = versions
      .filter((version) =>
        version.contractGovernanceVersion === 1 &&
        statuses.includes("pending_archive_confirm")
      )
      .map((version) => version.id);
    const ownFinalVersionIds = new Set(
      actorUserId && governedPendingIds.length
        ? (await this.prisma.contractFormalFile?.findMany?.({
            where: {
              contractVersionId: { in: governedPendingIds },
              purpose: "mutually_signed_final",
              status: "active",
              uploadedByUserId: actorUserId
            },
            select: { contractVersionId: true }
          }) ?? []).map((item) => item.contractVersionId)
        : []
    );

    return versions.flatMap((version) => {
      if (v2Exclusions.has(version.id)) return [];
      if (version.contractGovernanceVersion === 1 && statuses.includes("seal_approved_pending_archive")) {
        return [];
      }
      if (ownFinalVersionIds.has(version.id)) return [];
      const contract = contractById.get(version.contractId);
      if (!contract) {
        return [];
      }
      const code = contract.code ?? contract.temporaryCode ?? contract.id;
      return [
        {
          id: `contract-archive:${version.id}`,
          type: "archive",
          businessType: "contract_version",
          businessId: version.id,
          title: contract.name,
          projectName: projectNameById.get(contract.projectId) ?? contract.projectId,
          businessCode: code,
          amountText: this.amountText(version.amountCents),
          currentNode,
          [workItemNoticeAt]: version.updatedAt,
          stayedText: this.stayedText(version.updatedAt),
          nextAction,
          targetPath: `/合同管理/${code}`,
          tone
        }
      ];
    });
  }

  private async contractSealFinalUploadWorkItems(
    userId: string,
    projectNameById: ReadonlyMap<string, string>,
    limit: number | undefined = 30
  ): Promise<WorkItem[]> {
    const tasks = await this.prisma.contractSealTask?.findMany({
      where: { handlerUserId: userId, status: "completed" },
      orderBy: { updatedAt: "desc" },
      ...(limit === undefined ? {} : { take: limit })
    }) ?? [];
    if (!tasks.length) return [];
    const versions = await this.prisma.contractVersion.findMany({
      where: {
        id: { in: tasks.map((item) => item.contractVersionId) },
        status: "seal_approved_pending_archive"
      },
      select: { id: true, contractId: true, status: true, amountCents: true, numericProtocolVersion: true, signingSubjectType: true, updatedAt: true }
    });
    const v2Exclusions = await this.contractV2LegacySigningExclusions(versions);
    const contracts = versions.length ? await this.prisma.contract.findMany({
      where: {
        id: { in: [...new Set(versions.map((item) => item.contractId))] }
      },
      select: { id: true, projectId: true, code: true, temporaryCode: true, name: true }
    }) : [];
    const contractById = new Map(contracts.map((item) => [item.id, item]));
    return versions.flatMap((version) => {
      if (v2Exclusions.has(version.id)) return [];
      const contract = contractById.get(version.contractId);
      if (!contract) return [];
      const code = contract.code ?? contract.temporaryCode ?? contract.id;
      if (version.status !== "seal_approved_pending_archive") return [];
      return [{
        id: `contract-seal-handler:${version.id}`,
        type: "archive" as const,
        businessType: "contract_version",
        businessId: version.id,
        title: contract.name,
        projectName: projectNameById.get(contract.projectId) ?? contract.projectId,
        businessCode: code,
        amountText: this.amountText(version.amountCents),
        currentNode: "上传双方最终版",
        [workItemNoticeAt]: version.updatedAt,
        stayedText: this.stayedText(version.updatedAt),
        nextAction: "上传双方最终签署 PDF",
        targetPath: `/合同管理/${code}`,
        tone: "primary" as const
      }];
    });
  }

  private async contractFinalUploadSubstituteWorkItems(
    userId: string,
    visibleProjectIds: string[],
    projectNameById: ReadonlyMap<string, string>
  ): Promise<WorkItem[]> {
    if (!visibleProjectIds.length) return [];
    const directorPosition = await this.prisma.position?.findUnique?.({
      where: { key: "contract_director" },
      select: { id: true }
    });
    if (!directorPosition) return [];
    const assignments = await this.prisma.userPosition?.findMany?.({
      where: { projectId: null, positionId: directorPosition.id },
      select: { userId: true }
    }) ?? [];
    const activeDirectors = assignments.length ? await this.prisma.user?.findMany?.({
      where: { id: { in: assignments.map((item) => item.userId) }, isActive: true },
      select: { id: true }
    }) ?? [] : [];
    if (activeDirectors.length !== 1) return [];
    const memberships = await this.prisma.projectMember?.findMany?.({
      where: {
        userId,
        projectId: { in: visibleProjectIds },
        positionKey: "contract_staff"
      },
      select: { projectId: true }
    }) ?? [];
    const staffProjectIds = memberships.map((item) => item.projectId);
    if (!staffProjectIds.length) return [];
    const tasks = await this.prisma.contractSealTask?.findMany?.({
      where: { handlerUserId: activeDirectors[0].id, status: "completed" },
      select: { contractVersionId: true }
    }) ?? [];
    if (!tasks.length) return [];
    const versions = await this.prisma.contractVersion.findMany({
      where: {
        id: { in: tasks.map((item) => item.contractVersionId) },
        contractGovernanceVersion: 1,
        status: "seal_approved_pending_archive"
      },
      select: { id: true, contractId: true, amountCents: true, numericProtocolVersion: true, signingSubjectType: true, updatedAt: true }
    });
    const v2Exclusions = await this.contractV2LegacySigningExclusions(versions);
    const contracts = versions.length ? await this.prisma.contract.findMany({
      where: {
        id: { in: [...new Set(versions.map((item) => item.contractId))] },
        projectId: { in: staffProjectIds }
      },
      select: { id: true, projectId: true, code: true, temporaryCode: true, name: true }
    }) : [];
    const contractById = new Map(contracts.map((item) => [item.id, item]));
    return versions.flatMap((version) => {
      if (v2Exclusions.has(version.id)) return [];
      const contract = contractById.get(version.contractId);
      if (!contract) return [];
      const code = contract.code ?? contract.temporaryCode ?? contract.id;
      return [{
        id: `contract-final-substitute:${version.id}`,
        type: "archive" as const,
        businessType: "contract_version",
        businessId: version.id,
        title: contract.name,
        projectName: projectNameById.get(contract.projectId) ?? contract.projectId,
        businessCode: code,
        amountText: this.amountText(version.amountCents),
        currentNode: "上传双方最终版",
        [workItemNoticeAt]: version.updatedAt,
        stayedText: this.stayedText(version.updatedAt),
        nextAction: "代唯一合同主管上传双方最终签署 PDF",
        targetPath: `/合同管理/${code}`,
        tone: "primary" as const
      }];
    });
  }

  private async settlementArchiveWorkItems(
    projectIds: string[],
    statuses: string[],
    projectNameById: ReadonlyMap<string, string>,
    currentNode: string,
    nextAction: string,
    tone: WorkbenchCardTone,
    governanceMode?: "governed" | "legacy",
    unbounded = false
  ): Promise<WorkItem[]> {
    if (!projectIds.length) {
      return [];
    }

    const settlements = await this.prisma.settlement.findMany({
      where: {
        projectId: { in: projectIds },
        status: { in: statuses },
        ...(governanceMode === "governed"
          ? { governanceVersion: 1 }
          : governanceMode === "legacy"
            ? { governanceVersion: null }
            : {})
      },
      orderBy: { updatedAt: "desc" },
      ...(unbounded ? {} : { take: 30 }),
      select: {
        id: true,
        projectId: true,
        contractId: true,
        code: true,
        periodLabel: true,
        amountCents: true,
        governanceVersion: true,
        updatedAt: true
      }
    });
    const contracts = settlements.length
      ? await this.prisma.contract.findMany({
          where: { id: { in: [...new Set(settlements.map((settlement) => settlement.contractId))] } },
          select: { id: true, name: true }
        })
      : [];
    const contractById = new Map(contracts.map((contract) => [contract.id, contract]));

    return settlements.map((settlement) => ({
      id: `settlement-archive:${settlement.id}`,
      type: "archive",
      title: contractById.get(settlement.contractId)?.name ?? `结算 ${settlement.periodLabel}`,
      projectName: projectNameById.get(settlement.projectId) ?? settlement.projectId,
      businessCode: settlement.code,
      businessType: "settlement",
      businessId: settlement.id,
      amountText: this.amountText(settlement.amountCents),
      currentNode,
      [workItemNoticeAt]: settlement.updatedAt,
      stayedText: this.stayedText(settlement.updatedAt),
      nextAction,
      targetPath: `/结算管理/${settlement.code}`,
      tone
    }));
  }

  private async failedSettlementGenerationWorkItems(
    projectIds: string[],
    projectNameById: ReadonlyMap<string, string>,
    unbounded = false
  ): Promise<WorkItem[]> {
    if (!projectIds.length || !this.prisma.settlementSignedDocumentGenerationClaim) {
      return [];
    }
    // Restrict the parent business rows first; claim facts are only read for visible settlements.
    const settlements = await this.prisma.settlement.findMany({
      where: {
        projectId: { in: projectIds },
        governanceVersion: 1,
        status: "pending_generation"
      },
      orderBy: { updatedAt: "desc" },
      ...(unbounded ? {} : { take: 30 }),
      select: {
        id: true,
        projectId: true,
        contractId: true,
        code: true,
        periodLabel: true,
        amountCents: true,
        updatedAt: true
      }
    });
    if (!settlements.length) return [];
    const generationClaims = await this.prisma.settlementSignedDocumentGenerationClaim.findMany({
      where: {
        settlementId: { in: settlements.map((settlement) => settlement.id) }
      },
      select: {
        settlementId: true,
        status: true,
        claimedAt: true,
        uploadedFileId: true,
        safeFailureCode: true
      }
    });
    const claimBySettlementId = new Map(
      generationClaims.map((claim) => [claim.settlementId, claim])
    );
    const staleBefore = Date.now() - 5 * 60 * 1000;
    const failedSettlementIds = new Set(
      settlements
        .filter((settlement) => {
          const claim = claimBySettlementId.get(settlement.id);
          if (!claim) return true;
          if (claim.safeFailureCode) return true;
          if (claim.uploadedFileId && claim.status !== "completed") return true;
          return claim.status === "pending" && claim.claimedAt.getTime() < staleBefore;
        })
        .map((settlement) => settlement.id)
    );
    if (!failedSettlementIds.size) return [];
    const contracts = await this.prisma.contract.findMany({
      where: {
        id: {
          in: [
            ...new Set(
              settlements
                .filter((settlement) => failedSettlementIds.has(settlement.id))
                .map((settlement) => settlement.contractId)
            )
          ]
        }
      },
      select: { id: true, name: true }
    });
    const contractById = new Map(contracts.map((contract) => [contract.id, contract]));
    return settlements
      .filter((settlement) => failedSettlementIds.has(settlement.id))
      .map((settlement) => ({
        id: `settlement-generation-retry:${settlement.id}`,
        type: "archive" as const,
        title: contractById.get(settlement.contractId)?.name ?? `结算 ${settlement.periodLabel}`,
        projectName: projectNameById.get(settlement.projectId) ?? settlement.projectId,
        businessCode: settlement.code,
        businessType: "settlement",
        businessId: settlement.id,
        amountText: this.amountText(settlement.amountCents),
        currentNode: "最终结算文件生成失败",
        [workItemNoticeAt]: settlement.updatedAt,
        stayedText: this.stayedText(settlement.updatedAt),
        nextAction: "重试生成结算签名合成件",
        targetPath: `/结算管理/${settlement.code}`,
        tone: "danger" as const
      }));
  }

  private async attachIndependentApprovalReminders(userId: string, pending: WorkItem[], evaluatedAt: Date): Promise<WorkItem[]> {
    const reminders = await this.independentApprovals?.recentPendingReminders(userId, evaluatedAt) ?? [];
    const supplemental: WorkItem[] = [];
    for (const reminder of reminders) {
      const item = pending.find(candidate => candidate.businessId === reminder.businessId &&
        (candidate.businessType === reminder.kind
          || (reminder.kind === "settlement_archive" && candidate.id === `settlement-archive:${reminder.businessId}`)
          || (reminder.kind === "contract_archive" && candidate.businessType === "contract_version" &&
            candidate.id === `contract-archive:${reminder.businessId}` && candidate.currentNode === "确认合同归档")
          || (reminder.kind === "contract_seal" && candidate.businessType === "contract_version" &&
            candidate.id === `contract-archive:${reminder.businessId}` && ["待同意用章", "待确认用章"].includes(candidate.currentNode))));
      if (item) {
        item.reminderId = reminder.reminderId;
        if (!item[workItemNoticeAt] || reminder.remindedAt > item[workItemNoticeAt]) item[workItemNoticeAt] = reminder.remindedAt;
      } else {
        supplemental.push({
          id: `independent-notice:${reminder.id}`, type: "approval", businessType: reminder.kind, businessId: reminder.businessId,
          reminderId: reminder.reminderId, title: reminder.title, projectName: reminder.projectName, businessCode: reminder.businessCode,
          currentNode: reminder.currentNodeName, amountText: "", stayedText: "", nextAction: "查看审核进度",
          [workItemNoticeAt]: reminder.remindedAt,
          targetPath: `/审批中心?review=${encodeURIComponent(reminder.id)}`, tone: "warning"
        });
      }
    }
    return supplemental;
  }

  private async attachActiveApprovalReminders(userId: string, pending: WorkItem[], evaluatedAt: Date) {
    const targets = pending.flatMap<{ item: WorkItem; instanceId: string; dutyIndexes?: number[] }>(item => {
      const general = /^general-request-duty:([^:]+):(\d+)$/.exec(item.id);
      if (general) return [{ item, instanceId: general[1], dutyIndexes: [Number(general[2])] }];
      return item.id.startsWith("approval:") ? [{
        item, instanceId: item.id.slice("approval:".length), dutyIndexes: item[workItemExpenseDutyIndexes]
      }] : [];
    });
    if (!targets.length) return;
    const reminders = await this.prisma.approvalActionLog.findMany({
      where: {
        approvalInstanceId: { in: [...new Set(targets.map(target => target.instanceId))] },
        action: "remind",
        createdAt: { gte: new Date(evaluatedAt.getTime() - 24 * 60 * 60 * 1000) },
        AND: [
          { metadata: { path: ["kind"], equals: "sms_request" } },
          { metadata: { path: ["recipientIds"], array_contains: [userId] } }
        ]
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, approvalInstanceId: true, metadata: true, createdAt: true }
    });
    for (const { item, instanceId, dutyIndexes: itemDutyIndexes } of targets) {
      const reminder = reminders.find(row => {
        if (row.approvalInstanceId !== instanceId || !row.metadata || typeof row.metadata !== "object" || Array.isArray(row.metadata)) return false;
        const { kind, recipientIds, dutyIndexes, reimbursementDutiesByRecipient } = row.metadata;
        if (kind !== "sms_request" || !Array.isArray(recipientIds) || !recipientIds.includes(userId)) return false;
        if (!itemDutyIndexes) return true;
        const recipientDuties = reimbursementDutiesByRecipient && typeof reimbursementDutiesByRecipient === "object" &&
          !Array.isArray(reimbursementDutiesByRecipient) ? reimbursementDutiesByRecipient[userId] : dutyIndexes;
        return Array.isArray(recipientDuties) && itemDutyIndexes.some(index => recipientDuties.includes(index));
      });
      if (reminder && (!item.reminderId || !item[workItemNoticeAt] || reminder.createdAt >= item[workItemNoticeAt])) {
        item.reminderId = reminder.id;
        if (!item[workItemNoticeAt] || reminder.createdAt > item[workItemNoticeAt]) item[workItemNoticeAt] = reminder.createdAt;
      }
    }
  }

  private async approvalWorkItems(
    scopes: ProjectRoleScope[],
    userId: string,
    mode: "pending" | "started" | "delegated",
    evaluatedAt: Date,
    scope?: "contract"
  ): Promise<WorkItem[]> {
    const instances = (await this.prisma.approvalInstance.findMany({
      where: {
        ...(scope === "contract" ? { businessType: { in: ["contract_version", "contract_work_completion"] }, status: "in_progress" } : this.activeApprovalWhere()),
        ...(mode === "started" ? { applicantUserId: userId } : {})
      },
      orderBy: { updatedAt: "desc" },
    })) as ApprovalInstanceForWorkItem[];
    const roleKeysByProject = new Map(scopes.map((scope) => [scope.projectId, scope.roleKeys]));
    const details = await this.approvalBusinessDetails(instances);
    const applicantNames = await this.applicantNamesById(instances.map(instance => instance.applicantUserId));
    const items: WorkItem[] = [];
    const expenseActors = new Map<string | null, Promise<ApprovalActorRoleScopes | null>>();

    for (const instance of instances) {
      const detail = details.get(`${instance.businessType}:${instance.businessId}`);
      if (detail?.requestProtocolVersion === 2) continue;
      if (mode !== "started" && (detail?.historicalEmployeeLoan || isLegacySettlementApproval(instance))) continue;
      const expenseApproval = detail?.expenseApproval;
      let expenseDuties: number[] | undefined;
      if (detail && expenseApproval) {
        if (mode === "delegated" || !this.isCurrentExpenseRound(instance, expenseApproval)) continue;
        expenseDuties = mode === "pending" ? await this.expenseDutyIndexes(instance, detail.projectId, userId, expenseActors)
          : activeApprovalNodeIndexes(instance.frozenNodes, instance.currentNodeIndex);
        if (expenseDuties.length === 0) continue;
      }
      const currentContractDuty = mode === "pending" && detail?.contractApprovalVersion !== undefined;
      const currentContractNode = currentContractDuty ? await this.currentContractApprovalTodo(instance, detail, userId) : null;
      if (currentContractDuty && !currentContractNode) continue;
      const scopedDelegateNode = detail ? await this.scopedSpotDelegateNode(instance, detail.projectId ?? undefined, userId) : null;
      const scopedContractNode = detail ? await this.scopedContractDutyNode(instance, detail.projectId ?? undefined, userId) : null;
      const delegatedNode = scopedDelegateNode ?? scopedContractNode;
      const node = currentContractNode ?? (expenseDuties && Array.isArray(instance.frozenNodes)
        ? instance.frozenNodes[expenseDuties[0]] as ApprovalNode
        : this.currentApprovalNode(instance.frozenNodes, instance.currentNodeIndex, roleKeysByProject.get(detail?.projectId ?? "") ?? []) ?? delegatedNode);
      if (!detail || !node) {
        continue;
      }
      const roleKeys = (detail.projectId ? roleKeysByProject.get(detail.projectId) : undefined) ?? [];
      const supportsIndirect = this.supportsIndirectApproval(instance.businessType);
      const hasRoleTodo = currentContractDuty || (expenseApproval ? mode === "pending" : ["general_procurement", "expense_claim"].includes(instance.businessType)
        ? await this.canActOnProcurementNode(node, userId, detail.projectId)
        : supportsIndirect ? this.canActOnApprovalNode(node, roleKeys, userId) : this.hasDirectRoleTodo(node, roleKeys));
      const hasDirectTodo =
        hasRoleTodo &&
        this.canShowSpotApplicantTodo(instance, node, roleKeys, userId);
      const hasDelegatedTodo = Boolean(delegatedNode) || (
        mode === "started" || !supportsIndirect || hasDirectTodo
          ? false
          : await this.hasDelegatedApprovalTodo(userId, detail.projectId ?? "", node, evaluatedAt));
      if (mode === "pending" && !hasDirectTodo && !hasDelegatedTodo) {
        continue;
      }
      if (mode === "delegated" && !this.hasAssignmentTodo(node, userId) && !hasDelegatedTodo) {
        continue;
      }
      if (mode === "delegated" && !supportsIndirect && !delegatedNode) {
        continue;
      }

      items.push({
        id: `approval:${instance.id}`,
        type: "approval",
        title: detail.title,
        projectName: detail.projectName,
        projectId: detail.projectId ?? undefined,
        businessCode: detail.businessCode,
        businessType: instance.businessType,
        businessId: instance.businessId,
        amountText: detail.amountCents == null ? "预计金额待明确" : this.amountText(detail.amountCents),
        currentNode: expenseDuties && Array.isArray(instance.frozenNodes)
          ? expenseDuties.map(index => this.approvalNodeName((instance.frozenNodes as ApprovalNode[])[index])).join("、")
          : this.approvalNodeName(node),
        ...(mode === "pending" && expenseDuties ? { [workItemExpenseDutyIndexes]: expenseDuties } : {}),
        [workItemNoticeAt]: instance.updatedAt,
        stayedText: this.stayedText(instance.updatedAt),
        nextAction: mode === "started" ? "查看审批进度" : "处理当前审批",
        targetPath: detail.targetPath,
        tone: mode === "started" ? "primary" : "warning",
        applicantName: applicantNames.get(instance.applicantUserId),
        businessStatus: instance.status,
        overdue: isApprovalOverdue(instance.updatedAt, evaluatedAt),
        canHandle: mode !== "started",
        parallelCompletion: this.parallelCompletion(instance.frozenNodes)
      });
    }

    if (scope !== "contract") {
      items.push(...await generalRequestWorkItems(this.prisma as Prisma.TransactionClient, new ProjectVisibilityService(this.prisma), userId, mode));
      items.push(...await fundReviewWorkItems(this.prisma, userId, mode));
      items.push(...await principalReturnWorkItems(this.prisma, userId, mode));
    }
    return items;
  }

  private async handledApprovalWorkItems(
    scopes: ProjectRoleScope[],
    userId: string
  ): Promise<WorkItem[]> {
    const logs = await this.prisma.approvalActionLog.findMany({
      where: { actorUserId: userId },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: { id: true, approvalInstanceId: true, action: true, createdAt: true }
    });
    const approvalInstanceIds = [...new Set(logs.map((log) => log.approvalInstanceId))];
    if (!approvalInstanceIds.length) {
      return [];
    }

    const instances = (await this.prisma.approvalInstance.findMany({
      where: {
        id: { in: approvalInstanceIds },
        businessType: { in: [...RELEVANT_APPROVAL_TYPES] }
      }
    })) as ApprovalInstanceForWorkItem[];
    const instanceById = new Map(instances.map((instance) => [instance.id, instance]));
    const visibleProjectIds = new Set(scopes.map((scope) => scope.projectId));
    const details = await this.approvalBusinessDetails(instances);
    const applicantNames = await this.applicantNamesById(instances.map(instance => instance.applicantUserId));
    const evaluatedAt = new Date();
    const seen = new Set<string>();
    const items: WorkItem[] = [];

    for (const log of logs) {
      if (seen.has(log.approvalInstanceId)) {
        continue;
      }
      const instance = instanceById.get(log.approvalInstanceId);
      const detail = instance
        ? details.get(`${instance.businessType}:${instance.businessId}`)
        : undefined;
      if (!instance || !detail) continue;
      const companyReimbursementAction = detail.expenseApproval?.countKey === "reimbursement" && detail.projectId === null &&
        instance.flowType === "expense_claim.approve" && ["approve", "reject"].includes(log.action);
      if (!companyReimbursementAction && (detail.projectId == null || !visibleProjectIds.has(detail.projectId))) continue;
      seen.add(log.approvalInstanceId);
      items.push({
        id: `handled-approval:${log.id}`,
        type: "approval",
        title: detail.title,
        projectName: detail.projectName,
        projectId: detail.projectId ?? undefined,
        businessCode: detail.businessCode,
        businessType: instance.businessType,
        businessId: instance.businessId,
        amountText: detail.amountCents == null ? "预计金额待明确" : this.amountText(detail.amountCents),
        currentNode: `已处理：${this.approvalActionLabel(log.action)}`,
        stayedText: this.stayedText(log.createdAt),
        nextAction: "查看业务详情",
        targetPath: detail.targetPath,
        tone: "success",
        applicantName: applicantNames.get(instance.applicantUserId),
        businessStatus: instance.status,
        overdue: isApprovalOverdue(instance.updatedAt, evaluatedAt),
        canHandle: false,
        parallelCompletion: this.parallelCompletion(instance.frozenNodes)
      });
      if (items.length >= 30) {
        break;
      }
    }

    return items;
  }

  private async approvalBusinessDetails(instances: ApprovalInstanceForWorkItem[]) {
    const result = new Map<string, ApprovalBusinessDetail>();
    const generalIds = instances.filter((instance) => instance.businessType === "general_procurement").map((instance) => instance.businessId);
    const generalRows = generalIds.length ? await this.prisma.generalProcurement.findMany({ where: { id: { in: generalIds } } }) : [];
    const procurementProjectNames = await this.projectNames(generalRows.flatMap(row => row.projectId ? [row.projectId] : []));
    for (const row of generalRows) result.set(`general_procurement:${row.id}`, { requestProtocolVersion: row.requestProtocolVersion, projectId: row.projectId, projectName: row.projectId ? procurementProjectNames.get(row.projectId) ?? "所属项目" : "公司日常",
      businessCode: row.code, title: `综合采购申请：${row.reason || "详见采购清单"}`, amountCents: row.requestedAmountCents, targetPath: `/综合采购申请/${row.id}` });
    for (const [key, detail] of await this.expenseApprovalDetails(instances)) result.set(key, detail);
    const completionIds = instances.filter((instance) => instance.businessType === "contract_work_completion").map((instance) => instance.businessId);
    const completions = completionIds.length ? await this.prisma.contractWorkCompletion.findMany({
      where: { id: { in: completionIds } }, select: { id: true, contractVersionId: true, work: true, amountYuan: true }
    }) : [];
    if (completions.length) {
      const versions = await this.prisma.contractVersion.findMany({ where: { id: { in: [...new Set(completions.map(row => row.contractVersionId))] } },
        select: { id: true, contractId: true } });
      const contractIds = [...new Set(versions.map(row => row.contractId))];
      const contracts = contractIds.length ? await this.prisma.contract.findMany({ where: { id: { in: contractIds } },
        select: { id: true, projectId: true, code: true } }) : [];
      const projects = await this.projectNames(contracts.map(row => row.projectId));
      const contractById = new Map(contracts.map(row => [row.id, row]));
      const versionById = new Map(versions.map(row => [row.id, row]));
      for (const row of completions) {
        const contract = contractById.get(versionById.get(row.contractVersionId)?.contractId ?? "");
        if (!contract?.code) continue;
        result.set(`contract_work_completion:${row.id}`, { projectId: contract.projectId,
          projectName: projects.get(contract.projectId) ?? "所属项目", businessCode: contract.code,
          title: `履约确认：${row.work}`,
          amountCents: BigInt(new Prisma.Decimal(row.amountYuan.toString()).times(100).toFixed(0)),
          targetPath: approvalDutyTarget("contract", contract.code) });
      }
    }
    const contractVersionIds = instances
      .filter((instance) => instance.businessType === "contract_version")
      .map((instance) => instance.businessId);
    const settlementIds = instances
      .filter((instance) => instance.businessType === "settlement")
      .map((instance) => instance.businessId);
    const paymentIds = instances
      .filter((instance) => instance.businessType === "payment_request")
      .map((instance) => instance.businessId);
    const expenseIds = instances
      .filter((instance) => instance.businessType === "project_expense_request")
      .map((instance) => instance.businessId);
    const spotVersionIds = instances
      .filter((instance) => instance.businessType === "spot_procurement_version")
      .map((instance) => instance.businessId);
    const spotPaymentIds = instances
      .filter((instance) => instance.businessType === "spot_procurement_payment")
      .map((instance) => instance.businessId);

    const [versions, settlements, payments, expenses, spotVersions, spotPayments] = await Promise.all([
      contractVersionIds.length
        ? this.prisma.contractVersion.findMany({
            where: { id: { in: contractVersionIds } },
            select: { id: true, contractId: true, amountCents: true, numericProtocolVersion: true, status: true,
              documentContentRevision: true, documentContentFingerprint: true }
          })
        : Promise.resolve([]),
      settlementIds.length
        ? this.prisma.settlement.findMany({
            where: { id: { in: settlementIds } },
            select: { id: true, projectId: true, contractId: true, code: true, periodLabel: true, amountCents: true }
          })
        : Promise.resolve([]),
      paymentIds.length
        ? this.prisma.paymentRequest.findMany({
            where: { id: { in: paymentIds } },
            select: { id: true, projectId: true, contractId: true, code: true, requestedAmountCents: true }
          })
        : Promise.resolve([]),
      expenseIds.length
        ? this.prisma.projectExpenseRequest.findMany({
            where: { id: { in: expenseIds } },
            select: {
              id: true,
              projectId: true,
              code: true,
              expenseType: true,
              expenseSubtype: true,
              paymentSubject: true,
              requestedAmountCents: true
            }
          })
        : Promise.resolve([]),
      spotVersionIds.length
        ? this.prisma.spotProcurementVersion.findMany({
            where: { id: { in: spotVersionIds } },
            select: {
              id: true,
              procurementId: true,
              totalAmountCents: true,
              supplierNameSnapshot: true
            }
          })
        : Promise.resolve([]),
      spotPaymentIds.length
        ? this.prisma.spotProcurementPayment.findMany({
            where: { id: { in: spotPaymentIds } },
            select: {
              id: true,
              projectId: true,
              procurementId: true,
              code: true,
              settlementAmountCents: true,
              payeeNameSnapshot: true
            }
          })
        : Promise.resolve([])
    ]);
    const contractIds = [
      ...versions.map((version) => version.contractId),
      ...settlements.map((settlement) => settlement.contractId),
      ...payments.map((payment) => payment.contractId)
    ];
    const contracts = contractIds.length
      ? await this.prisma.contract.findMany({
          where: { id: { in: [...new Set(contractIds)] } },
          select: { id: true, projectId: true, code: true, temporaryCode: true, name: true, counterparty: true, voidedAt: true }
        })
      : [];
    const contractById = new Map(contracts.map((contract) => [contract.id, contract]));
    const spotProcurementIds = [
      ...spotVersions.map((version) => version.procurementId),
      ...spotPayments.map((payment) => payment.procurementId)
    ];
    const spotProcurements = spotProcurementIds.length
      ? await this.prisma.spotProcurement.findMany({
          where: { id: { in: [...new Set(spotProcurementIds)] } },
          select: {
            id: true,
            projectId: true,
            code: true,
            supplierNameSnapshot: true
          }
        })
      : [];
    const spotProcurementById = new Map(spotProcurements.map((row) => [row.id, row]));
    const projectNames = await this.projectNames([
      ...contracts.map((contract) => contract.projectId),
      ...settlements.map((settlement) => settlement.projectId),
      ...payments.map((payment) => payment.projectId),
      ...expenses.map((expense) => expense.projectId),
      ...spotProcurements.map((procurement) => procurement.projectId),
      ...spotPayments.map((payment) => payment.projectId)
    ]);

    for (const version of versions) {
      const contract = contractById.get(version.contractId);
      if (!contract) continue;
      const code = contract.code ?? contract.temporaryCode ?? contract.id;
      result.set(`contract_version:${version.id}`, {
        projectId: contract.projectId,
        projectName: projectNames.get(contract.projectId) ?? contract.projectId,
        businessCode: code,
        title: `合同审批：${contract.name}`,
        amountCents: version.amountCents,
        ...(version.numericProtocolVersion === 2 ? { contractApprovalVersion: {
          status: contract.voidedAt ? "voided" : version.status,
          documentContentRevision: version.documentContentRevision,
          documentContentFingerprint: version.documentContentFingerprint
        } } : {}),
        targetPath: `/合同管理/${code}`
      });
    }
    for (const settlement of settlements) {
      const contract = contractById.get(settlement.contractId);
      result.set(`settlement:${settlement.id}`, {
        projectId: settlement.projectId,
        projectName: projectNames.get(settlement.projectId) ?? settlement.projectId,
        businessCode: settlement.code,
        title: `结算审批：${contract?.name ?? settlement.periodLabel}`,
        amountCents: settlement.amountCents,
        targetPath: `/结算管理/${settlement.code}`
      });
    }
    for (const payment of payments) {
      const contract = contractById.get(payment.contractId);
      result.set(`payment_request:${payment.id}`, {
        projectId: payment.projectId,
        projectName: projectNames.get(payment.projectId) ?? payment.projectId,
        businessCode: payment.code,
        title: `付款审批：${contract?.name ?? payment.code}`,
        amountCents: payment.requestedAmountCents,
        targetPath: `/付款管理/${payment.code}`
      });
    }
    for (const expense of expenses) {
      result.set(`project_expense_request:${expense.id}`, {
        historicalEmployeeLoan: isRetiredProjectEmployeeLoan(expense),
        projectId: expense.projectId,
        projectName: projectNames.get(expense.projectId) ?? expense.projectId,
        businessCode: expense.code,
        title: `${projectExpenseApprovalTitle(expense.expenseType)}：${expense.paymentSubject}`,
        amountCents: expense.requestedAmountCents,
        targetPath: `/项目支出/${expense.projectId}/${expense.id}`
      });
    }
    for (const version of spotVersions) {
      const procurement = spotProcurementById.get(version.procurementId);
      if (!procurement) continue;
      result.set(`spot_procurement_version:${version.id}`, {
        projectId: procurement.projectId,
        projectName: projectNames.get(procurement.projectId) ?? procurement.projectId,
        businessCode: procurement.code,
        title: `零星采购审批：${procurement.code}`,
        amountCents: version.totalAmountCents ?? 0n,
        targetPath: `/零星采购/${procurement.id}`
      });
    }
    for (const payment of spotPayments) {
      const procurement = spotProcurementById.get(payment.procurementId);
      result.set(`spot_procurement_payment:${payment.id}`, {
        projectId: payment.projectId,
        projectName: projectNames.get(payment.projectId) ?? payment.projectId,
        businessCode: payment.code,
        title: `零星材料付款审批：${payment.payeeNameSnapshot || procurement?.supplierNameSnapshot || payment.code}`,
        amountCents: payment.settlementAmountCents,
        targetPath: `/零星材料付款/${payment.id}`
      });
    }

    return result;
  }

  private countTakeovers(projectIds: string[], where: Prisma.ContractTakeoverWhereInput) {
    return this.prisma.contractTakeover.count({
      where: {
        projectId: { in: projectIds },
        ...where
      }
    });
  }

  private parallelCompletion(frozenNodes: unknown): { completed: number; total: number } | undefined {
    if (!isParallelApprovalRound(frozenNodes)) return undefined;
    return {
      completed: frozenNodes.filter(node => isApprovalDutyComplete(node)).length,
      total: frozenNodes.length
    };
  }

  private async applicantNamesById(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
    const unique = Array.from(new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0)));
    if (!unique.length || typeof this.prisma.user?.findMany !== "function") return new Map();
    const users = await this.prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
    return new Map(users.map(user => [user.id, user.name]));
  }

  private async hasCompanyExpenseApprovalRole(userId: string) {
    const assignments = await this.prisma.userPosition.findMany({ where: { userId, projectId: null }, select: { positionId: true } });
    if (!assignments.length) return false;
    const positions = await this.prisma.position.findMany({ where: { id: { in: assignments.map(row => row.positionId) } }, select: { key: true } });
    return canPerform("expense_claim.approve", positions.map(row => row.key as RoleKey));
  }

  private async expenseApprovalDetails(instances: ReadonlyArray<Pick<ApprovalInstanceForWorkItem, "businessType" | "businessId">>, expenseOnly = false) {
    const result = new Map<string, ApprovalBusinessDetail>();
    const claimIds = instances.filter(instance => instance.businessType === "expense_claim").map(instance => instance.businessId);
    if (!claimIds.length) return result;
    const claimRows = await this.prisma.expenseClaim.findMany({
      where: { id: { in: claimIds }, OR: [pureExpenseReimbursementWhere, projectIncidentalExpenseWhere,
        ...(!expenseOnly ? [{ generalProcurementId: { not: null } }] : [])] },
      select: { id: true, projectId: true, code: true, reason: true, requestedAmountCents: true,
        claimType: true, generalProcurementId: true, actualPurchaseBatchId: true, approvalInstanceId: true, status: true }
    });
    const projectNames = await this.projectNames(claimRows.flatMap(row => row.projectId ? [row.projectId] : []));
    for (const row of claimRows) {
      const pure = isPureExpenseReimbursement(row);
      if (!pure && !row.projectId) continue;
      const title = pure ? "报销审批" : row.generalProcurementId ? "综合采购付款" : "零星费用审批";
      const countKey = pure ? "reimbursement" : row.generalProcurementId ? "procurementPayment" : "incidentalExpense";
      result.set(`expense_claim:${row.id}`, {
        projectId: row.projectId, projectName: row.projectId ? projectNames.get(row.projectId) ?? "所属项目" : "公司日常",
        businessCode: row.code, title: `${title}：${row.reason}`,
        amountCents: row.requestedAmountCents, targetPath: `/费用与报销/${encodeURIComponent(row.id)}`,
        ...(supportsExpenseParallelApproval(row) ? {
          expenseApproval: { status: row.status, approvalInstanceId: row.approvalInstanceId, countKey }
        } : {})
      });
    }
    return result;
  }

  private isCurrentExpenseRound(instance: Pick<ApprovalInstanceForWorkItem, "id" | "flowType" | "status">,
    expense: NonNullable<ApprovalBusinessDetail["expenseApproval"]>) {
    return instance.flowType === "expense_claim.approve" && instance.status === "in_progress" &&
      expense.status === "approval_pending" && expense.approvalInstanceId === instance.id;
  }

  private async expenseDutyIndexes(instance: Pick<ApprovalInstanceForWorkItem, "frozenNodes" | "currentNodeIndex">,
    projectId: string | null, userId: string, actors: Map<string | null, Promise<ApprovalActorRoleScopes | null>>) {
    if (!Array.isArray(instance.frozenNodes)) return [];
    const nodes: unknown[] = instance.frozenNodes;
    const parallel = isParallelApprovalRound(nodes);
    let actor = actors.get(projectId);
    if (!actor) {
      actor = generalRequestActor(this.prisma, new ProjectVisibilityService(this.prisma), userId, projectId).catch(error => {
        if (error instanceof ForbiddenException) return null;
        throw error;
      });
      actors.set(projectId, actor);
    }
    const scopes = await actor;
    if (!scopes) return [];
    return activeApprovalNodeIndexes(nodes, instance.currentNodeIndex).filter(index => {
      const node = nodes[index];
      if (!node || typeof node !== "object" || Array.isArray(node)) return false;
      if (parallel) return Boolean(resolveExpenseParallelDutyIdentity({ node, actorUserId: userId, actorRoleScopes: scopes }));
      const identity = resolveApprovalReviewIdentity({
        node, actorUserId: userId, actorRoleKeys: [...scopes.globalRoleKeys, ...scopes.projectRoleKeys], actorRoleScopes: scopes
      });
      return identity?.representedUserId === userId && !identity.viaAssignment;
    });
  }

  private async countApprovalTodos(scopes: ProjectRoleScope[], userId: string, expenseOnly = false) {
    const evaluatedAt = new Date();
    const roleKeysByProject = new Map(scopes.map((scope) => [scope.projectId, scope.roleKeys]));
    const instances = await this.prisma.approvalInstance.findMany({
      where: {
        ...(expenseOnly ? { businessType: "expense_claim", status: "in_progress" } : this.activeApprovalWhere())
      }
    });
    const expenseDetails = await this.expenseApprovalDetails(instances, expenseOnly);
    const expenseActors = new Map<string | null, Promise<ApprovalActorRoleScopes | null>>();
    const businessProjectIds = expenseOnly ? new Map<string, string>() : await this.approvalBusinessProjectIds(instances);
    const counts = {
      contract: 0,
      settlement: 0,
      payment: 0,
      expense: 0,
      spotProcurement: 0,
      spotPayment: 0,
      procurement: 0,
      procurementPayment: 0,
      reimbursement: 0,
      incidentalExpense: 0,
      total: 0
    };

    for (const instance of instances) {
      if (isLegacySettlementApproval(instance)) continue;
      const expense = expenseDetails.get(`${instance.businessType}:${instance.businessId}`);
      if (expense?.expenseApproval) {
        if (this.isCurrentExpenseRound(instance, expense.expenseApproval) &&
          (await this.expenseDutyIndexes(instance, expense.projectId, userId, expenseActors)).length) {
          counts[expense.expenseApproval.countKey] += 1;
          counts.total += 1;
        }
        continue;
      }
      if (expenseOnly) continue;
      const projectId = expense?.projectId ?? businessProjectIds.get(`${instance.businessType}:${instance.businessId}`);
      if (!projectId) {
        continue;
      }
      const roleKeys = roleKeysByProject.get(projectId) ?? [];

      const scopedDelegateNode = await this.scopedSpotDelegateNode(instance, projectId, userId)
        ?? await this.scopedContractDutyNode(instance, projectId, userId);
      const currentNode = this.currentApprovalNode(
        instance.frozenNodes,
        instance.currentNodeIndex,
        roleKeys
      ) ?? scopedDelegateNode;
      if (!currentNode) {
        continue;
      }
      const supportsIndirect = this.supportsIndirectApproval(instance.businessType);
      const hasRoleTodo = ["general_procurement", "expense_claim"].includes(instance.businessType)
        ? await this.canActOnProcurementNode(currentNode, userId, projectId)
        : supportsIndirect ? this.canActOnApprovalNode(currentNode, roleKeys, userId) : this.hasDirectRoleTodo(currentNode, roleKeys);
      const hasDirectTodo =
        hasRoleTodo &&
        this.canShowSpotApplicantTodo(instance, currentNode, roleKeys, userId);
      const hasDelegatedTodo = Boolean(scopedDelegateNode) || (
        supportsIndirect && !hasDirectTodo
          ? await this.hasDelegatedApprovalTodo(
              userId,
              projectId,
              currentNode,
              evaluatedAt
            )
          : false);
      if (!hasDirectTodo && !hasDelegatedTodo) {
        continue;
      }

      if (instance.businessType === "contract_version" || instance.businessType === "contract_work_completion") counts.contract += 1;
      if (instance.businessType === "settlement") counts.settlement += 1;
      if (instance.businessType === "payment_request") counts.payment += 1;
      if (instance.businessType === "project_expense_request") counts.expense += 1;
      if (instance.businessType === "spot_procurement_version") counts.spotProcurement += 1;
      if (instance.businessType === "spot_procurement_payment") counts.spotPayment += 1;
      if (instance.businessType === "general_procurement") counts.procurement += 1;
      if (instance.businessType === "expense_claim") counts.procurementPayment += 1;
      counts.total += 1;
    }

    if (!expenseOnly) {
      const generalDuties = await generalRequestWorkItems(this.prisma as Prisma.TransactionClient, new ProjectVisibilityService(this.prisma), userId);
      counts.procurement += generalDuties.length;
      counts.total += generalDuties.length;
    }
    return counts;
  }

  private async approvalBusinessProjectIds(
    instances: Array<{ businessType: string; businessId: string }>
  ) {
    const ids = new Map<string, string>();
    const contractVersionIds = instances
      .filter((instance) => instance.businessType === "contract_version")
      .map((instance) => instance.businessId);
    const completionIds = instances
      .filter((instance) => instance.businessType === "contract_work_completion")
      .map((instance) => instance.businessId);
    const settlementIds = instances
      .filter((instance) => instance.businessType === "settlement")
      .map((instance) => instance.businessId);
    const paymentIds = instances
      .filter((instance) => instance.businessType === "payment_request")
      .map((instance) => instance.businessId);
    const expenseIds = instances
      .filter((instance) => instance.businessType === "project_expense_request")
      .map((instance) => instance.businessId);
    const spotVersionIds = instances
      .filter((instance) => instance.businessType === "spot_procurement_version")
      .map((instance) => instance.businessId);
    const spotPaymentIds = instances
      .filter((instance) => instance.businessType === "spot_procurement_payment")
      .map((instance) => instance.businessId);

    const procurementIds = instances.filter((instance) => instance.businessType === "general_procurement").map((instance) => instance.businessId);
    const completions = completionIds.length ? await this.prisma.contractWorkCompletion.findMany({
      where: { id: { in: completionIds } }, select: { id: true, contractVersionId: true }
    }) : [];
    const completionVersionIds = [...new Set(completions.map((row) => row.contractVersionId))];
    const completionVersions = completionVersionIds.length ? await this.prisma.contractVersion.findMany({
      where: { id: { in: completionVersionIds } }, select: { id: true, contractId: true }
    }) : [];
    const completionContracts = completionVersions.length ? await this.prisma.contract.findMany({
      where: { id: { in: [...new Set(completionVersions.map((row) => row.contractId))] } }, select: { id: true, projectId: true }
    }) : [];
    const contractIdByCompletionVersionId = new Map(completionVersions.map((row) => [row.id, row.contractId]));
    const projectIdByCompletionContractId = new Map(completionContracts.map((row) => [row.id, row.projectId]));
    for (const completion of completions) {
      const contractId = contractIdByCompletionVersionId.get(completion.contractVersionId);
      const projectId = contractId ? projectIdByCompletionContractId.get(contractId) : undefined;
      if (projectId) ids.set(`contract_work_completion:${completion.id}`, projectId);
    }
    const [versions, settlements, payments, expenses, spotVersions, spotPayments, procurements] = await Promise.all([
      contractVersionIds.length
        ? this.prisma.contractVersion.findMany({
            where: { id: { in: contractVersionIds } },
            select: { id: true, contractId: true }
          })
        : Promise.resolve([]),
      settlementIds.length
        ? this.prisma.settlement.findMany({
            where: { id: { in: settlementIds } },
            select: { id: true, projectId: true }
          })
        : Promise.resolve([]),
      paymentIds.length
        ? this.prisma.paymentRequest.findMany({
            where: { id: { in: paymentIds } },
            select: { id: true, projectId: true }
          })
        : Promise.resolve([]),
      expenseIds.length
        ? this.prisma.projectExpenseRequest.findMany({
            where: { id: { in: expenseIds } },
            select: { id: true, projectId: true, expenseType: true, expenseSubtype: true }
          })
        : Promise.resolve([]),
      spotVersionIds.length
        ? this.prisma.spotProcurementVersion.findMany({
            where: { id: { in: spotVersionIds } },
            select: { id: true, procurementId: true }
          })
        : Promise.resolve([]),
      spotPaymentIds.length
        ? this.prisma.spotProcurementPayment.findMany({
            where: { id: { in: spotPaymentIds } },
            select: { id: true, projectId: true }
          })
        : Promise.resolve([]),
      procurementIds.length ? this.prisma.generalProcurement.findMany({ where: { id: { in: procurementIds } }, select: { id: true, projectId: true, requestProtocolVersion: true } }) : Promise.resolve([])
    ]);
    const [contracts, spotProcurements] = await Promise.all([
      versions.length
        ? this.prisma.contract.findMany({
            where: { id: { in: [...new Set(versions.map((version) => version.contractId))] } },
            select: { id: true, projectId: true }
          })
        : Promise.resolve([]),
      spotVersions.length
        ? this.prisma.spotProcurement.findMany({
            where: {
              id: { in: [...new Set(spotVersions.map((version) => version.procurementId))] }
            },
            select: { id: true, projectId: true }
          })
        : Promise.resolve([])
    ]);
    const projectIdByContractId = new Map(contracts.map((contract) => [contract.id, contract.projectId]));
    const projectIdBySpotProcurementId = new Map(
      spotProcurements.map((procurement) => [procurement.id, procurement.projectId])
    );

    for (const version of versions) {
      const projectId = projectIdByContractId.get(version.contractId);
      if (projectId) ids.set(`contract_version:${version.id}`, projectId);
    }
    for (const settlement of settlements) ids.set(`settlement:${settlement.id}`, settlement.projectId);
    for (const payment of payments) ids.set(`payment_request:${payment.id}`, payment.projectId);
    for (const expense of expenses) {
      if (!isRetiredProjectEmployeeLoan(expense)) ids.set(`project_expense_request:${expense.id}`, expense.projectId);
    }
    for (const version of spotVersions) {
      const projectId = projectIdBySpotProcurementId.get(version.procurementId);
      if (projectId) ids.set(`spot_procurement_version:${version.id}`, projectId);
    }
    for (const payment of spotPayments) {
      ids.set(`spot_procurement_payment:${payment.id}`, payment.projectId);
    }

    for (const row of procurements) if (row.projectId && row.requestProtocolVersion !== 2) ids.set(`general_procurement:${row.id}`, row.projectId);

    return ids;
  }

  private async scopedSpotDelegateNode(instance: {id: string; businessType: string; status: string; frozenNodes: unknown; currentNodeIndex: number}, projectId: string | undefined, userId: string): Promise<ApprovalNode | null> {
    if (instance.businessType !== "spot_procurement_version" || !projectId) return null;
    const indexes = await scopedSpotDutyNodeIndexes(this.prisma as never, instance, projectId, userId);
    return indexes.length && Array.isArray(instance.frozenNodes) ? instance.frozenNodes[indexes[0]] as ApprovalNode : null;
  }

  /** 并联合同履约职责：被委托人可能不持有冻结岗位，按全局委托解析其当前可办节点。 */
  private async scopedContractDutyNode(instance: {businessType: string; status: string; frozenNodes: unknown; currentNodeIndex: number},
    projectId: string | undefined, userId: string): Promise<ApprovalNode | null> {
    if (instance.businessType !== "contract_work_completion" || !projectId || !isParallelApprovalRound(instance.frozenNodes)) return null;
    for (const index of activeApprovalNodeIndexes(instance.frozenNodes, instance.currentNodeIndex)) {
      const node = instance.frozenNodes[index] as ApprovalNode;
      if (await this.hasDelegatedApprovalTodo(userId, projectId, node, new Date())) return node;
    }
    return null;
  }

  private async currentContractApprovalTodo(instance: ApprovalInstanceForWorkItem, detail: ApprovalBusinessDetail, userId: string) {
    const version = detail.contractApprovalVersion;
    const nodes = instance.frozenNodes;
    const snapshot = contractRoundSubmissionSnapshot(nodes);
    if (!detail.projectId || version?.status !== "in_approval" || instance.flowType !== "contract.approve" ||
        !isParallelApprovalRound(nodes) || snapshot?.contractVersionId !== instance.businessId ||
        snapshot.documentContentRevision !== version.documentContentRevision ||
        snapshot.documentContentFingerprint !== version.documentContentFingerprint) return null;

    const originators = await resolveContractOriginators(this.prisma, instance.businessId, nodes).catch(error => {
      if (error instanceof ConflictException) return null;
      throw error;
    });
    if (!originators) return null;
    const selfReview = instance.applicantUserId === userId || originators.includes(userId);
    for (const index of activeApprovalNodeIndexes(nodes, instance.currentNodeIndex)) {
      const identity = await contractParallelDutyIdentity(this.prisma, instance, detail.projectId, userId, index, false);
      if (identity && (!selfReview || identity.representedUserId === userId)) return nodes[index] as ApprovalNode;
    }
    return null;
  }

  private currentApprovalNode(frozenNodes: unknown, index: number, roleKeys: RoleKey[] = []): ApprovalNode | null {
    if (hasVersionedApprovalNodes(frozenNodes) && !isParallelApprovalRound(frozenNodes)) return null;
    if (isParallelApprovalRound(frozenNodes)) {
      index = activeApprovalNodeIndexes(frozenNodes, index).find(candidate => this.hasDirectRoleTodo(frozenNodes[candidate] as ApprovalNode, roleKeys)) ?? -1;
    }
    if (!Array.isArray(frozenNodes)) {
      return null;
    }

    const node = frozenNodes[index] as ApprovalNode | undefined;
    return node ?? null;
  }

  private activeApprovalWhere(): Prisma.ApprovalInstanceWhereInput {
    return {
      OR: [
        {
          status: "in_progress",
          businessType: { in: [...LEGACY_APPROVAL_TYPES] }
        },
        {
          status: "approval_pending",
          businessType: { in: [...SPOT_APPROVAL_TYPES] }
        }
      ]
    };
  }

  private async canActOnProcurementNode(node: ApprovalNode, userId: string, projectId: string | null) {
    try {
      const actor = projectId ? await generalProcurementActor(this.prisma, new ProjectVisibilityService(this.prisma), userId, projectId) : await generalRequestActor(this.prisma, new ProjectVisibilityService(this.prisma), userId, null);
      const identity = resolveApprovalReviewIdentity({ node, actorUserId: userId, actorRoleKeys: [...actor.globalRoleKeys, ...actor.projectRoleKeys], actorRoleScopes: actor });
      return Boolean(identity && !identity.viaAssignment);
    } catch (error) {
      if (error instanceof ForbiddenException) return false;
      throw error;
    }
  }

  private supportsIndirectApproval(businessType: string) {
    return (
      businessType !== "general_procurement" &&
      businessType !== "expense_claim" &&
      businessType !== "project_expense_request" &&
      businessType !== "spot_procurement_version" &&
      businessType !== "spot_procurement_payment"
    );
  }

  private canShowSpotApplicantTodo(
    instance: Pick<ApprovalInstanceForWorkItem, "businessType" | "applicantUserId" | "frozenNodes">,
    node: ApprovalNode,
    roleKeys: RoleKey[],
    userId: string
  ) {
    if (
      !SPOT_APPROVAL_TYPES.includes(
        instance.businessType as (typeof SPOT_APPROVAL_TYPES)[number]
      ) ||
      instance.applicantUserId !== userId
    ) {
      return true;
    }
    return requiresApprovalSelfReviewConfirmation({
      applicantUserId: instance.applicantUserId,
      actorUserId: userId,
      actorRoleKeys: roleKeys,
      nodeRoleKeys: this.stringArray(node.roleKeys) as RoleKey[]
    });
  }

  private canActOnApprovalNode(node: ApprovalNode, roleKeys: RoleKey[], userId: string) {
    return Boolean(resolveApprovalReviewIdentity({
      node,
      actorUserId: userId,
      actorRoleKeys: roleKeys
    }));
  }

  private hasDirectRoleTodo(node: ApprovalNode, roleKeys: RoleKey[]) {
    const approvedRoleKeys = new Set(this.stringArray(node.approvedRoleKeys));
    return this.stringArray(node.roleKeys).some(
      (role) => !approvedRoleKeys.has(role) && roleKeys.includes(role as RoleKey)
    );
  }

  private hasAssignmentTodo(node: ApprovalNode, userId: string) {
    const approvedRoleKeys = new Set(this.stringArray(node.approvedRoleKeys));
    const assignments = Array.isArray(node.assignments)
      ? (node.assignments as ApprovalAssignment[])
      : [];
    return assignments.some((assignment) => {
      if (assignment.toUserId !== userId || typeof assignment.fromRoleKey !== "string") {
        return false;
      }
      if (approvedRoleKeys.has(assignment.fromRoleKey)) return false;
      return Boolean(resolveApprovalReviewIdentity({
        node,
        actorUserId: userId,
        actorRoleKeys: []
      }));
    });
  }

  private async hasDelegatedApprovalTodo(
    userId: string,
    projectId: string,
    node: ApprovalNode,
    evaluatedAt: Date
  ): Promise<boolean> {
    const delegatorIds = await activeApprovalDelegatorIds(
      this.prisma,
      userId,
      evaluatedAt
    );
    const activeDelegators = await Promise.all(delegatorIds.map(async (delegatorId) => ({
      userId: delegatorId,
      roleKeys: await this.roleKeysForUserProject(delegatorId, projectId)
    })));
    return Boolean(resolveApprovalReviewIdentity({
      node,
      actorUserId: userId,
      actorRoleKeys: [],
      activeDelegators
    }));
  }

  private async activeFundsDelegatorIds(
    tx: Prisma.TransactionClient,
    userId: string,
    delegatorIds: string[],
    read: <T>(reader: (take: number) => Promise<T[]>) => Promise<T[]>
  ): Promise<string[]> {
    const users = await read((take) => tx.user.findMany({
      where: { id: { in: [userId, ...delegatorIds] } },
      select: { id: true, isActive: true },
      orderBy: { id: "asc" },
      take
    }));
    const activeUserIds = new Set(
      users.filter((user) => user.isActive).map((user) => user.id)
    );
    if (!activeUserIds.has(userId)) return [];
    return delegatorIds.filter((delegatorId) => activeUserIds.has(delegatorId));
  }

  private async fundsDelegatorRoles(
    tx: Prisma.TransactionClient,
    delegatorIds: string[],
    projectIds: string[],
    read: <T>(reader: (take: number) => Promise<T[]>) => Promise<T[]>
  ): Promise<FundsDelegatorRoleIndex> {
    const globalPositions = await read((take) => tx.userPosition.findMany({
      where: { userId: { in: delegatorIds }, projectId: null },
      select: { userId: true, positionId: true, projectId: true },
      orderBy: { id: "asc" },
      take
    }));
    const projectPositions = await read((take) => tx.userPosition.findMany({
      where: {
        userId: { in: delegatorIds },
        projectId: { in: projectIds }
      },
      select: { userId: true, positionId: true, projectId: true },
      orderBy: { id: "asc" },
      take
    }));
    const projectMembers = await read((take) => tx.projectMember.findMany({
      where: { userId: { in: delegatorIds }, projectId: { in: projectIds } },
      select: { userId: true, projectId: true, positionKey: true },
      orderBy: { id: "asc" },
      take
    }));
    const positionIds = Array.from(new Set(
      [...globalPositions, ...projectPositions].map((position) => position.positionId)
    ));
    const positions = positionIds.length
      ? await read((take) => tx.position.findMany({
          where: { id: { in: positionIds } },
          select: { id: true, key: true },
          orderBy: { id: "asc" },
          take
        }))
      : [];
    const positionKeyById = new Map(
      positions.map((position) => [position.id, position.key as RoleKey])
    );
    const globalKeysByUserId = new Map<string, RoleKey[]>();
    for (const position of globalPositions) {
      const role = positionKeyById.get(position.positionId);
      if (!role) continue;
      globalKeysByUserId.set(position.userId, [
        ...(globalKeysByUserId.get(position.userId) ?? []),
        role
      ]);
    }
    const localKeysByUserProject = new Map<string, RoleKey[]>();
    for (const position of projectPositions) {
      if (!position.projectId) continue;
      const role = positionKeyById.get(position.positionId);
      if (!role) continue;
      const key = `${position.userId}\u0000${position.projectId}`;
      localKeysByUserProject.set(key, [
        ...(localKeysByUserProject.get(key) ?? []),
        role
      ]);
    }
    for (const member of projectMembers) {
      const key = `${member.userId}\u0000${member.projectId}`;
      localKeysByUserProject.set(key, [
        ...(localKeysByUserProject.get(key) ?? []),
        member.positionKey as RoleKey
      ]);
    }
    const globalUserIdsByRole = new Map<RoleKey, Set<string>>();
    for (const [delegatorId, roleKeys] of globalKeysByUserId) {
      for (const role of resolveEffectiveRoleKeys(roleKeys)) {
        appendMapValue(globalUserIdsByRole, role, delegatorId);
      }
    }
    const localUserIdsByProjectRole = new Map<string, Set<string>>();
    for (const [userProjectKey, roleKeys] of localKeysByUserProject) {
      const separator = userProjectKey.indexOf("\u0000");
      const delegatorId = userProjectKey.slice(0, separator);
      const projectId = userProjectKey.slice(separator + 1);
      for (const role of roleKeys) {
        appendMapValue(
          localUserIdsByProjectRole,
          `${projectId}\u0000${role}`,
          delegatorId
        );
      }
    }
    return {
      globalKeysByUserId,
      localKeysByUserProject,
      globalUserIdsByRole,
      localUserIdsByProjectRole
    };
  }

  private async roleKeysForUserProject(userId: string, projectId: string): Promise<RoleKey[]> {
    const [globalPositions, projectPositions, projectMembers] = await Promise.all([
      this.prisma.userPosition.findMany({ where: { userId, projectId: null } }),
      this.prisma.userPosition.findMany({ where: { userId, projectId } }),
      this.prisma.projectMember.findMany({ where: { userId, projectId } })
    ]);
    const positionIds = Array.from(
      new Set([...globalPositions, ...projectPositions].map((position) => position.positionId))
    );
    const positions = positionIds.length
      ? await this.prisma.position.findMany({ where: { id: { in: positionIds } } })
      : [];
    const positionKeyById = new Map(positions.map((position) => [position.id, position.key as RoleKey]));
    const globalRoleKeys = globalPositions
      .map((position) => positionKeyById.get(position.positionId))
      .filter((role): role is RoleKey => Boolean(role));
    const projectRoleKeys = [
      ...projectPositions
        .map((position) => positionKeyById.get(position.positionId))
        .filter((role): role is RoleKey => Boolean(role)),
      ...projectMembers.map((member) => member.positionKey as RoleKey)
    ];

    return resolveEffectiveRoleKeys(globalRoleKeys, projectRoleKeys);
  }

  private stringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  }

  private approvalNodeName(node: ApprovalNode) {
    if (typeof node.name === "string" && node.name.trim()) {
      return node.name;
    }
    const roles = this.stringArray(node.roleKeys);
    return roles.length ? roles.join(" / ") : "当前审批节点";
  }

  private approvalActionLabel(action: string) {
    const labels: Record<string, string> = {
      approve: "同意",
      reject: "驳回",
      reject_previous: "退回上一步",
      return_to_applicant: "退回申请人",
      transfer: "转审",
      delegate: "委托",
      withdraw: "撤回",
      remind: "催办"
    };
    return labels[action] ?? action;
  }

  private async directDraftPresentations(versions: Array<{
    id: string; contractId: string; numericProtocolVersion: number; changeType: string;
    draftData: Prisma.JsonValue; amountYuan: Prisma.Decimal | null;
  }>) {
    const inputs = versions.map(version => ({ version, input: this.directDraftInput(version) }));
    const invalid = { businessCode: "编号待核对", amountText: "金额待核对", invalid: true };
    const result = new Map<string, { businessCode: string; amountText: string; invalid: boolean }>();
    for (const { version, input } of inputs) if (input) result.set(version.id, invalid);
    const candidates = inputs.filter(row => row.input?.valid);
    // Fixed 30-pair/60-parameter chunks, sequential: no unbounded per-version fan-out.
    for (let offset = 0; offset < candidates.length; offset += 30) {
      const chunk = candidates.slice(offset, offset + 30);
      try {
        const rows = await this.prisma.$queryRaw<unknown>(Prisma.sql`
          SELECT "id", "contractId", "originalSignedNumber" FROM public."ContractVersion"
          WHERE "status" = 'draft' AND ("id", "contractId") IN (${Prisma.join(chunk.map(({ version }) => Prisma.sql`(${version.id}, ${version.contractId})`))})
        `);
        if (!Array.isArray(rows) || rows.length !== chunk.length) continue;
        const numbers = new Map<string, string | null>();
        let valid = true;
        for (const row of rows as unknown[]) {
          if (!row || typeof row !== "object" || Array.isArray(row) ||
            Object.keys(row).sort().join(",") !== "contractId,id,originalSignedNumber" ||
            !("id" in row) || typeof row.id !== "string" || numbers.has(row.id) ||
            !("contractId" in row) || !chunk.some(({ version }) => version.id === row.id && version.contractId === row.contractId) ||
            !("originalSignedNumber" in row) ||
            (row.originalSignedNumber !== null && (typeof row.originalSignedNumber !== "string" || row.originalSignedNumber === ""))) {
            valid = false; break;
          }
          numbers.set(row.id, row.originalSignedNumber);
        }
        if (!valid) continue;
        for (const { version, input } of chunk) if (input?.valid && numbers.has(version.id)) {
          result.set(version.id, { businessCode: numbers.get(version.id) ?? "未注明编号", amountText: input.amountText, invalid: false });
        }
      } catch {
        // A missing column/permission or malformed batch leaves this chunk visibly awaiting verification.
      }
    }
    return result;
  }

  private directDraftInput(version: {
    numericProtocolVersion: number; changeType: string; draftData: Prisma.JsonValue; amountYuan: Prisma.Decimal | null;
  }) {
    const draft = version.draftData;
    if (!draft || typeof draft !== "object" || Array.isArray(draft) ||
      !Object.prototype.hasOwnProperty.call(draft, "directSigningInput")) return null;
    const invalid = { valid: false as const };
    const marker = draft.directSigningInput;
    const basics = draft.contractBasics;
    if (version.numericProtocolVersion !== 2 || version.changeType !== "original" ||
      !marker || typeof marker !== "object" || Array.isArray(marker) ||
      marker.protocolVersion !== 1 || marker.source !== "direct_signed" || marker.relationship !== "outside" ||
      !basics || typeof basics !== "object" || Array.isArray(basics) || basics.relationship !== "outside") return invalid;
    if (Object.keys(marker).sort().join(",") !== "counterpartyParty,enterpriseParty,fixedPaymentTermsVersionId,protocolVersion,relationship,signedOn,source") return invalid;
    const partyShape = (value: Prisma.JsonValue | undefined) => value === null ||
      (value !== undefined && typeof value === "object" && !Array.isArray(value) &&
        Object.keys(value).sort().join(",") === "displayOrder,roleKey" &&
        typeof value.roleKey === "string" && value.roleKey.length > 0 &&
        typeof value.displayOrder === "number" && Number.isSafeInteger(value.displayOrder) && value.displayOrder >= 0);
    if (!partyShape(marker.enterpriseParty) || !partyShape(marker.counterpartyParty) ||
      !(marker.fixedPaymentTermsVersionId === null ||
        (typeof marker.fixedPaymentTermsVersionId === "string" && marker.fixedPaymentTermsVersionId.length > 0))) return invalid;
    if (marker.signedOn !== null) {
      if (typeof marker.signedOn !== "string" || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u.test(marker.signedOn)) return invalid;
      const [year, month, day] = marker.signedOn.split("-").map(Number);
      const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) return invalid;
    }
    const amount = version.amountYuan;
    if (amount !== null && (!amount.isFinite() || amount.isNegative() || amount.decimalPlaces() > 4)) return invalid;
    return { valid: true as const, amountText: amount === null ? "金额待确定" : `¥${amount.toFixed(4)}` };
  }

  private amountText(amountCents: bigint) {
    return `¥${formatMoneyCentsAsYuan(dbMoneyToBigInt(amountCents, "金额"))}`;
  }

  private stayedText(value: Date) {
    const elapsedMs = Math.max(Date.now() - value.getTime(), 0);
    const days = Math.floor(elapsedMs / 86_400_000);
    if (days >= 1) {
      return `已停留 ${days} 天`;
    }
    const hours = Math.max(Math.floor(elapsedMs / 3_600_000), 1);
    return `已停留 ${hours} 小时`;
  }

  private approvalTargetPath(counts: {
    contract: number;
    settlement: number;
    payment: number;
    expense: number;
    spotProcurement: number;
    spotPayment: number;
    procurement: number;
    procurementPayment: number;
    reimbursement: number;
    incidentalExpense: number;
  }) {
    if (counts.reimbursement > 0 || counts.incidentalExpense > 0 || counts.procurement > 0 || counts.procurementPayment > 0) return "/审批中心";
    if (counts.payment > 0) return "/付款管理";
    if (counts.settlement > 0) return "/结算管理";
    if (counts.expense > 0) return "/项目经营";
    if (counts.spotPayment > 0) return "/零星材料付款工作台";
    if (counts.spotProcurement > 0) return "/零星采购工作台";
    return "/合同管理";
  }
}

function projectExpenseApprovalTitle(expenseType: string) {
  if (expenseType === "reimbursement") return "报销审批";
  if (expenseType === "spot_purchase") return "零星采购审批";
  return "项目支出审批";
}
