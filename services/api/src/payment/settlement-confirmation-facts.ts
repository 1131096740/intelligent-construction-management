export interface SettlementPaymentConfirmationFact {
  settlementId: string;
  confirmedAt: Date | null;
}

type ConfirmationFactsClient = {
  settlementArchiveFile?: {
    findMany: (args: {
      where: {
        settlementId: { in: string[] };
        status: string;
        confirmedAt: { not: null };
      };
      select: { settlementId: true; confirmedAt: true };
    }) => Promise<SettlementPaymentConfirmationFact[]>;
  };
  settlementSignedDocument?: {
    findMany: (args: {
      where: {
        settlementId: { in: string[] };
        purpose: string;
        status: string;
        generationStatus: string;
        confirmedAt: { not: null };
      };
      select: { settlementId: true; confirmedAt: true };
    }) => Promise<SettlementPaymentConfirmationFact[]>;
  };
};

export async function loadSettlementPaymentConfirmationFacts(
  client: unknown,
  settlementIds: readonly string[]
): Promise<SettlementPaymentConfirmationFact[]> {
  const ids = [...new Set(settlementIds)].sort();
  if (!ids.length) return [];

  const factsClient = client as ConfirmationFactsClient;
  if (!factsClient.settlementArchiveFile) {
    throw new Error("结算归档确认事实读取服务暂不可用");
  }

  const [legacyArchiveFacts, governedSignedDocumentFacts] = await Promise.all([
    factsClient.settlementArchiveFile.findMany({
      where: {
        settlementId: { in: ids },
        status: "confirmed",
        confirmedAt: { not: null }
      },
      select: { settlementId: true, confirmedAt: true }
    }),
    factsClient.settlementSignedDocument
      ? factsClient.settlementSignedDocument.findMany({
          where: {
            settlementId: { in: ids },
            purpose: "final_internal_signed_copy",
            status: "active",
            generationStatus: "completed",
            confirmedAt: { not: null }
          },
          select: { settlementId: true, confirmedAt: true }
        })
      : Promise.resolve([])
  ]);

  const earliestBySettlementId = new Map<string, Date>();
  for (const fact of [...legacyArchiveFacts, ...governedSignedDocumentFacts]) {
    if (!fact.confirmedAt) continue;
    const existing = earliestBySettlementId.get(fact.settlementId);
    if (!existing || fact.confirmedAt < existing) {
      earliestBySettlementId.set(fact.settlementId, fact.confirmedAt);
    }
  }

  return [...earliestBySettlementId.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([settlementId, confirmedAt]) => ({ settlementId, confirmedAt }));
}
