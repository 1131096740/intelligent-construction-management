export class ContractApprovalReviewResultUnknownError extends Error {
  constructor(readonly cause: unknown) {
    super(
      "合同审批提交结果暂时无法确认，请重新读取合同详情后人工核对，不要重复提交"
    );
    this.name = "ContractApprovalReviewResultUnknownError";
  }
}

export class ContractApprovalWithdrawalResultUnknownError extends Error {
  constructor(readonly cause: unknown) {
    super(
      "合同审批撤回结果暂时无法确认，请重新读取合同详情后人工核对，不要重复提交"
    );
    this.name = "ContractApprovalWithdrawalResultUnknownError";
  }
}
