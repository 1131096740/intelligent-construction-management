import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { createReviewedMaterialFixture, saveBody } from "./task10-body.test-support";
import { createTask09Draft, saveTask09Draft } from "./task09-draft-template.test-support";

const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

type VersionCase = { name: string; bodyVersion?: string; valuesVersion?: string; omitBody?: boolean; omitValue?: boolean; legacyAdmissionOnly?: boolean };
const versions: VersionCase[] = [
  { name: "unsupported body partner", bodyVersion: "contract-money-unsupported", valuesVersion: "contract-money-v1" },
  { name: "missing body partner", omitBody: true, valuesVersion: "contract-money-v1" },
  { name: "missing values partner", bodyVersion: "contract-money-v1", omitValue: true },
  { name: "matching unsupported partners", bodyVersion: "contract-money-unsupported", valuesVersion: "contract-money-unsupported" },
  { name: "present empty partners", bodyVersion: "", valuesVersion: "" },
  { name: "legacy both absent reaches runtime preflight only", omitBody: true, omitValue: true, legacyAdmissionOnly: true }
];

describe("task10 frozen money-version guard through public worker result", () => {
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

  it.each(versions)("$name", async vector => {
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
      expect(fresh.inputSnapshot).toMatchObject({ bodyDocument: { renderSemanticVersion: "contract-money-v1" },
        renderInput: { values: { "contract.renderSemanticVersion": "contract-money-v1" } } });
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
      const old = await server.store.prisma.contractGeneratedDocument.create({ data: { contractVersionId: draft.version.id, layoutTemplateVersionId: layout.id,
        purpose: "draft", status: "success", sourceRevision: workbench.version.draftRevision,
        idempotencyKey: hash(JSON.stringify([draft.version.id, workbench.version.documentContentRevision, workbench.version.documentContentFingerprint, layout.id,
          "draft", [], "contract-body-docx4j-v1", fresh.inputSnapshot.bodyDocument.runtimeLockSha256])),
        engineVersion: "contract-body-docx4j-v1", inputSnapshot: oldSnapshot, createdByUserId: "staff", docxFileId: previousFiles[0], pdfFileId: previousFiles[1], completedAt: new Date() } });
      await server.store.prisma.contractVersion.update({ where: { id: draft.version.id }, data: { latestDraftPreviewDocumentId: old.id } });
      // Corrupted historical/new frozen state is fixture setup only; no private
      // processor helper is called. The public worker must reject the mismatch.
      const corrupted = JSON.parse(JSON.stringify(fresh.inputSnapshot));
      if (vector.omitBody) delete corrupted.bodyDocument.renderSemanticVersion;
      else {
        expect(typeof vector.bodyVersion).toBe("string");
        corrupted.bodyDocument.renderSemanticVersion = vector.bodyVersion;
      }
      if (vector.omitValue) delete corrupted.renderInput.values["contract.renderSemanticVersion"];
      else {
        expect(typeof vector.valuesVersion).toBe("string");
        corrupted.renderInput.values["contract.renderSemanticVersion"] = vector.valuesVersion;
      }
      await server.store.prisma.contractGeneratedDocument.update({ where: { id: generation.generationId }, data: { inputSnapshot: corrupted } });
      const missingManifest = `/private/tmp/jg-task10-semantic-guard-${randomUUID()}-unavailable.json`;
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
      if (vector.legacyAdmissionOnly) {
        // This is admission/order compatibility only, not successful PDF output:
        // both flags absent must reach Word and the actual pinned-runtime gate.
        expect(reads).toHaveBeenCalledTimes(1);
        expect(result.errorMessage).toBe("合同正文转换运行环境未就绪，请联系管理员");
      } else {
        expect(reads).toHaveBeenCalledTimes(0);
        expect(result.errorMessage).toContain("金额口径版本");
      }
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
