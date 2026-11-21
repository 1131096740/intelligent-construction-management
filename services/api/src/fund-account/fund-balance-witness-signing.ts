import { createHmac } from "node:crypto";
import type { Prisma } from "@prisma/client";

export async function fundBalanceWitnessBinding(tx: Prisma.TransactionClient) {
  const [binding] = await tx.$queryRaw<Array<{ database: string; role: string; xid: string; backend: string; expires: string }>>`
    SELECT current_database()::text AS database, session_user::text AS role,
      pg_current_xact_id()::text AS xid, pg_backend_pid()::text AS backend,
      (floor(extract(epoch FROM clock_timestamp()))::bigint + 30)::text AS expires`;
  return binding;
}

export function fundBalanceWitnessFields(fields: readonly (string | null)[]) {
  return fields.map(value => value === null ? "-" : Buffer.from(value, "utf8").toString("hex")).join(":");
}

export function signFundBalanceWitness(keyValue: string, payload: readonly (string | null)[]) {
  const key = Buffer.from(keyValue, "hex");
  try {
    return createHmac("sha256", key).update(fundBalanceWitnessFields(payload)).digest("hex");
  } finally {
    key.fill(0);
  }
}
