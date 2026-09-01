import { ConflictException } from "@nestjs/common";
import { createHash } from "node:crypto";

export const FUND_EXECUTION_COMMAND_ACTIONS = [
  "create_case",
  "update_case",
  "submit_case",
  "return_case",
  "confirm_case"
] as const;

export type FundExecutionCommandAction =
  (typeof FUND_EXECUTION_COMMAND_ACTIONS)[number];

export function fundExecutionCommandFingerprint(
  action: FundExecutionCommandAction,
  payload: unknown
) {
  return createHash("sha256")
    .update(JSON.stringify(canonical({ action, payload })))
    .digest("hex");
}

export type FundExecutionCommandReceipt<TResponse> = Readonly<{
  action: FundExecutionCommandAction;
  payloadFingerprint: string;
  responseSnapshot: TResponse;
}>;

type ExecuteFundExecutionReceiptFirstInput<TResponse> = Readonly<{
  action: FundExecutionCommandAction;
  idempotencyKey: string;
  payloadFingerprint: string;
  lockIdempotency: () => Promise<void>;
  findReceipt: () => Promise<FundExecutionCommandReceipt<TResponse> | null>;
  execute: () => Promise<TResponse>;
  createReceipt: (
    receipt: FundExecutionCommandReceipt<TResponse> &
      Readonly<{ idempotencyKey: string }>
  ) => Promise<void>;
}>;

export async function executeFundExecutionReceiptFirst<TResponse>(
  input: ExecuteFundExecutionReceiptFirstInput<TResponse>
) {
  await input.lockIdempotency();
  const existing = await input.findReceipt();
  if (existing) {
    if (
      existing.action !== input.action ||
      existing.payloadFingerprint !== input.payloadFingerprint
    ) {
      throw new ConflictException("幂等键已被其他资金执行命令占用");
    }
    return existing.responseSnapshot;
  }

  const responseSnapshot = await input.execute();
  await input.createReceipt({
    action: input.action,
    idempotencyKey: input.idempotencyKey,
    payloadFingerprint: input.payloadFingerprint,
    responseSnapshot
  });
  return responseSnapshot;
}

function canonical(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonical(nested)])
    );
  }
  return value;
}
