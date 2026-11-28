import { ConflictException } from "@nestjs/common";

export const FUND_ACCOUNT_TRANSFER_ACTIONS = ["confirm", "reject", "resubmit", "return"] as const;
export type FundAccountTransferAction = typeof FUND_ACCOUNT_TRANSFER_ACTIONS[number];
export type FundAccountTransferState = "pending_receipt" | "rejected_held" | "received" | "returned";

const transitions: Record<FundAccountTransferState, Partial<Record<FundAccountTransferAction, FundAccountTransferState>>> = {
  pending_receipt: { confirm: "received", reject: "rejected_held" },
  rejected_held: { resubmit: "pending_receipt", return: "returned" },
  received: {},
  returned: {}
};

export const FUND_ACCOUNT_TRANSFER_HELD_STATES = ["pending_receipt", "rejected_held"] as const;

export function transferUsesHeldFunds(state: FundAccountTransferState): boolean {
  return FUND_ACCOUNT_TRANSFER_HELD_STATES.some(held => held === state);
}

export function rejectedTransferWithoutWrite(message: string) {
  return new ConflictException({ statusCode: 409, code: "FUND_ACCOUNT_TRANSFER_REJECTED_NO_WRITE", message });
}

export function transferStateAfterAction(state: FundAccountTransferState, action: FundAccountTransferAction): FundAccountTransferState {
  const next = transitions[state]?.[action];
  if (!next) throw rejectedTransferWithoutWrite("转款当前状态不能办理，请刷新核对");
  return next;
}


export function supersededTransferCommand() {
  return new ConflictException({
    statusCode: 409, code: "FUND_ACCOUNT_TRANSFER_COMMAND_SUPERSEDED",
    message: "转款或余额已更新，原操作未入账，请刷新后核对"
  });
}
