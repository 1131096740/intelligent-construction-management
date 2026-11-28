export interface SignedSettlementContractSource {
  relationship: "inside" | "outside" | "upward";
  sourceRecordId: string;
  sourceVersion: number;
  contractTypeKey: string | null;
  name: string;
  signingParty: string | null;
  counterparty: string | null;
  payerKind: "participating_company" | "construction_enterprise";
  payerVersionId: string | null;
  counterpartyKind: "downstream_counterparty" | "participating_company";
  counterpartyVersionId: string | null;
  companyEntityId: string | null;
  affiliateAssignmentId: string | null;
  affiliateBusinessPartyVersionId: string | null;
}

export function readSignedSettlementContractSource(value: unknown, contractKind: string): SignedSettlementContractSource | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (
    typeof source.sourceRecordId !== "string" || !source.sourceRecordId.trim() ||
    typeof source.sourceVersion !== "number" || !Number.isSafeInteger(source.sourceVersion) || source.sourceVersion < 1 ||
    typeof source.name !== "string" ||
    (source.payerKind !== "participating_company" && source.payerKind !== "construction_enterprise") ||
    (source.counterpartyKind !== "downstream_counterparty" && source.counterpartyKind !== "participating_company")
  ) return null;

  const expected = {
    downstream: (source.relationship === "inside" || source.relationship === "outside") && source.counterpartyKind === "downstream_counterparty",
    outside_fact: source.relationship === "outside" && source.payerKind === "construction_enterprise" && source.counterpartyKind === "downstream_counterparty",
    upward: source.relationship === "upward" && source.payerKind === "construction_enterprise" && source.counterpartyKind === "participating_company"
  };
  if (!Object.hasOwn(expected, contractKind) || !expected[contractKind as keyof typeof expected]) return null;

  const nullableText = [
    "contractTypeKey", "signingParty", "counterparty", "payerVersionId", "counterpartyVersionId",
    "companyEntityId", "affiliateAssignmentId", "affiliateBusinessPartyVersionId"
  ];
  if (nullableText.some(key => source[key] !== null && typeof source[key] !== "string")) return null;
  return source as unknown as SignedSettlementContractSource;
}
