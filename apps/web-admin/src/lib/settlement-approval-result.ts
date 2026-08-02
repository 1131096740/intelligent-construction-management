export class SettlementApprovalWithdrawalResultUnknownError extends Error {
  constructor(readonly cause: unknown) {
    super(
      "结算审批撤回结果暂时无法确认，请重新读取结算详情后人工核对，不要重复提交"
    );
    this.name = "SettlementApprovalWithdrawalResultUnknownError";
  }
}
