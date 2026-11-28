/**
 * 同一结算经济事实的跨来源去重键。
 *
 * FND-22/OPS-11 前提：同一合同版本、同一结算期次、同一合同关系只能计一次成本。
 * 旧 `settlement`、新 `signed_contract_settlement`、表外/对上结算事实是不同入口，
 * 数据库各自的来源唯一键无法互相约束，因此在写入与读取两侧共用本键：
 *
 *   合同版本 + 结算期次（编号）+ 合同关系（downstream / upward / outside_fact）
 *
 * 期次取结算单上的真实编号（旧结算 `periodLabel`，新已签结算手填编号），
 * 不做金额或日期近似匹配；缺失期次或合同版本时返回 null，不猜测去重。
 */
export const SETTLEMENT_SOURCE_TYPES = [
  "settlement",
  "signed_contract_settlement",
  "project_affiliate_settlement_fact"
] as const;

export type SettlementSourceType = (typeof SETTLEMENT_SOURCE_TYPES)[number];
export type SettlementContractKind = "downstream" | "upward" | "outside_fact";

export interface SettlementEconomicIdentity {
  sourceType: SettlementSourceType;
  contractKind: SettlementContractKind;
  contractVersionId: string;
  period: string;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

/** 编号比较只做空白与全半角差异归一，不忽略真实编号差异。 */
export function normalizeSettlementPeriod(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, "").toUpperCase();
}

export function settlementEconomicIdentity(
  sourceType: string,
  snapshot: unknown
): SettlementEconomicIdentity | null {
  if (!(SETTLEMENT_SOURCE_TYPES as readonly string[]).includes(sourceType)) {
    return null;
  }
  const source = record(snapshot);
  const typedSourceType = sourceType as SettlementSourceType;
  if (sourceType === "signed_contract_settlement") {
    const contractKind = text(source.contractKind);
    if (
      contractKind !== "downstream" &&
      contractKind !== "upward" &&
      contractKind !== "outside_fact"
    ) {
      return null;
    }
    const contractVersionId = text(source.contractVersionId);
    const period = text(source.settlementNumber) ?? text(source.number);
    return contractVersionId && period
      ? { sourceType: typedSourceType, contractKind, contractVersionId, period }
      : null;
  }
  if (sourceType === "settlement") {
    const contractVersionId = text(source.contractVersionId);
    const period = text(source.periodLabel) ?? text(source.code);
    return contractVersionId && period
      ? {
          sourceType: typedSourceType,
          contractKind: "downstream",
          contractVersionId,
          period
        }
      : null;
  }
  const contractKind: SettlementContractKind = text(source.affiliateCompanyContractId)
    ? "upward"
    : "outside_fact";
  const contractVersionId =
    text(source.affiliateCompanyContractId) ?? text(source.contractLedgerId);
  const period = text(source.periodLabel);
  return contractVersionId && period
    ? { sourceType: typedSourceType, contractKind, contractVersionId, period }
    : null;
}

export function settlementDedupKey(
  identity: SettlementEconomicIdentity
): string {
  return [
    identity.contractKind,
    identity.contractVersionId,
    normalizeSettlementPeriod(identity.period)
  ].join("\u0000");
}

/** 写入侧冲突提示：同一合同版本同一期次已由其他结算入口登记。 */
export function settlementCrossSourceConflict(identity: SettlementEconomicIdentity): string {
  return `该合同该结算期次（${identity.period}）已由其他结算入口登记，同一事实不能重复计成本；请核对原结算单后再办理`;
}

/**
 * 旧结算生效前的写入守卫：同一合同版本、同一结算期次若已由新已签结算确认，
 * 旧入口直接冲突，调用方事务（含归档确认/审计）整体回滚。
 */
export async function assertNoConfirmedSignedSettlementForPeriod(
  tx: {
    signedContractSettlement: {
      findMany(args: {
        where: Record<string, unknown>;
        select: { number: true; confirmedContractSource: true };
      }): Promise<Array<{ number: string | null; confirmedContractSource: unknown }>>;
    };
  },
  legacy: {
    projectId: string;
    contractId: string;
    contractVersionId: string;
    periodLabel: string;
    code: string;
  }
): Promise<void> {
  const identity = settlementEconomicIdentity("settlement", legacy);
  if (!identity) return;
  const signed = await tx.signedContractSettlement.findMany({
    where: {
      projectId: legacy.projectId,
      contractKind: "downstream",
      contractId: legacy.contractId,
      state: "confirmed"
    },
    select: { number: true, confirmedContractSource: true }
  });
  for (const row of signed) {
    const frozen = record(row.confirmedContractSource);
    const sourceRecordId = text(frozen.sourceRecordId);
    if (!sourceRecordId || !row.number) continue;
    const signedIdentity = settlementEconomicIdentity(
      "signed_contract_settlement",
      {
        contractKind: "downstream",
        contractVersionId: sourceRecordId,
        settlementNumber: row.number
      }
    );
    if (
      signedIdentity &&
      settlementDedupKey(signedIdentity) === settlementDedupKey(identity)
    ) {
      throw new Error(settlementCrossSourceConflict(identity));
    }
  }
}

/**
 * 已签结算确认前的写入守卫：同一合同版本、同一结算期次若已由旧 `Settlement`
 * 生效，新入口直接冲突，调用方复核事务整体回滚。
 */
export async function assertNoLegacySettlementForSignedPeriod(
  tx: {
    settlement: {
      findMany(args: {
        where: Record<string, unknown>;
        select: {
          contractVersionId: true;
          code: true;
          periodLabel: true;
        };
      }): Promise<
        Array<{
          contractVersionId: string;
          code: string;
          periodLabel: string;
        }>
      >;
    };
  },
  signed: {
    projectId: string;
    contractId: string;
    contractVersionId: string;
    period: string;
  }
): Promise<void> {
  const identity = settlementEconomicIdentity("signed_contract_settlement", {
    contractKind: "downstream",
    contractVersionId: signed.contractVersionId,
    settlementNumber: signed.period
  });
  if (!identity) return;
  const legacy = await tx.settlement.findMany({
    where: {
      projectId: signed.projectId,
      contractId: signed.contractId,
      status: { in: ["effective", "partially_paid", "paid"] }
    },
    select: { contractVersionId: true, code: true, periodLabel: true }
  });
  const conflict = legacy.some((row) => {
    const legacyIdentity = settlementEconomicIdentity("settlement", row);
    return (
      legacyIdentity !== null &&
      settlementDedupKey(legacyIdentity) === settlementDedupKey(identity)
    );
  });
  if (conflict) {
    throw new Error(settlementCrossSourceConflict(identity));
  }
}
