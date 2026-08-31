import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Injectable, Optional } from "@nestjs/common";

import type { ExecutionAllocationAxis } from "./fund-execution.domain";

const SELECTION_TTL_MILLISECONDS = 5 * 60 * 1_000;
const BANK_OBSERVATION_PREFIX = "fobs1";
const AXIS_BUSINESS_PREFIX = "faxis1";
const REVERSAL_TARGET_PREFIX = "frev1";
const BANK_OBSERVATION_PURPOSE = "fund_execution_bank_observation_selection_v1";
const AXIS_BUSINESS_PURPOSE = "fund_execution_axis_business_selection_v1";
const REVERSAL_TARGET_PURPOSE = "fund_execution_reversal_target_selection_v1";

export function fundExecutionSelectionRefFingerprint(selectionRef: string) {
  return createHash("sha256").update(selectionRef.trim()).digest("hex");
}

export function fundExecutionSelectionExpiresAt(now = new Date()) {
  return new Date(now.getTime() + SELECTION_TTL_MILLISECONDS);
}

export type BankObservationDirection = "inflow" | "outflow";

export type BankObservationSelectionBinding = Readonly<{
  actorUserId: string;
  observationId: string;
  observationFingerprint: string;
  payerVerificationId: string;
  payerVerificationFingerprint: string;
  direction: BankObservationDirection;
  amountCents: bigint;
  currency: string;
}>;

export type AxisBusinessSelectionBinding = Readonly<{
  actorUserId: string;
  caseId: string;
  caseRevision: number;
  executionId: string;
  allocationLineId: string;
  axis: ExecutionAllocationAxis;
  optionFingerprint: string;
  amountCents: bigint;
}>;

export type ReversalTargetSelectionBinding = Readonly<{
  actorUserId: string;
  targetType: "payment_execution" | "fund_execution";
  targetExecutionId: string;
  targetFingerprint: string;
}>;

type FundExecutionSelectionRefSecrets = Readonly<{
  bankObservationSecret?: string;
  axisBusinessSecret?: string;
}>;

@Injectable()
export class FundExecutionSelectionRefService {
  private readonly bankObservationSecret: string;
  private readonly axisBusinessSecret: string;

  constructor(@Optional() secrets: FundExecutionSelectionRefSecrets = {}) {
    const bankObservationSecret =
      secrets.bankObservationSecret ??
      process.env.FUND_EXECUTION_BANK_OBSERVATION_SELECTION_SECRET;
    const axisBusinessSecret =
      secrets.axisBusinessSecret ??
      process.env.FUND_EXECUTION_AXIS_BUSINESS_SELECTION_SECRET;
    if (process.env.NODE_ENV === "production") {
      this.assertProductionSecret(
        bankObservationSecret,
        "银行流水候选 selectionRef"
      );
      this.assertProductionSecret(axisBusinessSecret, "逐轴业务选项 selectionRef");
      if (bankObservationSecret === axisBusinessSecret) {
        throw new Error("生产环境资金执行 selectionRef 签名密钥必须按用途分离");
      }
    }
    this.bankObservationSecret =
      bankObservationSecret ?? "local-fund-observation-selection-secret";
    this.axisBusinessSecret =
      axisBusinessSecret ?? "local-fund-axis-business-selection-secret";
  }

  issueBankObservation(binding: BankObservationSelectionBinding, now = new Date()) {
    return this.issue(
      BANK_OBSERVATION_PREFIX,
      BANK_OBSERVATION_PURPOSE,
      this.bankObservationSecret,
      this.bankObservationCanonical(binding),
      now
    );
  }

  matchesBankObservation(
    selectionRef: string,
    binding: BankObservationSelectionBinding,
    now = new Date()
  ) {
    return this.matches(
      selectionRef,
      BANK_OBSERVATION_PREFIX,
      BANK_OBSERVATION_PURPOSE,
      this.bankObservationSecret,
      this.bankObservationCanonical(binding),
      now
    );
  }

  issueAxisBusinessOption(binding: AxisBusinessSelectionBinding, now = new Date()) {
    return this.issue(
      AXIS_BUSINESS_PREFIX,
      AXIS_BUSINESS_PURPOSE,
      this.axisBusinessSecret,
      this.axisBusinessCanonical(binding),
      now
    );
  }

  matchesAxisBusinessOption(
    selectionRef: string,
    binding: AxisBusinessSelectionBinding,
    now = new Date()
  ) {
    return this.matches(
      selectionRef,
      AXIS_BUSINESS_PREFIX,
      AXIS_BUSINESS_PURPOSE,
      this.axisBusinessSecret,
      this.axisBusinessCanonical(binding),
      now
    );
  }

  issueReversalTarget(
    binding: ReversalTargetSelectionBinding,
    now = new Date()
  ) {
    return this.issue(
      REVERSAL_TARGET_PREFIX,
      REVERSAL_TARGET_PURPOSE,
      this.axisBusinessSecret,
      this.reversalTargetCanonical(binding),
      now
    );
  }

  matchesReversalTarget(
    selectionRef: string,
    binding: ReversalTargetSelectionBinding,
    now = new Date()
  ) {
    return this.matches(
      selectionRef,
      REVERSAL_TARGET_PREFIX,
      REVERSAL_TARGET_PURPOSE,
      this.axisBusinessSecret,
      this.reversalTargetCanonical(binding),
      now
    );
  }

  private issue(
    prefix: string,
    purpose: string,
    secret: string,
    canonicalBinding: readonly unknown[],
    now: Date
  ) {
    const expiresAtEpochMs = now.getTime() + SELECTION_TTL_MILLISECONDS;
    const encodedExpiry = expiresAtEpochMs.toString(36);
    return `${prefix}.${encodedExpiry}.${this.signature(
      purpose,
      secret,
      canonicalBinding,
      expiresAtEpochMs
    )}`;
  }

  private matches(
    selectionRef: string,
    expectedPrefix: string,
    purpose: string,
    secret: string,
    canonicalBinding: readonly unknown[],
    now: Date
  ) {
    if (typeof selectionRef !== "string") {
      return false;
    }
    const parts = selectionRef.split(".");
    if (parts.length !== 3 || parts[0] !== expectedPrefix) {
      return false;
    }
    const expiresAtEpochMs = Number.parseInt(parts[1], 36);
    if (
      !Number.isSafeInteger(expiresAtEpochMs) ||
      expiresAtEpochMs <= now.getTime() ||
      expiresAtEpochMs > now.getTime() + SELECTION_TTL_MILLISECONDS
    ) {
      return false;
    }
    const expected = Buffer.from(
      `${expectedPrefix}.${parts[1]}.${this.signature(
        purpose,
        secret,
        canonicalBinding,
        expiresAtEpochMs
      )}`
    );
    const actual = Buffer.from(selectionRef);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  private signature(
    purpose: string,
    secret: string,
    canonicalBinding: readonly unknown[],
    expiresAtEpochMs: number
  ) {
    return createHmac("sha256", secret)
      .update(JSON.stringify([purpose, ...canonicalBinding, expiresAtEpochMs]))
      .digest("base64url");
  }

  private bankObservationCanonical(binding: BankObservationSelectionBinding) {
    return [
      binding.actorUserId,
      binding.observationId,
      binding.observationFingerprint,
      binding.payerVerificationId,
      binding.payerVerificationFingerprint,
      binding.direction,
      binding.amountCents.toString(),
      binding.currency
    ] as const;
  }

  private axisBusinessCanonical(binding: AxisBusinessSelectionBinding) {
    return [
      binding.actorUserId,
      binding.caseId,
      binding.caseRevision,
      binding.executionId,
      binding.allocationLineId,
      binding.axis,
      binding.optionFingerprint,
      binding.amountCents.toString()
    ] as const;
  }

  private reversalTargetCanonical(binding: ReversalTargetSelectionBinding) {
    return [
      binding.actorUserId,
      binding.targetType,
      binding.targetExecutionId,
      binding.targetFingerprint
    ] as const;
  }

  private assertProductionSecret(secret: string | undefined, purpose: string) {
    if (!secret || secret.length < 32) {
      throw new Error(`生产环境必须配置独立的${purpose}签名密钥`);
    }
  }
}
