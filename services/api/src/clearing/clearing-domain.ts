import { createHash } from "node:crypto";

import { BadRequestException, ConflictException } from "@nestjs/common";
import type {
  ClearingCategory,
  ClearingEventKind,
  OperatingImpactKind
} from "@jiangkong/shared-domain";

export type ClearingAllocationSourceKind =
  | "authority_cap"
  | "withheld"
  | "final_confirmed"
  | "supplemental";

export interface ClearingAllocationInput {
  sourceEventVersionId: string | null;
  sourceKind: ClearingAllocationSourceKind;
  amountCents: bigint;
  sourceRemainingCents: bigint;
  reversesAllocationId?: string | null;
}

export interface ClearingAllocationPlan extends ClearingAllocationInput {
  sourceRemainingAfterCents: bigint;
}

export interface ClearingImpactPlan {
  sourceImpactKey: string;
  impactKind: OperatingImpactKind;
  amountCents: bigint;
  direction: "increase" | "decrease";
  costCategoryCode?: "construction_enterprise_deduction";
  category: ClearingCategory;
}

export interface ClearingConfirmationPlanInput {
  kind: ClearingEventKind;
  amountCents: bigint;
  authoritativeGrossCapCents: bigint;
  confirmedAgainstCapCents: bigint;
  category: ClearingCategory;
  allocations: readonly ClearingAllocationInput[];
}

export interface ClearingConfirmationPlan {
  allocations: ClearingAllocationPlan[];
  impacts: ClearingImpactPlan[];
}

export function buildClearingConfirmationPlan(
  input: ClearingConfirmationPlanInput
): ClearingConfirmationPlan {
  assertPositiveCents(input.amountCents);
  assertNonNegativeCents(
    input.authoritativeGrossCapCents,
    "权威毛额上限不能为负数"
  );
  assertNonNegativeCents(
    input.confirmedAgainstCapCents,
    "已确认累计金额不能为负数"
  );

  if (
    ["final_confirmed", "supplemental"].includes(input.kind) &&
    input.confirmedAgainstCapCents + input.amountCents >
      input.authoritativeGrossCapCents
  ) {
    throw new BadRequestException("清算金额超过权威毛额上限");
  }

  const allocations = planAllocations(input);
  const impacts = buildImpacts(input, allocations);
  return { allocations, impacts };
}

export function assertClearingActorsDisjoint(
  handlerActorIds: readonly string[],
  confirmerActorIds: readonly string[]
): void {
  const handledBy = new Set(handlerActorIds.filter(Boolean));
  if (confirmerActorIds.some((actorId) => handledBy.has(actorId))) {
    throw new ConflictException("经办人与确认人职责分离冲突");
  }
}

export interface ClearingFingerprintInput {
  action: string;
  aggregateId: string;
  expectedRevision: number;
  actorUserId: string;
  delegatorUserId: string | null;
  payload: unknown;
}

export interface ClearingReconciliationEventVersionFingerprintInput {
  clearingCaseId: string;
  eventKind: ClearingEventKind;
  amountCents: string;
  currencyCode: "CNY";
  previousVersionId: string | null;
  actorSetSnapshot: readonly string[];
  reconciliationIntent: Record<string, unknown>;
}

export function fingerprintClearingCommand(
  input: ClearingFingerprintInput
): string {
  return createHash("sha256").update(stableJson(input)).digest("hex");
}

export function fingerprintClearingReconciliationEventVersion(
  input: ClearingReconciliationEventVersionFingerprintInput
): string {
  return createHash("sha256")
    .update(
      `clearing-event-version/reconciliation-intent/V1\n${strictJcs({
        clearingCaseId: input.clearingCaseId,
        eventKind: input.eventKind,
        amountCents: input.amountCents,
        currencyCode: input.currencyCode,
        previousVersionId: input.previousVersionId,
        actorSetSnapshot: input.actorSetSnapshot,
        reconciliationIntent: input.reconciliationIntent
      })}`,
      "utf8"
    )
    .digest("hex");
}

function planAllocations(
  input: ClearingConfirmationPlanInput
): ClearingAllocationPlan[] {
  const requiresAllocation = [
    "final_confirmed",
    "supplemental",
    "returned"
  ].includes(input.kind);
  const isTechnicalReversal = input.kind === "technical_reversal";
  if (!requiresAllocation && !isTechnicalReversal) {
    if (input.allocations.length) {
      throw new BadRequestException("当前事件类型不接受金额分配");
    }
    return [];
  }
  if (requiresAllocation && !input.allocations.length) {
    throw new BadRequestException("最终、补扣或退回必须提供显式分配");
  }

  let allocatedCents = 0n;
  const consumedBySource = new Map<
    string,
    { remainingCents: bigint; consumedCents: bigint }
  >();
  const plans = input.allocations.map((allocation) => {
    assertPositiveCents(allocation.amountCents);
    assertNonNegativeCents(
      allocation.sourceRemainingCents,
      "来源剩余余额不能为负数"
    );
    if (!isTechnicalReversal && allocation.amountCents > allocation.sourceRemainingCents) {
      throw new BadRequestException("清算分配超过来源剩余余额");
    }
    if (
      allocation.sourceKind !== "authority_cap" &&
      !allocation.sourceEventVersionId
    ) {
      throw new BadRequestException("清算分配必须引用来源事件版本");
    }
    if (
      allocation.sourceKind === "authority_cap" &&
      allocation.sourceEventVersionId
    ) {
      throw new BadRequestException("权威额度分配不得伪造来源事件版本");
    }
    if (
      ["final_confirmed", "supplemental"].includes(input.kind) &&
      !["authority_cap", "withheld"].includes(allocation.sourceKind)
    ) {
      throw new BadRequestException("最终或补扣只能消费权威额度或暂扣余额");
    }
    if (
      input.kind === "returned" &&
      allocation.sourceKind === "authority_cap"
    ) {
      throw new BadRequestException("退回必须精确引用原暂扣或最终事实");
    }
    if (isTechnicalReversal && !allocation.reversesAllocationId) {
      throw new BadRequestException("技术反向分配必须精确引用原 allocation");
    }
    if (!isTechnicalReversal && allocation.reversesAllocationId) {
      throw new BadRequestException("非技术反向事件不得引用原 allocation");
    }

    const sourceKey =
      allocation.sourceKind === "authority_cap"
        ? "authority_cap"
        : `${allocation.sourceKind}:${allocation.sourceEventVersionId}`;
    const consumed = consumedBySource.get(sourceKey);
    if (
      consumed &&
      consumed.remainingCents !== allocation.sourceRemainingCents
    ) {
      throw new BadRequestException("同一清算来源的剩余余额不一致");
    }
    const consumedCents =
      (consumed?.consumedCents ?? 0n) + allocation.amountCents;
    if (!isTechnicalReversal && consumedCents > allocation.sourceRemainingCents) {
      throw new BadRequestException("清算分配超过来源剩余余额");
    }
    consumedBySource.set(sourceKey, {
      remainingCents: allocation.sourceRemainingCents,
      consumedCents
    });

    allocatedCents += allocation.amountCents;
    return {
      ...allocation,
      sourceRemainingAfterCents:
        isTechnicalReversal
          ? allocation.sourceRemainingCents + consumedCents
          : allocation.sourceRemainingCents - consumedCents
    };
  });
  if (
    (!isTechnicalReversal || input.allocations.length > 0) &&
    allocatedCents !== input.amountCents
  ) {
    throw new BadRequestException("显式分配合计必须等于事件金额");
  }
  return plans;
}

function buildImpacts(
  input: ClearingConfirmationPlanInput,
  allocations: readonly ClearingAllocationPlan[]
): ClearingImpactPlan[] {
  const impact = (
    sourceImpactKey: string,
    impactKind: OperatingImpactKind,
    amountCents: bigint,
    direction: "increase" | "decrease",
    cost = false
  ): ClearingImpactPlan => ({
    sourceImpactKey,
    impactKind,
    amountCents,
    direction,
    ...(cost
      ? { costCategoryCode: "construction_enterprise_deduction" as const }
      : {}),
    category: input.category
  });

  if (input.kind === "estimated") {
    return [
      impact(
        "estimated-clearing-expense",
        "estimated_clearing_expense",
        input.amountCents,
        "increase",
        true
      )
    ];
  }
  if (input.kind === "withheld") {
    return [
      impact(
        "construction-enterprise-funds-freeze",
        "construction_enterprise_funds_freeze",
        input.amountCents,
        "decrease"
      )
    ];
  }
  if (input.kind === "pending_reconciliation") return [];
  if (
    input.kind === "coverage_added" ||
    input.kind === "continued_withheld" ||
    input.kind === "technical_reversal"
  ) return [];

  const impacts: ClearingImpactPlan[] = [];
  const withheldCents = allocations
    .filter((allocation) => allocation.sourceKind === "withheld")
    .reduce((sum, allocation) => sum + allocation.amountCents, 0n);
  if (withheldCents > 0n) {
    impacts.push(
      impact(
        "construction-enterprise-funds-release",
        "construction_enterprise_funds_release",
        withheldCents,
        "increase"
      )
    );
  }

  if (["final_confirmed", "supplemental"].includes(input.kind)) {
    impacts.push(
      impact(
        "confirmed-cost",
        "confirmed_cost",
        input.amountCents,
        "increase",
        true
      ),
      impact(
        "construction-enterprise-funds-decrease",
        "construction_enterprise_funds_decrease",
        input.amountCents,
        "decrease"
      )
    );
    return impacts;
  }

  const confirmedReturnCents = allocations
    .filter((allocation) =>
      ["final_confirmed", "supplemental"].includes(allocation.sourceKind)
    )
    .reduce((sum, allocation) => sum + allocation.amountCents, 0n);
  if (confirmedReturnCents > 0n) {
    impacts.push(
      impact(
        "confirmed-cost-return",
        "confirmed_cost",
        confirmedReturnCents,
        "decrease",
        true
      ),
      impact(
        "construction-enterprise-funds-return",
        "construction_enterprise_funds_increase",
        confirmedReturnCents,
        "increase"
      )
    );
  }
  return impacts;
}

function assertPositiveCents(value: bigint): void {
  if (value <= 0n) {
    throw new BadRequestException("清算金额必须是正整数分");
  }
}

function assertNonNegativeCents(value: bigint, message: string): void {
  if (value < 0n) throw new BadRequestException(message);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  return JSON.stringify(value);
}

function strictJcs(value: unknown, ancestors = new Set<object>()): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") {
    assertUnicodeScalarString(value);
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new TypeError("清算 JCS 不接受非有限数或负零");
    }
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw new TypeError("清算 JCS 仅接受 JSON 值");
  }
  if (ancestors.has(value)) throw new TypeError("清算 JCS 不接受循环引用");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const items: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) throw new TypeError("清算 JCS 不接受数组空洞");
        items.push(strictJcs(value[index], ancestors));
      }
      return `[${items.join(",")}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("清算 JCS 仅接受 plain JSON object");
    }
    const record = value as Record<string, unknown>;
    const keys = Reflect.ownKeys(record);
    if (keys.some((key) => typeof key !== "string")) {
      throw new TypeError("清算 JCS 不接受 symbol key");
    }
    const stringKeys = keys as string[];
    for (const key of stringKeys) {
      assertUnicodeScalarString(key);
      const descriptor = Object.getOwnPropertyDescriptor(record, key);
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        throw new TypeError("清算 JCS 仅接受 enumerable data property");
      }
    }
    stringKeys.sort();
    return `{${stringKeys.map((key) => `${JSON.stringify(key)}:${strictJcs(record[key], ancestors)}`).join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

function assertUnicodeScalarString(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new TypeError("清算 JCS 文本包含 lone surrogate");
      }
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError("清算 JCS 文本包含 lone surrogate");
    }
  }
}
