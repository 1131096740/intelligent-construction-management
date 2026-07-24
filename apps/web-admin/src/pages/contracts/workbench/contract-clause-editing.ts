import type { ContractClauseDefinition } from "@jiangkong/shared-domain";

import type { PublishedStandardClause } from "../../../api/contract-workbench.api";
import {
  clauseDocumentText,
  type ClauseBlock,
  type ClauseDocument
} from "./contract-bill-editor";

export type StandardClauseContentMeta = {
  standardTitle?: string;
  standardContent?: unknown;
  standardClauseSourceName?: string;
  standardClauseVersionNo?: number;
  deviatedFromStandard?: boolean;
};

const STANDARD_META_KEYS = new Set([
  "standardTitle",
  "standardContent",
  "standardClauseSourceName",
  "standardClauseVersionNo",
  "deviatedFromStandard"
]);
const INVALID_CLAUSE_JSON_MESSAGE = "条款内容必须是可序列化的 JSON 数据";

export function applyPublishedStandardClause(
  clause: ContractClauseDefinition,
  source: PublishedStandardClause
): ContractClauseDefinition {
  const sourceSnapshot = cleanDocumentContent(source.content);
  const renderedSource = cloneJsonValue(sourceSnapshot);
  const document = normalizeClauseContent(renderedSource);
  return {
    ...clause,
    standardClauseVersionId: source.standardClauseVersionId,
    title: source.title,
    content: {
      ...contentRecord(renderedSource),
      ...document,
      standardTitle: source.title,
      standardContent: sourceSnapshot,
      standardClauseSourceName: source.name || source.title || source.code,
      standardClauseVersionNo: source.versionNo,
      deviatedFromStandard: false
    }
  };
}

export function withClauseDeviation(
  clause: ContractClauseDefinition,
  patch: Partial<Pick<ContractClauseDefinition, "title" | "content">>
): ContractClauseDefinition {
  const next = { ...clause, ...patch };
  const meta = standardClauseMeta(clause.content);
  if (meta.standardContent === undefined) {
    return next;
  }

  const standardTitle = meta.standardTitle ?? clause.title;
  const nextContent = cleanDocumentContent(
    patch.content === undefined ? clause.content : patch.content
  );
  const nextDocument = normalizeClauseContent(nextContent);
  const deviatedFromStandard =
    next.title !== standardTitle ||
    clauseDocumentText(nextDocument) !==
      clauseDocumentText(normalizeClauseContent(meta.standardContent));

  return {
    ...next,
    content: {
      ...contentRecord(nextContent),
      ...nextDocument,
      ...meta,
      standardTitle,
      deviatedFromStandard
    }
  };
}

export function standardClauseMeta(content: unknown): StandardClauseContentMeta {
  const record = contentRecord(content);
  const standardContent = record["standardContent"];
  return {
    ...(typeof record["standardTitle"] === "string"
      ? { standardTitle: record["standardTitle"] }
      : {}),
    ...(standardContent === undefined
      ? {}
      : { standardContent: cleanDocumentContent(standardContent) }),
    ...(typeof record["standardClauseSourceName"] === "string"
      ? { standardClauseSourceName: record["standardClauseSourceName"] }
      : {}),
    ...(typeof record["standardClauseVersionNo"] === "number"
      ? { standardClauseVersionNo: record["standardClauseVersionNo"] }
      : {}),
    ...(typeof record["deviatedFromStandard"] === "boolean"
      ? { deviatedFromStandard: record["deviatedFromStandard"] }
      : {})
  };
}

function cleanDocumentContent(content: unknown): unknown {
  return cloneJsonValue(content, STANDARD_META_KEYS);
}

function cloneJsonValue(value: unknown, omittedRootKeys?: ReadonlySet<string>): unknown {
  try {
    return cloneJsonNode(value, new WeakSet<object>(), omittedRootKeys);
  } catch {
    throw new TypeError(INVALID_CLAUSE_JSON_MESSAGE);
  }
}

function cloneJsonNode(
  value: unknown,
  ancestors: WeakSet<object>,
  omittedKeys?: ReadonlySet<string>
): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(INVALID_CLAUSE_JSON_MESSAGE);
    }
    return value;
  }
  if (typeof value !== "object") {
    throw new TypeError(INVALID_CLAUSE_JSON_MESSAGE);
  }
  if (ancestors.has(value)) {
    throw new TypeError(INVALID_CLAUSE_JSON_MESSAGE);
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      assertPlainDenseArray(value);
      return value.map((item) => cloneJsonNode(item, ancestors));
    }
    if (!isPlainObject(value)) {
      throw new TypeError(INVALID_CLAUSE_JSON_MESSAGE);
    }
    const result: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") {
        throw new TypeError(INVALID_CLAUSE_JSON_MESSAGE);
      }
      if (omittedKeys?.has(key)) {
        continue;
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        !descriptor ||
        !descriptor.enumerable ||
        !Object.prototype.hasOwnProperty.call(descriptor, "value")
      ) {
        throw new TypeError(INVALID_CLAUSE_JSON_MESSAGE);
      }
      Object.defineProperty(result, key, {
        value: cloneJsonNode(value[key], ancestors),
        enumerable: true,
        configurable: true,
        writable: true
      });
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

function assertPlainDenseArray(value: unknown[]): void {
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError(INVALID_CLAUSE_JSON_MESSAGE);
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      throw new TypeError(INVALID_CLAUSE_JSON_MESSAGE);
    }
  }
  for (const key of Reflect.ownKeys(value)) {
    if (
      typeof key !== "string" ||
      (key !== "length" && !isArrayIndexKey(key, value.length))
    ) {
      throw new TypeError(INVALID_CLAUSE_JSON_MESSAGE);
    }
  }
}

function isArrayIndexKey(key: string, length: number): boolean {
  const index = Number(key);
  return (
    Number.isInteger(index) &&
    index >= 0 &&
    index < length &&
    String(index) === key
  );
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeClauseContent(content: unknown): ClauseDocument {
  const record = contentRecord(content);
  const rawBlocks = record["blocks"];
  const normalizedBlocks = Array.isArray(rawBlocks)
    ? rawBlocks.map((block) => normalizeClauseBlock(block))
    : [];
  if (
    normalizedBlocks.length > 0 &&
    normalizedBlocks.every((block): block is ClauseBlock => block !== null)
  ) {
    const blocks = normalizedBlocks;
    const document = { text: "", blocks };
    return {
      ...document,
      text: clauseDocumentText(document)
    };
  }

  const text = fallbackClauseText(content);
  return {
    text,
    blocks: [{ type: "paragraph", text }]
  };
}

function normalizeClauseBlock(value: unknown): ClauseBlock | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value["type"] === "paragraph" && typeof value["text"] === "string") {
    return {
      type: "paragraph",
      text: value["text"],
      ...(typeof value["bold"] === "boolean" ? { bold: value["bold"] } : {}),
      ...(typeof value["italic"] === "boolean" ? { italic: value["italic"] } : {})
    };
  }
  if (
    value["type"] === "list" &&
    Array.isArray(value["items"]) &&
    value["items"].every((item) => typeof item === "string")
  ) {
    return { type: "list", items: [...value["items"]] };
  }
  if (
    value["type"] === "table" &&
    Array.isArray(value["rows"]) &&
    value["rows"].every(
      (row) => Array.isArray(row) && row.every((cell) => typeof cell === "string")
    )
  ) {
    return {
      type: "table",
      rows: value["rows"].map((row) => [...row])
    };
  }
  return null;
}

function fallbackClauseText(content: unknown): string {
  return recursiveClauseText(content).join("\n");
}

function recursiveClauseText(content: unknown): string[] {
  if (typeof content === "string") {
    return [content];
  }
  if (typeof content === "number" || typeof content === "boolean") {
    return [String(content)];
  }
  if (content === null || content === undefined) {
    return [];
  }
  if (Array.isArray(content)) {
    return content.flatMap((item) => recursiveClauseText(item));
  }
  const record = contentRecord(content);
  if (typeof record["text"] === "string") {
    return [record["text"]];
  }
  return Object.entries(record).flatMap(([key, value]) =>
    key === "type" ? [] : recursiveClauseText(value)
  );
}

function contentRecord(content: unknown): Record<string, unknown> {
  return isRecord(content) ? content : {};
}

function isRecord(content: unknown): content is Record<string, unknown> {
  return Boolean(content) && typeof content === "object" && !Array.isArray(content);
}
