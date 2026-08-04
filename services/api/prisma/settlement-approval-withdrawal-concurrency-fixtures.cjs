"use strict";

const DATABASE_NAME =
  "jiangkong_settlement_approval_withdrawal_concurrency";
const VERIFICATION_SCOPE = "settlement-approval-withdrawal";

function assertVerificationScope(environment = process.env) {
  const actual = environment
    .SETTLEMENT_APPROVAL_WITHDRAWAL_CONCURRENCY_SCOPE
    ?.trim();
  if (actual !== VERIFICATION_SCOPE) {
    throw new Error(
      "结算审批撤回并发门要求显式设置精确 scope：" +
        VERIFICATION_SCOPE
    );
  }
  return actual;
}

function settlementApprovalNodes() {
  return [
    {
      name: "合同部主管",
      mode: "any",
      roleKeys: ["contract_director"]
    }
  ];
}

function twoNodeSettlementApprovalNodes() {
  return [
    {
      name: "合同部主管一审",
      mode: "any",
      roleKeys: ["contract_director"]
    },
    {
      name: "合同部主管二审",
      mode: "any",
      roleKeys: ["contract_director"]
    }
  ];
}

function withdrawalCoordinates(fixture) {
  return {
    expectedSettlementUpdatedAt:
      fixture.expectedSettlementUpdatedAt,
    expectedApprovalInstanceId:
      fixture.expectedApprovalInstanceId,
    expectedNodeIndex: fixture.expectedNodeIndex,
    expectedApprovalUpdatedAt:
      fixture.expectedApprovalUpdatedAt
  };
}

function reviewInput(decision) {
  if (
    decision !== "approve" &&
    decision !== "reject" &&
    decision !== "return_to_applicant"
  ) {
    throw new Error(`不支持的结算审批竞态决策：${decision}`);
  }
  return {
    decision,
    ...(decision === "approve"
      ? {}
      : { comment: `结算审批撤回并发门：${decision}` })
  };
}

function comparable(value) {
  return JSON.stringify(value, (_key, item) =>
    typeof item === "bigint" ? `${item}n` : item
  );
}

module.exports = {
  DATABASE_NAME,
  VERIFICATION_SCOPE,
  assertVerificationScope,
  comparable,
  reviewInput,
  settlementApprovalNodes,
  twoNodeSettlementApprovalNodes,
  withdrawalCoordinates
};
