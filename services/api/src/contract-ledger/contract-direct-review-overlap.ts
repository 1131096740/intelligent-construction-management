import type { ContractEconomicReview, Prisma } from "@prisma/client";
import { BadRequestException, ServiceUnavailableException } from "@nestjs/common";
import { isDeepStrictEqual } from "node:util";
import { type DirectReviewDocument, readStoredDirectReviewPins, reviewDocumentFingerprint } from "./contract-direct-review-source";
import { type EconomicDocument, suspectedOverlap } from "./contract-economic-coverage";

type Source = EconomicDocument | DirectReviewDocument;
type Review = Pick<ContractEconomicReview,
  "id" | "projectId" | "leftSourceRef" | "rightSourceRef" | "leftFingerprint" | "rightFingerprint" | "status" | "confirmedAt" | "frozenSources">;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function isDirect(document: Source): document is DirectReviewDocument {
  return "directSourcePin" in document;
}

function overlapDocument(document: Source): EconomicDocument {
  return isDirect(document) ? { ...document, reference: document.originalSignedNumber ?? "" } : document;
}

async function currentReview(
  tx: Prisma.TransactionClient, left: Source, right: Source, confirmed: Review[], now: Date
): Promise<boolean> {
  const dated = confirmed.flatMap(row => row.confirmedAt && Number.isFinite(row.confirmedAt.getTime()) ? [{ row, at: row.confirmedAt.getTime() }] : []);
  if (dated.length !== confirmed.length) return false;
  dated.sort((a, b) => b.at - a.at);
  const latest = dated[0];
  if (!latest || latest.at > now.getTime() || dated[1]?.at === latest.at) return false;
  const { row } = latest;
  if (row.leftFingerprint !== reviewDocumentFingerprint(left) || row.rightFingerprint !== reviewDocumentFingerprint(right)) return false;
  const sources = row.frozenSources;
  if (!Array.isArray(sources) || sources.length !== 2 || ![left, right].every((source, index) => {
    const side = sources[index];
    const frozen = record(side);
    if (!frozen || frozen.ref !== source.ref || frozen.version !== source.version) return false;
    if (!isDirect(source)) return true;
    const direct = record(frozen.directInput);
    const q = record(direct?.Q), locator = record(q?.locator), origin = record(q?.source);
    const pin = source.directSourcePin;
    return direct?.inputSha256 === pin.inputSha256 && q?.inputProtocolVersion === 1 &&
      origin?.kind === "direct_signed" && origin.relationship === "outside" && locator?.projectId === source.projectId &&
      frozen.ref === `contract:${locator.contractId}` && locator.contractVersionId === pin.contractVersionId &&
      locator.draftRevision === pin.sourceRevision && locator.versionNo === 1 && locator.changeType === "original";
  })) return false;
  const pins = [left, right].filter(isDirect).map(source => source.directSourcePin);
  try {
    return isDeepStrictEqual(await readStoredDirectReviewPins(tx, row.id, [left.ref, right.ref]), pins);
  } catch (error) {
    if (error instanceof BadRequestException || error instanceof ServiceUnavailableException) return false;
    throw error;
  }
}

/** A direct pair is compared within one project. Callers must supply qualified current sources. */
export async function unresolvedDirectReviewPairs(
  tx: Prisma.TransactionClient, projectId: string, direct: readonly DirectReviewDocument[],
  documents: readonly EconomicDocument[], reviews: readonly Review[], now: Date
) {
  const unresolved: Array<{
    leftSourceRef: string; rightSourceRef: string; suspected: boolean; formalSourceRefs: string[];
  }> = [];
  const confirmedByLeft = new Map<string, Review[]>();
  for (const review of reviews) {
    if (review.projectId !== projectId || review.status !== "confirmed") continue;
    const previous = confirmedByLeft.get(review.leftSourceRef);
    if (previous) previous.push(review);
    else confirmedByLeft.set(review.leftSourceRef, [review]);
  }
  const allDocuments = [...documents, ...direct];
  for (const source of direct) {
    if (source.projectId !== projectId) continue;
    for (const other of allDocuments) {
      if (other.projectId !== projectId || source.ref === other.ref || (isDirect(other) && source.ref > other.ref)) continue;
      const [left, right] = source.ref < other.ref ? [source, other] : [other, source];
      const suspected = suspectedOverlap(overlapDocument(left), overlapDocument(right), "business-yuan");
      const confirmed = (confirmedByLeft.get(left.ref) ?? []).filter(row => row.rightSourceRef === right.ref);
      if ((!suspected && !confirmed.length) || await currentReview(tx, left, right, confirmed, now)) continue;
      unresolved.push({ leftSourceRef: left.ref, rightSourceRef: right.ref, suspected,
        formalSourceRefs: [left, right].filter(document => document.formal || document.hasFormalHistory).map(document => document.ref) });
    }
  }
  return unresolved;
}
