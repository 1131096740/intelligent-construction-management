import type { ContractClauseDefinition } from "@jiangkong/shared-domain";

import type { PublishedStandardClause } from "../../../api/contract-workbench.api";
import { clauseDocumentText, normalizeClauseDocument } from "./contract-bill-editor";

export type StandardClauseContentMeta = {
  standardTitle?: string;
  standardContent?: unknown;
  standardClauseSourceName?: string;
  standardClauseVersionNo?: number;
  deviatedFromStandard?: boolean;
};

export function applyPublishedStandardClause(
  clause: ContractClauseDefinition,
  source: PublishedStandardClause
): ContractClauseDefinition {
  const renderedSource = structuredClone(source.content);
  const sourceSnapshot = structuredClone(source.content);
  const document = normalizeClauseDocument(renderedSource);
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
  const nextContent = patch.content === undefined ? clause.content : patch.content;
  const clonedContent = structuredClone(nextContent);
  const nextDocument = normalizeClauseDocument(clonedContent);
  const deviatedFromStandard =
    next.title !== standardTitle ||
    clauseDocumentText(nextDocument) !==
      clauseDocumentText(normalizeClauseDocument(meta.standardContent));

  return {
    ...next,
    content: {
      ...contentRecord(clonedContent),
      ...nextDocument,
      ...meta,
      standardTitle,
      deviatedFromStandard
    }
  };
}

export function standardClauseMeta(content: unknown): StandardClauseContentMeta {
  const record = contentRecord(content);
  return {
    ...(typeof record["standardTitle"] === "string"
      ? { standardTitle: record["standardTitle"] }
      : {}),
    ...(record["standardContent"] === undefined
      ? {}
      : { standardContent: structuredClone(record["standardContent"]) }),
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

function contentRecord(content: unknown): Record<string, unknown> {
  return content && typeof content === "object" && !Array.isArray(content)
    ? (content as Record<string, unknown>)
    : {};
}
