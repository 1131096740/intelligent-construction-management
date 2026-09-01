import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Injectable, Optional } from "@nestjs/common";

const TTL_MS = 5 * 60 * 1_000;
const PREFIX = "fac1";
const PURPOSE = "affiliate_clearing_authority_selection_v1";

export function affiliateClearingSelectionRefFingerprint(selectionRef: string): string {
  return createHash("sha256").update(selectionRef.trim()).digest("hex");
}

export type AffiliateClearingSelectionBinding = Readonly<{
  actorUserId: string;
  authorityVersionId: string;
  authorityFingerprint: string;
  purpose: "contract" | "person" | "role" | "wage" | "guarantee" | "allocation";
  selectedKey: string;
  amountCents?: bigint;
  revision: number;
}>;

@Injectable()
export class AffiliateClearingSelectionRefService {
  private readonly secret: string;

  constructor(@Optional() secrets: { secret?: string } = {}) {
    const secret = secrets.secret ?? process.env.AFFILIATE_CLEARING_AUTHORITY_SELECTION_SECRET;
    if (process.env.NODE_ENV === "production" && (!secret || secret.length < 32)) {
      throw new Error("生产环境必须配置独立的挂靠清算 authority selectionRef 签名密钥");
    }
    this.secret = secret ?? "local-affiliate-clearing-authority-selection-secret";
  }

  issue(binding: AffiliateClearingSelectionBinding, now = new Date()): string {
    const expiry = now.getTime() + TTL_MS;
    const encoded = expiry.toString(36);
    return `${PREFIX}.${encoded}.${this.signature(binding, expiry)}`;
  }

  matches(selectionRef: string, binding: AffiliateClearingSelectionBinding, now = new Date()): boolean {
    if (typeof selectionRef !== "string") return false;
    const parts = selectionRef.trim().split(".");
    if (parts.length !== 3 || parts[0] !== PREFIX) return false;
    const expiry = Number.parseInt(parts[1], 36);
    if (!Number.isSafeInteger(expiry) || expiry <= now.getTime() || expiry > now.getTime() + TTL_MS) return false;
    const expected = Buffer.from(`${PREFIX}.${parts[1]}.${this.signature(binding, expiry)}`);
    const actual = Buffer.from(selectionRef.trim());
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  private signature(binding: AffiliateClearingSelectionBinding, expiry: number): string {
    return createHmac("sha256", this.secret)
      .update(
        JSON.stringify([
          PURPOSE,
          binding.actorUserId,
          binding.authorityVersionId,
          binding.authorityFingerprint,
          binding.purpose,
          binding.selectedKey,
          binding.amountCents?.toString() ?? null,
          binding.revision,
          expiry
        ])
      )
      .digest("base64url");
  }
}
