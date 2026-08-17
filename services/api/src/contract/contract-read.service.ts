import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional
} from "@nestjs/common";
import {
  CONTRACT_DRAFT_PRIVATE_READ_ROLES,
  CONTRACT_FULL_VIEW_GLOBAL_ROLE_KEYS,
  CONTRACT_FULL_VIEW_PROJECT_ROLE_KEYS,
  CONTRACT_INVOICE_TYPES,
  CONTRACT_SUMMARY_VIEW_ROLE_KEYS,
  HISTORICAL_CONTRACT_TAKEOVER_READ_ROLE_KEYS,
  canCreatePaymentFromSettlementStatus,
  canUseCurrentContractApprovalForm,
  contractInvoiceTypeLabel,
  resolveEffectiveRoleKeys,
  type ContractVisibilityLevel,
  type ContractWorkbenchLedgerPage,
  type ContractWorkbenchView,
  type SettlementStatus,
  ContractBusinessOptionReadModel,
  ContractDetailReadModel,
  ContractSettlementPaymentReadModel,
  type ContractSigningMaterialChangeStatus,
  CoreFlowTone,
  type DetailActionReadModel,
  type DraftLedgerView,
  type LifecycleLedgerPage,
  type RoleKey
} from "@jiangkong/shared-domain";
import {
  approvalReviewAccessOnFrozenNode,
  type ApprovalReviewAccess
} from "../approval/approval-node-access";
import { activeApprovalDelegatorIds } from "../approval/active-approval-delegations";
import type { ApprovalActorRoleScopes } from "../approval/approval-review-identity";
import { AuditService } from "../audit/audit.service";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import {
  detailAction,
  disabledActionReasons,
  primaryActionKey
} from "../core-flow/detail-actions";
import { approvalTimelineForBusiness } from "../core-flow/approval-timeline-read";
import {
  buildLedgerWorkbook,
  shanghaiDateStamp
} from "../core-flow/ledger-excel";
import { PrismaService } from "../database/prisma.service";
import { MeService } from "../me/me.service";
import {
  dbMoneyToBigInt,
  formatMoneyCentsAsYuan,
  moneyCentsToApi
} from "../money/decimal-money";
import {
  CONTRACT_TAKEOVER_BALANCE_SELECT,
  type ContractTakeoverBalanceRow,
  toHistoricalContractPaymentBalance
} from "../payment/contract-takeover-balance";
import type { HistoricalContractPaymentBalance } from "../payment/settlement-payment-capacity";
import { contractChangeVersionsReadModel } from "./contract-change-read-model";
import {
  classifyContractDraftLifecycle,
  parseContractDraftLifecycleStatus,
  projectContractDraftLifecycleViews,
  type ContractDraftLifecycleClassification,
  type ContractDraftLifecycleFacts
} from "./contract-draft-lifecycle";
import { loadContractOwnerRisk } from "./contract-owner-risk";
import { resolveGovernedFinalArchiveAccess } from "./contract-final-archive-access";
import { settlementContractTypeBlockReason } from "../settlement/contract-settlement-capacity";

function emptyApprovalReviewAccess(): ApprovalReviewAccess {
  return { canAct: false, canReview: false, requiresSelfReviewConfirmation: false };
}

interface CurrentContractApprovalReview {
  access: ApprovalReviewAccess;
  approval: {
    id: string;
    currentNodeIndex: number;
    updatedAt: Date;
  } | null;
}

interface CurrentContractApprovalWithdrawal {
  id: string;
  currentNodeIndex: number;
  updatedAt: Date;
}

function emptyCurrentContractApprovalReview(): CurrentContractApprovalReview {
  return { access: emptyApprovalReviewAccess(), approval: null };
}

const HISTORICAL_TAKEOVER_READ_ROLES = new Set<RoleKey>(
  HISTORICAL_CONTRACT_TAKEOVER_READ_ROLE_KEYS
);

const MATERIAL_CHANGE_TASK_STATUS_BY_VERSION_STATUS: Record<
  ContractSigningMaterialChangeStatus,
  string
> = {
  approved_pending_seal: "pending_approval",
  in_seal: "in_seal",
  seal_approved_pending_archive: "completed",
  pending_archive_confirm: "completed"
};

@Injectable()
export class ContractReadService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    private readonly projectVisibility?: ProjectVisibilityService,
    @Optional()
    private readonly audit?: AuditService,
    @Optional()
    private readonly me?: MeService
  ) {}

  private async confirmedHistoricalBalanceForContract(contractId: string) {
    const takeoverClient = (this.prisma as unknown as {
      contractTakeover?: {
        findFirst(args: {
          where: {
            contractId: string;
            takeoverStatus: string;
            historicalBalanceConfirmedAt: { not: null };
          };
          select: typeof CONTRACT_TAKEOVER_BALANCE_SELECT;
        }): Promise<ContractTakeoverBalanceRow | null>;
      };
    }).contractTakeover;

    if (!takeoverClient) {
      return undefined;
    }

    const takeover = await takeoverClient.findFirst({
      where: {
        contractId,
        takeoverStatus: "confirmed",
        historicalBalanceConfirmedAt: { not: null }
      },
      select: CONTRACT_TAKEOVER_BALANCE_SELECT
    });

    return toHistoricalContractPaymentBalance(takeover);
  }

  private async contractArchiveFilesForVersion(
    contractVersionId: string
  ): Promise<ContractDetailReadModel["archiveFiles"]> {
    const client = this.prisma as unknown as {
      contractArchiveFile?: {
        findMany(args: {
          where: { contractVersionId: string };
          orderBy: { createdAt: "desc" };
        }): Promise<
          Array<{
            id: string;
            fileId: string;
            status: string;
            uploadedByUserId: string;
            confirmedByUserId: string | null;
            createdAt: Date;
            confirmedAt: Date | null;
          }>
        >;
      };
      fileObject?: {
        findMany(args: { where: { id: { in: string[] } } }): Promise<
          Array<{
            id: string;
            originalName: string;
            mimeType: string;
            sizeBytes: number;
          }>
        >;
      };
      user?: {
        findMany(args: { where: { id: { in: string[] } }; select: { id: true; name: true } }): Promise<
          Array<{
            id: string;
            name: string;
          }>
        >;
      };
    };

    if (!client.contractArchiveFile || !client.fileObject) {
      return [];
    }

    const archiveFiles = await client.contractArchiveFile.findMany({
      where: { contractVersionId },
      orderBy: { createdAt: "desc" }
    });
    const fileIds = Array.from(new Set(archiveFiles.map((file) => file.fileId)));
    if (!fileIds.length) {
      return [];
    }

    const userIds = Array.from(
      new Set(
        archiveFiles.flatMap((file) => [
          file.uploadedByUserId,
          ...(file.confirmedByUserId ? [file.confirmedByUserId] : [])
        ])
      )
    );
    const [files, users] = await Promise.all([
      client.fileObject.findMany({ where: { id: { in: fileIds } } }),
      client.user && userIds.length
        ? client.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
        : Promise.resolve([])
    ]);
    const fileById = new Map(files.map((file) => [file.id, file]));
    const userNameById = new Map(users.map((user) => [user.id, user.name]));

    return archiveFiles.flatMap((archiveFile) => {
      const file = fileById.get(archiveFile.fileId);
      if (!file) {
        return [];
      }
      const canDownload = archiveFile.status === "confirmed" || Boolean(archiveFile.confirmedAt);

      return [
        {
          archiveRecordId: archiveFile.id,
          fileId: file.id,
          fileName: file.originalName,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          status: archiveFile.status,
          statusLabel: this.settlementArchiveFileStatusLabel(archiveFile),
          uploadedByName: userNameById.get(archiveFile.uploadedByUserId) ?? "上传人未读取",
          createdAt: archiveFile.createdAt.toISOString(),
          confirmedByName: archiveFile.confirmedByUserId
            ? (userNameById.get(archiveFile.confirmedByUserId) ?? "确认人未读取")
            : null,
          confirmedAt: archiveFile.confirmedAt?.toISOString() ?? null,
          canDownload,
          disabledReason: canDownload ? null : "归档确认后开放下载"
        }
      ];
    });
  }

  private async governedSigningFacts(contractVersionId: string) {
    const [sealTask, formalFiles] = await Promise.all([
      this.prisma.contractSealTask.findFirst({
        where: { contractVersionId, status: { not: "cancelled" } },
        orderBy: { createdAt: "desc" }
      }),
      this.prisma.contractFormalFile.findMany({
        where: {
          contractVersionId,
          purpose: { in: ["approval_original", "mutually_signed_final"] }
        },
        orderBy: { createdAt: "desc" }
      })
    ]);
    const fileObjects = formalFiles.length ? await this.prisma.fileObject.findMany({
      where: { id: { in: formalFiles.map((item) => item.fileId) } },
      select: { id: true, originalName: true }
    }) : [];
    const names = new Map(fileObjects.map((item) => [item.id, item.originalName]));
    return {
      sealTask: sealTask ? {
        id: sealTask.id,
        status: sealTask.status,
        handlerUserId: sealTask.handlerUserId,
        approvedByUserId: sealTask.approvedByUserId,
        approvedAt: sealTask.approvedAt?.toISOString() ?? null,
        completedByUserId: sealTask.completedByUserId,
        completedAt: sealTask.completedAt?.toISOString() ?? null
      } : null,
      formalFiles: formalFiles.map((item) => {
        const content = this.formalFileDocumentContent(item.declarationSnapshot);
        return {
          formalFileId: item.id,
          purpose: item.purpose as "approval_original" | "mutually_signed_final",
          fileId: item.fileId,
          fileName: names.get(item.fileId) ?? "合同正式文件.pdf",
          pageCount: item.pageCount,
          sourceRevision: item.sourceRevision,
          documentContentRevision: content?.revision ?? null,
          documentContentFingerprint: content?.fingerprint ?? null,
          status: item.status,
          uploadedByUserId: item.uploadedByUserId,
          confirmedByUserId: item.confirmedByUserId,
          confirmedAt: item.confirmedAt?.toISOString() ?? null
        };
      })
    };
  }

  private formalFileDocumentContent(value: unknown): {
    revision: number;
    fingerprint: string;
  } | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const snapshot = value as Record<string, unknown>;
    const direct = this.documentContentCoordinates(snapshot);
    if (direct) return direct;
    const confirmed = snapshot["_counterparty_confirmed"];
    return confirmed && typeof confirmed === "object" && !Array.isArray(confirmed)
      ? this.documentContentCoordinates(confirmed as Record<string, unknown>)
      : null;
  }

  private documentContentCoordinates(value: Record<string, unknown>): {
    revision: number;
    fingerprint: string;
  } | null {
    const revision = value["documentContentRevision"];
    const fingerprint = value["documentContentFingerprint"];
    return Number.isInteger(revision) && (revision as number) > 0 &&
      typeof fingerprint === "string" && /^[a-f0-9]{64}$/u.test(fingerprint)
      ? { revision: revision as number, fingerprint }
      : null;
  }

  async listRecent(
    rawLimit?: string | number,
    visibleProjectIds?: string[],
    internalOptions?: { unbounded?: boolean; actorUserId?: string }
  ) {
    const take = internalOptions?.unbounded ? undefined : this.limit(rawLimit);
    const contracts = await this.prisma.contract.findMany({
      ...(visibleProjectIds ? { where: { projectId: { in: visibleProjectIds } } } : {}),
      ...(take === undefined ? {} : { take }),
      orderBy: { updatedAt: "desc" }
    });
    const contractIds = contracts.map((contract) => contract.id);
    const projectIds = [...new Set(contracts.map((contract) => contract.projectId))];
    const [versions, terms, projects, roleKeysByProject] = await Promise.all([
      contractIds.length
        ? this.prisma.contractVersion.findMany({
            where: {
              contractId: { in: contractIds },
              status: { not: "deleting" }
            },
            orderBy: [{ contractId: "asc" }, { versionNo: "desc" }]
          })
        : Promise.resolve([]),
      contractIds.length
        ? this.prisma.paymentTermsVersion.findMany({
            where: { contractId: { in: contractIds } },
            orderBy: [{ contractId: "asc" }, { versionNo: "desc" }]
          })
        : Promise.resolve([]),
      this.prisma.project.findMany({
        where: { id: { in: projectIds } }
      }),
      internalOptions?.actorUserId
        ? this.projectVisibility?.effectiveRoleKeysByProject(
            internalOptions.actorUserId,
            projectIds
          ) ?? Promise.resolve(new Map<string, RoleKey[]>())
        : Promise.resolve(new Map<string, RoleKey[]>())
    ]);
    const [takeovers, lifecycleByVersion] = await Promise.all([
      this.contractTakeoverLedgerRows(versions.map((version) => version.id)),
      this.contractDraftLifecycleByVersion(versions)
    ]);
    const versionByContractId = new Map<string, (typeof versions)[number]>();
    for (const contract of contracts) {
      if (contract.voidedAt) continue;
      const version = versions.find((candidate) =>
        candidate.contractId === contract.id &&
        !["deleting", "ended_retained"].includes(
          lifecycleByVersion.get(candidate.id)?.contractLifecycleStage ?? ""
        ) &&
        this.canReadContractVersionDraft(
          candidate,
          contract.ownerUserId,
          internalOptions?.actorUserId,
          roleKeysByProject.get(contract.projectId) ?? []
        )
      );
      if (version) versionByContractId.set(contract.id, version);
    }
    const termsByContractId = new Map<string, (typeof terms)[number]>();
    for (const term of terms) {
      const activeVersion = versionByContractId.get(term.contractId);
      if (
        activeVersion &&
        (!("contractVersionId" in term) || activeVersion.id === term.contractVersionId) &&
        !termsByContractId.has(term.contractId)
      ) {
        termsByContractId.set(term.contractId, term);
      }
    }
    const projectById = new Map(projects.map((project) => [project.id, project]));
    const takeoverByVersion = new Map(
      takeovers.map((takeover) => [takeover.contractVersionId, takeover])
    );

    const rows = contracts.flatMap<Record<string, unknown>>((contract) => {
      const version = versionByContractId.get(contract.id);
      if (!version) return [];
      const projectRoleKeys = roleKeysByProject.get(contract.projectId) ?? [];
      const visibility = this.resolveLedgerVisibility(projectRoleKeys);
      if (visibility === "none") return [];
      if (visibility === "summary") {
        if (
          lifecycleByVersion.get(version.id)?.contractLifecycleStage !==
            "protected_formal" ||
          contract.voidedAt != null
        ) {
          return [];
        }
        return [this.contractEmployeeSummaryRow(
          contract,
          version,
          projectById.get(contract.projectId)
        )];
      }
      const termsVersion = termsByContractId.get(contract.id);
      return [this.contractLedgerRow(
        contract,
        version,
        termsVersion,
        projectById.get(contract.projectId),
        {
          contractVersionId: version.id,
          contractLifecycleStage: lifecycleByVersion.get(version.id)?.contractLifecycleStage,
          contractLifecycleCapabilities: lifecycleByVersion.get(version.id)?.capabilities,
          lifecycleKind: lifecycleByVersion.get(version.id)?.lifecycleKind,
          lifecycleBlockers: lifecycleByVersion.get(version.id)?.blockers ?? [],
          draftRevision: version.draftRevision ?? null,
          lifecycleUpdatedAt: version.updatedAt instanceof Date
            ? version.updatedAt.toISOString()
            : contract.updatedAt.toISOString(),
          ...this.contractTakeoverLedgerProjection(
            contract,
            version,
            takeoverByVersion.get(version.id),
            false
          )
        }
      )];
    });

    return {
      rows,
      summary: {
        total: rows.length,
        inApproval: rows.filter((row) => row.currentNode === "等待审批").length,
        pendingSeal: rows.filter((row) => row.currentNode === "发起用章").length,
        pendingArchive: rows.filter((row) => String(row.currentNode ?? "").includes("归档")).length,
        effective: rows.filter((row) => row.currentNode === "可发起结算").length
      }
    };
  }

  private async contractDraftLifecycleByVersion<
    V extends {
      id: string;
      changeType?: string | null;
      versionNo?: number | null;
      status: string;
      firstSubmittedAt?: Date | null;
      abandonedAt?: Date | null;
      abandonedByUserId?: string | null;
      abandonReason?: string | null;
    }
  >(
    versions: V[]
  ): Promise<Map<string, ContractDraftLifecycleClassification>> {
    const versionIds = versions.map((version) => version.id);
    if (!versionIds.length) return new Map();

    type VersionFact = { contractVersionId?: string };
    const client = this.prisma as unknown as {
      approvalInstance?: {
        findMany(args: unknown): Promise<Array<{ id?: string; businessId?: string }>>;
      };
      approvalActionLog?: {
        findMany(args: unknown): Promise<Array<{ approvalInstanceId?: string }>>;
      };
      contractFormalFile?: {
        findMany(args: unknown): Promise<Array<
          VersionFact & { purpose?: string; status?: string }
        >>;
      };
      contractAuthorization?: {
        findMany(args: unknown): Promise<Array<{ originContractVersionId?: string }>>;
      };
      contractVersionAuthorizationLink?: {
        findMany(args: unknown): Promise<Array<VersionFact>>;
      };
      contractSealTask?: {
        findMany(args: unknown): Promise<Array<VersionFact & { status?: string }>>;
      };
      contractArchiveFile?: {
        findMany(args: unknown): Promise<Array<VersionFact>>;
      };
      settlement?: {
        findMany(args: unknown): Promise<Array<VersionFact>>;
      };
      paymentRequest?: {
        findMany(args: unknown): Promise<Array<VersionFact>>;
      };
    };
    const [
      approvalInstances,
      formalFiles,
      authorizations,
      authorizationLinks,
      sealTasks,
      archiveFiles,
      settlements,
      paymentRequests
    ] = await Promise.all([
      client.approvalInstance?.findMany({
        where: {
          businessType: "contract_version",
          businessId: { in: versionIds }
        },
        select: { id: true, businessId: true }
      }) ?? Promise.resolve([]),
      client.contractFormalFile?.findMany({
        where: { contractVersionId: { in: versionIds } },
        select: { contractVersionId: true, purpose: true, status: true }
      }) ?? Promise.resolve([]),
      client.contractAuthorization?.findMany({
        where: { originContractVersionId: { in: versionIds } },
        select: { originContractVersionId: true }
      }) ?? Promise.resolve([]),
      client.contractVersionAuthorizationLink?.findMany({
        where: {
          contractVersionId: { in: versionIds },
          authorizationId: { not: null }
        },
        select: { contractVersionId: true }
      }) ?? Promise.resolve([]),
      client.contractSealTask?.findMany({
        where: { contractVersionId: { in: versionIds } },
        select: { contractVersionId: true, status: true }
      }) ?? Promise.resolve([]),
      client.contractArchiveFile?.findMany({
        where: { contractVersionId: { in: versionIds } },
        select: { contractVersionId: true }
      }) ?? Promise.resolve([]),
      client.settlement?.findMany({
        where: { contractVersionId: { in: versionIds } },
        select: { contractVersionId: true }
      }) ?? Promise.resolve([]),
      client.paymentRequest?.findMany({
        where: { contractVersionId: { in: versionIds } },
        select: { contractVersionId: true }
      }) ?? Promise.resolve([])
    ]);
    const versionIdSet = new Set(versionIds);
    const soleVersionId = versionIds.length === 1 ? versionIds[0] : undefined;
    const versionIdOf = (value?: string) => value
      ? versionIdSet.has(value) ? value : undefined
      : soleVersionId;
    const approvalVersionById = new Map<string, string>();
    const approvalInstanceCounts = new Map<string, number>();
    for (const instance of approvalInstances) {
      const versionId = versionIdOf(instance.businessId);
      if (!versionId) continue;
      approvalInstanceCounts.set(
        versionId,
        (approvalInstanceCounts.get(versionId) ?? 0) + 1
      );
      if (instance.id) approvalVersionById.set(instance.id, versionId);
    }
    const approvalInstanceIds = [...approvalVersionById.keys()];
    const approvalActions = approvalInstanceIds.length
      ? await client.approvalActionLog?.findMany({
          where: { approvalInstanceId: { in: approvalInstanceIds } },
          select: { approvalInstanceId: true }
        }) ?? []
      : [];
    const approvalActionCounts = new Map<string, number>();
    for (const action of approvalActions) {
      const versionId = action.approvalInstanceId
        ? approvalVersionById.get(action.approvalInstanceId)
        : undefined;
      if (!versionId) continue;
      approvalActionCounts.set(
        versionId,
        (approvalActionCounts.get(versionId) ?? 0) + 1
      );
    }
    const countByVersion = <T>(
      rows: T[],
      readVersionId: (row: T) => string | undefined,
      predicate: (row: T) => boolean = () => true
    ) => {
      const counts = new Map<string, number>();
      for (const row of rows) {
        if (!predicate(row)) continue;
        const versionId = versionIdOf(readVersionId(row));
        if (!versionId) continue;
        counts.set(versionId, (counts.get(versionId) ?? 0) + 1);
      }
      return counts;
    };
    const formalFileCounts = countByVersion(
      formalFiles,
      (row) => row.contractVersionId
    );
    const signedFormalFileCounts = countByVersion(
      formalFiles,
      (row) => row.contractVersionId,
      (row) => row.purpose === "mutually_signed_final"
    );
    const activeSignedFormalFileCounts = countByVersion(
      formalFiles,
      (row) => row.contractVersionId,
      (row) =>
        row.purpose === "mutually_signed_final" && row.status === "active"
    );
    const authorizationCounts = countByVersion(
      authorizations,
      (row) => row.originContractVersionId
    );
    const authorizationLinkCounts = countByVersion(
      authorizationLinks,
      (row) => row.contractVersionId
    );
    const sealTaskCounts = countByVersion(
      sealTasks,
      (row) => row.contractVersionId
    );
    const activeSealTaskCounts = countByVersion(
      sealTasks,
      (row) => row.contractVersionId,
      (row) => row.status !== "cancelled"
    );
    const archiveFileCounts = countByVersion(
      archiveFiles,
      (row) => row.contractVersionId
    );
    const settlementCounts = countByVersion(
      settlements,
      (row) => row.contractVersionId
    );
    const paymentRequestCounts = countByVersion(
      paymentRequests,
      (row) => row.contractVersionId
    );

    return new Map(versions.map((version) => {
      const facts: ContractDraftLifecycleFacts = {
        changeType: version.changeType ?? "original",
        versionNo: version.versionNo ?? 1,
        status: parseContractDraftLifecycleStatus(version.status),
        firstSubmittedAt: version.firstSubmittedAt ?? null,
        approvalInstanceCount: approvalInstanceCounts.get(version.id) ?? 0,
        approvalActionCount: approvalActionCounts.get(version.id) ?? 0,
        formalFileCount: formalFileCounts.get(version.id) ?? 0,
        signedFormalFileCount: signedFormalFileCounts.get(version.id) ?? 0,
        activeSignedFormalFileCount:
          activeSignedFormalFileCounts.get(version.id) ?? 0,
        authorizationCount: authorizationCounts.get(version.id) ?? 0,
        authorizationLinkCount: authorizationLinkCounts.get(version.id) ?? 0,
        sealTaskCount: sealTaskCounts.get(version.id) ?? 0,
        activeSealTaskCount: activeSealTaskCounts.get(version.id) ?? 0,
        archiveFileCount: archiveFileCounts.get(version.id) ?? 0,
        settlementCount: settlementCounts.get(version.id) ?? 0,
        paymentRequestCount: paymentRequestCounts.get(version.id) ?? 0,
        abandonedAt: version.abandonedAt ?? null,
        abandonedByUserId: version.abandonedByUserId ?? null,
        abandonReason: version.abandonReason ?? null
      };
      return [version.id, classifyContractDraftLifecycle(facts)];
    }));
  }

  async lifecycleLedger(
    view: DraftLedgerView,
    rawPage: string | number | undefined,
    rawPageSize: string | number | undefined,
    visibleProjectIds: string[],
    actorUserId: string
  ): Promise<LifecycleLedgerPage<Record<string, unknown>>> {
    const page = this.page(rawPage);
    const pageSize = this.pageSize(rawPageSize);
    const contracts = await this.prisma.contract.findMany({
      where: { projectId: { in: visibleProjectIds } },
      orderBy: { updatedAt: "desc" }
    });
    const contractIds = contracts.map((contract) => contract.id);
    const [
      versions,
      terms,
      projects,
      takeoverReadableProjectIds,
      roleKeysByProject
    ] = await Promise.all([
      contractIds.length
        ? this.prisma.contractVersion.findMany({
            where: { contractId: { in: contractIds } },
            orderBy: [{ contractId: "asc" }, { versionNo: "desc" }]
          })
        : Promise.resolve([]),
      contractIds.length
        ? this.prisma.paymentTermsVersion.findMany({
            where: { contractId: { in: contractIds } },
            orderBy: [{ contractId: "asc" }, { versionNo: "desc" }]
          })
        : Promise.resolve([]),
      visibleProjectIds.length
        ? this.prisma.project.findMany({ where: { id: { in: visibleProjectIds } } })
        : Promise.resolve([]),
      this.historicalTakeoverReadableProjectIds(actorUserId, visibleProjectIds),
      this.projectVisibility?.effectiveRoleKeysByProject(actorUserId, visibleProjectIds) ??
        Promise.resolve(new Map<string, RoleKey[]>())
    ]);
    const [takeovers, lifecycleByVersion] = await Promise.all([
      this.contractTakeoverLedgerRows(versions.map((version) => version.id)),
      this.contractDraftLifecycleByVersion(versions)
    ]);
    const projectById = new Map(projects.map((project) => [project.id, project]));
    const versionsByContract = new Map<string, typeof versions>();
    for (const version of versions) {
      versionsByContract.set(version.contractId, [
        ...(versionsByContract.get(version.contractId) ?? []),
        version
      ]);
    }
    const termsByVersion = new Map(terms.map((term) => [term.contractVersionId, term]));
    const takeoverByVersion = new Map(
      takeovers.map((takeover) => [takeover.contractVersionId, takeover])
    );
    const classified = contracts.flatMap<Record<string, unknown>>((contract) => {
      const projectRoleKeys = roleKeysByProject.get(contract.projectId) ?? [];
      const visibility = this.resolveLedgerVisibility(projectRoleKeys);
      if (visibility === "none") return [];
      const all = versionsByContract.get(contract.id) ?? [];
      const lifecycle = projectContractDraftLifecycleViews(
        contract,
        all,
        lifecycleByVersion,
        actorUserId,
        projectRoleKeys
      );
      const rowVersion = lifecycle.versionByView[view];
      if (!lifecycle.matches[view] || !rowVersion) return [];
      const draftLifecycle = lifecycleByVersion.get(rowVersion.id);
      if (!draftLifecycle) return [];
      if (visibility === "summary") {
        // Employee summary never leaves the protected formal ledger; the
        // lifecycle view matcher already prevents drafts from appearing.
        return draftLifecycle.contractLifecycleStage !== "protected_formal" ||
          contract.voidedAt != null
          ? []
          : [this.contractEmployeeSummaryRow(
              contract,
              rowVersion,
              projectById.get(contract.projectId)
            )];
      }
      return [this.contractLedgerRow(
        contract,
        rowVersion,
        termsByVersion.get(rowVersion.id),
        projectById.get(contract.projectId),
        {
          contractVersionId: rowVersion.id,
          contractLifecycleStage: draftLifecycle.contractLifecycleStage,
          contractLifecycleCapabilities: draftLifecycle.capabilities,
          lifecycleKind: draftLifecycle.lifecycleKind,
          lifecycleBlockers: draftLifecycle.blockers,
          draftRevision: rowVersion.draftRevision,
          lifecycleUpdatedAt: rowVersion.updatedAt.toISOString(),
          abandonedAt: rowVersion.abandonedAt?.toISOString() ?? null,
          abandonReason: rowVersion.abandonReason ?? null,
          copyAvailable: view === "ended" &&
            draftLifecycle.contractLifecycleStage === "deleting" &&
            rowVersion.status === "abandoned" &&
            rowVersion.changeType === "original" && rowVersion.versionNo === 1 &&
            contract.ownerUserId === actorUserId,
          ...this.contractTakeoverLedgerProjection(
            contract,
            rowVersion,
            takeoverByVersion.get(rowVersion.id),
            takeoverReadableProjectIds.has(contract.projectId)
          )
        }
      )];
    });
    const summary = {
      formal_ledger: this.lifecycleCount(
        contracts,
        versionsByContract,
        lifecycleByVersion,
        actorUserId,
        "formal_ledger",
        roleKeysByProject
      ),
      my_drafts: this.lifecycleCount(
        contracts,
        versionsByContract,
        lifecycleByVersion,
        actorUserId,
        "my_drafts",
        roleKeysByProject
      ),
      returned_for_revision: this.lifecycleCount(
        contracts,
        versionsByContract,
        lifecycleByVersion,
        actorUserId,
        "returned_for_revision",
        roleKeysByProject
      ),
      ended: this.lifecycleCount(
        contracts,
        versionsByContract,
        lifecycleByVersion,
        actorUserId,
        "ended",
        roleKeysByProject
      )
    };
    const start = (page - 1) * pageSize;
    return {
      rows: classified.slice(start, start + pageSize),
      meta: { page, pageSize, total: classified.length, totalPages: Math.ceil(classified.length / pageSize) },
      summary
    };
  }

  async workbenchLedger(
    view: ContractWorkbenchView,
    rawPage: string | number | undefined,
    rawPageSize: string | number | undefined,
    visibleProjectIds: string[],
    actorUserId: string
  ): Promise<ContractWorkbenchLedgerPage<Record<string, unknown>>> {
    const page = this.page(rawPage);
    const pageSize = this.pageSize(rawPageSize);
    const contracts = await this.prisma.contract.findMany({
      where: { projectId: { in: visibleProjectIds } },
      orderBy: { updatedAt: "desc" }
    });
    const contractIds = contracts.map((contract) => contract.id);
    const [
      versions,
      terms,
      projects,
      pendingWorkItems,
      takeoverReadableProjectIds,
      roleKeysByProject
    ] = await Promise.all([
      contractIds.length
        ? this.prisma.contractVersion.findMany({
            where: { contractId: { in: contractIds } },
            orderBy: [{ contractId: "asc" }, { versionNo: "desc" }]
          })
        : Promise.resolve([]),
      contractIds.length
        ? this.prisma.paymentTermsVersion.findMany({
            where: { contractId: { in: contractIds } },
            orderBy: [{ contractId: "asc" }, { versionNo: "desc" }]
          })
        : Promise.resolve([]),
      visibleProjectIds.length
        ? this.prisma.project.findMany({ where: { id: { in: visibleProjectIds } } })
        : Promise.resolve([]),
      this.me?.getContractPendingWorkItems(actorUserId) ?? Promise.resolve([]),
      this.historicalTakeoverReadableProjectIds(actorUserId, visibleProjectIds),
      this.projectVisibility?.effectiveRoleKeysByProject(actorUserId, visibleProjectIds) ??
        Promise.resolve(new Map<string, RoleKey[]>()),
    ]);
    const pendingVersionIds = new Set(
      pendingWorkItems
        .map((item) => item.businessId)
        .filter((businessId): businessId is string => Boolean(businessId))
    );
    const [takeovers, lifecycleByVersion] = await Promise.all([
      this.contractTakeoverLedgerRows(versions.map((version) => version.id)),
      this.contractDraftLifecycleByVersion(versions)
    ]);
    const versionsByContract = new Map<string, typeof versions>();
    for (const version of versions) {
      versionsByContract.set(version.contractId, [...(versionsByContract.get(version.contractId) ?? []), version]);
    }
    const termsByVersion = new Map(terms.map((term) => [term.contractVersionId, term]));
    const projectById = new Map(projects.map((project) => [project.id, project]));
    const takeoverByVersion = new Map(
      takeovers.map((takeover) => [takeover.contractVersionId, takeover])
    );
    const classified = contracts.flatMap((contract) => {
      const version = this.currentWorkbenchVersion(
        versionsByContract.get(contract.id) ?? [],
        view,
        lifecycleByVersion,
        pendingVersionIds
      );
      if (!version) return [];
      const draftLifecycle = lifecycleByVersion.get(version.id);
      if (!draftLifecycle) return [];
      const projectRoleKeys = roleKeysByProject.get(contract.projectId) ?? [];
      const visibility = this.resolveLedgerVisibility(projectRoleKeys);
      // The legacy workbench endpoint only serves full-view positions;
      // employee summary rows belong on the lifecycle ledger, never here.
      if (visibility !== "full") return [];
      if (!this.matchesWorkbenchView(
        view,
        version,
        draftLifecycle,
        contract.ownerUserId,
        actorUserId,
        pendingVersionIds,
        projectRoleKeys
      )) return [];
      return [this.contractLedgerRow(
        contract,
        version,
        termsByVersion.get(version.id),
        projectById.get(contract.projectId),
        {
          contractVersionId: version.id,
          status: version.status,
          contractLifecycleStage: draftLifecycle.contractLifecycleStage,
          contractLifecycleCapabilities: draftLifecycle.capabilities,
          lifecycleKind: draftLifecycle.lifecycleKind,
          lifecycleBlockers: draftLifecycle.blockers,
          draftRevision: version.draftRevision,
          workbenchEditable: draftLifecycle.capabilities.canEdit,
          copyAvailable: view === "all" &&
            draftLifecycle.contractLifecycleStage === "deleting" &&
            version.status === "abandoned" &&
            version.changeType === "original" && version.versionNo === 1 &&
            contract.ownerUserId === actorUserId,
          lifecycleUpdatedAt: version.updatedAt.toISOString(),
          abandonReason: version.abandonReason ?? null,
          ...this.contractTakeoverLedgerProjection(
            contract,
            version,
            takeoverByVersion.get(version.id),
            takeoverReadableProjectIds.has(contract.projectId)
          )
        }
      )];
    });
    const count = (targetView: ContractWorkbenchView) => contracts.filter((contract) => {
      const version = this.currentWorkbenchVersion(
        versionsByContract.get(contract.id) ?? [],
        targetView,
        lifecycleByVersion,
        pendingVersionIds
      );
      if (!version) return false;
      const draftLifecycle = lifecycleByVersion.get(version.id);
      if (!draftLifecycle) return false;
      const projectRoleKeys = roleKeysByProject.get(contract.projectId) ?? [];
      if (this.resolveLedgerVisibility(projectRoleKeys) !== "full") return false;
      return this.matchesWorkbenchView(
        targetView,
        version,
        draftLifecycle,
        contract.ownerUserId,
        actorUserId,
        pendingVersionIds,
        projectRoleKeys
      );
    }).length;
    const summary = {
      pending_action: count("pending_action"),
      my_drafts: count("my_drafts"),
      in_approval: count("in_approval"),
      pending_seal: count("pending_seal"),
      pending_archive: count("pending_archive"),
      effective: count("effective"),
      all: count("all")
    };
    const start = (page - 1) * pageSize;
    return {
      rows: classified.slice(start, start + pageSize),
      meta: { page, pageSize, total: classified.length, totalPages: Math.ceil(classified.length / pageSize) },
      summary
    };
  }

  async exportLedger(visibleProjectIds: string[], actorUserId: string) {
    const ledger = await this.listRecent(undefined, visibleProjectIds, {
      unbounded: true,
      actorUserId
    });
    const rows = ledger.rows.map((row) => ({
      contractNo: row.contractNo,
      name: row.name,
      project: row.project,
      counterparty: row.counterparty,
      amount: row.amount,
      version: row.version,
      paymentTermsVersion: row.paymentTermsVersion ?? "-",
      currentNode: row.currentNode,
      pendingOwner: row.pendingOwner,
      stalledFor: row.stalledFor,
      returnReason: row.returnReason,
      nextAction: row.nextAction,
      updatedAt: row.updatedAt
    }));
    const buffer = await buildLedgerWorkbook({
      sheetName: "合同台账",
      columns: [
        { header: "合同编号", key: "contractNo", width: 20 },
        { header: "合同名称", key: "name", width: 28 },
        { header: "项目", key: "project", width: 24 },
        { header: "相对方", key: "counterparty", width: 24 },
        { header: "合同金额", key: "amount", width: 18 },
        { header: "合同版本", key: "version", width: 12 },
        { header: "付款条款版本", key: "paymentTermsVersion", width: 16 },
        { header: "当前节点", key: "currentNode", width: 18 },
        { header: "当前责任人", key: "pendingOwner", width: 18 },
        { header: "停留时间", key: "stalledFor", width: 14 },
        { header: "退回原因", key: "returnReason", width: 28 },
        { header: "下一步", key: "nextAction", width: 22 },
        { header: "更新时间", key: "updatedAt", width: 22 }
      ],
      rows
    });

    if (!this.audit) {
      throw new Error("合同台账导出审计服务暂不可用，请稍后重试");
    }
    await this.audit.record(this.prisma, {
      actorUserId,
      action: "contract.ledger.export",
      businessType: "contract_ledger",
      metadata: {
        exportedRows: rows.length,
        visibleProjectCount: visibleProjectIds.length,
        scope: "all_visible_records"
      }
    });

    return {
      buffer,
      fileName: `合同台账-${shanghaiDateStamp()}.xlsx`
    };
  }

  async listCreateOptions(projectId: string): Promise<ContractBusinessOptionReadModel[]> {
    if (!projectId?.trim()) {
      throw new BadRequestException("项目不能为空");
    }

    const contracts = await this.prisma.contract.findMany({
      where: { projectId, voidedAt: null },
      orderBy: [{ code: "asc" }, { temporaryCode: "asc" }, { updatedAt: "desc" }]
    });
    const contractIds = contracts.map((contract) => contract.id);
    if (!contractIds.length) {
      return [];
    }

    const [versions, takeovers, settlements] = await Promise.all([
      this.prisma.contractVersion.findMany({
        where: { contractId: { in: contractIds } },
        orderBy: [{ contractId: "asc" }, { versionNo: "desc" }]
      }),
      (this.prisma as unknown as {
        contractTakeover?: {
          findMany(args: {
            where: { projectId: string; contractId: { in: string[] } };
            select: {
              contractId: true;
              takeoverLevel: true;
              takeoverStatus: true;
              historicalBalanceConfirmedAt: true;
              balanceSourceSummary: true;
            };
            orderBy: { updatedAt: "desc" };
          }): Promise<
            Array<{
              contractId: string;
              takeoverLevel: string;
              takeoverStatus: string;
              historicalBalanceConfirmedAt: Date | null;
              balanceSourceSummary: string | null;
            }>
          >;
        };
      }).contractTakeover?.findMany({
        where: { projectId, contractId: { in: contractIds } },
        select: {
          contractId: true,
          takeoverLevel: true,
          takeoverStatus: true,
          historicalBalanceConfirmedAt: true,
          balanceSourceSummary: true
        },
        orderBy: { updatedAt: "desc" }
      }) ?? Promise.resolve([]),
      this.prisma.settlement.findMany({
        where: { projectId, contractId: { in: contractIds } },
        orderBy: [{ contractId: "asc" }, { createdAt: "desc" }]
      })
    ]);

    const latestVersionByContractId = new Map<string, (typeof versions)[number]>();
    const effectiveVersionByContractId = new Map<string, (typeof versions)[number]>();
    for (const version of versions) {
      if (!latestVersionByContractId.has(version.contractId)) {
        latestVersionByContractId.set(version.contractId, version);
      }
      if (version.status === "effective" && !effectiveVersionByContractId.has(version.contractId)) {
        effectiveVersionByContractId.set(version.contractId, version);
      }
    }

    const takeoverByContractId = new Map<string, (typeof takeovers)[number]>();
    for (const takeover of takeovers) {
      if (!takeoverByContractId.has(takeover.contractId)) {
        takeoverByContractId.set(takeover.contractId, takeover);
      }
    }

    const settlementsByContractId = new Map<string, typeof settlements>();
    for (const settlement of settlements) {
      const rows = settlementsByContractId.get(settlement.contractId) ?? [];
      settlementsByContractId.set(settlement.contractId, [...rows, settlement]);
    }

    return contracts.map((contract) => {
      const latestVersion = latestVersionByContractId.get(contract.id);
      const effectiveVersion = effectiveVersionByContractId.get(contract.id);
      const takeover = takeoverByContractId.get(contract.id);
      const source = contract.source === "historical_takeover" ? "historical_takeover" : "system";
      const paymentUnavailableReason = this.contractPaymentUnavailableReason(
        source,
        latestVersion?.status ?? "draft",
        effectiveVersion?.id ?? null,
        takeover
      );
      const settlementTypeBlockReason = settlementContractTypeBlockReason(contract.contractTypeKey);
      const settlementClosedReason = contract.settlementClosedAt || contract.finalSettlementId
        ? "该合同已完成最终结算，不能再发起新的结算"
        : null;
      const paymentTypeBlockReason =
        contract.contractTypeKey === "generic_contract" || !settlementTypeBlockReason
          ? null
          : "请先明确合同类型，再发起付款申请";

      return {
        contractId: contract.id,
        contractVersionId: effectiveVersion?.id ?? null,
        contractNo: contract.code ?? contract.temporaryCode ?? contract.id,
        contractName: contract.name,
        contractTypeKey: contract.contractTypeKey ?? null,
        counterparty: contract.counterparty,
        amountCents: this.centsValue(effectiveVersion?.amountCents ?? latestVersion?.amountCents ?? 0n),
        versionLabel: effectiveVersion ? `合同 v${effectiveVersion.versionNo}` : "-",
        contractStatus: effectiveVersion?.status ?? latestVersion?.status ?? "draft",
        contractStatusLabel: this.statusView(effectiveVersion?.status ?? latestVersion?.status ?? "draft").label,
        paymentSubjectType:
          effectiveVersion?.signingSubjectType === "affiliate" ? "affiliate" : "our_company",
        source,
        sourceLabel:
          source === "historical_takeover"
            ? `历史接管${takeover?.balanceSourceSummary ? ` · ${takeover.balanceSourceSummary}` : ""}`
            : "系统合同",
        takeoverLevel: takeover?.takeoverLevel ?? null,
        takeoverStatus: takeover?.takeoverStatus ?? null,
        takeoverStatusLabel: takeover ? this.takeoverStatusLabel(takeover.takeoverStatus) : null,
        historicalBalanceConfirmedAt: takeover?.historicalBalanceConfirmedAt?.toISOString() ?? null,
        canCreateSettlement: Boolean(effectiveVersion) && !settlementTypeBlockReason && !settlementClosedReason,
        settlementUnavailableReason: effectiveVersion
          ? settlementClosedReason ?? settlementTypeBlockReason
          : "合同尚未生效，不能发起结算",
        canCreatePayment: !paymentUnavailableReason && !paymentTypeBlockReason,
        paymentUnavailableReason: paymentUnavailableReason ?? paymentTypeBlockReason,
        settlements: (settlementsByContractId.get(contract.id) ?? []).map((settlement) => {
          const canCreatePayment = canCreatePaymentFromSettlementStatus(settlement.status as SettlementStatus);
          return {
            settlementId: settlement.id,
            settlementNo: settlement.code,
            periodLabel: settlement.periodLabel,
            amountCents: moneyCentsToApi(settlement.amountCents),
            payableAmountCents: moneyCentsToApi(settlement.payableAmountCents),
            paidAmountCents: moneyCentsToApi(settlement.paidAmountCents),
            status: settlement.status,
            statusLabel: this.settlementApprovalStatusLabel(settlement.status),
            canCreatePayment,
            unavailableReason: canCreatePayment ? null : "结算未生效或已付款完成"
          };
        })
      };
    });
  }

  async getDetail(
    contractId: string,
    visibleProjectIds?: string[],
    actorUserId?: string,
    requestedVersionId?: string
  ): Promise<ContractDetailReadModel> {
    if (process.env.SKIP_DATABASE_CONNECT === "true") {
      return this.sampleDetail(contractId);
    }

    let contract = await this.prisma.contract.findFirst({
      where: {
        OR: [{ id: contractId }, { code: contractId }],
        ...(visibleProjectIds ? { projectId: { in: visibleProjectIds } } : {})
      }
    });

    if (!contract && actorUserId) {
      const candidate = await this.prisma.contract.findFirst({
        where: { OR: [{ id: contractId }, { code: contractId }] }
      });
      if (candidate) {
        const candidateVersions = await this.prisma.contractVersion.findMany({
          where: { contractId: candidate.id },
          orderBy: { versionNo: "desc" },
          take: 1,
          select: { id: true }
        });
        const handlerTask = candidateVersions[0]
          ? await this.prisma.contractSealTask.findFirst({
              where: {
                contractVersionId: candidateVersions[0].id,
                handlerUserId: actorUserId,
                status: { not: "cancelled" }
              },
              select: { id: true }
            })
          : null;
        if (handlerTask) contract = candidate;
      }
    }

    if (!contract) {
      throw new NotFoundException("未找到合同，请刷新合同台账后重试");
    }

    const [project, versions, actorRoles] = await Promise.all([
      this.prisma.project.findUnique({ where: { id: contract.projectId } }),
      this.prisma.contractVersion.findMany({
        where: {
          contractId: contract.id,
          status: { not: "deleting" }
        },
        orderBy: { versionNo: "desc" }
      }),
      this.actorRoles(actorUserId, contract.projectId)
    ]);
    const roleKeys = actorRoles.roleKeys;

    const lifecycleByVersion = versions.every((candidate) =>
      typeof candidate.status === "string"
    )
      ? await this.contractDraftLifecycleByVersion(versions)
      : new Map<string, ContractDraftLifecycleClassification>();
    const defaultVersion = versions.find((candidate) => {
      const stage = lifecycleByVersion.get(candidate.id)?.contractLifecycleStage;
      return stage !== "deleting" &&
        stage !== "ended_retained" &&
        this.canReadContractVersionDraft(
          candidate,
          contract.ownerUserId,
          actorUserId,
          roleKeys
        );
    });

    const requestedVersion = requestedVersionId
      ? versions.find((candidate) => candidate.id === requestedVersionId)
      : null;
    const endedHistoryRead = Boolean(
      requestedVersion &&
      lifecycleByVersion.get(requestedVersion.id)?.contractLifecycleStage === "ended_retained"
    );
    if (requestedVersionId && !requestedVersion) {
      throw new NotFoundException("未找到请求的合同版本，请刷新合同台账后重试");
    }
    if (
      endedHistoryRead &&
      this.getContractVisibilityLevel(roleKeys) !== "full"
    ) {
      throw new NotFoundException("未找到合同，请刷新合同台账后重试");
    }
    const version = endedHistoryRead ? requestedVersion : defaultVersion;

    if (!version) {
      throw new NotFoundException("未找到合同版本，请刷新合同台账后重试");
    }

    const terms = await this.prisma.paymentTermsVersion.findFirst({
      where: { contractVersionId: version.id },
      orderBy: { versionNo: "desc" }
    });

    if (!terms) {
      throw new NotFoundException("未找到合同付款条款版本，请刷新合同台账后重试");
    }

    const [
      stages,
      settlements,
      paymentRequests,
      contractArchiveFiles,
      approvalTimeline,
      signingFacts,
      latestApprovalInstance,
      historicalApprovedInstances
    ] = await Promise.all([
      this.prisma.paymentTermsStage.findMany({
        where: { paymentTermsVersionId: terms.id },
        orderBy: { createdAt: "asc" }
      }),
      this.prisma.settlement.findMany({
        where: { contractId: contract.id },
        orderBy: { createdAt: "asc" }
      }),
      this.prisma.paymentRequest.findMany({
        where: { contractId: contract.id },
        orderBy: { updatedAt: "desc" }
      }),
      this.contractArchiveFilesForVersion(version.id),
      approvalTimelineForBusiness(this.prisma, "contract_version", version.id),
      version.contractGovernanceVersion === 1
        ? this.governedSigningFacts(version.id)
        : Promise.resolve({ sealTask: null, formalFiles: [] }),
      this.prisma.approvalInstance?.findFirst({
        where: { businessType: "contract_version", businessId: version.id },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }]
      }) ?? Promise.resolve(null),
      this.prisma.approvalInstance?.findMany({
        where: {
          businessType: "contract_version",
          businessId: { in: versions.map((item) => item.id) },
          flowType: "contract.approve",
          status: { in: ["approved", "in_progress"] }
        },
        orderBy: { updatedAt: "desc" },
        select: {
          businessId: true,
          frozenNodes: true,
          currentNodeIndex: true,
          status: true
        }
      }) ?? Promise.resolve([])
    ]);
    const paymentIds = paymentRequests.map((payment) => payment.id);
    const settlementIds = settlements.map((settlement) => settlement.id);
    const [paymentExecutions, settlementArchiveFiles, projectProxyPayments] = await Promise.all([
      paymentIds.length
        ? this.prisma.paymentExecution.findMany({
            where: { paymentRequestId: { in: paymentIds } }
          })
        : Promise.resolve([]),
      settlementIds.length
        ? this.prisma.settlementArchiveFile.findMany({
            where: { settlementId: { in: settlementIds } },
            orderBy: { createdAt: "desc" }
          })
        : Promise.resolve([]),
      settlementIds.length ? this.findProjectProxyPayments(settlementIds) : Promise.resolve([])
    ]);
    const historicalBalance = await this.confirmedHistoricalBalanceForContract(contract.id);
    const draftLifecycle = lifecycleByVersion.get(version.id) ??
      (await this.contractDraftLifecycleByVersion([version])).get(version.id);
    if (!draftLifecycle) {
      throw new NotFoundException("未找到合同版本生命周期，请刷新合同台账后重试");
    }
    if (
      actorUserId &&
      draftLifecycle.contractLifecycleStage === "unsubmitted_draft" &&
      contract.ownerUserId !== actorUserId &&
      !roleKeys.some((roleKey) => CONTRACT_DRAFT_PRIVATE_READ_ROLES.has(roleKey))
    ) {
      throw new NotFoundException("未找到合同，请刷新合同台账后重试");
    }
    const currentApprovalReview = endedHistoryRead
      ? emptyCurrentContractApprovalReview()
      : await this.canReviewCurrentApproval(
          "contract_version",
          version.id,
          contract.projectId,
          roleKeys,
          actorUserId,
          actorRoles.roleScopes
        );
    const candidateReviewApprovalContext =
      currentApprovalReview.access.canReview &&
      version.updatedAt instanceof Date &&
      currentApprovalReview.approval?.updatedAt instanceof Date
        ? {
            expectedContractUpdatedAt: version.updatedAt.toISOString(),
            expectedApprovalInstanceId: currentApprovalReview.approval.id,
            expectedNodeIndex: currentApprovalReview.approval.currentNodeIndex,
            expectedApprovalUpdatedAt:
              currentApprovalReview.approval.updatedAt.toISOString()
          }
        : null;
    const currentApprovalWithdrawal = endedHistoryRead
      ? null
      : await this.currentApprovalWithdrawal(
          "contract_version",
          version.id,
          actorUserId
        );
    const withdrawApprovalContext =
      version.status === "in_approval" &&
      version.updatedAt instanceof Date &&
      currentApprovalWithdrawal?.updatedAt instanceof Date
        ? {
            expectedContractUpdatedAt: version.updatedAt.toISOString(),
            expectedApprovalInstanceId: currentApprovalWithdrawal.id,
            expectedNodeIndex: currentApprovalWithdrawal.currentNodeIndex,
            expectedApprovalUpdatedAt:
              currentApprovalWithdrawal.updatedAt.toISOString()
          }
        : null;
    const approvalReviewAccess = candidateReviewApprovalContext
      ? currentApprovalReview.access
      : { ...currentApprovalReview.access, canReview: false };
    const activeFinal = signingFacts.formalFiles.find((item) =>
      item.purpose === "mutually_signed_final" && item.status === "active"
    ) ?? null;
    const governedFinalAccess = endedHistoryRead
      ? { canUpload: false, canConfirm: false, canSelfConfirm: false }
      : await this.governedFinalAccess(
          actorUserId,
          contract.projectId,
          signingFacts.sealTask,
          activeFinal
        );
    const canReportSigningMaterialChange = endedHistoryRead
      ? false
      : await this.canReportSigningMaterialChange(
          actorUserId,
          signingFacts.sealTask
        );
    const ownerRiskClient = this.prisma as unknown as {
      projectOwnerContract?: { findMany?: unknown };
      contract?: { findMany?: unknown };
      contractVersion?: { findMany?: unknown };
    };
    const ownerContractRisk =
      !endedHistoryRead &&
      typeof ownerRiskClient.projectOwnerContract?.findMany === "function" &&
      typeof ownerRiskClient.contract?.findMany === "function" &&
      typeof ownerRiskClient.contractVersion?.findMany === "function"
        ? await loadContractOwnerRisk(this.prisma, contract.projectId)
        : null;

    const status = this.statusView(version.status);
    const availableActions = endedHistoryRead
      ? []
      : this.contractActions(
      version.status,
      roleKeys,
      approvalReviewAccess,
      contractArchiveFiles,
      {
        actorUserId,
        ownerUserId: contract.ownerUserId,
        contractTypeKey: contract.contractTypeKey,
        governed: version.contractGovernanceVersion === 1,
        sealTask: signingFacts.sealTask,
        activeFinal,
        approvalFormAvailable: Boolean(
          latestApprovalInstance?.status === "approved" &&
          canUseCurrentContractApprovalForm(version.status)
        ),
        approvalParticipant: Boolean(
          actorUserId &&
          latestApprovalInstance?.status === "approved" &&
          canUseCurrentContractApprovalForm(version.status) && (
          latestApprovalInstance.applicantUserId === actorUserId ||
          await this.prisma.approvalActionLog?.findFirst({
            where: {
              approvalInstanceId: latestApprovalInstance.id,
              actorUserId,
              action: "approve"
            },
            select: { id: true }
          })
        )),
        canUploadGovernedFinal: governedFinalAccess.canUpload,
        canConfirmGovernedFinal: governedFinalAccess.canConfirm,
        canSelfConfirmGovernedFinal: governedFinalAccess.canSelfConfirm,
        canReportSigningMaterialChange,
        genericDraftActionsAllowed: Boolean(draftLifecycle.expectedAction),
        withdrawApprovalContext
      }
    );

    if (
      !endedHistoryRead &&
      draftLifecycle.expectedAction &&
      actorUserId && actorUserId === contract.ownerUserId
    ) {
      availableActions.push(detailAction({
        key: draftLifecycle.expectedAction,
        label: draftLifecycle.expectedAction === "delete_pristine_draft"
          ? "删除草稿"
          : "放弃申请",
        kind: "danger",
        roleKeys,
        skipRoleCheck: true,
        enabled: true,
        requiresComment:
          draftLifecycle.expectedAction === "abandon_application"
      }));
    }

    const enabledReviewActions = availableActions.filter(
      (action) => action.key === "review_approval" && action.enabled
    );
    const reviewApprovalContext =
      candidateReviewApprovalContext && enabledReviewActions.length === 1
        ? candidateReviewApprovalContext
        : null;

    const contractCode = contract.code ?? contract.temporaryCode ?? contract.id;
    const latestSettlement = settlements.at(-1);
    const currentApproval = historicalApprovedInstances.find(
      (item) => item.businessId === version.id && item.status === "in_progress"
    );
    const currentApprovalNodes = Array.isArray(currentApproval?.frozenNodes)
      ? currentApproval.frozenNodes
      : [];
    const ownerContractRiskReadModel = ownerContractRisk
      ? {
          status: ownerContractRisk.status,
          ownerContractAmountCents:
            ownerContractRisk.ownerContractAmountCents.toString(),
          downstreamContractAmountCents:
            ownerContractRisk.downstreamContractAmountCents.toString(),
          excessAmountCents: ownerContractRisk.excessAmountCents.toString(),
          message: ownerContractRisk.status === "clear"
            ? "我方对下合同累计金额未超过业主主合同有效金额。"
            : ownerContractRisk.status === "missing_owner_contract"
              ? "项目尚未登记生效业主主合同，本次合同终审必须显式确认风险。"
              : `我方对下合同累计金额已超过业主主合同有效金额 ${formatMoneyCentsAsYuan(
                  ownerContractRisk.excessAmountCents
                )} 元，本次合同终审必须显式确认风险。`,
          requiresExplicitConfirmation: Boolean(
            ownerContractRisk.status !== "clear" &&
            currentApproval &&
            currentApproval.currentNodeIndex === currentApprovalNodes.length - 1 &&
            availableActions.some(
              (action) => action.key === "review_approval" && action.enabled
            )
          )
        } satisfies NonNullable<ContractDetailReadModel["ownerContractRisk"]>
      : null;
    const signingMaterialChangeContext =
      signingFacts.sealTask &&
      availableActions.some(
        (action) => action.key === "report_signing_material_change" && action.enabled
      )
        ? {
            expectedRevision: version.draftRevision,
            expectedSealTaskId: signingFacts.sealTask.id,
            expectedStatus: version.status as ContractSigningMaterialChangeStatus
          }
        : null;
    return {
      id: contractCode,
      contractVersionId: version.id,
      title: `${contractCode} · ${contract.name}`,
      meta: [
        { label: "当前状态", value: status.label, tone: status.tone },
        { label: "当前版本", value: `合同 v${version.versionNo}` },
        { label: "付款条款", value: `v${terms.versionNo} ${this.termsStatusLabel(terms.status)}` },
        { label: "责任部门", value: "合同部" },
        { label: "当前处理人", value: this.currentOwnerLabel(version.status) },
        { label: "下一步动作", value: this.nextActionLabel(version.status), tone: status.tone }
      ],
      baseInfo: [
        { label: "合同编号", value: contractCode },
        { label: "合同名称", value: contract.name },
        { label: "项目", value: project?.name ?? contract.projectId },
        { label: "相对方", value: contract.counterparty },
        { label: "合同金额", value: this.formatContractAmount(version) },
        {
          label: "发票类型",
          value: this.formatContractInvoiceType(version.invoiceType)
        },
        {
          label: "合同税率",
          value: version.defaultTaxRatePercent == null
            ? "未明确"
            : `${version.defaultTaxRatePercent.toString()}%`
        },
        { label: "创建人", value: "合同部" }
      ],
      effectivenessSteps: this.effectivenessSteps(version.status),
      paymentTermStages: stages.map((stage) => ({
        id: stage.id,
        version: `v${terms.versionNo}`,
        paymentTermsVersion: `v${terms.versionNo}`,
        status: this.termsStatusLabel(terms.status),
        contractVersion: `合同 v${version.versionNo}`,
        basis: this.basisLabel(stage.basis),
        ratio: this.ratioLabel(stage.ratioBps),
        accountPeriod: `${stage.dueDays}天`,
        triggerEvent: stage.triggerEvent,
        advanceDeductionMode: stage.advanceDeductionMode,
        advanceDeductionRatioBps: stage.advanceDeductionRatioBps,
        advanceDeductionStartRatioBps: stage.advanceDeductionStartRatioBps
      })),
      settlementBlockMessage: this.settlementBlockMessage(version.status, contract.contractTypeKey),
      settlementPayment: this.settlementPayment(
        version.amountCents,
        settlements,
        settlementArchiveFiles,
        paymentRequests,
        paymentExecutions,
        projectProxyPayments,
        historicalBalance
      ),
      archiveFiles: contractArchiveFiles,
      formalFiles: signingFacts.formalFiles,
      ...(ownerContractRiskReadModel
        ? { ownerContractRisk: ownerContractRiskReadModel }
        : {}),
      sealTask: signingFacts.sealTask,
      signingMaterialChangeContext,
      approvalTimeline,
      availableActions,
      availableActionKeys: availableActions
        .filter((action) => action.enabled)
        .map((action) => action.key),
      reviewApprovalContext,
      withdrawApprovalContext,
      historyReadOnly: endedHistoryRead,
      contractLifecycleStage: draftLifecycle.contractLifecycleStage,
      contractLifecycleCapabilities: draftLifecycle.capabilities,
      lifecycleKind: draftLifecycle.lifecycleKind,
      lifecycleBlockers: draftLifecycle.blockers,
      draftRevision: version.draftRevision,
      documentContentRevision: version.documentContentRevision,
      documentContentFingerprint: version.documentContentFingerprint,
      lifecycleUpdatedAt: version.updatedAt?.toISOString() ?? contract.updatedAt?.toISOString() ?? "",
      primaryAction: primaryActionKey(availableActions),
      disabledReasons: disabledActionReasons(availableActions),
      chainLinks: [
        { label: "关联合同台账", to: "/contracts" },
        { label: "关联结算", to: latestSettlement ? `/settlements/${latestSettlement.code}` : "/settlements" },
        { label: "归档资料", to: "/archives" },
        { label: "审计日志", to: "/audit" }
      ],
      changeVersions: contractChangeVersionsReadModel(versions, historicalApprovedInstances)
    };
  }

  private sampleDetail(contractId: string): ContractDetailReadModel {
    return {
      id: contractId,
      contractVersionId: "contract-version-sample",
      title: "HT-2026-001 · 钢材采购合同",
      meta: [
        { label: "当前状态", value: "待用章", tone: "warning" },
        { label: "当前版本", value: "合同 v1" },
        { label: "付款条款", value: "v1 草拟中" },
        { label: "责任部门", value: "合同部" },
        { label: "当前处理人", value: "合同部成员" },
        { label: "下一步动作", value: "发起用章", tone: "warning" }
      ],
      baseInfo: [
        { label: "合同编号", value: contractId },
        { label: "合同名称", value: "钢材采购合同" },
        { label: "项目", value: "建设项目一期" },
        { label: "相对方", value: "钢材供应商" },
        { label: "合同金额", value: "¥1,280,000.00" },
        { label: "发票类型", value: "增值税专用发票" },
        { label: "合同税率", value: "13%" },
        { label: "创建人", value: "合同部 李工" }
      ],
      effectivenessSteps: [
        { label: "合同审批", status: "已通过", tone: "success" },
        { label: "用章", status: "待处理", tone: "warning" },
        { label: "归档上传", status: "未开始", tone: "default" },
        { label: "主管确认", status: "未开始", tone: "default" },
        { label: "合同生效", status: "阻塞", tone: "danger" }
      ],
      paymentTermStages: [
        {
          id: "current-settlement-payment",
          version: "v1",
          paymentTermsVersion: "v1",
          status: "随合同生效",
          contractVersion: "合同 v1",
          basis: "当期结算",
          ratio: "80%",
          accountPeriod: "30天",
          triggerEvent: "结算归档生效"
        },
        {
          id: "retention-payment",
          version: "v1",
          paymentTermsVersion: "v1",
          status: "随合同生效",
          contractVersion: "合同 v1",
          basis: "质保金",
          ratio: "20%",
          accountPeriod: "365天",
          triggerEvent: "质保期满"
        }
      ],
      settlementBlockMessage:
        "合同尚未生效，暂不可发起结算；结算未生效前不可创建付款申请。",
      settlementPayment: {
        summary: [
          { label: "累计生效结算", value: "¥0.00", tone: "default" },
          { label: "保守可申请余额", value: "¥0.00", tone: "warning" },
          { label: "审批中占用", value: "¥0.00", tone: "warning" },
          { label: "已批待付", value: "¥0.00", tone: "default" },
          { label: "已实付", value: "¥0.00", tone: "default" },
          { label: "最新合同剩余额度", value: "¥1,280,000.00", tone: "primary" }
        ],
        settlementRows: [],
        paymentRows: [],
        calculationNote:
          "当前可申请余额暂按已生效应付金额 - 已实付 - 审批中占用 - 已批待付计算，未纳入账期、质保金、预付款扣回和项目资金池；最新合同剩余额度以当前最新合同金额扣减合同维度累计生效结算，仅作台账提示。"
      },
      archiveFiles: [],
      approvalTimeline: [],
      availableActions: [],
      availableActionKeys: [],
      reviewApprovalContext: null,
      withdrawApprovalContext: null,
      documentContentRevision: 1,
      documentContentFingerprint: null,
      primaryAction: null,
      disabledReasons: [],
      chainLinks: [
        { label: "关联合同台账", to: "/contracts" },
        { label: "关联结算", to: "/settlements/JS-2026-018" },
        { label: "归档资料", to: "/archives" },
        { label: "审计日志", to: "/audit" }
      ]
    };
  }

  private async findProjectProxyPayments(settlementIds: string[]) {
    const projectProxyPaymentClient = (this.prisma as unknown as {
      projectProxyPayment?: {
        findMany: (args: {
          where: { settlementId: { in: string[] }; voidedAt: null };
          select: { settlementId: true; amountCents: true };
        }) => Promise<Array<{ settlementId: string | null; amountCents: bigint }>>;
      };
    }).projectProxyPayment;

    if (!projectProxyPaymentClient) {
      return [];
    }

    return projectProxyPaymentClient.findMany({
      where: { settlementId: { in: settlementIds }, voidedAt: null },
      select: { settlementId: true, amountCents: true }
    });
  }

  private settlementPayment(
    contractAmountCents: bigint,
    settlements: Array<{
      id: string;
      code: string;
      periodLabel: string;
      status: string;
      amountCents: bigint;
      payableAmountCents: bigint;
      updatedAt: Date;
    }>,
    settlementArchiveFiles: Array<{
      settlementId: string;
      status: string;
      confirmedAt: Date | null;
    }>,
    paymentRequests: Array<{
      id: string;
      settlementId: string | null;
      sourceType?: string | null;
      paymentTermsStageId?: string | null;
      code: string;
      status: string;
      requestedAmountCents: bigint;
      approvedAmountCents: bigint | null;
      paidAmountCents: bigint;
      updatedAt: Date;
    }>,
    paymentExecutions: Array<{
      paymentRequestId: string;
      amountCents: bigint;
      paidAt: Date;
      voucherFileId: string;
    }>,
    projectProxyPayments: Array<{
      settlementId: string | null;
      amountCents: bigint;
    }>,
    historicalBalance?: HistoricalContractPaymentBalance
  ): ContractSettlementPaymentReadModel {
    const historicalSettledCents = this.toBigIntCents(historicalBalance?.settledCents ?? 0n);
    const historicalApprovalPendingCents = this.toBigIntCents(
      historicalBalance?.approvalPendingPaymentCents ?? 0n
    );
    const historicalApprovedPendingCents = this.toBigIntCents(
      historicalBalance?.approvedPendingPaymentCents ?? 0n
    );
    const historicalPaidCents = this.toBigIntCents(historicalBalance?.paidCents ?? 0n);
    const historicalProxyPaidCents = this.toBigIntCents(historicalBalance?.proxyPaidCents ?? 0n);
    const historicalAdvancePaidCents = this.toBigIntCents(
      historicalBalance?.advancePaidCents ?? 0n
    );
    const historicalAdvanceDeductedCents = this.toBigIntCents(
      historicalBalance?.advanceDeductedCents ?? 0n
    );
    const historicalOtherConfirmedOccupancyCents = this.toBigIntCents(
      historicalBalance?.otherConfirmedOccupancyCents ?? 0n
    );
    const hasHistoricalBalance =
      historicalSettledCents +
        historicalApprovalPendingCents +
        historicalApprovedPendingCents +
        historicalPaidCents +
        historicalProxyPaidCents +
        historicalAdvancePaidCents +
        historicalAdvanceDeductedCents +
        historicalOtherConfirmedOccupancyCents >
      0n;
    const archiveFileBySettlementId = new Map<string, (typeof settlementArchiveFiles)[number]>();
    for (const archiveFile of settlementArchiveFiles) {
      if (!archiveFileBySettlementId.has(archiveFile.settlementId)) {
        archiveFileBySettlementId.set(archiveFile.settlementId, archiveFile);
      }
    }
    const paidByPaymentId = new Map<
      string,
      { amountCents: bigint; paidAt: Date | null; hasVoucher: boolean }
    >();
    for (const execution of paymentExecutions) {
      const current = paidByPaymentId.get(execution.paymentRequestId) ?? {
        amountCents: 0n,
        paidAt: null,
        hasVoucher: false
      };
      paidByPaymentId.set(execution.paymentRequestId, {
        amountCents:
          current.amountCents + dbMoneyToBigInt(execution.amountCents, "付款执行金额"),
        paidAt:
          !current.paidAt || execution.paidAt.getTime() > current.paidAt.getTime()
            ? execution.paidAt
            : current.paidAt,
        hasVoucher: current.hasVoucher || !!execution.voucherFileId
      });
    }

    let cumulativeEffectiveSettlementCents = 0n;
    let cumulativeEffectivePayableCents = 0n;
    const settlementRows = settlements.map((settlement) => {
      const archiveFile = archiveFileBySettlementId.get(settlement.id);
      const before = cumulativeEffectiveSettlementCents;
      if (this.isEffectiveSettlementStatus(settlement.status)) {
        cumulativeEffectiveSettlementCents += dbMoneyToBigInt(
          settlement.amountCents,
          "结算金额"
        );
        cumulativeEffectivePayableCents += dbMoneyToBigInt(
          settlement.payableAmountCents,
          "结算应付金额"
        );
      }

      return {
        id: settlement.code,
        settlementNo: settlement.code,
        period: settlement.periodLabel,
        settlementDate: this.date(settlement.updatedAt),
        settlementMethod: "待补充",
        currentAmount: this.formatMoney(settlement.amountCents),
        cumulativeBeforeAmount: this.formatMoney(before),
        cumulativeAfterAmount: this.formatMoney(cumulativeEffectiveSettlementCents),
        approvalStatus: this.settlementApprovalStatusLabel(settlement.status),
        archiveStatus: archiveFile
          ? this.settlementArchiveFileStatusLabel(archiveFile)
          : this.settlementArchiveStatusLabel(settlement.status)
      };
    });
    const settlementNoById = new Map(settlements.map((settlement) => [settlement.id, settlement.code]));
    const proxyPaidBySettlementId = new Map<string, bigint>();
    for (const proxyPayment of projectProxyPayments) {
      if (!proxyPayment.settlementId) {
        continue;
      }
      proxyPaidBySettlementId.set(
        proxyPayment.settlementId,
        (proxyPaidBySettlementId.get(proxyPayment.settlementId) ?? 0n) +
          this.toBigIntCents(proxyPayment.amountCents)
      );
    }

    let actualPaidCents = 0n;
    let proxyPaidCents = 0n;
    let approvalPendingCents = 0n;
    let approvedPendingCents = 0n;
    const paymentRows = paymentRequests.map((payment) => {
      const execution = paidByPaymentId.get(payment.id);
      const paidCents =
        execution?.amountCents ?? dbMoneyToBigInt(payment.paidAmountCents, "付款实付金额");
      const approved = this.isApprovedPaymentStatus(payment.status);
      const approvedCents = approved
        ? dbMoneyToBigInt(
            payment.approvedAmountCents ?? payment.requestedAmountCents,
            "付款批准金额"
          )
        : 0n;
      const remainingApprovedCents = approvedCents - paidCents;
      actualPaidCents += paidCents;
      if (["approval_pending", "in_approval"].includes(payment.status)) {
        const pendingBalance = payment.requestedAmountCents - payment.paidAmountCents;
        approvalPendingCents += pendingBalance > 0n ? pendingBalance : 0n;
      }
      if (["approved_pending_payment", "partially_paid"].includes(payment.status)) {
        approvedPendingCents += remainingApprovedCents > 0n ? remainingApprovedCents : 0n;
      }

      return {
        id: payment.code,
        paymentNo: payment.code,
        settlementNo: payment.settlementId
          ? (settlementNoById.get(payment.settlementId) ?? payment.settlementId)
          : payment.sourceType === "contract_due" && payment.paymentTermsStageId
            ? "合同冻结阶段直接付款"
            : this.paymentSourceLabel(payment.sourceType),
        requestedAmount: this.formatMoney(payment.requestedAmountCents),
        approvedAmount: approved ? this.formatMoney(approvedCents) : "待审批",
        paidAmount: this.formatMoney(paidCents),
        paymentDate: execution?.paidAt ? this.date(execution.paidAt) : "-",
        approvalStatus: this.paymentApprovalStatusLabel(payment.status),
        paymentStatus: this.paymentExecutionStatusLabel(payment.status, paidCents, approvedCents),
        voucherStatus: execution?.hasVoucher ? "已上传" : paidCents > 0n ? "待上传" : "未上传"
      };
    });
    for (const proxyAmountCents of proxyPaidBySettlementId.values()) {
      proxyPaidCents += proxyAmountCents;
    }
    const totalEffectiveSettlementCents =
      cumulativeEffectiveSettlementCents + historicalSettledCents;
    const totalApprovalPendingCents = approvalPendingCents + historicalApprovalPendingCents;
    const totalApprovedPendingCents = approvedPendingCents + historicalApprovedPendingCents;
    const totalActualPaidCents = actualPaidCents + historicalPaidCents;
    const totalProxyPaidCents = proxyPaidCents + historicalProxyPaidCents;
    const cumulativePaidCents = totalActualPaidCents + totalProxyPaidCents;
    const conservativeAvailableCents =
      cumulativeEffectivePayableCents -
      cumulativePaidCents -
      totalApprovalPendingCents -
      totalApprovedPendingCents -
      historicalOtherConfirmedOccupancyCents;
    const remainingContractCents =
      dbMoneyToBigInt(contractAmountCents, "合同金额") - totalEffectiveSettlementCents;
    const summary: ContractSettlementPaymentReadModel["summary"] = [
      { label: "累计生效结算", value: this.formatMoney(totalEffectiveSettlementCents), tone: "success" },
      ...(hasHistoricalBalance
        ? [
            {
              label: "系统内累计生效结算",
              value: this.formatMoney(cumulativeEffectiveSettlementCents),
              tone: "default" as const
            },
            {
              label: "历史累计生效结算",
              value: this.formatMoney(historicalSettledCents),
              tone: "success" as const
            }
          ]
        : []),
      {
        label: "保守可申请余额",
        value: this.formatMoney(conservativeAvailableCents > 0n ? conservativeAvailableCents : 0n),
        tone: "warning"
      },
      ...(hasHistoricalBalance
        ? [
            {
              label: "系统内审批中占用",
              value: this.formatMoney(approvalPendingCents),
              tone: "warning" as const
            },
            {
              label: "历史审批中占用",
              value: this.formatMoney(historicalApprovalPendingCents),
              tone: "warning" as const
            },
            {
              label: "系统内已批待付",
              value: this.formatMoney(approvedPendingCents),
              tone: "warning" as const
            },
            {
              label: "历史已批待付",
              value: this.formatMoney(historicalApprovedPendingCents),
              tone: "warning" as const
            },
            {
              label: "系统内已实付",
              value: this.formatMoney(actualPaidCents),
              tone: "success" as const
            },
            {
              label: "历史已实付",
              value: this.formatMoney(historicalPaidCents),
              tone: "success" as const
            }
          ]
        : [
            { label: "审批中占用", value: this.formatMoney(approvalPendingCents), tone: "warning" as const },
            { label: "已批待付", value: this.formatMoney(approvedPendingCents), tone: "warning" as const },
            { label: "已实付", value: this.formatMoney(actualPaidCents), tone: "success" as const }
          ])
    ];

    if (hasHistoricalBalance || proxyPaidCents > 0n) {
      if (hasHistoricalBalance) {
        summary.push(
          { label: "系统内总包代付", value: this.formatMoney(proxyPaidCents), tone: "success" },
          { label: "历史总包代付", value: this.formatMoney(historicalProxyPaidCents), tone: "success" }
        );
      } else {
        summary.push({ label: "总包代付", value: this.formatMoney(proxyPaidCents), tone: "success" });
      }
      summary.push({ label: "累计已支付", value: this.formatMoney(cumulativePaidCents), tone: "success" });
    }
    if (hasHistoricalBalance) {
      summary.push(
        { label: "历史其他确认占用", value: this.formatMoney(historicalOtherConfirmedOccupancyCents), tone: "warning" },
        { label: "历史预付款已付", value: this.formatMoney(historicalAdvancePaidCents), tone: "success" },
        { label: "历史预付款已扣回", value: this.formatMoney(historicalAdvanceDeductedCents), tone: "default" }
      );
    }

    summary.push({
      label: "最新合同剩余额度",
      value: this.formatMoney(remainingContractCents > 0n ? remainingContractCents : 0n),
      tone: "primary"
    });

    return {
      summary,
      settlementRows,
      paymentRows,
      calculationNote:
        "合同详情为金额摘要，系统内金额与历史接管余额分列；精确可申请额以付款申请预览的到账期、预付款扣回、总包代付和历史余额硬扣减口径为准。"
    };
  }

  private async actorRoles(actorUserId: string | undefined, projectId: string): Promise<{
    roleKeys: RoleKey[];
    roleScopes?: ApprovalActorRoleScopes;
  }> {
    if (!actorUserId || !this.projectVisibility) {
      return { roleKeys: [] };
    }
    const scopedVisibility = this.projectVisibility as ProjectVisibilityService & {
      effectiveRoleScopes?: (
        userId: string,
        scopedProjectId: string
      ) => Promise<ApprovalActorRoleScopes>;
    };
    if (scopedVisibility.effectiveRoleScopes) {
      const roleScopes = await scopedVisibility.effectiveRoleScopes(actorUserId, projectId);
      return {
        roleKeys: resolveEffectiveRoleKeys(
          roleScopes.globalRoleKeys,
          roleScopes.projectRoleKeys
        ),
        roleScopes
      };
    }
    return { roleKeys: await this.projectVisibility.effectiveRoleKeys(actorUserId, projectId) };
  }

  private canReadContractVersionDraft(
    version: { status: string; firstSubmittedAt?: Date | null },
    ownerUserId: string | null,
    actorUserId: string | undefined,
    projectRoleKeys: readonly RoleKey[]
  ) {
    if (!actorUserId || version.status !== "draft" || version.firstSubmittedAt) {
      return true;
    }
    return ownerUserId === actorUserId ||
      projectRoleKeys.some((roleKey) => CONTRACT_DRAFT_PRIVATE_READ_ROLES.has(roleKey));
  }

  private async canReviewCurrentApproval(
    businessType: string,
    businessId: string,
    projectId: string,
    roleKeys: RoleKey[],
    actorUserId?: string,
    actorRoleScopes?: ApprovalActorRoleScopes
  ): Promise<CurrentContractApprovalReview> {
    if (!actorUserId) {
      return emptyCurrentContractApprovalReview();
    }

    const approvalClient = (this.prisma as unknown as {
      approvalInstance?: {
        findMany(args: {
          where: {
            businessType: string;
            businessId: string;
            flowType: "contract.approve";
            status: "in_progress";
          };
          orderBy: Array<{ createdAt: "desc" } | { id: "desc" }>;
          take: 2;
          select: {
            id: true;
            applicantUserId: true;
            frozenNodes: true;
            currentNodeIndex: true;
            updatedAt: true;
          };
        }): Promise<Array<{
          id: string;
          applicantUserId: string;
          frozenNodes: unknown;
          currentNodeIndex: number;
          updatedAt: Date;
        }>>;
      };
    }).approvalInstance;
    if (!approvalClient?.findMany) {
      return emptyCurrentContractApprovalReview();
    }

    const instances = await approvalClient.findMany({
      where: {
        businessType,
        businessId,
        flowType: "contract.approve",
        status: "in_progress"
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 2,
      select: {
        id: true,
        applicantUserId: true,
        frozenNodes: true,
        currentNodeIndex: true,
        updatedAt: true
      }
    });

    if (instances.length !== 1) {
      return emptyCurrentContractApprovalReview();
    }
    const instance = instances[0];

    const directOrAssignedAccess = approvalReviewAccessOnFrozenNode(
      instance.frozenNodes,
      instance.currentNodeIndex,
      roleKeys,
      actorUserId,
      instance.applicantUserId,
      false,
      true,
      actorRoleScopes,
      true
    );
    if (directOrAssignedAccess.canAct) {
      return {
        access: directOrAssignedAccess,
        approval: {
          id: instance.id,
          currentNodeIndex: instance.currentNodeIndex,
          updatedAt: instance.updatedAt
        }
      };
    }

    const activeDelegators = await this.activeDelegatedApprovalIdentities(
      actorUserId,
      projectId
    );
    const delegatedAccess = approvalReviewAccessOnFrozenNode(
      instance.frozenNodes,
      instance.currentNodeIndex,
      roleKeys,
      actorUserId,
      instance.applicantUserId,
      activeDelegators,
      true,
      actorRoleScopes,
      true
    );
    return {
      access: delegatedAccess,
      approval: delegatedAccess.canAct
        ? {
            id: instance.id,
            currentNodeIndex: instance.currentNodeIndex,
            updatedAt: instance.updatedAt
          }
        : null
    };
  }

  private async currentApprovalWithdrawal(
    businessType: string,
    businessId: string,
    actorUserId?: string
  ): Promise<CurrentContractApprovalWithdrawal | null> {
    if (!actorUserId) return null;

    const approvalClient = (this.prisma as unknown as {
      approvalInstance?: {
        findMany(args: {
          where: {
            businessType: string;
            businessId: string;
            flowType: "contract.approve";
            status: "in_progress";
          };
          orderBy: Array<{ createdAt: "desc" } | { id: "desc" }>;
          take: 2;
          select: {
            id: true;
            applicantUserId: true;
            currentNodeIndex: true;
            updatedAt: true;
          };
        }): Promise<Array<{
          id: string;
          applicantUserId: string;
          currentNodeIndex: number;
          updatedAt: Date;
        }>>;
      };
    }).approvalInstance;
    if (!approvalClient?.findMany) return null;

    const instances = await approvalClient.findMany({
      where: {
        businessType,
        businessId,
        flowType: "contract.approve",
        status: "in_progress"
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 2,
      select: {
        id: true,
        applicantUserId: true,
        currentNodeIndex: true,
        updatedAt: true
      }
    });
    if (instances.length !== 1 || instances[0]?.applicantUserId !== actorUserId) {
      return null;
    }

    return instances[0];
  }

  private async activeDelegatedApprovalIdentities(
    actorUserId: string,
    projectId: string
  ): Promise<Array<{
    userId: string;
    roleKeys: RoleKey[];
    roleScopes?: ApprovalActorRoleScopes;
  }>> {
    if (!this.projectVisibility) return [];

    const delegatorIds = await activeApprovalDelegatorIds(this.prisma, actorUserId, new Date());
    const identities: Array<{
      userId: string;
      roleKeys: RoleKey[];
      roleScopes?: ApprovalActorRoleScopes;
    }> = [];
    for (const delegatorId of delegatorIds) {
      const roles = await this.actorRoles(delegatorId, projectId);
      identities.push({
        userId: delegatorId,
        roleKeys: roles.roleKeys,
        roleScopes: roles.roleScopes
      });
    }
    return identities;
  }

  private contractActions(
    status: string,
    roleKeys: RoleKey[],
    approvalReviewAccess: ApprovalReviewAccess,
    archiveFiles: ContractDetailReadModel["archiveFiles"],
    context?: {
      actorUserId?: string;
      ownerUserId: string | null;
      contractTypeKey?: string | null;
      governed: boolean;
      sealTask: ContractDetailReadModel["sealTask"];
      activeFinal: NonNullable<ContractDetailReadModel["formalFiles"]>[number] | null;
      approvalFormAvailable: boolean;
      approvalParticipant: boolean;
      canUploadGovernedFinal: boolean;
      canConfirmGovernedFinal: boolean;
      canSelfConfirmGovernedFinal: boolean;
      canReportSigningMaterialChange: boolean;
      genericDraftActionsAllowed: boolean;
      withdrawApprovalContext: ContractDetailReadModel["withdrawApprovalContext"];
    }
  ): DetailActionReadModel[] {
    const materialChangeStatus = status as ContractSigningMaterialChangeStatus;
    const expectedMaterialChangeTaskStatus =
      MATERIAL_CHANGE_TASK_STATUS_BY_VERSION_STATUS[materialChangeStatus];
    const signingMaterialChangeActions =
      context?.governed &&
      context.canReportSigningMaterialChange &&
      context.sealTask?.status === expectedMaterialChangeTaskStatus
        ? [detailAction({
            key: "report_signing_material_change",
            label: "申报签署内容实质变化（退回重审）",
            kind: "danger",
            roleKeys,
            skipRoleCheck: true,
            enabled: true,
            requiresComment: true
          })]
        : [];
    const workflowActions = [
      detailAction({
        key: "download_approval_form",
        label: "下载审批单",
        kind: "normal",
        roleKeys,
        enabled: Boolean(context?.approvalFormAvailable && (
          context.approvalParticipant ||
          context.actorUserId === context.ownerUserId ||
          roleKeys.some((role) => [
            "contract_staff", "contract_director", "project_manager", "finance_staff",
            "finance_director", "comprehensive_director", "chairman", "general_manager"
          ].includes(role))
        )),
        disabledReason: "审批单尚未生成或当前账号无下载权限"
      }),
      ...(context?.withdrawApprovalContext
        ? [detailAction({
            key: "withdraw_approval",
            label: "撤回审批",
            kind: "normal",
            roleKeys,
            skipRoleCheck: true,
            enabled: true
          })]
        : []),
      detailAction({
        key: "remind_approval",
        label: "催办审批",
        kind: "normal",
        roleKeys,
        requiredAction: "contract.submit",
        enabled: ["in_approval", "approval_pending"].includes(status)
      }),
      detailAction({
        key: "transfer_approval",
        label: "转审",
        kind: "normal",
        roleKeys,
        skipRoleCheck: true,
        enabled: approvalReviewAccess.canAct,
        disabledReason: "当前用户不是当前审批节点处理人"
      }),
      detailAction({
        key: "delegate_approval",
        label: "委托",
        kind: "normal",
        roleKeys,
        skipRoleCheck: true,
        enabled: approvalReviewAccess.canAct,
        disabledReason: "当前用户不是当前审批节点处理人"
      }),
      ...(!context?.governed || status === "effective" ? [detailAction({
        key: "generate_pdf_archive",
        label: "生成 PDF 归档",
        kind: "normal",
        roleKeys,
        requiredAction: "contract.archive.upload",
        enabled: Boolean(status)
      })] : [])
    ];

    if (status === "draft") {
      if (context?.genericDraftActionsAllowed === false) {
        return [];
      }
      return [
        detailAction({
          key: "submit_approval",
          label: "提交合同审批",
          kind: "primary",
          roleKeys,
          requiredAction: "contract.submit",
          enabled: true
        }),
        ...workflowActions
      ];
    }

    if (status === "in_approval" || status === "approval_pending") {
      return [
        detailAction({
          key: "review_approval",
          label: "处理合同审批",
          kind: "primary",
          roleKeys,
          requiredAction: "contract.approve",
          skipRoleCheck: true,
          enabled: approvalReviewAccess.canReview,
          requiresSelfReviewConfirmation:
            approvalReviewAccess.requiresSelfReviewConfirmation,
          disabledReason: approvalReviewAccess.canAct
            ? "申请人不能审批自己发起的业务"
            : "当前用户不是当前审批节点处理人"
        }),
        ...workflowActions
      ];
    }

    if (status === "approved_pending_seal" || status === "approved") {
      return [
        detailAction({
          key: "approve_seal",
          label: context?.governed ? "同意用章" : "确认用章通过",
          kind: "primary",
          roleKeys,
          requiredAction: "contract.seal",
          enabled: true,
          requiresPassword: true
        }),
        ...signingMaterialChangeActions,
        ...workflowActions
      ];
    }

    if (status === "in_seal") {
      return [
        detailAction({
          key: "complete_seal",
          label: "确认我方签署盖章完成",
          kind: "primary",
          roleKeys,
          skipRoleCheck: true,
          enabled: Boolean(context?.actorUserId && context.sealTask?.handlerUserId === context.actorUserId),
          disabledReason: "仅冻结经办人可确认线下签署盖章完成"
        }),
        ...signingMaterialChangeActions,
        ...workflowActions
      ];
    }

    if (status === "seal_approved_pending_archive") {
      return [
        detailAction({
          key: context?.governed ? "upload_final_contract" : "upload_archive",
          label: context?.governed ? "上传双方最终版" : "上传盖章合同",
          kind: "primary",
          roleKeys,
          requiredAction: context?.governed ? undefined : "contract.archive.upload",
          skipRoleCheck: Boolean(context?.governed),
          enabled: context?.governed
            ? Boolean(context.canUploadGovernedFinal)
            : true,
          disabledReason: "仅冻结经办人或符合条件的替代上传人可上传",
          requiresFile: true
        }),
        ...signingMaterialChangeActions,
        ...workflowActions
      ];
    }

    if (status === "pending_archive_confirm" || status === "sealed_pending_archive") {
      return [
        ...(context?.governed ? [detailAction({
          key: "return_final_contract",
          label: "退回补正",
          kind: "danger",
          roleKeys,
          requiredAction: "contract.archive.confirm",
          enabled: Boolean(context.activeFinal && context.canConfirmGovernedFinal),
          disabledReason: context.canConfirmGovernedFinal
            ? "暂无可退回补正的双方最终版"
            : "仅当前全局合同部主管可退回补正双方最终版",
          requiresComment: true
        })] : []),
        detailAction({
          key: context?.governed ? "confirm_final_contract" : "confirm_archive",
          label: context?.governed ? "确认双方最终版并归档" : "确认合同归档",
          kind: "primary",
          roleKeys,
          requiredAction: "contract.archive.confirm",
          enabled: context?.governed
            ? Boolean(
              context.activeFinal &&
              context.canConfirmGovernedFinal &&
              (context.activeFinal.uploadedByUserId !== context.actorUserId ||
                context.canSelfConfirmGovernedFinal)
            )
            : true,
          requiresPassword: context?.governed ? false : true
        }),
        ...signingMaterialChangeActions,
        ...workflowActions
      ];
    }

    if (status === "effective") {
      const settlementTypeBlockReason = settlementContractTypeBlockReason(
        context?.contractTypeKey
      );
      return [
        ...(!settlementTypeBlockReason ? [detailAction({
          key: "create_settlement",
          label: "发起结算",
          kind: "primary",
          roleKeys,
          requiredAction: "settlement.create",
          enabled: true
        })] : []),
        detailAction({
          key: "download_archive",
          label: "下载合同归档件",
          kind: "normal",
          roleKeys,
          enabled: archiveFiles.some((file) => file.status === "confirmed"),
          disabledReason: "暂无已确认归档件",
          requiresPassword: true
        }),
        ...workflowActions
      ];
    }

    return workflowActions;
  }

  private async governedFinalAccess(
    actorUserId: string | undefined,
    projectId: string,
    sealTask: ContractDetailReadModel["sealTask"],
    activeFinal: NonNullable<ContractDetailReadModel["formalFiles"]>[number] | null
  ) {
    if (!actorUserId || !sealTask) {
      return { canUpload: false, canConfirm: false, canSelfConfirm: false };
    }
    const access = await resolveGovernedFinalArchiveAccess(this.prisma, {
      actorUserId,
      projectId,
      handlerUserId: sealTask.handlerUserId,
      uploadedByUserId: activeFinal?.uploadedByUserId
    });
    return {
      canUpload: access.canUpload,
      canConfirm: access.canConfirm,
      canSelfConfirm: access.canSelfConfirm
    };
  }

  private async canReportSigningMaterialChange(
    actorUserId: string | undefined,
    sealTask: ContractDetailReadModel["sealTask"]
  ) {
    if (!actorUserId || !sealTask) return false;
    if (sealTask.handlerUserId === actorUserId) return true;
    const [position, user] = await Promise.all([
      this.prisma.position.findUnique({
        where: { key: "contract_director" },
        select: { id: true }
      }),
      this.prisma.user.findUnique({
        where: { id: actorUserId },
        select: { isActive: true }
      })
    ]);
    if (!position || !user?.isActive) return false;
    return Boolean(await this.prisma.userPosition.findFirst({
      where: {
        userId: actorUserId,
        projectId: null,
        positionId: position.id
      },
      select: { id: true }
    }));
  }

  private statusView(status: string): { label: string; tone: CoreFlowTone } {
    const views: Record<string, { label: string; tone: CoreFlowTone }> = {
      draft: { label: "草拟中", tone: "default" },
      in_approval: { label: "审批中", tone: "primary" },
      approval_pending: { label: "审批中", tone: "primary" },
      approval_rejected: { label: "最终驳回", tone: "danger" },
      approved_pending_seal: { label: "待用章", tone: "warning" },
      approved: { label: "待用章", tone: "warning" },
      in_seal: { label: "用章中", tone: "warning" },
      seal_approved_pending_archive: { label: "待归档上传", tone: "primary" },
      pending_archive_confirm: { label: "待归档确认", tone: "primary" },
      sealed_pending_archive: { label: "待归档确认", tone: "primary" },
      effective: { label: "已生效", tone: "success" },
      abandoned: { label: "已放弃", tone: "default" },
      deleting: { label: "删除处理中", tone: "warning" },
      superseded: { label: "已被新版本替代", tone: "default" },
      voided: { label: "已作废", tone: "danger" }
    };

    return views[status] ?? { label: "合同状态未读取", tone: "default" };
  }

  private takeoverStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      draft: "草稿",
      pending_review: "待复核",
      confirmed: "已接管",
      needs_supplement: "待补充",
      voided: "已作废"
    };

    return labels[status] ?? "接管状态未读取";
  }

  private contractPaymentUnavailableReason(
    source: "system" | "historical_takeover",
    latestStatus: string,
    effectiveVersionId: string | null,
    takeover:
      | {
          takeoverStatus: string;
          historicalBalanceConfirmedAt: Date | null;
        }
      | undefined
  ): string | null {
    if (!effectiveVersionId) {
      return `合同状态为${this.statusView(latestStatus).label}，不能发起付款`;
    }
    if (source !== "historical_takeover") {
      return null;
    }
    if (!takeover) {
      return "历史合同尚未完成接管确认";
    }
    if (takeover.takeoverStatus !== "confirmed") {
      return `历史合同接管状态为${this.takeoverStatusLabel(takeover.takeoverStatus)}，确认后才能付款`;
    }
    if (!takeover.historicalBalanceConfirmedAt) {
      return "历史余额尚未确认，不能发起付款";
    }

    return null;
  }

  private termsStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      draft: "草拟中",
      effective: "已生效",
      archived: "已归档"
    };

    return labels[status] ?? "付款条款状态未读取";
  }

  private currentOwnerLabel(status: string): string {
    const labels: Record<string, string> = {
      draft: "合同部成员",
      in_approval: "审批节点处理人",
      approval_pending: "审批节点处理人",
      approval_rejected: "保留历史（只读）",
      approved_pending_seal: "综合部主管",
      approved: "合同部成员",
      in_seal: "冻结经办人",
      seal_approved_pending_archive: "冻结经办人",
      pending_archive_confirm: "合同部主管",
      sealed_pending_archive: "合同部主管",
      effective: "系统归档",
      deleting: "系统清理",
      voided: "系统归档"
    };

    return labels[status] ?? "合同部";
  }

  private nextActionLabel(status: string): string {
    const labels: Record<string, string> = {
      draft: "提交合同审批",
      in_approval: "等待审批",
      approval_pending: "等待审批",
      approval_rejected: "查看保留历史",
      approved_pending_seal: "综合部主管同意用章",
      approved: "发起用章",
      in_seal: "经办人完成线下签署盖章",
      seal_approved_pending_archive: "上传双方最终版",
      pending_archive_confirm: "合同部主管确认双方最终版",
      sealed_pending_archive: "主管确认归档",
      effective: "可发起结算",
      deleting: "无",
      voided: "无"
    };

    return labels[status] ?? "待处理";
  }

  private returnReason(status: string): string {
    return status === "approval_rejected" ? "最终驳回，查看保留历史" : "-";
  }

  private stalledFor(value: Date): string {
    const days = Math.max(0, Math.floor((Date.now() - value.getTime()) / 86_400_000));
    return days === 0 ? "今天" : `${days}天`;
  }

  private effectivenessSteps(status: string): ContractDetailReadModel["effectivenessSteps"] {
    if (status === "effective") {
      return [
        { label: "合同审批", status: "已通过", tone: "success" },
        { label: "用章", status: "已完成", tone: "success" },
        { label: "归档上传", status: "已上传", tone: "success" },
        { label: "主管确认", status: "已确认", tone: "success" },
        { label: "合同生效", status: "已生效", tone: "success" }
      ];
    }

    if (status === "approved" || status === "approved_pending_seal" || status === "in_seal") {
      return [
        { label: "合同审批", status: "已通过", tone: "success" },
        {
          label: "用章",
          status: status === "in_seal" ? "已同意，线下办理中" : "待综合部主管同意",
          tone: "warning"
        },
        { label: "归档上传", status: "未开始", tone: "default" },
        { label: "主管确认", status: "未开始", tone: "default" },
        { label: "合同生效", status: "阻塞", tone: "danger" }
      ];
    }

    if (status === "seal_approved_pending_archive" || status === "pending_archive_confirm") {
      return [
        { label: "合同审批", status: "已通过", tone: "success" },
        { label: "用章", status: "已完成", tone: "success" },
        {
          label: "归档上传",
          status: status === "pending_archive_confirm" ? "已上传" : "待上传",
          tone: status === "pending_archive_confirm" ? "success" : "primary"
        },
        {
          label: "主管确认",
          status: status === "pending_archive_confirm" ? "待确认" : "未开始",
          tone: status === "pending_archive_confirm" ? "primary" : "default"
        },
        { label: "合同生效", status: "阻塞", tone: "danger" }
      ];
    }

    return [
      {
        label: "合同审批",
        status: status === "approval_pending" || status === "in_approval" ? "处理中" : "未提交",
        tone: "primary"
      },
      { label: "用章", status: "未开始", tone: "default" },
      { label: "归档上传", status: "未开始", tone: "default" },
      { label: "主管确认", status: "未开始", tone: "default" },
      { label: "合同生效", status: "阻塞", tone: "danger" }
    ];
  }

  private settlementBlockMessage(status: string, contractTypeKey?: string | null): string {
    if (status === "effective") {
      const typeBlockReason = settlementContractTypeBlockReason(contractTypeKey);
      if (typeBlockReason) return typeBlockReason;
      return "合同版本已生效，可基于当前合同版本创建结算；付款条款版本将随结算一并绑定。";
    }

    return "合同尚未生效，暂不可发起结算；结算未生效前不可创建付款申请。";
  }

  private settlementApprovalStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      draft: "草稿",
      in_approval: "审批中",
      approval_pending: "审批中",
      approval_rejected: "审批退回",
      withdrawn: "已撤回",
      approved_pending_archive: "审批通过",
      archive_pending: "审批通过",
      pending_archive_confirm: "审批通过",
      effective: "审批通过",
      partially_paid: "审批通过",
      paid: "审批通过",
      rejected: "审批退回",
      voided: "已作废"
    };

    return labels[status] ?? "结算审批状态未读取";
  }

  private settlementArchiveStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      draft: "未归档",
      in_approval: "未归档",
      approval_pending: "未归档",
      approval_rejected: "未归档",
      withdrawn: "未归档",
      approved_pending_archive: "待上传盖章件",
      archive_pending: "待上传盖章件",
      pending_archive_confirm: "待确认归档",
      effective: "已归档确认",
      partially_paid: "已归档确认",
      paid: "已归档确认",
      rejected: "未归档",
      voided: "已作废"
    };

    return labels[status] ?? "未归档";
  }

  private isEffectiveSettlementStatus(status: string): boolean {
    return ["effective", "partially_paid", "paid"].includes(status);
  }

  private settlementArchiveFileStatusLabel(archiveFile: {
    status: string;
    confirmedAt: Date | null;
  }): string {
    if (archiveFile.confirmedAt || archiveFile.status === "confirmed") return "已归档确认";
    if (archiveFile.status === "pending_confirm") return "待确认归档";
    return "结算归档状态未读取";
  }

  private paymentApprovalStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      draft: "草稿",
      in_approval: "审批中",
      approval_pending: "审批中",
      approval_rejected: "审批退回",
      approved_pending_payment: "审批通过",
      partially_paid: "审批通过",
      paid: "审批通过",
      completed: "审批通过",
      rejected: "审批退回",
      voided: "已作废"
    };

    return labels[status] ?? "付款审批状态未读取";
  }

  private paymentExecutionStatusLabel(
    status: string,
    paidAmountCents: bigint,
    payableAmountCents: bigint
  ): string {
    if (paidAmountCents >= payableAmountCents && payableAmountCents > 0n) return "已付款";
    if (paidAmountCents > 0n) return "部分付款";
    if (status === "approved_pending_payment") return "已批待付";
    return "未付款";
  }

  private isApprovedPaymentStatus(status: string): boolean {
    return ["approved_pending_payment", "partially_paid", "paid", "completed"].includes(status);
  }

  private paymentSourceLabel(sourceType?: string | null): string {
    if (sourceType === "contract_advance") {
      return "合同预付款";
    }

    return "未关联结算";
  }

  private basisLabel(basis: string): string {
    const labels: Record<string, string> = {
      contract_amount: "合同金额",
      current_settlement: "当期结算",
      cumulative_settlement: "累计结算",
      fixed_amount: "固定金额",
      manual_amount: "人工确认金额"
    };

    return labels[basis] ?? basis;
  }

  private ratioLabel(ratioBps: number | null): string {
    if (ratioBps === null) {
      return "-";
    }

    return `${ratioBps / 100}%`;
  }

  private formatMoney(amountCents: bigint): string {
    return `¥${formatMoneyCentsAsYuan(dbMoneyToBigInt(amountCents, "合同金额"))}`;
  }

  private formatContractAmount(version: {
    amountCents: bigint;
    amountLimitType?: string | null;
    pricingNature?: string | null;
  }): string {
    if (version.amountLimitType === "unlimited" &&
      version.pricingNature === "framework"
    ) {
      return "不设合同总价";
    }
    const amount = this.formatMoney(version.amountCents);
    return ["provisional_total", "unit_price"].includes(version.pricingNature ?? "")
      ? `控制金额 ${amount}`
      : amount;
  }

  private contractTypePricingLabel(contractTypeKey: string | null | undefined, pricingNature?: string | null) {
    const type = {
      material_purchase: "材料采购合同",
      equipment_rental: "工程机械设备租赁合同",
      labor_subcontract: "劳务分包合同",
      professional_subcontract: "专业分包合同",
      generic_contract: "通用合同"
    }[contractTypeKey ?? ""] ?? "未明确类型";
    const pricing = {
      fixed_total: "固定总价",
      provisional_total: "暂定金额",
      unit_price: "单价合同",
      framework: "框架合同"
    }[pricingNature ?? ""] ?? "未明确计价";
    return `${type} · ${pricing}`;
  }

  private formatContractInvoiceType(value?: string | null): string {
    return value && CONTRACT_INVOICE_TYPES.some((item) => item === value)
      ? contractInvoiceTypeLabel(value as "vat_general" | "vat_special")
      : "未明确";
  }

  private toBigIntCents(amountCents: bigint): bigint {
    return dbMoneyToBigInt(amountCents, "合同金额");
  }

  private async contractTakeoverLedgerRows(
    contractVersionIds: string[]
  ): Promise<Array<{
    id: string;
    contractVersionId: string;
    contractId: string;
    projectId: string;
    takeoverStatus: string;
  }>> {
    if (!contractVersionIds.length) return [];
    const client = (this.prisma as unknown as {
      contractTakeover?: {
        findMany(args: {
          where: {
            contractVersionId: { in: string[] };
          };
          select: {
            id: true;
            contractVersionId: true;
            contractId: true;
            projectId: true;
            takeoverStatus: true;
          };
        }): Promise<Array<{
          id: string;
          contractVersionId: string;
          contractId: string;
          projectId: string;
          takeoverStatus: string;
        }>>;
      };
    }).contractTakeover;
    if (!client) return [];
    return client.findMany({
      where: {
        contractVersionId: { in: contractVersionIds }
      },
      select: {
        id: true,
        contractVersionId: true,
        contractId: true,
        projectId: true,
        takeoverStatus: true
      }
    });
  }

  private async historicalTakeoverReadableProjectIds(
    actorUserId: string,
    visibleProjectIds: string[]
  ): Promise<Set<string>> {
    if (!this.projectVisibility || !visibleProjectIds.length) return new Set();
    const roleKeysByProject = await this.projectVisibility.effectiveRoleKeysByProject(
      actorUserId,
      visibleProjectIds
    );
    return new Set(visibleProjectIds.filter((projectId) =>
      (roleKeysByProject.get(projectId) ?? []).some((roleKey) =>
        HISTORICAL_TAKEOVER_READ_ROLES.has(roleKey)
      )
    ));
  }

  private contractTakeoverLedgerProjection(
    contract: { id: string; projectId: string; source?: string | null },
    version: { id: string; contractId: string; changeType?: string | null },
    takeover: {
      id: string;
      contractVersionId: string;
      contractId: string;
      projectId: string;
      takeoverStatus: string;
    } | undefined,
    canReadTakeover: boolean
  ): Record<string, unknown> {
    const hasHistoricalMarker = version.changeType === "historical_takeover";
    const hasTakeoverRelation = Boolean(takeover);
    const hasExactTakeoverRelation = Boolean(
      takeover &&
      takeover.contractVersionId === version.id &&
      takeover.contractId === version.contractId &&
      takeover.contractId === contract.id &&
      takeover.projectId === contract.projectId
    );
    const historicalTakeoverFlow = hasHistoricalMarker || hasTakeoverRelation;
    const takeoverRelationMismatch =
      hasHistoricalMarker !== hasExactTakeoverRelation ||
      (hasTakeoverRelation && !hasExactTakeoverRelation);
    const base = {
      projectId: contract.projectId,
      source: contract.source === "historical_takeover" ? "historical_takeover" : "system",
      changeType: version.changeType ?? null,
      historicalTakeoverFlow
    };
    if (!historicalTakeoverFlow) {
      return {
        ...base,
        takeoverId: null,
        takeoverStatus: null,
        takeoverReadable: false
      };
    }
    const historicalBase = {
      ...base,
      copyAvailable: false
    };
    if (!canReadTakeover) {
      return {
        ...historicalBase,
        currentNode: "历史合同接管",
        nodeTone: "default",
        pendingOwner: "专用工作台",
        ownerDepartment: "专用工作台",
        nextAction: "查看详情",
        takeoverReadable: false,
        workbenchEditable: false
      };
    }

    if (takeoverRelationMismatch) {
      return {
        ...historicalBase,
        takeoverReadable: true,
        takeoverRelationMismatch: true,
        currentNode: "接管关联异常",
        nodeTone: "danger",
        pendingOwner: "历史接管工作台",
        ownerDepartment: "历史接管工作台",
        nextAction: "检查接管关联",
        workbenchEditable: false
      };
    }

    const view = ({
      draft: {
        currentNode: "接管准备",
        nodeTone: "warning",
        pendingOwner: "接管责任人",
        nextAction: "继续接管"
      },
      needs_supplement: {
        currentNode: "待补充",
        nodeTone: "warning",
        pendingOwner: "接管责任人",
        nextAction: "补充接管资料"
      },
      pending_review: {
        currentNode: "复核确认",
        nodeTone: "primary",
        pendingOwner: "合同部/财务部主管",
        nextAction: "继续复核"
      },
      confirmed: {
        currentNode: "已接管",
        nodeTone: "success",
        pendingOwner: "系统归档",
        nextAction: "查看接管台账"
      },
      voided: {
        currentNode: "已作废",
        nodeTone: "danger",
        pendingOwner: "系统归档",
        nextAction: "查看历史记录"
      },
      abandoned: {
        currentNode: "已放弃",
        nodeTone: "default",
        pendingOwner: "系统归档",
        nextAction: "查看合同详情"
      }
    } as const)[takeover?.takeoverStatus as "draft" | "needs_supplement" |
      "pending_review" | "confirmed" | "voided" | "abandoned"] ?? {
      currentNode: "接管关联异常",
      nodeTone: "danger",
      pendingOwner: "历史接管工作台",
      nextAction: "检查接管关联"
    };
    return {
      ...historicalBase,
      takeoverId: takeover?.id ?? null,
      takeoverStatus: takeover?.takeoverStatus ?? null,
      takeoverReadable: true,
      takeoverRelationMismatch: false,
      ...view,
      ownerDepartment: view.pendingOwner,
      workbenchEditable: false
    };
  }

  /**
   * True only when the project-visibility service can actually resolve per
   * project role keys. Legacy callers without the service (or without the
   * resolver) keep the previous behavior instead of collapsing to `none`.
   */
  private ledgerRoleResolutionAvailable(): boolean {
    return Boolean(
      this.projectVisibility &&
      typeof this.projectVisibility.effectiveRoleKeysByProject === "function"
    );
  }

  /**
   * Resolves a user's contract read visibility from their role keys.
   *
   * Spec 9 groups: global full-view positions see every project's full rows;
   * project full-view positions see full rows inside their own projects;
   * `employee` sees only the 7-field public summary of archived formal
   * contracts; any unconfigured role resolves to `none`.
   */
  private getContractVisibilityLevel(
    roleKeys: readonly RoleKey[]
  ): ContractVisibilityLevel {
    if (roleKeys.some((role) => CONTRACT_FULL_VIEW_GLOBAL_ROLE_KEYS.some((candidate) => candidate === role))) {
      return "full";
    }
    if (roleKeys.some((role) => CONTRACT_FULL_VIEW_PROJECT_ROLE_KEYS.some((candidate) => candidate === role))) {
      return "full";
    }
    if (roleKeys.some((role) => CONTRACT_SUMMARY_VIEW_ROLE_KEYS.some((candidate) => candidate === role))) {
      return "summary";
    }
    return "none";
  }

  /**
   * Role-aware ledger visibility with a safe fallback for callers that cannot
   * resolve roles: when role resolution is unavailable the pre-Spec-9 full
   * rows behavior is kept instead of hiding every row.
   */
  private resolveLedgerVisibility(
    projectRoleKeys: readonly RoleKey[]
  ): ContractVisibilityLevel {
    if (this.ledgerRoleResolutionAvailable()) {
      return this.getContractVisibilityLevel(projectRoleKeys);
    }
    this.warnRoleResolutionFallback();
    return "full";
  }

  private roleResolutionFallbackWarned = false;

  private warnRoleResolutionFallback() {
    if (this.roleResolutionFallbackWarned) return;
    this.roleResolutionFallbackWarned = true;
    Logger.warn(
      "合同台账角色可见性解析不可用（projectVisibility 未配置），已回退为 full 全量可见；Spec-9 角色边界未生效。",
      ContractReadService.name
    );
  }

  /**
   * The employee public summary row. Exactly the seven spec-9 fields:
   * contract number, name, type, project, counterparty, effective date and
   * status. Amounts, payment terms, bills, body text, files, versions and
   * approval history are never projected for this role.
   */
  private contractEmployeeSummaryRow(
    contract: {
      id: string; code: string | null; temporaryCode: string | null; name: string;
      projectId: string; counterparty: string; contractTypeKey?: string | null;
    },
    version: { status: string; effectiveAt?: Date | null },
    project?: { name: string } | null
  ) {
    return {
      id: contract.code ?? contract.id,
      contractId: contract.id,
      contractNo: contract.code ?? contract.temporaryCode ?? contract.id,
      name: contract.name,
      project: project?.name ?? contract.projectId,
      counterparty: contract.counterparty,
      type: contract.contractTypeKey ?? "-",
      status: version.status,
      effectiveDate: version.effectiveAt
        ? version.effectiveAt.toLocaleDateString("zh-CN", {
            timeZone: "Asia/Shanghai"
          })
        : null,
      visibility: "summary" as const
    };
  }

  private contractLedgerRow(
    contract: {
      id: string; code: string | null; temporaryCode: string | null; name: string;
      projectId: string; counterparty: string; contractTypeKey?: string | null; updatedAt: Date;
    },
    version: {
      id: string; status: string; versionNo: number; amountCents: bigint;
      amountLimitType?: string | null; pricingNature?: string | null;
    },
    termsVersion?: { versionNo: number } | null,
    project?: { name: string } | null,
    lifecycle: Record<string, unknown> = {}
  ) {
    const status = this.statusView(version.status);
    const nextAction = this.nextActionLabel(version.status);
    const pendingOwner = this.currentOwnerLabel(version.status);
    return {
      id: contract.code ?? contract.id,
      contractId: contract.id,
      contractNo: contract.code ?? contract.temporaryCode ?? contract.id,
      name: contract.name,
      project: project?.name ?? contract.projectId,
      counterparty: contract.counterparty,
      typePricing: this.contractTypePricingLabel(contract.contractTypeKey, version.pricingNature),
      amount: this.formatContractAmount(version),
      version: `v${version.versionNo}`,
      status: version.status,
      currentNode: nextAction,
      nodeTone: status.tone,
      ownerDepartment: pendingOwner,
      pendingOwner,
      stalledFor: this.stalledFor(contract.updatedAt),
      returnReason: this.returnReason(version.status),
      nextAction,
      updatedAt: this.date(contract.updatedAt),
      paymentTermsVersion: termsVersion ? `v${termsVersion.versionNo}` : "-",
      ...lifecycle
    };
  }

  private lifecycleCount(
    contracts: Array<{
      id: string;
      projectId: string;
      ownerUserId: string | null;
      voidedAt: Date | null;
    }>,
    versionsByContract: Map<string, Array<{ id: string; status: string }>>,
    lifecycleByVersion: ReadonlyMap<
      string,
      ContractDraftLifecycleClassification
    >,
    actorUserId: string,
    view: DraftLedgerView,
    roleKeysByProject: ReadonlyMap<string, readonly RoleKey[]>
  ) {
    return contracts.filter((contract) => {
      const projectRoleKeys = roleKeysByProject.get(contract.projectId) ?? [];
      const visibility = this.resolveLedgerVisibility(projectRoleKeys);
      if (visibility === "none") return false;
      const views = projectContractDraftLifecycleViews(
        contract,
        versionsByContract.get(contract.id) ?? [],
        lifecycleByVersion,
        actorUserId,
        projectRoleKeys
      );
      if (!views.matches[view]) return false;
      if (visibility === "summary") {
        const rowVersion = views.versionByView[view];
        return Boolean(
          rowVersion &&
          contract.voidedAt == null &&
          lifecycleByVersion.get(rowVersion.id)?.contractLifecycleStage ===
            "protected_formal"
        );
      }
      return true;
    }).length;
  }

  private currentWorkbenchVersion<V extends { id: string; status: string }>(
    versions: V[],
    view: ContractWorkbenchView,
    lifecycleByVersion: ReadonlyMap<string, ContractDraftLifecycleClassification>,
    pendingVersionIds: ReadonlySet<string>
  ): V | undefined {
    const candidates = versions.filter((version) =>
      !["deleting", "ended_retained"].includes(
        lifecycleByVersion.get(version.id)?.contractLifecycleStage ?? ""
      )
    );
    if (view === "all") return candidates[0];
    if (view === "my_drafts") {
      return candidates.find((version) =>
        lifecycleByVersion.get(version.id)?.contractLifecycleStage === "unsubmitted_draft"
      );
    }
    if (view === "pending_action") {
      return candidates.find((version) => pendingVersionIds.has(version.id)) ??
        candidates.find((version) =>
          lifecycleByVersion.get(version.id)?.contractLifecycleStage === "returned_editable"
        );
    }
    if (view === "in_approval") {
      return candidates.find((version) => ["in_approval", "approval_pending"].includes(version.status));
    }
    if (view === "pending_seal") {
      return candidates.find((version) => ["approved", "approved_pending_seal", "in_seal"].includes(version.status));
    }
    if (view === "pending_archive") {
      return candidates.find((version) => [
        "seal_approved_pending_archive",
        "pending_archive_confirm",
        "sealed_pending_archive"
      ].includes(version.status));
    }
    return candidates.find((version) => version.status === "effective");
  }

  private matchesWorkbenchView(
    view: ContractWorkbenchView,
    version: { id: string; status: string },
    draftLifecycle: ContractDraftLifecycleClassification,
    ownerUserId: string | null,
    actorUserId: string,
    pendingVersionIds: ReadonlySet<string>,
    projectRoleKeys: readonly RoleKey[]
  ) {
    const { status } = version;
    if (!draftLifecycle.capabilities.canView) return false;
    if (draftLifecycle.contractLifecycleStage === "ended_retained") return false;
    if (
      draftLifecycle.contractLifecycleStage === "unsubmitted_draft" &&
      ownerUserId !== actorUserId &&
      !projectRoleKeys.some((roleKey) => CONTRACT_DRAFT_PRIVATE_READ_ROLES.has(roleKey))
    ) {
      return false;
    }
    if (view === "all") return true;
    if (view === "pending_action") {
      return pendingVersionIds.has(version.id) ||
        (draftLifecycle.contractLifecycleStage === "returned_editable" && ownerUserId === actorUserId);
    }
    if (view === "my_drafts") {
      return status === "draft" &&
        draftLifecycle.contractLifecycleStage === "unsubmitted_draft" &&
        ownerUserId === actorUserId;
    }
    if (view === "in_approval") return ["in_approval", "approval_pending"].includes(status);
    if (view === "pending_seal") return ["approved", "approved_pending_seal", "in_seal"].includes(status);
    if (view === "pending_archive") {
      return ["seal_approved_pending_archive", "pending_archive_confirm", "sealed_pending_archive"].includes(status);
    }
    return status === "effective";
  }

  private page(raw?: string | number) {
    const parsed = typeof raw === "number" ? raw : Number(raw ?? 1);
    return Number.isFinite(parsed) ? Math.max(1, Math.trunc(parsed)) : 1;
  }

  private pageSize(raw?: string | number) {
    const parsed = typeof raw === "number" ? raw : Number(raw ?? 20);
    return Number.isFinite(parsed) ? Math.min(100, Math.max(1, Math.trunc(parsed))) : 20;
  }

  private limit(rawLimit?: string | number) {
    const parsed = typeof rawLimit === "number" ? rawLimit : Number(rawLimit ?? 100);
    if (!Number.isFinite(parsed)) return 100;
    return Math.min(Math.max(Math.trunc(parsed), 1), 200);
  }

  private centsValue(amountCents: bigint): string {
    return moneyCentsToApi(dbMoneyToBigInt(amountCents, "合同金额"));
  }

  private date(value: Date) {
    return value.toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" });
  }
}
