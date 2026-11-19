import { BadRequestException } from "@nestjs/common";
import { normalizeBusinessAmount } from "@jiangkong/shared-domain";
import { Prisma } from "@prisma/client";

export type OperatingMoneyInput =
  | { numericProtocolVersion?: 1; amountCents: bigint; amountYuan?: never }
  | { numericProtocolVersion: 2; amountCents: null; amountYuan: string | null };

export function normalizeOperatingMoney(value: OperatingMoneyInput): OperatingMoneyInput {
  if (value.numericProtocolVersion === 2) {
    if (value.amountCents !== null || value.amountYuan !== null && (typeof value.amountYuan !== "string" || value.amountYuan === "")) throw new BadRequestException("新版经营金额必须明确填写元金额或待确定，不能混用分");
    try { return { numericProtocolVersion: 2, amountCents: null, amountYuan: normalizeBusinessAmount(value.amountYuan) }; }
    catch { throw new BadRequestException("经营金额最多4位小数，请保留原输入后核对修改"); }
  }
  if (value.numericProtocolVersion !== undefined && value.numericProtocolVersion !== 1 || typeof value.amountCents !== "bigint" || value.amountYuan !== undefined) throw new BadRequestException("原分金额与新版元金额协议不一致");
  return value;
}

export function operatingNumericSnapshot(value: Extract<OperatingMoneyInput, { numericProtocolVersion: 2 }>): Prisma.InputJsonObject {
  return { protocolVersion: 2, amountState: value.amountYuan === null ? "unknown" : "known", amountYuan: value.amountYuan };
}
/** The expected snapshot is derived from source authority, never from the stored fact. */
export function normalizeOperatingSourceSnapshot(input:OperatingMoneyInput&{sourceSnapshot:Prisma.InputJsonObject}):Prisma.InputJsonObject {
  if(input.numericProtocolVersion!==2)return input.sourceSnapshot;
  const money=normalizeOperatingMoney(input) as Extract<OperatingMoneyInput,{numericProtocolVersion:2}>;
  return JSON.parse(JSON.stringify({...input.sourceSnapshot,numericFacts:operatingNumericSnapshot(money)})) as Prisma.InputJsonObject;
}

/** Explicit legacy-only boundary. Null or a v2 fact is never a substitute zero. */
export function requireLegacyOperatingCents(value: { amountCents: bigint | null; numericProtocolVersion?: number }, message = "此原分流程不能处理新版经营金额，请使用对应精度入口"): bigint {
  if (value.numericProtocolVersion === 2 || typeof value.amountCents !== "bigint") throw new BadRequestException(message);
  return value.amountCents;
}

export function sameOperatingMoney(existing: { amountCents: bigint | null; numericProtocolVersion?: number; amountYuan?: Prisma.Decimal | string | null }, input: OperatingMoneyInput): boolean {
  if ((existing.numericProtocolVersion ?? 1) !== (input.numericProtocolVersion ?? 1)) return false;
  if (input.numericProtocolVersion !== 2) return existing.amountCents === input.amountCents;
  return existing.amountCents === null && (existing.amountYuan == null ? null : new Prisma.Decimal(existing.amountYuan).toFixed(4)) === input.amountYuan;
}
