import { ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { types } from "node:util";

export const REGISTERED_PAYMENT_IMPACT_READER = Symbol("REGISTERED_PAYMENT_IMPACT_READER");

export interface RegisteredPaymentImpact {
  factId: string;
  impactKind: string;
  amountCents: bigint | null;
  numericProtocolVersion: number;
  subjectKind: string | null;
  subjectId: string | null;
}

export type RegisteredPaymentImpactReader = (
  tx: Prisma.TransactionClient,
  scope: { requestKey: string; executionId: string; paymentId: string; projectId: string },
  factIds: readonly string[]
) => Promise<RegisteredPaymentImpact[]>;

const columns = ["factId", "impactKind", "amountCents", "numericProtocolVersion", "subjectKind", "subjectId"] as const;

function readImpactForFact(row: unknown, expectedFactId: string): RegisteredPaymentImpact | null {
  if (!row || typeof row !== "object" || Array.isArray(row) || types.isProxy(row) || Reflect.ownKeys(row).length !== columns.length) return null;
  const values: unknown[] = columns.map(column => Object.getOwnPropertyDescriptor(row, column)?.value);
  const [factId, impactKind, amountCents, numericProtocolVersion, subjectKind, subjectId] = values;
  if (factId !== expectedFactId || typeof impactKind !== "string"
    || (amountCents !== null && typeof amountCents !== "bigint")
    || (numericProtocolVersion !== 1 && numericProtocolVersion !== 2)
    || (subjectKind !== null && typeof subjectKind !== "string")
    || (subjectId !== null && typeof subjectId !== "string")) return null;
  return { factId, impactKind, amountCents, numericProtocolVersion, subjectKind, subjectId };
}

/** Supply only after the dedicated installation proves this reader is callable. */
export const readTask16RegisteredPaymentImpacts: RegisteredPaymentImpactReader = async (tx, scope, factIds) => {
  const impacts: RegisteredPaymentImpact[] = [];
  try {
    for (const factId of factIds) {
      const rows = await tx.$queryRaw<unknown>(Prisma.sql`
        SELECT "factId", "impactKind", "amountCents", "numericProtocolVersion", "subjectKind", "subjectId"
        FROM public.jg_read_registered_payment_impacts(${scope.requestKey}::text, ${scope.executionId}::text, ${scope.paymentId}::text, ${scope.projectId}::text, ${factId}::text)`);
      if (!Array.isArray(rows) || types.isProxy(rows)) throw new Error("Invalid registered payment impact result");
      for (let index = 0; index < rows.length; index++) {
        const impact = readImpactForFact(Object.getOwnPropertyDescriptor(rows, String(index))?.value, factId);
        if (!impact) throw new Error("Invalid registered payment impact row");
        impacts.push(impact);
      }
    }
    return impacts;
  } catch {
    throw new ServiceUnavailableException("暂时无法核对实付影响，请稍后查询");
  }
};
