"use strict";
const { prepareSeedLayoutDocxSource, SEED_LAYOUT_FONT } = require("../dist/contract-document/seed-layout-docx-source");
const { readFile } = require("node:fs/promises");
const { renderLayoutPreviewDocx } = require("../dist/contract-document/layout-preview-docx");
const { convertDocxToPdf } = require("../dist/contract-document/libreoffice-converter");
const { layoutPreviewValues } = require("../dist/contract-document/layout-preview-values");
const { requiredPlaceholderKeys, declaredBillKeys } = require("../dist/contract-document/contract-document.service");

// Initialization only: existing layouts and all V1 bytes remain immutable on re-seed.
async function initializeSeedLayout({ prisma, data, uploaderId, sourcePath, writeFile }) {
  const existing = await prisma.contractLayoutTemplateVersion.findFirst({
    where: { OR: [{ layoutTemplateId: data.layout.id }, { id: data.layout.versionId }] }
  });
  if (existing) return { status: "preserved" };
  const conflictingFile = await prisma.fileObject.findFirst({
    where: { OR: [
      { id: { in: [data.layout.docxFile.id, data.layout.previewPdfFile.id] } },
      { objectKey: { in: [data.layout.docxFile.objectKey, data.layout.previewPdfFile.objectKey] } }
    ] }
  });
  if (conflictingFile) throw new Error("版式初始化文件已存在，须人工核对，禁止覆盖原件");
  const source = prepareSeedLayoutDocxSource(await readFile(sourcePath));
  const schema = { fields: data.fields, bills: data.bills, clauses: data.clauses,
    required: ["contract.amountUppercase"] };
  const rendered = renderLayoutPreviewDocx(source,
    { values: layoutPreviewValues(data.layout.previewJob.sampleData, declaredBillKeys(schema, data.layout.inspectionReport)) },
    requiredPlaceholderKeys(schema, data.layout.inspectionReport));
  const preview = await convertDocxToPdf(rendered, [SEED_LAYOUT_FONT]);
  const docxMetadata = await writeFile(data.layout.docxFile, source);
  const previewMetadata = await writeFile(data.layout.previewPdfFile, preview);
  for (const [file, metadata] of [[data.layout.docxFile, docxMetadata], [data.layout.previewPdfFile, previewMetadata]]) {
    await prisma.fileObject.create({ data: { ...file, ...metadata, uploadedByUserId: uploaderId } });
  }
  await prisma.contractLayoutTemplate.upsert({
    where: { id: data.layout.id },
    update: {
      name: data.layout.name,
      contractTypeKey: data.template.contractTypeKey
    },
    create: {
      id: data.layout.id,
      name: data.layout.name,
      contractTypeKey: data.template.contractTypeKey,
      createdByUserId: uploaderId
    }
  });
  await prisma.contractLayoutTemplateVersion.create({ data: {
      id: data.layout.versionId,
      layoutTemplateId: data.layout.id,
      versionNo: data.layout.versionNo,
      status: data.layout.status,
      docxFileId: data.layout.docxFile.id,
      placeholderSchema: {
        fields: data.fields,
        bills: data.bills,
        clauses: data.clauses,
        required: ["contract.amountUppercase"]
      },
      previewPdfFileId: data.layout.previewPdfFile.id,
      inspectionReport: data.layout.inspectionReport,
      submittedByUserId: uploaderId,
      publishedByUserId: "seed-user-contract-director",
      publishedAt: data.publishedAt,
      changeSummary: data.version.changeSummary
    }
  });
  await prisma.contractLayoutPreviewJob.create({ data: {
      id: data.layout.previewJob.id,
      layoutTemplateVersionId: data.layout.versionId,
      status: data.layout.previewJob.status,
      sampleData: data.layout.previewJob.sampleData,
      previewPdfFileId: data.layout.previewPdfFile.id,
      completedAt: data.layout.previewJob.completedAt,
      createdByUserId: uploaderId
    }
  });
  return { status: "initialized" };
}
module.exports = { initializeSeedLayout };
