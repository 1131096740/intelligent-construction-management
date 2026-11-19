import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createTemplateTestServer } from "./template-management.test-support";
import { confirmedBodyLayout, saveBody, type Body } from "./task10-body.test-support";
import { createTask09Draft, saveTask09Draft } from "./task09-draft-template.test-support";

const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");

describe("task10 same-content old table-layout cache isolation", () => {
  it("keeps an old money-v1 success immutable and reuses only the new table-layout job", async () => {
    const referenceDirectory = process.env.TASK10_OLD_LAYOUT_REFERENCE_DIRECTORY;
    if (!referenceDirectory) throw new Error("布局缓存检查需要明确的旧实际文件来源");
    const server = await createTemplateTestServer({ draftWorkbench: true });
    const uploads = jest.spyOn(server.files, "uploadPrivateFile");
    try {
      const referenceDocx = await readFile(join(referenceDirectory, "actual.docx"));
      const referencePdf = await readFile(join(referenceDirectory, "actual.pdf"));
      const referenceJson = await readFile(join(referenceDirectory, "receipt.json"));
      expect(hash(referenceDocx)).toBe("5b27eca740ac892ababf0b01bd2460894e0059c5153f208069a68a869ede5294");
      expect(hash(referencePdf)).toBe("2eeebe7e5428854100b865862f1ac39ee3ddefea40d6bd58cce7e464383c25d9");
      expect(hash(referenceJson)).toBe("a49ab0bde831b11828222a3826a4390bba3d1ec007bec49ea32a7d2f0faca49a");
      const reference = JSON.parse(referenceJson.toString("utf8"));
      const source = await readFile(resolve(__dirname, "../../assets/templates/material-purchase-real-v1.docx"));
      expect(hash(source)).toBe("44be99630d27578e9828bd7c6fa4925cdc26f552b84637e125c8acb0632b17bd");
      const layout = await confirmedBodyLayout(server, source, "materials");
      const draft = await createTask09Draft(server);
      await server.store.prisma.contract.update({ where: { id: draft.contract.id }, data: { temporaryCode: "草稿-旧布局实际正控-001" } });
      expect((await saveTask09Draft(server, draft, "material_purchase", layout.id)).status).toBe(200);
      const body = await fetch(draft.base + "/document-body", { headers: draft.headers }).then(response => response.json()) as Body;
      const ordinary = body.blocks.find(block => block.editable && block.text.startsWith("4.若卖方违背"))!;
      const editPlan = { protocolVersion: 1, layoutTemplateVersionId: layout.id, sourceSha256: layout.sha256,
        edits: [{ positionId: ordinary.id, text: ordinary.text + "旧无标记任务的人工条款应原样保留。" }] };
      const rows = [1, 2].map(index => ({ clientRowKey: "old-layout-" + index, sortOrder: index - 1, itemName: "旧任务材料00" + index,
        unit: "项", quantity: "1", unitPrice: index + ".0000", taxRatePercent: "0", customData: {} }));
      expect((await saveBody(draft, editPlan, "当前单甲方", rows)).status).toBe(200);
      const stateResponse = await fetch(draft.base + "/workbench", { headers: draft.headers });
      expect(stateResponse.status).toBe(200);
      const current = await stateResponse.json();
      expect(current.version).toMatchObject({ amountYuan: "3.0000", draftData: { contractBasics: { amountBasis: "tax_inclusive" } } });
      expect(current.bills[0]).toMatchObject({ taxInclusiveAmountYuan: "3.0000", taxExclusiveAmountYuan: "3.0000", taxAmountYuan: "0.0000" });
      // Adapt only fixture identity/mapping coordinates to this synthetic record.
      // It is a same-visible-content old success, not a replay of the reference lifecycle.
      const storedLayout = await server.store.prisma.contractLayoutTemplateVersion.findUnique({ where: { id: layout.id } });
      const mapping = (storedLayout!.placeholderSchema as { sourceMapping: Record<string, unknown> }).sourceMapping;
      const oldSnapshot = JSON.parse(JSON.stringify(reference.oldQueued.inputSnapshot));
      expect(Object.hasOwn(oldSnapshot.bodyDocument, "tableLayoutVersion")).toBe(false);
      expect(Object.hasOwn(oldSnapshot.renderInput.values, "contract.tableLayoutVersion")).toBe(false);
      expect(oldSnapshot.bodyDocument.renderSemanticVersion).toBe("contract-money-v1");
      oldSnapshot.documentContentRevision = current.version.documentContentRevision;
      oldSnapshot.documentContentFingerprint = current.version.documentContentFingerprint;
      oldSnapshot.templateFileId = storedLayout!.docxFileId;
      oldSnapshot.bodyDocument.layoutTemplateVersionId = layout.id;
      oldSnapshot.bodyDocument.editPlan = current.version.draftData.documentBody;
      oldSnapshot.renderInput.values["field.documentBody"] = current.version.draftData.documentBody;
      oldSnapshot.layoutSourceMapping = { protocolVersion: mapping.protocolVersion, sourceFileId: mapping.sourceFileId,
        sourceSha256: mapping.sourceSha256, draftRevision: mapping.draftRevision, fingerprint: mapping.fingerprint, bindings: mapping.bindings };
      // Fixed 2cd old money-v1 tuple, no current private idempotency helper.
      const oldKey = hash(JSON.stringify([draft.version.id, current.version.documentContentRevision, current.version.documentContentFingerprint, layout.id,
        "draft", [], "contract-body-docx4j-v1", oldSnapshot.bodyDocument.runtimeLockSha256, "contract-money-v1"]));
      const oldFiles: string[] = [];
      for (const [format, bytes, mimeType] of [["docx", referenceDocx, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"], ["pdf", referencePdf, "application/pdf"]] as const) {
        const file = await server.files.uploadPrivateFile({ originalName: "旧完成布局." + format, mimeType, buffer: bytes, sizeBytes: bytes.length, uploadedByUserId: "staff" });
        oldFiles.push(file.id);
      }
      const old = await server.store.prisma.contractGeneratedDocument.create({ data: { contractVersionId: draft.version.id,
        layoutTemplateVersionId: layout.id, purpose: "draft", status: "success", sourceRevision: current.version.draftRevision,
        engineVersion: "contract-body-docx4j-v1", idempotencyKey: oldKey, inputSnapshot: oldSnapshot, createdByUserId: "staff",
        docxFileId: oldFiles[0], pdfFileId: oldFiles[1], completedAt: new Date() } });
      await server.store.prisma.contractVersion.update({ where: { id: draft.version.id }, data: { latestDraftPreviewDocumentId: old.id } });
      const downloadHashes = async () => {
        const hashes: string[] = [];
        for (const fileId of oldFiles) {
          const ticket = await fetch((await server.app.getUrl()) + "/files/" + fileId + "/download-ticket", { method: "POST", headers: draft.headers,
            body: JSON.stringify({ confirmationPassword: server.password, downloadReason: "核对旧布局缓存文件未被新生成覆盖" }) });
          expect(ticket.status === 201 ? "OK" : await ticket.text()).toBe("OK");
          const { downloadUrl } = await ticket.json() as { downloadUrl: string };
          const response = await fetch((await server.app.getUrl()) + downloadUrl);
          expect(response.status).toBe(200); hashes.push(hash(Buffer.from(await response.arrayBuffer())));
        }
        return hashes;
      };
      const beforeHashes = await downloadHashes();
      expect(beforeHashes).toEqual([hash(referenceDocx), hash(referencePdf)]);
      const queue = () => fetch(draft.base + "/preview-generation", { method: "POST", headers: draft.headers,
        body: JSON.stringify({ sourceRevision: current.version.draftRevision }) });
      uploads.mockClear();
      const firstResponse = await queue();
      expect(firstResponse.status === 201 ? "OK" : await firstResponse.text()).toBe("OK");
      const first = await firstResponse.json();
      console.info("OldTableCacheIsolation", JSON.stringify({ reusedOld: first.generationId === old.id, status: first.status }));
      expect(first.generationId).not.toBe(old.id); expect(first.status).toBe("queued");
      const repeatResponse = await queue();
      expect(repeatResponse.status).toBe(201);
      const repeated = await repeatResponse.json();
      expect(repeated).toMatchObject({ generationId: first.generationId, status: "queued" });
      const listed = await fetch((await server.app.getUrl()) + "/contract-workbench/" + draft.version.id + "/documents", { headers: draft.headers });
      expect(listed.status).toBe(200);
      const documents = await listed.json();
      expect(documents).toHaveLength(2);
      const fresh = documents.find((item: { id: string }) => item.id === first.generationId);
      expect(fresh.idempotencyKey).not.toBe(oldKey);
      expect(fresh.inputSnapshot).toMatchObject({ bodyDocument: { tableLayoutVersion: "body-bill-loop-v2", renderSemanticVersion: "contract-money-v1" },
        renderInput: { values: { "contract.tableLayoutVersion": "body-bill-loop-v2", "contract.renderSemanticVersion": "contract-money-v1" } } });
      const retained = documents.find((item: { id: string }) => item.id === old.id);
      expect(retained).toMatchObject({ status: "success", idempotencyKey: oldKey, docxFileId: oldFiles[0], pdfFileId: oldFiles[1] });
      expect(retained.inputSnapshot).toEqual(oldSnapshot);
      expect(await downloadHashes()).toEqual(beforeHashes);
      expect(uploads).toHaveBeenCalledTimes(0);
      const final = await fetch(draft.base + "/workbench", { headers: draft.headers }).then(response => response.json());
      expect(final.version.latestDraftPreviewDocumentId).toBe(old.id);
    } finally { uploads.mockRestore(); await server.app.close(); }
  }, 150_000);
});
