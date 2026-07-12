import type { Prisma } from "@prisma/client";

export interface ContractCandidateLedger {
  amountCents: bigint;
  draftData: Prisma.JsonValue;
  templateSnapshot: Prisma.JsonValue;
  clauseSnapshot: Prisma.JsonValue;
}

export function contractDocumentCandidateMatchesLedger(
  candidateValue: Prisma.JsonValue | null,
  ledger: ContractCandidateLedger
) {
  const candidate = object(candidateValue);
  if (candidate["kind"] === "amount" && typeof candidate["cents"] === "string") {
    return ledger.amountCents.toString() === candidate["cents"];
  }
  if (
    candidate["kind"] === "date" &&
    typeof candidate["fieldKey"] === "string" &&
    typeof candidate["label"] === "string" &&
    typeof candidate["isoDate"] === "string"
  ) {
    const template = object(ledger.templateSnapshot);
    const fields = Array.isArray(template["fieldSchema"])
      ? template["fieldSchema"].map((field) => object(field))
      : [];
    const definitions = fields.filter(
      (field) =>
        field["key"] === candidate["fieldKey"] &&
        field["label"] === candidate["label"]
    );
    const draftData = object(ledger.draftData);
    const values = { ...draftData, ...object(draftData["fieldValues"]) };
    return (
      definitions.length === 1 &&
      fields.filter((field) => field["label"] === candidate["label"]).length === 1 &&
      values[candidate["fieldKey"]] === candidate["isoDate"]
    );
  }
  if (
    candidate["kind"] === "key_clause" &&
    typeof candidate["clauseKey"] === "string" &&
    typeof candidate["title"] === "string" &&
    typeof candidate["proposedText"] === "string"
  ) {
    const clauses = Array.isArray(ledger.clauseSnapshot)
      ? ledger.clauseSnapshot.map((clause) => object(clause))
      : [];
    const matches = clauses.filter(
      (item) =>
        item["key"] === candidate["clauseKey"] &&
        item["title"] === candidate["title"]
    );
    const titleIsUnique =
      clauses.filter((item) => item["title"] === candidate["title"]).length === 1;
    const clause = matches.length === 1 && titleIsUnique ? matches[0] : undefined;
    return clauseContentText(clause?.["content"]) === candidate["proposedText"];
  }
  return false;
}

function clauseContentText(value: unknown) {
  if (typeof value === "string") return value;
  const content = object(value);
  return typeof content["text"] === "string" ? content["text"] : null;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
