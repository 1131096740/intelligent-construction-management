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
  if (!isRecord(content)) {
    return cloneJsonValue(content);
  }
  const documentEntries = Object.entries(content).filter(
    ([key]) => !STANDARD_META_KEYS.has(key)
  );
  return cloneJsonValue(Object.fromEntries(documentEntries));
}

function cloneJsonValue(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      throw new TypeError(INVALID_CLAUSE_JSON_MESSAGE);
    }
    return JSON.parse(serialized) as unknown;
  } catch {
    throw new TypeError(INVALID_CLAUSE_JSON_MESSAGE);
  }
}

function normalizeClauseContent(content: unknown): ClauseDocument {
  const record = contentRecord(content);
  const blocks = Array.isArray(record["blocks"])
    ? record["blocks"].flatMap((block) => normalizeClauseBlock(block))
    : [];
  if (blocks.length > 0) {
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

function normalizeClauseBlock(value: unknown): ClauseBlock[] {
  if (!isRecord(value)) {
    return [];
  }
  if (value["type"] === "paragraph" && typeof value["text"] === "string") {
    return [
      {
        type: "paragraph",
        text: value["text"],
        ...(typeof value["bold"] === "boolean" ? { bold: value["bold"] } : {}),
        ...(typeof value["italic"] === "boolean" ? { italic: value["italic"] } : {})
      }
    ];
  }
  if (
    value["type"] === "list" &&
    Array.isArray(value["items"]) &&
    value["items"].every((item) => typeof item === "string")
  ) {
    return [{ type: "list", items: [...value["items"]] }];
  }
  if (
    value["type"] === "table" &&
    Array.isArray(value["rows"]) &&
    value["rows"].every(
      (row) => Array.isArray(row) && row.every((cell) => typeof cell === "string")
    )
  ) {
    return [
      {
        type: "table",
        rows: value["rows"].map((row) => [...row])
      }
    ];
  }
  return [];
}

function fallbackClauseText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (typeof content === "number" || typeof content === "boolean") {
    return String(content);
  }
  const record = contentRecord(content);
  return typeof record["text"] === "string" ? record["text"] : "";
}

function contentRecord(content: unknown): Record<string, unknown> {
  return isRecord(content) ? content : {};
}

function isRecord(content: unknown): content is Record<string, unknown> {
  return Boolean(content) && typeof content === "object" && !Array.isArray(content);
}
