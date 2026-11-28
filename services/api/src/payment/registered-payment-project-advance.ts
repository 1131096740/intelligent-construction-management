import { BadRequestException, ConflictException } from "@nestjs/common";
import { parseMoneyCentsInput } from "../money/decimal-money";

type Allocation = Readonly<{ sourceBatchId: string; amount: bigint }>;
type AdvanceSource = Readonly<{ id: string; projectId: string | null; projectStatus: string; ownedByCompanyId: string | null }>;
export type ConfirmedProjectAdvance = Readonly<{
  amountCents: string;
  reason: string;
  evidence: string;
  sourceAllocations: ReadonlyArray<Readonly<{ sourceBatchId: string; amountCents: string }>>;
}>;
type Input = {
  projectId: string;
  payerCompanyId: string | null;
  debtorCompanyId: string | null;
  paidCents: bigint;
  openingTreatment: string;
  projectAllocations: readonly Allocation[];
  sources: readonly AdvanceSource[];
  confirmed?: ConfirmedProjectAdvance;
};

const GAP_MESSAGE = "项目资金差额待确认";

export function confirmedProjectAdvancePayload(input: ConfirmedProjectAdvance) {
  const sourceAllocations = input.sourceAllocations
    .map(line => ({ sourceBatchId: line.sourceBatchId, amountCents: line.amountCents }))
    .sort((left, right) => left.sourceBatchId.localeCompare(right.sourceBatchId));
  return { amountCents: input.amountCents, reason: input.reason.trim(), evidence: input.evidence.trim(), sourceAllocations };
}

export function registeredProjectAdvanceReceiptStatus(input: ConfirmedProjectAdvance, receipt: {
  amountCents: bigint;
  reason: string;
  evidence: string;
  companyAllocations: unknown;
} | null): "matched" | "mismatch" | "missing" {
  if (!receipt) return "missing";
  const expected = confirmedProjectAdvancePayload(input);
  if (receipt.amountCents.toString() !== expected.amountCents || receipt.reason !== expected.reason || receipt.evidence !== expected.evidence ||
      !Array.isArray(receipt.companyAllocations) || receipt.companyAllocations.length !== expected.sourceAllocations.length) return "mismatch";
  const stored = new Map(receipt.companyAllocations.filter((line): line is { sourceBatchId: string; amountCents: string } =>
    Boolean(line && typeof line === "object" && typeof line.sourceBatchId === "string" && typeof line.amountCents === "string"))
    .map(line => [line.sourceBatchId, line.amountCents]));
  return stored.size === expected.sourceAllocations.length &&
    expected.sourceAllocations.every(line => stored.get(line.sourceBatchId) === line.amountCents) ? "matched" : "mismatch";
}

export function planRegisteredProjectAdvance(input: Input) {
  const { confirmed, payerCompanyId, debtorCompanyId, openingTreatment, projectAllocations, sources } = input;
  if (openingTreatment !== "not_included") {
    if (confirmed) throw new BadRequestException("已含期初的历史实付不能同时确认新的项目垫资");
    return null;
  }

  const projectAmount = projectAllocations.reduce((total, allocation) => total + allocation.amount, 0n);
  const difference = input.paidCents - projectAmount;
  if (!confirmed && (difference <= 0n || !payerCompanyId || payerCompanyId !== debtorCompanyId)) return null;

  const byId = new Map(sources.map(source => [source.id, source]));
  const allProjectFunds = projectAllocations.every(allocation => {
    const source = byId.get(allocation.sourceBatchId);
    return source?.projectStatus === "project" && source.projectId === input.projectId;
  });
  if (!confirmed) {
    if (projectAllocations.length && allProjectFunds) {
      throw new ConflictException({
        statusCode: 409, code: "REGISTERED_PROJECT_ADVANCE_CONFIRMATION_REQUIRED",
        message: GAP_MESSAGE, differenceCents: difference.toString()
      });
    }
    return null;
  }

  if (!payerCompanyId) throw new BadRequestException("请使用实际付款公司资金确认项目垫资");
  if (payerCompanyId !== debtorCompanyId) throw new ConflictException("跨公司代付不能重复确认同一笔项目垫资");
  if (!allProjectFunds) throw new ConflictException("项目资金分摊必须对应当前项目，不能用未核对来源补齐差额");

  const reason = confirmed.reason.trim();
  const evidence = confirmed.evidence.trim();
  if (!reason || !evidence) throw new BadRequestException("请填写公司垫资确认原因和核对依据");
  const amount = parseMoneyCentsInput(confirmed.amountCents, "公司垫资差额", "请填写实际确认的差额");
  if (difference <= 0n || amount !== difference) throw new ConflictException("确认垫资金额必须等于本次实际付款与已选项目资金的差额");

  const companyAllocations = confirmed.sourceAllocations.map(line => ({
    ...line,
    amount: parseMoneyCentsInput(line.amountCents, "公司来源分摊", "请填写实际公司出资金额")
  }));
  const selected = [...projectAllocations, ...companyAllocations].map(line => line.sourceBatchId);
  if (new Set(selected).size !== selected.length || companyAllocations.some(line => line.amount <= 0n) ||
      companyAllocations.reduce((total, line) => total + line.amount, 0n) !== difference) {
    throw new BadRequestException("公司资金须逐笔明确且合计等于差额，不能重复选择来源");
  }
  for (const allocation of companyAllocations) {
    const source = byId.get(allocation.sourceBatchId);
    if (source?.projectStatus !== "pending" || source.ownedByCompanyId !== payerCompanyId) {
      throw new ConflictException("所选补足款须为已核实的付款公司自有资金，不能采用原出资方待核对或其它项目款");
    }
  }

  return { amount, companyId: payerCompanyId, reason, evidence, companyAllocations };
}
