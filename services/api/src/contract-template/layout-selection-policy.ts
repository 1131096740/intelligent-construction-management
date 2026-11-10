import { BadRequestException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import type { FileService } from "../file/file.service";
import { confirmedLayoutSourceMapping, mappedLayoutSourceForVersion, readLayoutSourcePositions } from "./layout-field-mapping";

import { canonicalContractPlaceholder } from "../contract-document/contract-placeholder-registry";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const CONFIRM_REQUIRED = "该版式尚无可信的原文确认记录，请由合同主管复制为新草稿、选择填写位置并确认样张后发布";
type SelectionClient = Pick<Prisma.TransactionClient, "contractLayoutTemplateVersion" | "contractLayoutTemplate" | "contractGeneratedDocument" | "fileObject">;

/** Eligibility only; the owning mutation retains role, lease and revision authority. */
export async function assertSelectableLayoutVersion(
  tx: SelectionClient,
  files: Pick<FileService, "getFileBuffer">,
  versionId: string,
  contractTypeKey: string | null
) {
  const { layout } = await readSelectableLayoutSource(tx, files, versionId, contractTypeKey);
  return layout;
}

export async function readSelectableLayoutSource(
  tx: SelectionClient,
  files: Pick<FileService, "getFileBuffer">,
  versionId: string,
  contractTypeKey: string | null
) {
  const layout = await tx.contractLayoutTemplateVersion.findUnique({ where: { id: versionId } });
  if (!layout || layout.status !== "published") throw new BadRequestException("所选合同版式尚未发布，请重新选择已发布版式");
  const template = await tx.contractLayoutTemplate.findUnique({ where: { id: layout.layoutTemplateId } });
  if (!contractTypeKey || !template || template.contractTypeKey !== contractTypeKey) throw new BadRequestException("所选合同版式与当前合同类型不匹配，请重新选择");
  const mapping = confirmedLayoutSourceMapping(layout);
  if (!mapping) {
    // Absence is not a legacy marker. Require a prior successful immutable job
    // from the exact source and complete, hashed private DOCX/PDF file facts.
    const historical = await tx.contractGeneratedDocument.findFirst({
      where: { layoutTemplateVersionId: layout.id, status: "success", docxFileId: { not: null }, pdfFileId: { not: null } },
      orderBy: { createdAt: "asc" }
    });
    const snapshot = historical?.inputSnapshot;
    if (!layout.publishedAt || !layout.publishedByUserId || !layout.previewPdfFileId || !historical ||
      !(snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)) ||
      snapshot.templateFileId !== layout.docxFileId || Object.prototype.hasOwnProperty.call(snapshot, "layoutSourceMapping") ||
      !historical.docxFileId || !historical.pdfFileId || historical.docxFileId === historical.pdfFileId ||
      historical.createdAt.getTime() < layout.publishedAt.getTime()) throw new BadRequestException(CONFIRM_REQUIRED);
    const outputs = await tx.fileObject.findMany({ where: { id: { in: [historical.docxFileId, historical.pdfFileId] } } });
    const docx = outputs.find(file => file.id === historical.docxFileId);
    const pdf = outputs.find(file => file.id === historical.pdfFileId);
    if (!docx || !pdf || docx.mimeType !== DOCX_MIME || pdf.mimeType !== "application/pdf" ||
      ![docx, pdf].every(file => file.storageStatus === "active" && file.sizeBytes > 0 && /^[a-f0-9]{64}$/u.test(file.contentSha256 ?? ""))) throw new BadRequestException(CONFIRM_REQUIRED);
  }
  const source = await files.getFileBuffer(layout.docxFileId);
  const sha256 = createHash("sha256").update(source.buffer).digest("hex");
  if (source.file.id !== layout.docxFileId || source.file.storageStatus !== "active" || source.file.contentSha256 !== sha256 || mapping && mapping.sourceSha256 !== sha256) {
    throw new BadRequestException("版式原文件已变化，请由合同主管重新检查确认");
  }
  // Validates the canonical mapping fingerprint, ranges, XML and actual bytes;
  // the explicit legacy branch validates the bounded source without inventing a mapping.
  const mapped = mappedLayoutSourceForVersion(source.buffer, layout);
  if (!mapping) {
    const positions = readLayoutSourcePositions(source.buffer).positions;
    const tags = new Set(positions.flatMap(position =>
      [...position.text.matchAll(/\{([^{}]+)\}/gu)].map(match => canonicalContractPlaceholder(match[1]))));
    if (!["contract.name", "party.owner.name", "party.counterparty.name", "contract.temporaryCode", "document.watermark"].every(key => tags.has(key))) {
      throw new BadRequestException(CONFIRM_REQUIRED);
    }
    // Only explicit, independently declared legacy body/signature coordinates
    // are recognized. This is not inference of names or legal party roles.
    const declarations = positions.map(position => position.text.trim()
      .replace(/\{([^{}]+)\}/gu, (_token, key: string) => `{${canonicalContractPlaceholder(key)}}`)
      .replace(/\s+/gu, "").replace(/:/gu, "："));
    for (const [label, key] of [["甲方", "party.owner.name"], ["乙方", "party.counterparty.name"], ["甲方签章", "party.owner.name"], ["乙方签章", "party.counterparty.name"]]) {
      if (declarations.filter(text => text === `${label}：{${key}}`).length !== 1) throw new BadRequestException(CONFIRM_REQUIRED);
    }
  }
  return { layout, source, mapped };
}
