import { moneyCentsToApi } from "../money/decimal-money";

interface ContractVersionLineageSource {
  id: string;
  versionNo: number;
  status: string;
  changeType: string;
  baseVersionId: string | null;
  supersedesVersionId: string | null;
  changeReason: string | null;
  changeDirection: string | null;
  changeAmountCents: bigint | null;
  amountCents: bigint;
  amountLimitType: string;
  originalBaseAmountCents: bigint | null;
  cumulativeIncreaseCents: bigint;
  cumulativeDecreaseCents: bigint;
}

interface HistoricalApprovedInstance {
  businessId: string;
  frozenNodes: unknown;
  status?: string;
}

interface FrozenRouteSnapshot {
  roles: string[];
  candidateFrozen: boolean;
}

function frozenRoute(value: unknown): FrozenRouteSnapshot | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  let candidateFrozen = true;
  const route = value.map((node) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return null;
    const source = node as Record<string, unknown>;
    if (!Array.isArray(source.roleKeys) || source.roleKeys.some((item) => typeof item !== "string")) {
      return null;
    }
    if (!Array.isArray(source.candidateUserIds) ||
        source.candidateUserIds.some((item) => typeof item !== "string")) {
      candidateFrozen = false;
    }
    return (source.roleKeys as string[]).join("_or_");
  });
  return route.every((item): item is string => item !== null)
    ? { roles: route, candidateFrozen }
    : null;
}

function provesHistoricalEnhancedRoute(route: FrozenRouteSnapshot | null): boolean {
  if (!route) return false;
  const roles = route.roles;
  return ["contract_director", "project_manager", "finance_director"].every(
    (roleKey) => roles.includes(roleKey)
  ) && roles.some((roleKey) =>
    roleKey === "chairman" ||
    roleKey === "general_manager" ||
    roleKey === "chairman_or_general_manager"
  );
}

export function contractChangeVersionsReadModel(
  versions: ContractVersionLineageSource[],
  approvedInstances: HistoricalApprovedInstance[] = []
) {
  const byId = new Map(versions.map((version) => [version.id, version]));
  const frozenRouteByVersion = new Map<string, FrozenRouteSnapshot>();
  for (const instance of approvedInstances) {
    const version = byId.get(instance.businessId);
    if (!version) continue;
    const instanceStatus = instance.status ?? "approved";
    const usableForVersion = version.status === "in_approval"
      ? instanceStatus === "in_progress"
      : instanceStatus === "approved";
    if (!usableForVersion) continue;
    if (frozenRouteByVersion.has(instance.businessId)) continue;
    const route = frozenRoute(instance.frozenNodes);
    if (route) frozenRouteByVersion.set(instance.businessId, route);
  }
  return versions.map((version) => {
    const changeType = version.changeType ?? "original";
    const historicalRoute = frozenRouteByVersion.get(version.id) ?? null;
    const historicalEnhanced = provesHistoricalEnhancedRoute(historicalRoute);
    const legacyFrozenChange = changeType === "change" && historicalRoute !== null &&
      !historicalRoute.candidateFrozen;
    const historicalChangeRouteMissing = changeType === "change" && historicalRoute === null &&
      !["draft", "approval_rejected", "in_approval"].includes(version.status);
    const directBase = version.baseVersionId ? byId.get(version.baseVersionId) : null;
    if (version.baseVersionId && !directBase) {
      throw new Error("合同版本直接来源谱系不完整，不能展示版本历史");
    }
    const archiveCompleted = version.status === "effective" || version.status === "superseded";
    const archivePending = version.status === "pending_archive_confirm";
    if (directBase) {
      // completed 表示替代关系已落地；directBase 必须永久保持 superseded，
      // 否则历史结算等既有引用将失去稳定的版本谱系。
      if (
        (archiveCompleted && (
          directBase.status !== "superseded" ||
          version.supersedesVersionId !== directBase.id
        )) ||
        (!archiveCompleted && (
          directBase.status !== "effective" ||
          version.supersedesVersionId !== null
        ))
      ) {
        throw new Error("合同版本归档替代谱系异常，不能展示版本历史");
      }
    }
    return {
      versionNo: version.versionNo,
      status: version.status,
      changeType,
      changeReason: version.changeReason ?? null,
      changeDirection: version.changeDirection ?? null,
      changeAmountCents: version.changeAmountCents == null
        ? null
        : moneyCentsToApi(version.changeAmountCents),
      amountCents: moneyCentsToApi(version.amountCents),
      approvalRoute: historicalRoute?.roles ?? (
        changeType === "change" && !historicalChangeRouteMissing
          ? ["contract_director", "project_manager", "finance_director", "chairman_or_general_manager"]
          : changeType === "change" || changeType === "supplement"
            ? []
            : ["chairman_or_general_manager"]
      ),
      approvalRouteLabel: changeType === "supplement"
        ? historicalRoute
          ? historicalEnhanced ? "增强合同变更（历史）" : "合同变更（历史）"
          : "历史路线未冻结"
        : changeType === "change"
          ? historicalChangeRouteMissing
            ? "历史路线未冻结"
            : legacyFrozenChange
            ? historicalEnhanced ? "增强合同变更（历史）" : "合同变更（历史）"
            : "合同变更"
          : "原合同",
      archiveEffect: directBase && (archiveCompleted || archivePending)
        ? {
            status: archiveCompleted
              ? "completed" as const
              : "pending" as const,
            replacesVersionNo: directBase.versionNo,
            beforeAmountCents: moneyCentsToApi(directBase.amountCents),
            afterAmountCents: moneyCentsToApi(version.amountCents),
            historyReferencesStable: true as const
          }
        : null
    };
  });
}
