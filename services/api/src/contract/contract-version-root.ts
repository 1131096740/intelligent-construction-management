export interface ContractVersionRootCandidate {
  id: string;
  baseVersionId: string | null;
  changeType: string;
  status: string;
  effectiveAt: Date | null;
}

export type ContractVersionRootResolution<T extends ContractVersionRootCandidate> =
  | { ok: true; root: T }
  | { ok: false; reason: string };

/**
 * Resolves the single, once-effective origin of a contract lineage.
 *
 * This deliberately fails closed. A merely draft root is not a legal basis for
 * a change, and choosing the first row when duplicate roots exist would make
 * the 10% ceiling depend on database ordering.
 */
export function resolveContractVersionRoot<T extends ContractVersionRootCandidate>(
  lineage: readonly T[]
): ContractVersionRootResolution<T> {
  const roots = lineage.filter((item) => item.baseVersionId === null);
  if (roots.length !== 1) {
    return { ok: false, reason: "原合同版本谱系异常，暂不能判断增项上限" };
  }
  const root = roots[0]!;
  if (root.changeType !== "original" && root.changeType !== "historical_takeover") {
    return { ok: false, reason: "原合同版本类型异常，暂不能判断增项上限" };
  }
  if ((root.status !== "effective" && root.status !== "superseded") || !root.effectiveAt) {
    return { ok: false, reason: "原合同版本尚未生效，不能作为合同变更依据" };
  }
  return { ok: true, root };
}
