import { BadRequestException, ConflictException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { hasDirectSigningInput, assertDirectPendingSourceQualification } from "../contract/contract-direct-pending-source";
import { normalizeBusinessAmount } from "@jiangkong/shared-domain";
import { documentFingerprint, type EconomicDocument } from "./contract-economic-coverage";

export interface DirectReviewSourcePin {
  sourceRef: string;
  contractVersionId: string;
  sourceRevision: number;
  inputSha256: string;
}
export interface DirectReviewDocument extends EconomicDocument {
  directSourcePin: DirectReviewSourcePin;
  originalSignedNumber: string | null;
  fileIds: string[];
}
type ReviewDocument = EconomicDocument | DirectReviewDocument;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function sourceChanged(): never {
  throw new ConflictException("已签原文书已发生变化或资料不完整，请按当前资料重新核对");
}
export function directReviewPins(value: unknown, refs: readonly string[]): DirectReviewSourcePin[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) throw new BadRequestException("直签复核来源范围不正确");
  const pins = value.map(raw => {
    const pin = record(raw);
    if (!pin || Object.keys(pin).sort().join(",") !== "contractVersionId,inputSha256,sourceRef,sourceRevision"
      || typeof pin.sourceRef !== "string" || !pin.sourceRef.startsWith("contract:") || !refs.includes(pin.sourceRef)
      || typeof pin.contractVersionId !== "string" || !pin.contractVersionId || pin.contractVersionId.length > 128
      || typeof pin.sourceRevision !== "number" || !Number.isSafeInteger(pin.sourceRevision) || pin.sourceRevision < 1
      || typeof pin.inputSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(pin.inputSha256)) {
      throw new BadRequestException("直签复核来源坐标不正确");
    }
    return { sourceRef: pin.sourceRef, contractVersionId: pin.contractVersionId, sourceRevision: pin.sourceRevision, inputSha256: pin.inputSha256 };
  });
  if (new Set(pins.map(pin => pin.sourceRef)).size !== pins.length || new Set(pins.map(pin => pin.contractVersionId)).size !== pins.length) {
    throw new BadRequestException("直签复核来源不能重复");
  }
  return pins.sort((left, right) => left.sourceRef < right.sourceRef ? -1 : 1);
}

export function reviewDocumentFingerprint(document: ReviewDocument) {
  return "directSourcePin" in document ? document.directSourcePin.inputSha256 : documentFingerprint(document);
}

async function readDirectReviewInputs(tx: Prisma.TransactionClient, projectId: string, versionIds: string[]) {
  // Every input, including Q and D, comes from the same statement snapshot.
  return tx.$queryRaw<unknown[]>(Prisma.sql`
    SELECT c."id" AS "contractId", cv."id" AS "versionId", cv."draftRevision", q.input
    FROM public."ContractVersion" cv
    JOIN public."Contract" c ON c."id"=cv."contractId"
    JOIN public."Project" p ON p."id"=c."projectId"
    CROSS JOIN LATERAL (SELECT public.jg_contract_direct_pending_input_v1(cv."id") AS input) q
    WHERE c."projectId"=${projectId} AND c."voidedAt" IS NULL AND p."isActive"
      AND cv."versionNo"=1 AND cv."changeType"='original' AND cv."numericProtocolVersion"=2 AND cv."status"='draft'
      AND cv."effectiveAt" IS NULL AND cv."firstSubmittedAt" IS NULL AND cv."draftData" ? 'directSigningInput'
      AND cv."id" IN (${Prisma.join(versionIds)})
  `);
}

function directReviewDocument(row: Record<string, unknown> | null, projectId: string, pin: DirectReviewSourcePin): DirectReviewDocument {
  const input = record(row?.input), q = record(input?.Q), source = record(q?.source), locator = record(q?.locator);
  const details = record(q?.contract), money = record(q?.money), subjects = record(q?.subjects), roles = record(subjects?.roles);
  if (!row || typeof row.contractId !== "string" || pin.sourceRef !== `contract:${row.contractId}` ||
    row.draftRevision !== pin.sourceRevision || !input || input.protocolVersion !== 1 || input.sourceKind !== "direct_signed_pending" ||
    input.state !== "complete" || input.sourceRevision !== pin.sourceRevision || input.inputSha256 !== pin.inputSha256 ||
    q?.inputProtocolVersion !== 1 || source?.kind !== "direct_signed" || source.relationship !== "outside" ||
    locator?.projectId !== projectId || locator.contractId !== row.contractId || locator.contractVersionId !== pin.contractVersionId ||
    locator.versionNo !== 1 || locator.changeType !== "original" || locator.draftRevision !== pin.sourceRevision ||
    !details || typeof details.name !== "string" || !details.name || (details.originalSignedNumber !== null && typeof details.originalSignedNumber !== "string") ||
    !money || money.numericProtocolVersion !== 2 || (money.amountYuan !== null &&
      (typeof money.amountYuan !== "string" || !/^(0|[1-9][0-9]{0,19})\.[0-9]{4}$/u.test(money.amountYuan))) ||
    typeof roles?.counterpartyCpsId !== "string" || !Array.isArray(subjects?.parties) ||
    !Array.isArray(q.signedFiles) || !q.signedFiles.length || q.signedFiles.length > 20) sourceChanged();
  const parties = subjects.parties.map(record).filter(party => party?.cpsId === roles.counterpartyCpsId);
  const counterparty = parties.length === 1 ? record(parties[0]?.identity)?.name : null;
  if (typeof counterparty !== "string" || !counterparty) sourceChanged();
  const fileIds = q.signedFiles.map((item: unknown, index: number) => {
    const file = record(item);
    if (typeof file?.fileId !== "string" || !file.fileId || file.displayOrder !== index) sourceChanged();
    return file.fileId;
  });
  if (new Set(fileIds).size !== fileIds.length) sourceChanged();
  return {
    ref: pin.sourceRef, projectId, reference: details.originalSignedNumber ?? "未注明编号", title: details.name,
    counterparty, numericProtocolVersion: 2, amountCents: null, amountYuan: normalizeBusinessAmount(money.amountYuan),
    targetVersionId: pin.contractVersionId, version: `${pin.contractVersionId}:direct:${pin.sourceRevision}:${pin.inputSha256}`,
    formal: false, settledCents: 0n, directSourcePin: pin, originalSignedNumber: details.originalSignedNumber, fileIds
  };
}

export async function readDirectReviewDocuments(tx: Prisma.TransactionClient, projectId: string, pins: DirectReviewSourcePin[]): Promise<DirectReviewDocument[]> {
  if (!pins.length) return [];
  const rows = (await readDirectReviewInputs(tx, projectId, pins.map(pin => pin.contractVersionId))).map(record);
  if (rows.length !== pins.length) sourceChanged();
  return pins.map(pin => {
    const matches = rows.filter(row => row?.versionId === pin.contractVersionId);
    return directReviewDocument(matches.length === 1 ? matches[0] : null, projectId, pin);
  });
}

type ProjectDirectReviewSources =
  | { status: "unavailable" }
  | { status: "complete" | "incomplete"; documents: DirectReviewDocument[] };

/** This inventory is for the review list. Absence is not archive authorization. */
export async function readProjectDirectReviewDocuments(tx: Prisma.TransactionClient, projectId: string): Promise<ProjectDirectReviewSources | undefined> {
  const contracts = await tx.contract.findMany({ where: { projectId, voidedAt: null }, select: { id: true }, take: 10001 });
  if (!contracts.length) return undefined;
  if (contracts.length > 10000) return { status: "unavailable" };
  const versions = (await tx.contractVersion.findMany({
    where: { contractId: { in: contracts.map(contract => contract.id) }, versionNo: 1, changeType: "original", status: "draft" },
    select: { id: true, draftData: true }, orderBy: { id: "asc" }
  })).filter(version => hasDirectSigningInput(version.draftData));
  if (!versions.length) return undefined;
  try {
    await assertDirectPendingSourceQualification(tx);
    const ids = new Set(versions.map(version => version.id));
    const rows = (await readDirectReviewInputs(tx, projectId, [...ids])).map(record);
    if (rows.length !== ids.size || new Set(rows.map(row => row?.versionId)).size !== ids.size) return { status: "unavailable" };
    const documents: DirectReviewDocument[] = [];
    for (const row of rows) {
      const input = record(row?.input);
      if (!row || typeof row.versionId !== "string" || !ids.has(row.versionId) || typeof row.contractId !== "string" ||
        !input || input.protocolVersion !== 1 || input.sourceKind !== "direct_signed_pending" ||
        typeof input.sourceRevision !== "number" || !Number.isSafeInteger(input.sourceRevision) || input.sourceRevision < 1 ||
        input.sourceRevision !== row.draftRevision) return { status: "unavailable" };
      if (input.state === "incomplete" || input.state === "invalid") {
        if (input.Q !== null || input.inputSha256 !== null) return { status: "unavailable" };
        continue;
      }
      if (typeof input.inputSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(input.inputSha256)) return { status: "unavailable" };
      documents.push(directReviewDocument(row, projectId, {
        sourceRef: `contract:${row.contractId}`, contractVersionId: row.versionId,
        sourceRevision: input.sourceRevision, inputSha256: input.inputSha256
      }));
    }
    return { status: documents.length === versions.length ? "complete" : "incomplete", documents };
  } catch (error) {
    if (error instanceof ServiceUnavailableException || error instanceof ConflictException ||
      error instanceof Prisma.PrismaClientKnownRequestError) return { status: "unavailable" };
    throw error;
  }
}

export function rethrowDirectReviewFileContention(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2010" && error.meta?.code === "55P03") {
    throw new ConflictException("直签原件正在办理，请稍后重试");
  }
  throw error;
}

export async function lockDirectReviewFiles(tx: Prisma.TransactionClient, sources: DirectReviewDocument[]) {
  const ids = [...new Set(sources.flatMap(source => source.fileIds))].sort();
  if (!ids.length) return;
  const rows = await tx.$queryRaw<unknown[]>(Prisma.sql`
    SELECT f."id" FROM public."FileObject" f WHERE f."id" IN (${Prisma.join(ids)})
      AND f."storageStatus"='active' AND f."purgeReceiptId" IS NULL ORDER BY f."id" COLLATE "C" FOR UPDATE NOWAIT
  `).catch(rethrowDirectReviewFileContention);
  if (rows.length !== ids.length || rows.some((row, index) => record(row)?.id !== ids[index])) sourceChanged();
}

export async function readStoredDirectReviewPins(tx: Prisma.TransactionClient, reviewId: string, refs: readonly string[]) {
  const rows = await tx.$queryRaw<unknown[]>(Prisma.sql`
    SELECT "directSourcePins" FROM public."ContractEconomicReview" WHERE "id"=${reviewId}
  `);
  const row = rows.length === 1 ? record(rows[0]) : null;
  if (!row) throw new ServiceUnavailableException("履约复核的直签来源暂无法核对");
  return row.directSourcePins === null ? [] : directReviewPins(row.directSourcePins, refs);
}

export function stripInternalDirectReviewProof(value: Prisma.JsonValue | null): Prisma.JsonValue | null {
  if (!Array.isArray(value)) return value;
  return value.map(side => {
    if (!side || typeof side !== "object" || Array.isArray(side) || !Object.hasOwn(side, "directInput")) return side;
    const result = { ...side };
    delete result.directInput;
    delete result.fileIds;
    return result;
  });
}

type HistoricalReview = { id: string; projectId: string; leftSourceRef: string; rightSourceRef: string; frozenSources: Prisma.JsonValue | null };
export function hasFrozenDirectReview(review: HistoricalReview): boolean {
  return Array.isArray(review.frozenSources) && review.frozenSources.some(side => {
    const facts = record(side);
    return facts !== null && (Object.hasOwn(facts, "directInput") || (typeof facts.version === "string" && facts.version.includes(":direct:")));
  });
}

export interface DirectReviewHistorySide {
  sourceRef: string;
  contractVersionId: string;
  sourceRevision: number;
  originalSignedNumber: string | null;
  signedOn: string | null;
  title: string;
  files: { fileId: string; displayOrder: number; mimeType: string; sizeBytes: number }[];
}

export async function readDirectReviewHistory(tx: Prisma.TransactionClient, projectId: string, reviews: HistoricalReview[]): Promise<Map<string, DirectReviewHistorySide[]>> {
  const invalid = (): never => { throw new ServiceUnavailableException("直签履约复核原件留存尚未完整核对"); };
  if (!reviews.length) return new Map();
  if (reviews.length > 10000 || reviews.some(review => review.projectId !== projectId)) invalid();
  const rows = await tx.$queryRaw<unknown[]>(Prisma.sql`
    /* contract_direct_review_history_v1 */
    SELECT r."reviewId",r."sourceRef",r."sourceContractVersionId",r."directInputProtocolVersion",r."sourceRevision",
      r."inputSha256",r."displayOrder",r."fileId",r."mimeType",r."sizeBytes",r."contentSha256"
    FROM public."ContractEconomicReviewFileReference" r
    JOIN public."ContractEconomicReview" review ON review."id"=r."reviewId"
    WHERE review."projectId"=${projectId} AND review."status"='confirmed'
      AND r."reviewId" IN (${Prisma.join(reviews.map(review => review.id))})
    ORDER BY r."reviewId",r."sourceRef",r."displayOrder"
  `);
  const references = rows.map(record);
  if (references.some(row => !row || !reviews.some(review => review.id === row.reviewId))) invalid();
  return new Map(reviews.map(review => {
    if (!Array.isArray(review.frozenSources) || review.frozenSources.length !== 2) return invalid();
    const sides = review.frozenSources.map(record);
    if (sides[0]?.ref !== review.leftSourceRef || sides[1]?.ref !== review.rightSourceRef) return invalid();
    const retained = references.filter(row => row?.reviewId === review.id);
    const projected = sides.flatMap(side => {
      if (!side || typeof side.ref !== "string") return invalid();
      if (!Object.hasOwn(side, "directInput")) {
        if (typeof side.version === "string" && side.version.includes(":direct:")) return invalid();
        return [];
      }
      const proof = record(side.directInput), q = record(proof?.Q), locator = record(q?.locator), source = record(q?.source), contract = record(q?.contract);
      if (!proof || typeof proof.inputSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(proof.inputSha256) ||
        q?.inputProtocolVersion !== 1 || source?.kind !== "direct_signed" || source.relationship !== "outside" ||
        locator?.projectId !== projectId || side.ref !== `contract:${locator.contractId}` ||
        typeof locator.contractVersionId !== "string" || typeof locator.draftRevision !== "number" || !Number.isSafeInteger(locator.draftRevision) ||
        locator.draftRevision < 1 || locator.changeType !== "original" || locator.versionNo !== 1 ||
        side.version !== `${locator.contractVersionId}:direct:${locator.draftRevision}:${proof.inputSha256}` ||
        typeof contract?.name !== "string" || (contract.originalSignedNumber !== null && typeof contract.originalSignedNumber !== "string") ||
        (contract.signedOn !== null && typeof contract.signedOn !== "string") ||
        !Array.isArray(q.signedFiles) || q.signedFiles.length < 1 || q.signedFiles.length > 20) return invalid();
      const sideRows = retained.filter(row => row?.sourceRef === side.ref);
      if (sideRows.length !== q.signedFiles.length) return invalid();
      const files = q.signedFiles.map((item: unknown, index: number) => {
        const entry = record(item), row = sideRows[index];
        if (!entry || !row || typeof entry.fileId !== "string" || !entry.fileId ||
          typeof entry.mimeType !== "string" || !["application/pdf","image/jpeg","image/png"].includes(entry.mimeType) ||
          typeof entry.sizeBytes !== "number" || !Number.isSafeInteger(entry.sizeBytes) || entry.sizeBytes < 1 ||
          typeof entry.contentSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(entry.contentSha256) ||
          row.sourceContractVersionId !== locator.contractVersionId || row.directInputProtocolVersion !== 1 ||
          row.sourceRevision !== locator.draftRevision || row.inputSha256 !== proof.inputSha256 ||
          entry.displayOrder !== index || row.displayOrder !== index || row.fileId !== entry.fileId ||
          row.mimeType !== entry.mimeType || row.sizeBytes !== entry.sizeBytes || row.contentSha256 !== entry.contentSha256) return invalid();
        return { fileId: entry.fileId, displayOrder: index, mimeType: entry.mimeType, sizeBytes: entry.sizeBytes };
      });
      if (new Set(files.map(file => file.fileId)).size !== files.length) return invalid();
      return [{ sourceRef: side.ref, contractVersionId: locator.contractVersionId, sourceRevision: locator.draftRevision,
        originalSignedNumber: contract.originalSignedNumber, signedOn: contract.signedOn, title: contract.name, files }];
    });
    if (!projected.length || retained.length !== projected.reduce((count, side) => count + side.files.length, 0)) return invalid();
    return [review.id, projected] as const;
  }));
}
