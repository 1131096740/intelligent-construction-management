import { BadRequestException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

/**
 * OPS-07：施工企业已付金额 = 施工企业直接付下游 + 施工企业转我方。
 *
 * 这不是 #418 的「项目对外支付」：对外支付还包含我方对下游的实际支付。
 * 两个指标成对定义、口径不同，禁止相加。
 *
 * 我方收到施工企业拨款后再由我方付下游，落在我方付款事实上，
 * 不会进入本口径，因此不会重复计算施工企业的直接已付。
 */
export const CONSTRUCTION_ENTERPRISE_PAID_SOURCES = [
  "project_affiliate_payment_fact",
  "project_upstream_fund_fact"
] as const;

export type ConstructionEnterprisePaidSource =
  (typeof CONSTRUCTION_ENTERPRISE_PAID_SOURCES)[number];

export type ConstructionEnterprisePaidKind =
  | "downstream_payment"
  | "affiliate_remittance_to_company";

export interface ConstructionEnterprisePaidFact {
  id: string;
  kind: ConstructionEnterprisePaidKind;
  counterpartyName: string;
  occurredAt: Date;
  amountCents: bigint;
  effectDirection: "increase" | "decrease";
  settlementLedgerId: string | null;
  paymentKind?: string;
}

export interface ConstructionEnterprisePaidLedger {
  ledgerId: string;
  effectiveAmountCents: bigint;
  paidAmountCents: bigint;
}

export interface ConstructionEnterprisePaidSummary {
  downstreamCents: bigint;
  remittanceCents: bigint;
  paidCents: bigint;
  overpaidCents: bigint;
}

export interface ConstructionEnterprisePaidEntry extends ConstructionEnterprisePaidFact {
  sourceType: ConstructionEnterprisePaidSource;
  ledgerOverpaidCents: bigint;
}

function signedAmount(fact: {
  effectDirection: string;
  amountCents: bigint;
}): bigint {
  return fact.effectDirection === "decrease" ? -fact.amountCents : fact.amountCents;
}

function mapSettlementLedgers(
  settlements: Array<{
    id: string;
    ledgerId: string;
    effectDirection: string;
    amountCents: bigint;
  }>
) {
  const effectiveByLedger = new Map<string, bigint>();
  const ledgerBySettlementFact = new Map<string, string>();
  for (const settlement of settlements) {
    ledgerBySettlementFact.set(settlement.id, settlement.ledgerId);
    effectiveByLedger.set(
      settlement.ledgerId,
      (effectiveByLedger.get(settlement.ledgerId) ?? 0n) +
        signedAmount(settlement)
    );
  }
  return { effectiveByLedger, ledgerBySettlementFact };
}

function overpaidByLedger(
  effectiveByLedger: Map<string, bigint>,
  paidByLedger: Map<string, bigint>
): Map<string, bigint> {
  const result = new Map<string, bigint>();
  for (const [ledgerId, paid] of paidByLedger) {
    const effective = effectiveByLedger.get(ledgerId) ?? 0n;
    result.set(ledgerId, paid > effective ? paid - effective : 0n);
  }
  return result;
}

export function summarizeConstructionEnterprisePaid(
  facts: ConstructionEnterprisePaidFact[],
  settlements: Array<{
    id: string;
    ledgerId: string;
    effectDirection: string;
    amountCents: bigint;
  }>
): ConstructionEnterprisePaidSummary {
  const { effectiveByLedger } = mapSettlementLedgers(settlements);
  let downstreamCents = 0n;
  let remittanceCents = 0n;
  const paidByLedger = new Map<string, bigint>();
  for (const fact of facts) {
    const signed = signedAmount(fact);
    if (fact.kind === "downstream_payment") downstreamCents += signed;
    else remittanceCents += signed;
    if (fact.settlementLedgerId) {
      paidByLedger.set(
        fact.settlementLedgerId,
        (paidByLedger.get(fact.settlementLedgerId) ?? 0n) + signed
      );
    }
  }
  let overpaidCents = 0n;
  for (const overpaid of overpaidByLedger(effectiveByLedger, paidByLedger).values()) {
    overpaidCents += overpaid;
  }
  return {
    downstreamCents,
    remittanceCents,
    paidCents: downstreamCents + remittanceCents,
    overpaidCents
  };
}

/**
 * 同一项目内已确认的施工企业已付事实。只统计数据事实，不读取经营投影，
 * 因此即使经营账本尚未启用，也能给出真实已付金额。
 */
export async function readConstructionEnterprisePaid(
  tx: Prisma.TransactionClient,
  projectId: string
): Promise<{
  summary: ConstructionEnterprisePaidSummary;
  entries: ConstructionEnterprisePaidEntry[];
}> {
  const [payments, remittances, settlements, settlementOwners] = await Promise.all([
    tx.projectAffiliatePaymentFact.findMany({
      where: { projectId, status: "confirmed" },
      select: {
        id: true,
        counterpartyName: true,
        paidAt: true,
        amountCents: true,
        effectDirection: true,
        settlementLedgerId: true,
        paymentKind: true
      }
    }),
    tx.projectUpstreamFundFact.findMany({
      where: {
        projectId,
        status: "confirmed",
        factType: "affiliate_remittance_to_company"
      },
      select: {
        id: true,
        counterpartyName: true,
        occurredAt: true,
        amountCents: true,
        effectDirection: true,
        affiliateSettlementFactId: true
      }
    }),
    tx.projectAffiliateSettlementFact.findMany({
      where: { projectId, status: "confirmed" },
      select: {
        id: true,
        ledgerId: true,
        effectDirection: true,
        amountCents: true
      }
    }),
    tx.projectAffiliateSettlementFact.findMany({
      where: { projectId },
      select: { id: true, ledgerId: true }
    })
  ]);

  const { effectiveByLedger, ledgerBySettlementFact } =
    mapSettlementLedgers(settlements);
  const ledgerByAnySettlementFact = new Map(ledgerBySettlementFact);
  for (const owner of settlementOwners) {
    if (!ledgerByAnySettlementFact.has(owner.id)) {
      ledgerByAnySettlementFact.set(owner.id, owner.ledgerId);
    }
  }

  const facts: ConstructionEnterprisePaidEntry[] = [];
  for (const payment of payments) {
    facts.push({
      id: payment.id,
      kind: "downstream_payment",
      sourceType: "project_affiliate_payment_fact",
      counterpartyName: payment.counterpartyName,
      occurredAt: payment.paidAt,
      amountCents: payment.amountCents,
      effectDirection: payment.effectDirection as "increase" | "decrease",
      settlementLedgerId: payment.settlementLedgerId,
      paymentKind: payment.paymentKind,
      ledgerOverpaidCents: 0n
    });
  }
  for (const remittance of remittances) {
    const ledgerId = remittance.affiliateSettlementFactId
      ? ledgerByAnySettlementFact.get(remittance.affiliateSettlementFactId) ?? null
      : null;
    facts.push({
      id: remittance.id,
      kind: "affiliate_remittance_to_company",
      sourceType: "project_upstream_fund_fact",
      counterpartyName: remittance.counterpartyName,
      occurredAt: remittance.occurredAt,
      amountCents: remittance.amountCents,
      effectDirection: remittance.effectDirection as "increase" | "decrease",
      settlementLedgerId: ledgerId,
      ledgerOverpaidCents: 0n
    });
  }

  const paidByLedger = new Map<string, bigint>();
  for (const fact of facts) {
    if (!fact.settlementLedgerId) continue;
    paidByLedger.set(
      fact.settlementLedgerId,
      (paidByLedger.get(fact.settlementLedgerId) ?? 0n) + signedAmount(fact)
    );
  }
  const overpaid = overpaidByLedger(effectiveByLedger, paidByLedger);
  for (const fact of facts) {
    fact.ledgerOverpaidCents = fact.settlementLedgerId
      ? overpaid.get(fact.settlementLedgerId) ?? 0n
      : 0n;
  }

  let downstreamCents = 0n;
  let remittanceCents = 0n;
  for (const fact of facts) {
    if (fact.kind === "downstream_payment") downstreamCents += signedAmount(fact);
    else remittanceCents += signedAmount(fact);
  }
  let overpaidCents = 0n;
  for (const amount of overpaid.values()) overpaidCents += amount;

  return {
    summary: {
      downstreamCents,
      remittanceCents,
      paidCents: downstreamCents + remittanceCents,
      overpaidCents
    },
    entries: facts
  };
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export interface ConstructionEnterprisePaidCursor {
  occurredAt: string;
  id: string;
}

export function encodeConstructionEnterprisePaidCursor(
  position: ConstructionEnterprisePaidCursor
): string {
  return Buffer.from(JSON.stringify({ v: 1, ...position }), "utf8").toString(
    "base64url"
  );
}

export function decodeConstructionEnterprisePaidCursor(
  cursor: string
): ConstructionEnterprisePaidCursor {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8")
    ) as { v?: unknown; occurredAt?: unknown; id?: unknown };
    if (
      parsed.v !== 1 ||
      typeof parsed.occurredAt !== "string" ||
      typeof parsed.id !== "string" ||
      !parsed.id ||
      Number.isNaN(Date.parse(parsed.occurredAt))
    ) {
      throw new Error("游标内容错误");
    }
    return { occurredAt: parsed.occurredAt, id: parsed.id };
  } catch {
    throw new BadRequestException("施工企业已付明细游标无效或与当前查询不匹配");
  }
}

function compareDescending(
  left: ConstructionEnterprisePaidEntry,
  right: ConstructionEnterprisePaidEntry
) {
  const difference = right.occurredAt.getTime() - left.occurredAt.getTime();
  if (difference !== 0) return difference;
  return left.id < right.id ? 1 : left.id > right.id ? -1 : 0;
}

/** 项目总览下钻：收款方/金额/时间，跨付下游与转我方两条事实族。 */
export async function listConstructionEnterprisePaid(
  tx: Prisma.TransactionClient,
  projectId: string,
  input: { cursor?: string; pageSize?: number } = {}
) {
  const pageSize = input.pageSize ?? DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new BadRequestException("施工企业已付明细每页条数必须是 1 到 200 的整数");
  }
  const position = input.cursor
    ? decodeConstructionEnterprisePaidCursor(input.cursor)
    : null;
  const cursorAt = position ? new Date(position.occurredAt) : null;
  const paymentWhere: Prisma.ProjectAffiliatePaymentFactWhereInput = {
    projectId,
    status: "confirmed",
    ...(position && cursorAt
      ? {
          OR: [
            { paidAt: { lt: cursorAt } },
            { paidAt: cursorAt, id: { lt: position.id } }
          ]
        }
      : {})
  };
  const remittanceWhere: Prisma.ProjectUpstreamFundFactWhereInput = {
    projectId,
    status: "confirmed",
    factType: "affiliate_remittance_to_company",
    ...(position && cursorAt
      ? {
          OR: [
            { occurredAt: { lt: cursorAt } },
            { occurredAt: cursorAt, id: { lt: position.id } }
          ]
        }
      : {})
  };
  const [payments, remittances, settlements, settlementOwners] = await Promise.all([
    tx.projectAffiliatePaymentFact.findMany({
      where: paymentWhere,
      select: {
        id: true,
        counterpartyName: true,
        paidAt: true,
        amountCents: true,
        effectDirection: true,
        settlementLedgerId: true,
        paymentKind: true,
        status: true
      },
      orderBy: [{ paidAt: "desc" }, { id: "desc" }],
      take: pageSize + 1
    }),
    tx.projectUpstreamFundFact.findMany({
      where: remittanceWhere,
      select: {
        id: true,
        counterpartyName: true,
        occurredAt: true,
        amountCents: true,
        effectDirection: true,
        affiliateSettlementFactId: true
      },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: pageSize + 1
    }),
    tx.projectAffiliateSettlementFact.findMany({
      where: { projectId, status: "confirmed" },
      select: {
        id: true,
        ledgerId: true,
        effectDirection: true,
        amountCents: true
      }
    }),
    tx.projectAffiliateSettlementFact.findMany({
      where: { projectId },
      select: { id: true, ledgerId: true }
    })
  ]);

  const { ledgerBySettlementFact } = mapSettlementLedgers(settlements);
  const ledgerByAnySettlementFact = new Map(ledgerBySettlementFact);
  for (const owner of settlementOwners) {
    if (!ledgerByAnySettlementFact.has(owner.id)) {
      ledgerByAnySettlementFact.set(owner.id, owner.ledgerId);
    }
  }

  const merged: ConstructionEnterprisePaidEntry[] = [
    ...payments.map((payment) => ({
      id: payment.id,
      kind: "downstream_payment" as const,
      sourceType: "project_affiliate_payment_fact" as const,
      counterpartyName: payment.counterpartyName,
      occurredAt: payment.paidAt,
      amountCents: payment.amountCents,
      effectDirection: payment.effectDirection as "increase" | "decrease",
      settlementLedgerId: payment.settlementLedgerId,
      paymentKind: payment.paymentKind,
      ledgerOverpaidCents: 0n
    })),
    ...remittances.map((remittance) => ({
      id: remittance.id,
      kind: "affiliate_remittance_to_company" as const,
      sourceType: "project_upstream_fund_fact" as const,
      counterpartyName: remittance.counterpartyName,
      occurredAt: remittance.occurredAt,
      amountCents: remittance.amountCents,
      effectDirection: remittance.effectDirection as "increase" | "decrease",
      settlementLedgerId: remittance.affiliateSettlementFactId
        ? ledgerByAnySettlementFact.get(remittance.affiliateSettlementFactId) ?? null
        : null,
      ledgerOverpaidCents: 0n
    }))
  ].sort(compareDescending);

  const page = merged.slice(0, pageSize);
  const nextPosition = merged.length > pageSize ? page[page.length - 1] : null;

  // 超付提示按结算账本口径计算；下钻会返回项目全部已确认事实中的账本余额，
  // 因此这里补充读取同账本事实，避免只按当前页误判。
  const allFacts = await readConstructionEnterprisePaid(tx, projectId);
  const overpaidByLedgerId = new Map<string, bigint>();
  for (const fact of allFacts.entries) {
    if (fact.settlementLedgerId) {
      overpaidByLedgerId.set(fact.settlementLedgerId, fact.ledgerOverpaidCents);
    }
  }
  for (const fact of page) {
    fact.ledgerOverpaidCents = fact.settlementLedgerId
      ? overpaidByLedgerId.get(fact.settlementLedgerId) ?? 0n
      : 0n;
  }

  return {
    items: page,
    summary: allFacts.summary,
    nextCursor: nextPosition
      ? encodeConstructionEnterprisePaidCursor({
          occurredAt: nextPosition.occurredAt.toISOString(),
          id: nextPosition.id
        })
      : null
  };
}
