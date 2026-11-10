import { contractRoundSubmissionSnapshot, hasActiveContractGlobalRole } from "../contract/contract-parallel-duty-access";
import { resolveGovernedFinalArchiveAccess } from "../contract/contract-final-archive-access";
import { readContractV2LifecycleContext } from "../contract/contract-v2-lifecycle-context";
import { RegisteredPaymentExecutionService } from "../payment/registered-payment-execution.service";
import { spotPurchaseWorkItems } from "../spot-procurement/spot-purchase-work-items";
import { fundReviewWorkItems } from "../fund-account/fund-account-work-items";
import { generalRequestWorkItems } from "../general-procurement/general-procurement-request-work-items";
import { generalRequestActor } from "../general-procurement/general-procurement-request-access";
import {scopedSpotDutyNodeIndexes, SPOT_APPROVAL_DUTY_RESOURCE} from "../approval/spot-approval-duty-access";
import { activeApprovalNodeIndexes, hasVersionedApprovalNodes, isParallelApprovalRound } from "../approval/parallel-approval-protocol";
import {companyTransferWorkItems} from "../company-transfer/company-transfer-workitems";
import {contractHandlingWorkItems} from "../contract-ledger/contract-handling-workitems";
import { addContractRelationshipSummaries } from "../contract-ledger/contract-relationship-summary";
import { generalProcurementActor } from "../general-procurement/general-procurement-access";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { Prisma, type ContractVersion } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import {
  canPerform,
  resolveEffectiveRoleKeys,
  type BusinessAction,
  type RoleKey
} from "@jiangkong/shared-domain";
import { activeApprovalDelegatorIds } from "../approval/active-approval-delegations";
import {
  frozenCandidateUserIds,
  isGovernedFrozenApprovalNode,
  resolveApprovalReviewIdentity,
  type FrozenApprovalNode
} from "../approval/approval-review-identity";
import { requiresApprovalSelfReviewConfirmation } from "../approval/approval-self-review";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";
import { dbMoneyToBigInt, formatMoneyCentsAsYuan } from "../money/decimal-money";

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

export type ApprovalCenterViewKey =
  | "pendingApproval"
  | "startedByMe"
  | "handledByMe"
  | "delegatedToMe"
  | "overdueReminder";
export type WorkItemKind =
  | "draft"
  | "contract_takeover"
  | "archive"
  | "approval"
  | "payment_execution"
  | "procurement"
  | "blocker";

export interface WorkItem {
  contractRelationshipLabel?: string; signingParty?: string; accountingEffect?: string;
  id: string;
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
  generatedAt: string;
  visibleProjectCount: number;
  queues: Record<WorkItemQueueKey, WorkItem[]>;
  queueMeta: Record<WorkItemQueueKey, {
    total: number;
    returned: number;
    truncated: boolean;
  }>;
  approvalCenter: Record<ApprovalCenterViewKey, WorkItem[]>;
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
  status: string;
  currentNodeIndex: number;
  frozenNodes: unknown;
  applicantUserId: string;
  createdAt: Date;
  updatedAt: Date;
};

interface ApprovalBusinessDetail {
  requestProtocolVersion?: number;
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
    private readonly audit: AuditService = new AuditService()
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

    const approvalProjects = this.projectIdsFor(scopes, [
      "contract.approve",
      "settlement.approve",
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
    if (approvalProjects.length || scopedSpotMandate || fundReviewTodos.length) {
      const approvalCounts = await this.countApprovalTodos(scopes, userId);
      approvalCounts.total += fundReviewTodos.length;
      cards.push({
        id: "approval_todo",
        title: "待审批",
        count: approvalCounts.total,
        description: `${fundReviewTodos.length ? `余额核对 ${fundReviewTodos.length} · ` : ""}${approvalCounts.procurement || approvalCounts.procurementPayment ? `综合采购 ${approvalCounts.procurement} · 采购付款 ${approvalCounts.procurementPayment} · ` : ""}合同 ${approvalCounts.contract} · 结算 ${approvalCounts.settlement} · 付款 ${approvalCounts.payment} · 支出 ${approvalCounts.expense}${
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
    const pending = [
      ...(await spotPurchaseWorkItems(this.prisma as Prisma.TransactionClient, userId, this.projectIdsFor(scopes, ["spot_procurement.create"]))),
      ...(await generalRequestWorkItems(this.prisma as Prisma.TransactionClient, new ProjectVisibilityService(this.prisma), userId, "procurement")),
      ...(await contractHandlingWorkItems(this.prisma as Prisma.TransactionClient,userId,scopes,projectNameById)),
      ...(await companyTransferWorkItems(this.prisma as Prisma.TransactionClient,userId)),
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
        this.projectIdsFor(scopes, ["contract.archive.confirm"]),
        ["pending_review"],
        projectNameById,
        "复核历史合同接管",
        "确认后作为系统事实起点",
        "warning"
      )),
      ...(await this.paymentExecutionWorkItems(
        userId,
        projectNameById
      )),
      ...(await this.spotPaymentExecutionWorkItems(
        this.projectIdsFor(scopes, ["spot_procurement.payment.execute"]),
        projectNameById
      )),
      ...contractLifecycleItems.pending,
      ...(await this.contractArchiveWorkItems(
        this.projectIdsFor(scopes, ["contract.seal"]),
        ["approved_pending_seal"],
        projectNameById,
        "待同意用章",
        "核对审批结果后同意经办人线下取章",
        "warning",
        undefined,
        "governed"
      )),
      ...(await this.contractArchiveWorkItems(
        this.projectIdsFor(scopes, ["contract.seal"]),
        ["approved_pending_seal"],
        projectNameById,
        "待确认用章",
        "确认后上传盖章合同",
        "warning",
        undefined,
        "legacy"
      )),
      ...(await this.contractSealHandlerWorkItems(
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
    const delegatedToMe = (
      await this.approvalWorkItems(scopes, userId, "delegated", evaluatedAt)
    ).filter(
      (item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index
    );

    await addContractRelationshipSummaries(this.prisma,[...pending,...blocked,...started,...draftResult.items,...handledByMe,...delegatedToMe]);

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
        pendingApproval: pending.filter((item) => item.type === "approval").slice(0, 30),
        startedByMe: started.slice(0, 30),
        handledByMe,
        delegatedToMe,
        overdueReminder: []
      }
    };
  }

  async getFundsPendingWorkItems(userId: string): Promise<WorkItem[]> {
    const evaluatedAt = new Date();
    const scopes = await this.loadProjectRoleScopes(userId);
    const projectIds = scopes.map((scope) => scope.projectId);
    const projectNameById = await this.projectNames(projectIds);
    const pending = [
      ...(await contractHandlingWorkItems(this.prisma as Prisma.TransactionClient,userId,scopes,projectNameById)),
      ...(await companyTransferWorkItems(this.prisma as Prisma.TransactionClient,userId)),
      ...(await this.paymentExecutionWorkItems(
        userId,
        projectNameById,
        undefined
      )),
      ...(await this.spotPaymentExecutionWorkItems(
        this.projectIdsFor(scopes, ["spot_procurement.payment.execute"]),
        projectNameById,
        undefined
      )),
      ...(await this.approvalWorkItems(scopes, userId, "pending", evaluatedAt))
    ];
    await addContractRelationshipSummaries(this.prisma,pending);
    return pending.filter((item) =>
      ["company_transfer","contract_bank_verification","upward_receipt_match","contract_proxy_execution"].includes(item.businessType??"") ||
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
            status: { in: ["approved_pending_payment", "partially_paid"] }
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
      ...(await this.contractArchiveWorkItems(
        this.projectIdsFor(scopes, ["contract.seal"]), ["approved_pending_seal"], projectNameById,
        "待同意用章", "核对审批结果后同意经办人线下取章", "warning", undefined, "governed", undefined
      )),
      ...(await this.contractArchiveWorkItems(
        this.projectIdsFor(scopes, ["contract.seal"]), ["approved_pending_seal"], projectNameById,
        "待确认用章", "确认后上传盖章合同", "warning", undefined, "legacy", undefined
      )),
      ...(await this.contractSealHandlerWorkItems(userId, projectNameById, undefined)),
      ...(await this.contractFinalUploadSubstituteWorkItems(userId, projectIds, projectNameById)),
      ...(await this.contractArchiveWorkItems(
        this.projectIdsFor(scopes, ["contract.archive.upload"]), ["seal_approved_pending_archive"], projectNameById,
        "上传盖章合同", "上传后等待合同部主管确认归档", "primary", undefined, undefined, undefined
      )),
      ...(await this.contractArchiveWorkItems(
        this.projectIdsFor(scopes, ["contract.archive.confirm"]), ["pending_archive_confirm"], projectNameById,
        "确认合同归档", "确认后合同版本生效", "warning", userId, undefined, undefined
      )),
      ...(await this.approvalWorkItems(scopes, userId, "pending", evaluatedAt))
    ];
    await addContractRelationshipSummaries(this.prisma,pending);
    return pending.filter((item) =>
      ["company_transfer","contract_bank_verification","upward_receipt_match","contract_proxy_execution"].includes(item.businessType??"") || item.businessType === "contract_version");
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
            orderBy: [{ updatedAt: "desc" }, { id: "desc" }]
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
        stayedText: this.stayedText(takeover.updatedAt),
        nextAction,
        targetPath: "/历史合同接管",
        tone
      };
    });
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
      stayedText: this.stayedText(new Date(payment.expectedPaymentUpdatedAt)),
      nextAction: "实际付款后登记，凭证可后补",
      targetPath: `/付款管理/${payment.code}`,
      tone: "warning"
    }));
  }

  private async spotPaymentExecutionWorkItems(
    projectIds: string[],
    projectNameById: ReadonlyMap<string, string>,
    limit: number | undefined = 30
  ): Promise<WorkItem[]> {
    if (!projectIds.length || !supportsSpotPaymentExecutionAggregation(this.prisma)) {
      return [];
    }

    const payments = await this.prisma.spotProcurementPayment.findMany({
      where: {
        projectId: { in: projectIds },
        status: { in: ["approved_pending_payment", "partially_paid"] }
      },
      orderBy: { updatedAt: "desc" },
      ...(limit === undefined ? {} : { take: limit }),
      select: {
        id: true,
        projectId: true,
        code: true,
        approvalAmountCents: true,
        paidAmountCents: true,
        updatedAt: true
      }
    });

    return payments.map((payment) => {
      const balance = payment.approvalAmountCents - payment.paidAmountCents;
      const remainingAmountCents = balance > 0n ? balance : 0n;

      return {
        id: `spot-payment-execution:${payment.id}`,
        type: "payment_execution",
        title: "登记零星材料实付与凭证",
        projectName: projectNameById.get(payment.projectId) ?? payment.projectId,
        projectId: payment.projectId,
        businessCode: payment.code,
        businessType: "spot_payment",
        businessId: payment.id,
        amountText: this.amountText(
          remainingAmountCents !== 0n ? remainingAmountCents : payment.approvalAmountCents
        ),
        currentNode: "财务登记实际付款",
        stayedText: this.stayedText(payment.updatedAt),
        nextAction: "登记实付并上传凭证",
        targetPath: `/零星材料付款/${encodeURIComponent(payment.id)}?tab=current`,
        tone: "warning"
      };
    });
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
    governanceMode?: "governed" | "legacy",
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
            status: { in: statuses },
            ...(governanceMode === "governed"
              ? { contractGovernanceVersion: 1 }
              : governanceMode === "legacy"
                ? { contractGovernanceVersion: null }
                : {})
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
          stayedText: this.stayedText(version.updatedAt),
          nextAction,
          targetPath: `/合同管理/${code}`,
          tone
        }
      ];
    });
  }

  private async contractSealHandlerWorkItems(
    userId: string,
    projectNameById: ReadonlyMap<string, string>,
    limit: number | undefined = 30
  ): Promise<WorkItem[]> {
    const tasks = await this.prisma.contractSealTask?.findMany({
      where: { handlerUserId: userId, status: { in: ["in_seal", "completed"] } },
      orderBy: { updatedAt: "desc" },
      ...(limit === undefined ? {} : { take: limit })
    }) ?? [];
    if (!tasks.length) return [];
    const versions = await this.prisma.contractVersion.findMany({
      where: {
        id: { in: tasks.map((item) => item.contractVersionId) },
        status: { in: ["in_seal", "seal_approved_pending_archive"] }
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
      const completing = version.status === "in_seal";
      return [{
        id: `contract-seal-handler:${version.id}`,
        type: "archive" as const,
        businessType: "contract_version",
        businessId: version.id,
        title: contract.name,
        projectName: projectNameById.get(contract.projectId) ?? contract.projectId,
        businessCode: code,
        amountText: this.amountText(version.amountCents),
        currentNode: completing ? "线下签署盖章" : "上传双方最终版",
        stayedText: this.stayedText(version.updatedAt),
        nextAction: completing ? "确认我方签署盖章完成" : "上传双方最终签署 PDF",
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
        stayedText: this.stayedText(settlement.updatedAt),
        nextAction: "重试生成结算签名合成件",
        targetPath: `/结算管理/${settlement.code}`,
        tone: "danger" as const
      }));
  }

  private async approvalWorkItems(
    scopes: ProjectRoleScope[],
    userId: string,
    mode: "pending" | "started" | "delegated",
    evaluatedAt: Date
  ): Promise<WorkItem[]> {
    const instances = (await this.prisma.approvalInstance.findMany({
      where: {
        ...this.activeApprovalWhere(),
        ...(mode === "started" ? { applicantUserId: userId } : {})
      },
      orderBy: { updatedAt: "desc" },
    })) as ApprovalInstanceForWorkItem[];
    const roleKeysByProject = new Map(scopes.map((scope) => [scope.projectId, scope.roleKeys]));
    const details = await this.approvalBusinessDetails(instances);
    const items: WorkItem[] = [];

    for (const instance of instances) {
      const detail = details.get(`${instance.businessType}:${instance.businessId}`);
      if (detail?.requestProtocolVersion === 2) continue;
      const scopedDelegateNode = detail ? await this.scopedSpotDelegateNode(instance, detail.projectId ?? undefined, userId) : null;
      const node = this.currentApprovalNode(instance.frozenNodes, instance.currentNodeIndex, roleKeysByProject.get(detail?.projectId ?? "") ?? []) ?? scopedDelegateNode;
      if (!detail || !node) {
        continue;
      }
      const roleKeys = (detail.projectId ? roleKeysByProject.get(detail.projectId) : undefined) ?? [];
      const supportsIndirect = this.supportsIndirectApproval(instance.businessType);
      const hasRoleTodo = ["general_procurement", "expense_claim"].includes(instance.businessType)
        ? await this.canActOnProcurementNode(node, userId, detail.projectId)
        : supportsIndirect ? this.canActOnApprovalNode(node, roleKeys, userId) : this.hasDirectRoleTodo(node, roleKeys);
      const hasDirectTodo =
        hasRoleTodo &&
        this.canShowSpotApplicantTodo(instance, node, roleKeys, userId);
      const hasDelegatedTodo = Boolean(scopedDelegateNode) || (
        mode === "started" || !supportsIndirect || hasDirectTodo
          ? false
          : await this.hasDelegatedApprovalTodo(userId, detail.projectId ?? "", node, evaluatedAt));
      if (mode === "pending" && !hasDirectTodo && !hasDelegatedTodo) {
        continue;
      }
      if (mode === "delegated" && !this.hasAssignmentTodo(node, userId) && !hasDelegatedTodo) {
        continue;
      }
      if (mode === "delegated" && !supportsIndirect && !scopedDelegateNode) {
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
        currentNode: this.approvalNodeName(node),
        stayedText: this.stayedText(instance.updatedAt),
        nextAction: mode === "started" ? "查看审批进度" : "处理当前审批",
        targetPath: detail.targetPath,
        tone: mode === "started" ? "primary" : "warning"
      });
    }

    items.push(...await generalRequestWorkItems(this.prisma as Prisma.TransactionClient, new ProjectVisibilityService(this.prisma), userId, mode));
    items.push(...await fundReviewWorkItems(this.prisma, userId, mode));
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
      if (!instance || !detail || (detail.projectId == null || !visibleProjectIds.has(detail.projectId))) {
        continue;
      }
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
        tone: "success"
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
    const claimIds = instances.filter((instance) => instance.businessType === "expense_claim").map((instance) => instance.businessId);
    const generalRows = generalIds.length ? await this.prisma.generalProcurement.findMany({ where: { id: { in: generalIds } } }) : [];
    const claimRows = claimIds.length ? await this.prisma.expenseClaim.findMany({ where: { id: { in: claimIds }, generalProcurementId: { not: null } } }) : [];
    const procurementProjectNames = await this.projectNames([...generalRows.flatMap((row) => row.projectId ? [row.projectId] : []), ...claimRows.flatMap((row) => row.projectId ? [row.projectId] : [])]);
    for (const row of generalRows) result.set(`general_procurement:${row.id}`, { requestProtocolVersion: row.requestProtocolVersion, projectId: row.projectId, projectName: row.projectId ? procurementProjectNames.get(row.projectId) ?? "所属项目" : "公司日常",
      businessCode: row.code, title: `综合采购申请：${row.reason || "详见采购清单"}`, amountCents: row.requestedAmountCents, targetPath: `/综合采购申请/${row.id}` });
    for (const row of claimRows) if (row.projectId) result.set(`expense_claim:${row.id}`, { projectId: row.projectId, projectName: procurementProjectNames.get(row.projectId) ?? "所属项目",
      businessCode: row.code, title: `综合采购付款：${row.reason}`, amountCents: row.requestedAmountCents, targetPath: `/费用与报销/${row.id}` });
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
            select: { id: true, contractId: true, amountCents: true }
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
          select: { id: true, projectId: true, code: true, temporaryCode: true, name: true, counterparty: true }
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

  private async countApprovalTodos(scopes: ProjectRoleScope[], userId: string) {
    const evaluatedAt = new Date();
    const roleKeysByProject = new Map(scopes.map((scope) => [scope.projectId, scope.roleKeys]));
    const instances = await this.prisma.approvalInstance.findMany({
      where: {
        ...this.activeApprovalWhere()
      }
    });
    const businessProjectIds = await this.approvalBusinessProjectIds(instances);
    const counts = {
      contract: 0,
      settlement: 0,
      payment: 0,
      expense: 0,
      spotProcurement: 0,
      spotPayment: 0,
      procurement: 0,
      procurementPayment: 0,
      total: 0
    };

    for (const instance of instances) {
      const projectId = businessProjectIds.get(`${instance.businessType}:${instance.businessId}`);
      if (!projectId) {
        continue;
      }
      const roleKeys = roleKeysByProject.get(projectId) ?? [];

      const scopedDelegateNode = await this.scopedSpotDelegateNode(instance, projectId, userId);
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

      if (instance.businessType === "contract_version") counts.contract += 1;
      if (instance.businessType === "settlement") counts.settlement += 1;
      if (instance.businessType === "payment_request") counts.payment += 1;
      if (instance.businessType === "project_expense_request") counts.expense += 1;
      if (instance.businessType === "spot_procurement_version") counts.spotProcurement += 1;
      if (instance.businessType === "spot_procurement_payment") counts.spotPayment += 1;
      if (instance.businessType === "general_procurement") counts.procurement += 1;
      if (instance.businessType === "expense_claim") counts.procurementPayment += 1;
      counts.total += 1;
    }

    const generalDuties = await generalRequestWorkItems(this.prisma as Prisma.TransactionClient, new ProjectVisibilityService(this.prisma), userId);
    counts.procurement += generalDuties.length; counts.total += generalDuties.length;
    return counts;
  }

  private async approvalBusinessProjectIds(
    instances: Array<{ businessType: string; businessId: string }>
  ) {
    const ids = new Map<string, string>();
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

    const procurementIds = instances.filter((instance) => instance.businessType === "general_procurement").map((instance) => instance.businessId);
    const procurementPaymentIds = instances.filter((instance) => instance.businessType === "expense_claim").map((instance) => instance.businessId);
    const [versions, settlements, payments, expenses, spotVersions, spotPayments, procurements, procurementPayments] = await Promise.all([
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
            select: { id: true, projectId: true }
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
      procurementIds.length ? this.prisma.generalProcurement.findMany({ where: { id: { in: procurementIds } }, select: { id: true, projectId: true, requestProtocolVersion: true } }) : Promise.resolve([]),
      procurementPaymentIds.length ? this.prisma.expenseClaim.findMany({ where: { id: { in: procurementPaymentIds }, generalProcurementId: { not: null } }, select: { id: true, projectId: true } }) : Promise.resolve([])
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
      ids.set(`project_expense_request:${expense.id}`, expense.projectId);
    }
    for (const version of spotVersions) {
      const projectId = projectIdBySpotProcurementId.get(version.procurementId);
      if (projectId) ids.set(`spot_procurement_version:${version.id}`, projectId);
    }
    for (const payment of spotPayments) {
      ids.set(`spot_procurement_payment:${payment.id}`, payment.projectId);
    }

    for (const row of procurements) if (row.projectId && row.requestProtocolVersion !== 2) ids.set(`general_procurement:${row.id}`, row.projectId);
    for (const row of procurementPayments) if (row.projectId) ids.set(`expense_claim:${row.id}`, row.projectId);

    return ids;
  }

  private async scopedSpotDelegateNode(instance: {id: string; businessType: string; status: string; frozenNodes: unknown; currentNodeIndex: number}, projectId: string | undefined, userId: string): Promise<ApprovalNode | null> {
    if (instance.businessType !== "spot_procurement_version" || !projectId) return null;
    const indexes = await scopedSpotDutyNodeIndexes(this.prisma as never, instance, projectId, userId);
    return indexes.length && Array.isArray(instance.frozenNodes) ? instance.frozenNodes[indexes[0]] as ApprovalNode : null;
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
  }) {
    if (counts.procurement > 0 || counts.procurementPayment > 0) return "/审批中心";
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
