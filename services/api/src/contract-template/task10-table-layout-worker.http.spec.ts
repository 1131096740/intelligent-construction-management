import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { createReviewedMaterialFixture, saveBody } from "./task10-body.test-support";
import { createTask09Draft, saveTask09Draft } from "./task09-draft-template.test-support";

const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

describe("task10 frozen table-layout version through public worker result", () => {
  let fixture: Awaited<ReturnType<typeof createReviewedMaterialFixture>>;
  let draft: Awaited<ReturnType<typeof createTask09Draft>>;
  beforeAll(async () => { fixture = await createReviewedMaterialFixture(); });
  beforeEach(async () => {
    const { server, layout } = fixture;
    draft = await createTask09Draft(server);
    expect((await saveTask09Draft(server, draft, "material_purchase", layout.id)).status).toBe(200);
    expect((await saveBody(draft, undefined, "当前单甲方", [{ clientRowKey: "worker-gross-row", sortOrder: 0, itemName: "版本核对材料", unit: "吨", quantity: "1", unitPrice: "1.5340", taxRatePercent: "0", customData: {} }])).status).toBe(200);
  });
  afterAll(async () => { await fixture?.close(); });
  afterEach(() => { jest.restoreAllMocks(); });

  it.each([
    { name: "missing protected table-layout partner", corruption: "missingValue" },
    { name: "unsupported body layout partner", corruption: "unsupportedBody" }
  ] as const)("refuses $name before Word reads and uploads", async vector => {
    const { server, source, layout } = fixture;
    const originalManifest = process.env.CONTRACT_DOCX4J_RUNTIME_MANIFEST;
    try {
      const workbench = await fetch(`${draft.base}/workbench`, { headers: draft.headers }).then(response => response.json());
      const queued = await fetch(`${draft.base}/preview-generation`, { method: "POST", headers: draft.headers, body: JSON.stringify({ sourceRevision: workbench.version.draftRevision }) });
      expect(queued.status === 201 ? "OK" : await queued.text()).toBe("OK");
      const generation = await queued.json();
      const list = async () => fetch(`${await server.app.getUrl()}/contract-workbench/${draft.version.id}/documents`, { headers: draft.headers });
      const initialList = await list();
      expect(initialList.status).toBe(200);
      const fresh = (await initialList.json()).find((item: { id: string }) => item.id === generation.generationId);
      expect(fresh.inputSnapshot).toMatchObject({ bodyDocument: { renderSemanticVersion: "contract-money-v1", tableLayoutVersion: "body-bill-loop-v2" },
        renderInput: { values: { "contract.renderSemanticVersion": "contract-money-v1", "contract.tableLayoutVersion": "body-bill-loop-v2" } } });
      // Opaque, valid synthetic historical files prove previous pointer/refs stay;
      // they do not stand in for an actual physical contract conversion.
      const pdf = await PDFDocument.create(); pdf.addPage([595.28, 841.89]);
      const previousFiles: string[] = [];
      for (const [name, bytes, mimeType] of [["docx", source, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"], ["pdf", Buffer.from(await pdf.save()), "application/pdf"]] as const) {
        const file = await server.files.uploadPrivateFile({ originalName: `原冻结文件.${name}`, mimeType, sizeBytes: bytes.length, buffer: bytes, uploadedByUserId: "staff" });
        previousFiles.push(file.id);
      }
      const oldSnapshot = JSON.parse(JSON.stringify(fresh.inputSnapshot));
      delete oldSnapshot.bodyDocument.renderSemanticVersion;
      delete oldSnapshot.renderInput.values["contract.renderSemanticVersion"];
      delete oldSnapshot.bodyDocument.tableLayoutVersion;
      delete oldSnapshot.renderInput.values["contract.tableLayoutVersion"];
      const old = await server.store.prisma.contractGeneratedDocument.create({ data: { contractVersionId: draft.version.id, layoutTemplateVersionId: layout.id,
        purpose: "draft", status: "success", sourceRevision: workbench.version.draftRevision,
        idempotencyKey: hash(JSON.stringify([draft.version.id, workbench.version.documentContentRevision, workbench.version.documentContentFingerprint, layout.id,
          "draft", [], "contract-body-docx4j-v1", fresh.inputSnapshot.bodyDocument.runtimeLockSha256])),
        engineVersion: "contract-body-docx4j-v1", inputSnapshot: oldSnapshot, createdByUserId: "staff", docxFileId: previousFiles[0], pdfFileId: previousFiles[1], completedAt: new Date() } });
      await server.store.prisma.contractVersion.update({ where: { id: draft.version.id }, data: { latestDraftPreviewDocumentId: old.id } });
      // Corrupted historical/new frozen state is fixture setup only; no private
      // processor helper is called. The public worker must reject the mismatch.
      const corrupted = JSON.parse(JSON.stringify(fresh.inputSnapshot));
      if (vector.corruption === "missingValue") delete corrupted.renderInput.values["contract.tableLayoutVersion"];
      else corrupted.bodyDocument.tableLayoutVersion = "body-bill-loop-unsupported";
      await server.store.prisma.contractGeneratedDocument.update({ where: { id: generation.generationId }, data: { inputSnapshot: corrupted } });
      const missingManifest = `/private/tmp/jg-task10-table-layout-guard-${randomUUID()}-unavailable.json`;
      expect(existsSync(missingManifest)).toBe(false);
      process.env.CONTRACT_DOCX4J_RUNTIME_MANIFEST = missingManifest;
      // The actual missing-manifest runtime preflight ensures no JVM even in the
      // invalid-version path. Invalid versions must have0 Word reads; the separately
      // labelled legacy admission control intentionally reaches runtime preflight.
      const reads = jest.spyOn(server.files, "getFileBuffer");
      const uploads = jest.spyOn(server.files, "uploadPrivateFile");
      expect(await server.processor.processNext()).toBe(true);
      const resultResponse = await list();
      expect(resultResponse.status).toBe(200);
      const documents = await resultResponse.json();
      const result = documents.find((item: { id: string }) => item.id === generation.generationId);
      expect(result).toMatchObject({ status: "failed", docxFileId: null, pdfFileId: null });
      console.info("冻结版本公共失败结果", JSON.stringify({ name: vector.name, status: result.status, errorMessage: result.errorMessage, wordReads: reads.mock.calls.length, uploads: uploads.mock.calls.length }));
      expect(uploads).toHaveBeenCalledTimes(0);
      expect(reads).toHaveBeenCalledTimes(0);
      expect(result.errorMessage).toBe("合同文书表格版式版本无法核对，请联系管理员处理");
      const after = await fetch(`${draft.base}/workbench`, { headers: draft.headers });
      expect(after.status).toBe(200);
      expect((await after.json()).version.latestDraftPreviewDocumentId).toBe(old.id);
      expect(documents.find((item: { id: string }) => item.id === old.id)).toMatchObject({ status: "success", docxFileId: previousFiles[0], pdfFileId: previousFiles[1], inputSnapshot: oldSnapshot });
    } finally {
      if (originalManifest === undefined) delete process.env.CONTRACT_DOCX4J_RUNTIME_MANIFEST;
      else process.env.CONTRACT_DOCX4J_RUNTIME_MANIFEST = originalManifest;
      await server.store.prisma.contractGeneratedDocument.deleteMany({ where: { contractVersionId: draft.version.id, status: "queued" } });
    }
  });
});
