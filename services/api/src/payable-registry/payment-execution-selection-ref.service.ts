import { createHmac, timingSafeEqual } from "node:crypto";

const PURPOSE = "payment_execution_selection:v1";
const TOKEN_PREFIX = "pes1";
const TTL_MILLISECONDS = 8 * 60 * 1000;

export interface PaymentExecutionSelectionBinding {
  actorUserId: string;
  caseId: string;
  companyId: string;
  projectId: string;
  paymentExecutionId: string;
  executionFingerprint: string;
  caseRevision: number;
  balanceFingerprint: string;
}

/**
 * Issues an irreversible, stateless candidate-selection reference.  The
 * reference is deliberately only a HMAC: its bound PaymentExecution id and
 * other inputs cannot be decoded by the client.
 */
export class PaymentExecutionSelectionRefService {
  private readonly secret: string;

  constructor(secret?: string) {
    const configuredSecret = secret ?? process.env.PAYMENT_EXECUTION_SELECTION_SECRET;
    if (process.env.NODE_ENV === "production" && (!configuredSecret || configuredSecret.length < 32)) {
      throw new Error("生产环境必须配置独立的付款候选 selectionRef 签名密钥");
    }
    this.secret = configuredSecret ?? "local-selection-ref-secret";
  }

  issue(binding: PaymentExecutionSelectionBinding, now = new Date()) {
    const expiresAt = new Date(now.getTime() + TTL_MILLISECONDS).toISOString();
    return {
      selectionRef: `${TOKEN_PREFIX}.${this.signature(binding, expiresAt)}`,
      expiresAt
    };
  }

  matches(
    selectionRef: string,
    expiresAt: string,
    binding: PaymentExecutionSelectionBinding,
    now = new Date()
  ) {
    const expiry = new Date(expiresAt);
    if (
      typeof selectionRef !== "string" ||
      !selectionRef.startsWith(`${TOKEN_PREFIX}.`) ||
      Number.isNaN(expiry.getTime()) ||
      expiry.getTime() <= now.getTime() ||
      expiry.getTime() > now.getTime() + TTL_MILLISECONDS
    ) {
      return false;
    }
    const expected = Buffer.from(`${TOKEN_PREFIX}.${this.signature(binding, expiry.toISOString())}`);
    const actual = Buffer.from(selectionRef);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  private signature(binding: PaymentExecutionSelectionBinding, expiresAt: string) {
    const canonical = JSON.stringify([
      PURPOSE,
      binding.actorUserId,
      binding.caseId,
      binding.companyId,
      binding.projectId,
      binding.paymentExecutionId,
      binding.executionFingerprint,
      binding.caseRevision,
      binding.balanceFingerprint,
      expiresAt
    ]);
    return createHmac("sha256", this.secret).update(canonical).digest("base64url");
  }
}
