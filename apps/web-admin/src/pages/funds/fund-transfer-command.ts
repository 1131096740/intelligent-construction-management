import {
  actOnFundAccountTransfer,
  FundTransferApiError,
  registerFundAccountTransfer,
  type ActOnFundTransferInput,
  type RegisterFundTransferInput
} from "../../api/fund-account-transfer.api";

export type FundTransferCommand =
  | { type: "register"; input: RegisterFundTransferInput }
  | { type: "action"; transferId: string; input: ActOnFundTransferInput };

const storageKey = (actorId: string) => `jiangkong-fund-transfer:v1:${actorId}`;

export function readFundTransferCommand(actorId: string): FundTransferCommand | null {
  const saved = localStorage.getItem(storageKey(actorId));
  if (saved === null) return null;
  const command = JSON.parse(saved) as FundTransferCommand;
  if ((command.type !== "register" && command.type !== "action") ||
    typeof command.input?.idempotencyKey !== "string" || !command.input.idempotencyKey ||
    (command.type === "action" && typeof command.transferId !== "string")) {
    throw new Error("原转款凭据无法读取，请保留浏览器记录");
  }
  return command;
}

export async function submitFundTransferCommand(
  actorId: string,
  proposal: FundTransferCommand | null,
  isCurrent: () => boolean,
  expectedPending: FundTransferCommand | null = null
) {
  if (!actorId || !navigator.locks) throw new Error("当前浏览器无法安全保存转款凭据");
  const key = storageKey(actorId);
  return navigator.locks.request(key, { mode: "exclusive" }, async () => {
    if (!isCurrent()) throw new Error("当前账号已变化，请重新核对");
    const pending = readFundTransferCommand(actorId);
    if (pending && (proposal || JSON.stringify(pending) !== JSON.stringify(expectedPending))) {
      return { kind: "pending", command: pending } as const;
    }
    const command = pending ?? proposal;
    if (!command) return { kind: "missing" } as const;
    if (!pending) localStorage.setItem(key, JSON.stringify(command));
    try {
      const receipt = command.type === "register"
        ? await registerFundAccountTransfer(command.input)
        : await actOnFundAccountTransfer(command.transferId, command.input);
      localStorage.removeItem(key);
      return { kind: "saved", receipt } as const;
    } catch (error) {
      if (error instanceof FundTransferApiError && error.isSupersededCommand) {
        localStorage.removeItem(key);
        return { kind: "superseded", error } as const;
      }
      if (!pending && error instanceof FundTransferApiError && error.isDefinitiveRejection) {
        localStorage.removeItem(key);
        return { kind: "rejected", error } as const;
      }
      return { kind: "unknown", command } as const;
    }
  });
}
