import { moneyCentsToApi } from "../money/decimal-money";
import { evaluateContractChangeApproval } from "./contract-change-approval";

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

export function contractChangeVersionsReadModel(
  versions: ContractVersionLineageSource[]
) {
  const byId = new Map(versions.map((version) => [version.id, version]));
  return versions.map((version) => {
    const changeType = version.changeType ?? "original";
    const enhanced = evaluateContractChangeApproval({
      changeType,
      amountLimitType: version.amountLimitType ?? "capped",
      changeAmountCents: version.changeAmountCents ?? null,
      originalBaseAmountCents: version.originalBaseAmountCents ?? null,
      cumulativeIncreaseCents: version.cumulativeIncreaseCents ?? 0n,
      cumulativeDecreaseCents: version.cumulativeDecreaseCents ?? 0n
    }).enhanced;
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
      approvalRoute: enhanced
        ? ["contract_director", "project_manager", "finance_director", "chairman_or_general_manager"]
        : ["chairman_or_general_manager"],
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
