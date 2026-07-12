import { BadRequestException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type {
  ContractDocxBlock,
  ContractDocxSnapshot
} from "./contract-docx-extractor";

export const CONTRACT_DOCUMENT_COMPARISON_ALGORITHM_VERSION =
  "contract-docx-patience-v1";

export const CONTRACT_DOCUMENT_COMPARISON_LIMITS = {
  maxBlocksPerDocument: 5_000,
  maxDifferences: 1_000
} as const;

export type ContractDocumentChangeType = "insert" | "delete" | "replace";

export type ContractDocumentDifferenceCandidate =
  | { kind: "amount"; label: string; cents: string }
  | { kind: "date"; fieldKey: string; label: string; isoDate: string }
  | {
      kind: "key_clause";
      clauseKey: string;
      title: string;
      proposedText: string;
      baseTextSha256: string;
    };

export interface ContractDocumentDifference {
  differenceKey: string;
  sortOrder: number;
  changeType: ContractDocumentChangeType;
  kind: ContractDocxBlock["kind"];
  locationPath: string;
  basePath: string | null;
  revisedPath: string | null;
  beforeText: string | null;
  afterText: string | null;
  candidate: ContractDocumentDifferenceCandidate | null;
}

export interface ContractDocumentComparisonResult {
  algorithmVersion: string;
  baseNormalizedSha256: string;
  revisionNormalizedSha256: string;
  differences: ContractDocumentDifference[];
}

type ClauseReference = { key: string; title: string };
type FieldReference = { key: string; label: string };
type Anchor = { baseIndex: number; revisionIndex: number };

export function compareContractDocumentSnapshots(
  base: ContractDocxSnapshot,
  revised: ContractDocxSnapshot,
  clauseSnapshot: unknown = [],
  templateSnapshot: unknown = {}
): ContractDocumentComparisonResult {
  assertSnapshot(base);
  assertSnapshot(revised);
  const clauses = clauseReferences(clauseSnapshot);
  const fields = fieldReferences(templateSnapshot);
  const differences: ContractDocumentDifference[] = [];
  const anchors = uniqueOrderedAnchors(base.blocks, revised.blocks);
  let previousBase = -1;
  let previousRevision = -1;

  for (const anchor of [...anchors, { baseIndex: base.blocks.length, revisionIndex: revised.blocks.length }]) {
    compareGap(
      base.blocks.slice(previousBase + 1, anchor.baseIndex),
      revised.blocks.slice(previousRevision + 1, anchor.revisionIndex),
      differences,
      clauses,
      fields
    );
    previousBase = anchor.baseIndex;
    previousRevision = anchor.revisionIndex;
  }

  return {
    algorithmVersion: CONTRACT_DOCUMENT_COMPARISON_ALGORITHM_VERSION,
    baseNormalizedSha256: base.normalizedSha256,
    revisionNormalizedSha256: revised.normalizedSha256,
    differences
  };
}

function compareGap(
  base: ContractDocxBlock[],
  revised: ContractDocxBlock[],
  differences: ContractDocumentDifference[],
  clauses: ClauseReference[],
  fields: FieldReference[]
) {
  let baseIndex = 0;
  let revisionIndex = 0;
  while (baseIndex < base.length && revisionIndex < revised.length) {
    const before = base[baseIndex];
    const after = revised[revisionIndex];
    if (blockSignature(before) === blockSignature(after)) {
      baseIndex += 1;
      revisionIndex += 1;
      continue;
    }
    if (before.kind === after.kind) {
      pushDifference(differences, "replace", before, after, clauses, fields);
      baseIndex += 1;
      revisionIndex += 1;
    } else {
      pushDifference(differences, "delete", before, null, clauses, fields);
      pushDifference(differences, "insert", null, after, clauses, fields);
      baseIndex += 1;
      revisionIndex += 1;
    }
  }
  while (baseIndex < base.length) {
    pushDifference(differences, "delete", base[baseIndex], null, clauses, fields);
    baseIndex += 1;
  }
  while (revisionIndex < revised.length) {
    pushDifference(differences, "insert", null, revised[revisionIndex], clauses, fields);
    revisionIndex += 1;
  }
}

function pushDifference(
  differences: ContractDocumentDifference[],
  changeType: ContractDocumentChangeType,
  before: ContractDocxBlock | null,
  after: ContractDocxBlock | null,
  clauses: ClauseReference[],
  fields: FieldReference[]
) {
  if (differences.length >= CONTRACT_DOCUMENT_COMPARISON_LIMITS.maxDifferences) {
    throw new BadRequestException("合同文档差异数量超过系统限制");
  }
  const beforeText = before?.text ?? null;
  const afterText = after?.text ?? null;
  const basePath = before?.path ?? null;
  const revisedPath = after?.path ?? null;
  const kind = after?.kind ?? before?.kind;
  if (!kind) throw new BadRequestException("合同文档差异内容不正确");
  const keySource = JSON.stringify({ changeType, kind, basePath, revisedPath, beforeText, afterText });
  differences.push({
    differenceKey: createHash("sha256").update(keySource).digest("hex"),
    sortOrder: differences.length + 1,
    changeType,
    kind,
    locationPath: revisedPath ?? basePath ?? "unknown",
    basePath,
    revisedPath,
    beforeText,
    afterText,
    candidate: afterText ? candidateFor(afterText, beforeText, clauses, fields) : null
  });
}

function uniqueOrderedAnchors(base: ContractDocxBlock[], revised: ContractDocxBlock[]) {
  const baseOccurrences = occurrences(base);
  const revisionOccurrences = occurrences(revised);
  const candidates: Anchor[] = [];
  for (const [signature, baseIndexes] of baseOccurrences) {
    const revisionIndexes = revisionOccurrences.get(signature);
    if (baseIndexes.length === 1 && revisionIndexes?.length === 1) {
      candidates.push({ baseIndex: baseIndexes[0], revisionIndex: revisionIndexes[0] });
    }
  }
  candidates.sort((left, right) => left.baseIndex - right.baseIndex);
  return longestIncreasingRevisionSubsequence(candidates);
}

function occurrences(blocks: ContractDocxBlock[]) {
  const result = new Map<string, number[]>();
  blocks.forEach((block, index) => {
    const signature = blockSignature(block);
    const indexes = result.get(signature) ?? [];
    indexes.push(index);
    result.set(signature, indexes);
  });
  return result;
}

function longestIncreasingRevisionSubsequence(candidates: Anchor[]) {
  if (!candidates.length) return [];
  const tails: number[] = [];
  const previous = new Array<number>(candidates.length).fill(-1);
  for (let index = 0; index < candidates.length; index += 1) {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (candidates[tails[middle]].revisionIndex < candidates[index].revisionIndex) low = middle + 1;
      else high = middle;
    }
    if (low > 0) previous[index] = tails[low - 1];
    tails[low] = index;
  }
  const result: Anchor[] = [];
  let cursor = tails.at(-1) ?? -1;
  while (cursor >= 0) {
    result.push(candidates[cursor]);
    cursor = previous[cursor];
  }
  return result.reverse();
}

function candidateFor(
  afterText: string,
  beforeText: string | null,
  clauses: ClauseReference[],
  fields: FieldReference[]
): ContractDocumentDifferenceCandidate | null {
  const amount = explicitAmount(afterText);
  if (amount) return amount;
  const date = explicitDate(afterText, fields);
  if (date) return date;
  const clause = clauses.find(({ title }) => hasExactTitlePrefix(afterText, title));
  return clause
    ? {
        kind: "key_clause",
        clauseKey: clause.key,
        title: clause.title,
        proposedText: afterText,
        baseTextSha256: createHash("sha256").update(beforeText ?? "").digest("hex")
      }
    : null;
}

function explicitAmount(text: string): ContractDocumentDifferenceCandidate | null {
  const match = text.match(
    /(?:^|\s)(合同金额|合同总价|总价|价款)\s*[:：]\s*(?:人民币\s*)?[¥￥]?\s*((?:0|[1-9]\d{0,2}(?:,\d{3})+|[1-9]\d{0,15})(?:\.\d{1,2})?)(?=\s*(?:元(?:\s|$)|$))/u
  );
  if (!match) return null;
  const normalized = match[2].replace(/,/gu, "");
  if (!/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/u.test(normalized)) return null;
  const [yuan, fraction = ""] = normalized.split(".");
  return {
    kind: "amount",
    label: match[1],
    cents: (BigInt(yuan) * 100n + BigInt(fraction.padEnd(2, "0"))).toString()
  };
}

function explicitDate(
  text: string,
  fields: FieldReference[]
): ContractDocumentDifferenceCandidate | null {
  const match = text.match(
    /(?:^|\s)(签订日期|合同日期|生效日期|开工日期|竣工日期|付款日期)\s*[:：]\s*(\d{4})(?:年|-|\/)(\d{1,2})(?:月|-|\/)(\d{1,2})(?:日|$|\s)/u
  );
  if (!match) return null;
  const field = fields.find(({ label }) => label === match[1]);
  if (!field) return null;
  const year = Number(match[2]);
  const month = Number(match[3]);
  const day = Number(match[4]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return {
    kind: "date",
    fieldKey: field.key,
    label: match[1],
    isoDate: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
  };
}

function clauseReferences(value: unknown): ClauseReference[] {
  if (!Array.isArray(value)) return [];
  const references = value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const key = typeof record["key"] === "string" ? record["key"].trim() : "";
    const title = typeof record["title"] === "string" ? record["title"].normalize("NFKC").trim() : "";
    return key && title.length >= 2 ? [{ key, title }] : [];
  });
  return references.filter(
    (reference) =>
      references.filter(({ key }) => key === reference.key).length === 1 &&
      references.filter(({ title }) => title === reference.title).length === 1
  );
}

function fieldReferences(value: unknown): FieldReference[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const fieldSchema = (value as Record<string, unknown>)["fieldSchema"];
  if (!Array.isArray(fieldSchema)) return [];
  const references = fieldSchema.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const key = typeof record["key"] === "string" ? record["key"].trim() : "";
    const label =
      typeof record["label"] === "string" ? record["label"].normalize("NFKC").trim() : "";
    return key && label ? [{ key, label }] : [];
  });
  return references.filter(
    (reference) =>
      references.filter(({ key }) => key === reference.key).length === 1 &&
      references.filter(({ label }) => label === reference.label).length === 1
  );
}

function hasExactTitlePrefix(text: string, title: string) {
  if (!text.startsWith(title)) return false;
  const suffix = text.slice(title.length, title.length + 1);
  return suffix === "" || /[\s:：]/u.test(suffix);
}

function assertSnapshot(snapshot: ContractDocxSnapshot) {
  if (!snapshot || !Array.isArray(snapshot.blocks)) {
    throw new BadRequestException("合同文档提取结果不正确");
  }
  if (snapshot.blocks.length > CONTRACT_DOCUMENT_COMPARISON_LIMITS.maxBlocksPerDocument) {
    throw new BadRequestException("合同文档内容块数量超过比较限制");
  }
  for (const block of snapshot.blocks) {
    if (
      !block ||
      !["paragraph", "table_cell"].includes(block.kind) ||
      typeof block.path !== "string" ||
      typeof block.text !== "string"
    ) {
      throw new BadRequestException("合同文档提取结果不正确");
    }
  }
  const actualHash = createHash("sha256").update(JSON.stringify(snapshot.blocks)).digest("hex");
  if (snapshot.normalizedSha256 !== actualHash) {
    throw new BadRequestException("合同文档提取结果校验失败");
  }
}

function blockSignature(block: ContractDocxBlock) {
  return `${block.kind}\u0000${block.text}`;
}
