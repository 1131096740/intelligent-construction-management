import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";

export function personnelFingerprint(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")}`;
}

function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([, child]) => child !== undefined).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => [key, canonical(child)]));
  return value;
}

export async function recordPersonnelFact(tx: Prisma.TransactionClient, input: {
  userId: string; actorUserId: string; action: string; reason: string;
  before: Prisma.InputJsonValue; after: Prisma.InputJsonValue;
  commandKey?: string; payloadFingerprint?: string;
}) {
  const commandKey = input.commandKey ?? randomUUID();
  const previous = await tx.personnelChange.findFirst({ where: { userId: input.userId }, orderBy: { sequence: "desc" }, select: { id: true } });
  const result = { commandKey, userId: input.userId, action: input.action };
  await tx.personnelChange.create({ data: { ...input, commandKey,
    payloadFingerprint: input.payloadFingerprint ?? personnelFingerprint({ action: input.action, before: input.before, after: input.after }),
    previousChangeId: previous?.id, result } });
  return result;
}

export async function startUnverifiedEmployment(tx: Prisma.TransactionClient, userId: string) {
  return tx.employmentPeriod.create({ data: { userId } });
}
