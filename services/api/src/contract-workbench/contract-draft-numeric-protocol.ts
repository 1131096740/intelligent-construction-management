import { BadRequestException, ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { businessAmountToLegacyCents } from "@jiangkong/shared-domain";

export function assertContractDraftNumericProtocol(version: { numericProtocolVersion?: number }, protocol?: string) {
  if (protocol !== undefined && protocol !== "2") throw new BadRequestException("合同金额读取格式不受支持，请刷新页面后重试");
  if (version.numericProtocolVersion === 2 && protocol !== "2") throw new ConflictException("合同金额精度已升级，请刷新页面并使用新版合同工作台后重试");
}

export function assertLegacyContractDraftWriter(version: { numericProtocolVersion?: number }) {
  if (version.numericProtocolVersion === 2) throw new ConflictException("合同金额精度已升级，请使用新版合同草稿工作台保存，原四位金额不会被覆盖");
}

type DecimalFact = Prisma.Decimal | string | null | undefined;
function yuan(value: DecimalFact) { return value == null ? null : new Prisma.Decimal(value).toFixed(4); }

export function contractVersionMoneyReadProjection(version: { numericProtocolVersion?: number; amountYuan?: DecimalFact }) {
  if (version.numericProtocolVersion !== 2) return {};
  const amountYuan = yuan(version.amountYuan);
  return { amountYuan, amountCents: businessAmountToLegacyCents(amountYuan) };
}

export function contractBillMoneyReadProjection(bill: { numericProtocolVersion?: number; taxInclusiveAmountYuan?: DecimalFact; taxExclusiveAmountYuan?: DecimalFact; taxAmountYuan?: DecimalFact }) {
  if (bill.numericProtocolVersion !== 2) return {};
  const taxInclusiveAmountYuan = yuan(bill.taxInclusiveAmountYuan);
  const taxExclusiveAmountYuan = yuan(bill.taxExclusiveAmountYuan);
  const taxAmountYuan = yuan(bill.taxAmountYuan);
  const gross = businessAmountToLegacyCents(taxInclusiveAmountYuan);
  const net = businessAmountToLegacyCents(taxExclusiveAmountYuan);
  return { taxInclusiveAmountYuan, taxExclusiveAmountYuan, taxAmountYuan,
    taxInclusiveAmountCents: gross, taxExclusiveAmountCents: net,
    taxAmountCents: gross === null || net === null ? null : (BigInt(gross) - BigInt(net)).toString() };
}

export const CONTRACT_PRECISE_HISTORICAL_REMAINDER_REASON = "历史余量与精确金额需一起核对，当前不能直接取消，请联系合同部复核清单和结算记录。";

export const CONTRACT_PRECISE_SUBMISSION_REASON = "四位金额草稿尚不能提交审批，请保留草稿，待合同部核对审批要求后再办理。";
