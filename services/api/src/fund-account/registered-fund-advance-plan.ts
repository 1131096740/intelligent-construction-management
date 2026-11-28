import { sumBusinessAmounts } from "@jiangkong/shared-domain";
import type { FundAccountBalanceRegistration, FundAccountSourceBatch } from "@prisma/client";

import { rejectedFundAdvanceWithoutWrite } from "./fund-account-advance-conflict";

type ConfirmedRegistration = Pick<FundAccountBalanceRegistration, "id" | "balanceYuan" | "coveredExecutionIds"> & {
  sources: Pick<FundAccountSourceBatch, "id" | "lineNo" | "amountYuan" | "sourceStatus" | "sourceName" | "projectStatus" | "projectId">[];
};

export function planRegisteredFundAdvance(
  current: ConfirmedRegistration | null,
  expectedRegistrationId: string,
  receipt: { amountYuan: string; contributorNameSnapshot: string | null; projectId: string | null },
) {
  if (!current || current.balanceYuan === null) {
    throw rejectedFundAdvanceWithoutWrite("账户余额待核对，请先登记或确认余额后再办理垫资到账");
  }
  if (current.id !== expectedRegistrationId) {
    throw rejectedFundAdvanceWithoutWrite("资金登记版本已变化，请刷新后重新核对垫资到账");
  }

  let balanceYuan: string;
  try {
    // Carry booked principal. Prior executions and transfer holds still apply to its descendants.
    balanceYuan = sumBusinessAmounts([current.balanceYuan.toFixed(4), receipt.amountYuan])!;
  } catch {
    throw rejectedFundAdvanceWithoutWrite("到账后登记余额超过可保存范围，请先核对账户");
  }

  return {
    previousRegistrationId: current.id,
    balanceYuan,
    coveredExecutionIds: current.coveredExecutionIds,
    sources: current.sources.map(({ id, lineNo, amountYuan, sourceStatus, sourceName, projectStatus, projectId }) => ({
      previousSourceBatchId: id,
      lineNo,
      amountYuan,
      sourceStatus,
      sourceName,
      projectStatus,
      projectId,
    })),
    originalSource: {
      lineNo: Math.max(0, ...current.sources.map(source => source.lineNo)) + 1,
      amountYuan: receipt.amountYuan,
      sourceStatus: receipt.contributorNameSnapshot === null ? "pending" : "known",
      sourceName: receipt.contributorNameSnapshot,
      projectStatus: receipt.projectId === null ? "pending" : "project",
      projectId: receipt.projectId,
    },
  };
}
