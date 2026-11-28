import { businessAmountToPaymentCents } from "@jiangkong/shared-domain";
import type { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";

export const PAYMENT_TEXT_AGREEMENT_BASIS = "text_agreement_v1";

export function isConfirmedTextAgreementContract(
  contract: { contractTypeKey: string | null; voidedAt?: Date | null },
  version: {
    numericProtocolVersion: number;
    status: string;
    effectiveAt: Date | null;
    settlementMode: string | null;
    settlementModeConfirmedAt: Date | null;
    settlementModeConfirmedByUserId: string | null;
  }
): boolean {
  return contract.contractTypeKey === "other" && !contract.voidedAt &&
    version.numericProtocolVersion === 2 && version.status === "effective" && Boolean(version.effectiveAt) &&
    version.settlementMode === "direct_payment" && Boolean(version.settlementModeConfirmedAt) &&
    Boolean(version.settlementModeConfirmedByUserId);
}

export async function readTextAgreementContractLimit(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  version: { id: string; contractId: string; amountLimitType: string; amountYuan: Prisma.Decimal | null },
  projectId: string
): Promise<bigint | null> {
  if (version.amountLimitType === "unlimited") return null;
  const [change] = await tx.$queryRaw<Array<{ effectiveAmountYuan: Prisma.Decimal | null }>>`
    SELECT "effectiveAmountYuan"
    FROM public.jg_read_effective_contract_change_amount_v1(${version.id}::text, ${projectId}::text, ${version.contractId}::text)
  `;
  const amount = change ? change.effectiveAmountYuan : version.amountYuan;
  const cents = businessAmountToPaymentCents(amount?.toFixed(4) ?? null);
  return cents === null ? null : BigInt(cents);
}

export async function readTextPaymentAgreement(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  input: { contractVersionId: string; paymentTermsVersionId: string; projectId: string; contractId: string }
) {
  const [row] = await tx.$queryRaw<Array<{ agreementText: string }>>`
    SELECT "agreementText" FROM public.jg_read_text_payment_agreement_v1(
      ${input.contractVersionId}::text, ${input.paymentTermsVersionId}::text,
      ${input.projectId}::text, ${input.contractId}::text)
  `;
  if (!row?.agreementText.trim()) return null;
  return {
    paymentTermsVersionId: input.paymentTermsVersionId,
    agreementText: row.agreementText,
    fingerprint: createHash("sha256").update(JSON.stringify([input.paymentTermsVersionId, row.agreementText])).digest("hex")
  };
}
