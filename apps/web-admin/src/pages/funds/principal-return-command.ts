import {
  actOnPrincipalReturn,
  applyPrincipalReturn,
  fetchPrincipalReturnResult,
  fetchPrincipalReturns,
  payPrincipalReturn,
  PrincipalReturnApiError,
  type PrincipalReturnReadModel,
  type PrincipalReturnCommand,
} from "../../api/fund-principal-return.api";

const storageKey = (actor: string) => `jiangkong-principal-return:v1:${actor}`;

export function readPrincipalReturnCommand(actor: string): PrincipalReturnCommand | null {
  const saved = localStorage.getItem(storageKey(actor));
  if (!saved) return null;
  const command = JSON.parse(saved) as PrincipalReturnCommand;
  if (!command?.idempotencyKey || !command.input ||
      !["apply", "act", "pay"].includes(command.kind) ||
      (command.kind !== "apply" && !command.applicationId)) {
    throw new Error("原归还凭据无法读取，请保留浏览器记录");
  }
  return command;
}

function canWritePrincipalReturn(model: PrincipalReturnReadModel, command: PrincipalReturnCommand) {
  if (command.kind === "apply") {
    return model.items.some(source => source.sourceKind === command.input.sourceKind &&
      source.sourceId === command.input.sourceId && source.canApply);
  }
  const application = model.items.flatMap(source => source.applications).find(row => row.id === command.applicationId);
  if (!application || application.revision !== command.input.expectedRevision) return false;
  if (command.kind === "pay") return application.canPay && model.payableScopeKeys.includes(command.input.scopeKey);
  if (command.input.action === "withdraw") return application.canWithdraw;
  if (command.input.action === "reduce") return application.canReduce;
  return application.approvalDuties.some(duty => duty.nodeIndex === command.input.nodeIndex);
}

export async function runPrincipalReturnCommand(
  actor: string,
  command: PrincipalReturnCommand,
  mode: "new" | "check" | "retry",
  isCurrent: () => boolean,
  password = "",
) {
  if (!actor || !navigator.locks) throw new Error("当前浏览器无法安全保存归还凭据");
  const key = storageKey(actor);
  return navigator.locks.request(key, { mode: "exclusive" }, async () => {
    if (!isCurrent()) throw new Error("当前账号已变化，请重新核对");
    const saved = readPrincipalReturnCommand(actor);
    if (saved && (mode === "new" || JSON.stringify(saved) !== JSON.stringify(command))) {
      return { kind: "pending", command: saved } as const;
    }
    if (!saved && mode !== "new") return { kind: "missing" } as const;
    try {
      if (saved) {
        const receipt = await fetchPrincipalReturnResult(command.idempotencyKey, isCurrent);
        if (isRecordedReceipt(receipt, command)) {
          localStorage.removeItem(key);
          return { kind: "recorded" } as const;
        }
        if (mode === "check" || receipt?.status !== "unconfirmed" ||
            receipt.idempotencyKey !== command.idempotencyKey) return { kind: "pending", command } as const;
      }

      const model = await fetchPrincipalReturns(isCurrent);
      if (!isCurrent()) return { kind: "pending", command } as const;
      if (!canWritePrincipalReturn(model, command)) {
        const error = new Error("办理权限或原记录状态已变化，请刷新后核对");
        return saved ? { kind: "pending", command } as const : { kind: "rejected", error } as const;
      }
      if (!saved) localStorage.setItem(key, JSON.stringify(command));
      const receipt = command.kind === "apply"
        ? await applyPrincipalReturn(command, isCurrent)
        : command.kind === "act"
          ? await actOnPrincipalReturn(command, password, isCurrent)
          : await payPrincipalReturn(command, password, isCurrent);
      if (isRecordedReceipt(receipt, command)) {
        localStorage.removeItem(key);
        return { kind: "recorded" } as const;
      }
    } catch (error) {
      if (!saved && !readPrincipalReturnCommand(actor)) throw error;
      if (mode === "new" && error instanceof PrincipalReturnApiError && error.rejected) {
        localStorage.removeItem(key);
        return { kind: "rejected", error } as const;
      }
    }
    return { kind: "pending", command } as const;
  });
}

function isRecordedReceipt(receipt: Awaited<ReturnType<typeof fetchPrincipalReturnResult>>, command: PrincipalReturnCommand) {
  return receipt?.status === "recorded" && receipt.idempotencyKey === command.idempotencyKey &&
    receipt.applicationId && (command.kind === "apply" || receipt.applicationId === command.applicationId) &&
    (command.kind !== "pay" || receipt.paymentId);
}
