import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PDFDocument } from "pdf-lib";
import { createReviewedMaterialFixture, saveBody } from "./task10-body.test-support";
import { createTask09Draft, saveTask09Draft } from "./task09-draft-template.test-support";

const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const currentLockSha = "6c7d6a82ea477f30f41bd5e1ccc9eab0dee4ed05d9901fee911e5d9ad14e1128";

describe("task10 frozen semantic version through public generation reuse", () => {
  let fixture: Awaited<ReturnType<typeof createReviewedMaterialFixture>>;
  let draft: Awaited<ReturnType<typeof createTask09Draft>>;
  beforeAll(async () => {
    fixture = await createReviewedMaterialFixture();
    const { server, layout } = fixture;
    draft = await createTask09Draft(server);
    expect((await saveTask09Draft(server, draft, "material_purchase", layout.id)).status).toBe(200);
    expect((await saveBody(draft, undefined, "当前单甲方", [{ clientRowKey: "gross-semantic-row", sortOrder: 0, itemName: "含税原值材料", unit: "吨", quantity: "1", unitPrice: "1.5340", taxRatePercent: "0", customData: {} }])).status).toBe(200);
  }, 10_000);
  afterAll(async () => { await fixture?.close(); });

  it("does not alias a new money-semantic job to the same-content legacy completed job", async () => {
    const { server, source, layout } = fixture;
    const currentResponse = await fetch(`${draft.base}/workbench`, { headers: draft.headers });
    expect(currentResponse.status).toBe(200);
    const current = await currentResponse.json();
    expect(current.version).toMatchObject({ amountYuan: "1.5340", draftData: { contractBasics: { amountBasis: "tax_inclusive" } } });
    const runtimeLockSha256 = hash(await readFile(resolve(__dirname, "../../assets/document-converter/runtime-lock.json")));
    // Historical fixture encoding frozen at0d092148, before semantic-key support.
    // This seeds upgrade state; it never calls/computes the new private key helper.
    const legacyKey = hash(JSON.stringify([draft.version.id, current.version.documentContentRevision, current.version.documentContentFingerprint,
      layout.id, "draft", [], "contract-body-docx4j-v1", runtimeLockSha256]));
    const storedLayout = await server.store.prisma.contractLayoutTemplateVersion.findUnique({ where: { id: layout.id } });
    const row = { itemName: "含税原值材料", unit: "吨", quantity: "1", unitPrice: "1.534", taxInclusiveUnitPrice: "1.534", taxExclusiveUnitPrice: "1.5340", taxRatePercent: "0%", taxInclusiveAmount: "1.5340", taxExclusiveAmount: "1.5340", taxAmount: "0.0000" };
    const oldSnapshot = {
      documentContentRevision: current.version.documentContentRevision, documentContentFingerprint: current.version.documentContentFingerprint,
      templateFileId: storedLayout!.docxFileId, layoutSourceMapping: (storedLayout!.placeholderSchema as { sourceMapping: unknown }).sourceMapping,
      bodyDocument: { protocolVersion: 1, layoutTemplateVersionId: layout.id, sourceSha256: layout.sha256, pdfEngine: "docx4j-17.3.5", runtimeLockSha256 },
      outputBaseName: "历史冻结同修订样张", renderInput: { values: { "contract.name": "上游新建当前合同名称", "contract.temporaryCode": current.contract.temporaryCode,
        "contract.amount": "1.5340", "contract.amountUppercase": "人民币壹元伍角叁分肆厘", "party.owner.name": "当前单甲方", "party.counterparty.name": "当前单乙方",
        "field.taxRatePercent": "0%", "document.watermark": "草稿", "bill.main": [row], "bill.materials": [row] } }, requiredKeys: [], attachmentFiles: []
    };
    // Valid opaque historical file fixtures test immutability only, not PDF
    // conversion, printed text or signing quality. No native converter is used.
    const historicalPdf = await PDFDocument.create(); historicalPdf.addPage([595.28, 841.89]);
    const pdfBytes = Buffer.from(await historicalPdf.save());
    const oldFiles: Array<{ id: string; sha256: string }> = [];
    for (const [format, bytes, mimeType] of [["docx", source, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"], ["pdf", pdfBytes, "application/pdf"]] as const) {
      const file = await server.files.uploadPrivateFile({ originalName: `历史不透明文件样本.${format}`, mimeType, sizeBytes: bytes.length, buffer: bytes, uploadedByUserId: "staff" });
      oldFiles.push({ id: file.id, sha256: hash(bytes) });
    }
    const old = await server.store.prisma.contractGeneratedDocument.create({ data: { contractVersionId: draft.version.id, layoutTemplateVersionId: layout.id,
      purpose: "draft", status: "success", sourceRevision: current.version.draftRevision, idempotencyKey: legacyKey, engineVersion: "contract-body-docx4j-v1",
      inputSnapshot: oldSnapshot, createdByUserId: "staff", docxFileId: oldFiles[0].id, pdfFileId: oldFiles[1].id, completedAt: new Date() } });
    await server.store.prisma.contractVersion.update({ where: { id: draft.version.id }, data: { latestDraftPreviewDocumentId: old.id } });
    const downloadHashes = async () => {
      const hashes = [];
      for (const file of oldFiles) {
        const ticket = await fetch(`${await server.app.getUrl()}/files/${file.id}/download-ticket`, { method: "POST", headers: draft.headers,
          body: JSON.stringify({ confirmationPassword: server.password, downloadReason: "核对历史冻结文件仍按原字节保留" }) });
        expect(ticket.status === 201 ? "OK" : await ticket.text()).toBe("OK");
        const { downloadUrl } = await ticket.json();
        const downloaded = await fetch(`${await server.app.getUrl()}${downloadUrl}`);
        expect(downloaded.status).toBe(200);
        hashes.push(hash(Buffer.from(await downloaded.arrayBuffer())));
      }
      return hashes;
    };
    expect(await downloadHashes()).toEqual(oldFiles.map(file => file.sha256));
    const queue = () => fetch(`${draft.base}/preview-generation`, { method: "POST", headers: draft.headers, body: JSON.stringify({ sourceRevision: current.version.draftRevision }) });
    const response = await queue();
    expect(response.status === 201 ? "OK" : await response.text()).toBe("OK");
    const generation = await response.json();
    console.info("同修订公开队列复用结果", JSON.stringify({ reusedLegacy: generation.generationId === old.id, status: generation.status, documentContentRevision: generation.documentContentRevision,
      historicalFileHashes: oldFiles.map(file => file.sha256) }));
    expect(generation.generationId).not.toBe(old.id);
    expect(generation).toMatchObject({ status: "queued", documentContentRevision: current.version.documentContentRevision, documentContentFingerprint: current.version.documentContentFingerprint });
    const again = await queue();
    expect(again.status).toBe(201);
    expect((await again.json()).generationId).toBe(generation.generationId);
    const listed = await fetch(`${await server.app.getUrl()}/contract-workbench/${draft.version.id}/documents`, { headers: draft.headers });
    expect(listed.status).toBe(200);
    const documents = await listed.json();
    const historical = documents.find((item: { id: string }) => item.id === old.id);
    expect(historical).toMatchObject({ status: "success", idempotencyKey: legacyKey, docxFileId: oldFiles[0].id, pdfFileId: oldFiles[1].id, inputSnapshot: oldSnapshot });
    expect(await downloadHashes()).toEqual(oldFiles.map(file => file.sha256));
    const after = await fetch(`${draft.base}/workbench`, { headers: draft.headers });
    expect(after.status).toBe(200);
    expect((await after.json()).version.latestDraftPreviewDocumentId).toBe(old.id);
    const fresh = documents.find((item: { id: string }) => item.id === generation.generationId);
    expect(fresh.inputSnapshot).toMatchObject({ bodyDocument: { renderSemanticVersion: "contract-money-v1", runtimeLockSha256: currentLockSha },
      renderInput: { values: { "contract.renderSemanticVersion": "contract-money-v1" } } });
    expect(fresh.idempotencyKey).not.toBe(legacyKey);
  });
});
