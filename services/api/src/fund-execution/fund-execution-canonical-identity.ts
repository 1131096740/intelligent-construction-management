import { createHash } from "node:crypto";

import type { OperatingSubjectReference } from "../operating-ledger/operating-ledger.service";

type PayeeSubject = Readonly<{
  payeeSubjectType: string;
  payeeSubjectId: string;
}>;

export function executionOperatingPayee(
  registered: PayeeSubject
): OperatingSubjectReference {
  const prefix = `${registered.payeeSubjectType}:`;
  const id = registered.payeeSubjectId.startsWith(prefix)
    ? registered.payeeSubjectId.slice(prefix.length)
    : registered.payeeSubjectId;
  return {
    kind:
      registered.payeeSubjectType === "employee_user"
        ? "employee"
        : "downstream_counterparty",
    id
  };
}

export function stableExecutionIdentity(namespace: string, value: unknown) {
  return createHash("sha256")
    .update(`${namespace}:${canonicalJson(value)}`)
    .digest("hex");
}

function canonicalJson(value: unknown): string {
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
