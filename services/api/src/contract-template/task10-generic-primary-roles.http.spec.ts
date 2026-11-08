// One closed generic source-role public HTTP tracer; independent literal expectations.
// Latin/number TNR14 is normative metadata only: the public paragraph-format schema has no run/Latin fields.
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import PizZip from "pizzip";
import { DOMParser, type Element } from "@xmldom/xmldom";
import type { ContractBodyFlow, ContractBodyParagraph } from "../contract-document/contract-body-document";
import { task10HttpRepository } from "./task10-http-repository.test-support";
import { createTemplateTestServer } from "./template-management.test-support";
import type { Body } from "./task10-body.test-support";
import { prepareLayoutSourceMapping, readLayoutSourcePositions } from "./layout-field-mapping";
import { createTask09Draft, saveTask09Draft } from "./task09-draft-template.test-support";

const sourceSha = "ef9b75b39a487903d33bfc239f7c9754b8172ff1a1f6c6b6b3ba20178e098e5d";
const expectedVersion = "reviewed-generic-primary-roles-v1";
const lockSha = "95f5243446393e03e14472002835ac8607634982b1be420a012b2ea5a5adafab";
const title = "通用一级条款A2026合同";
const roleExpectations = [
  {"paragraphIndex": 27, "id": "67089b82ee8f3c6da3a1f876a8234c9f2e782df8f935c9fb6b334ac5db4a305d", "originalText": "第一条 业务内容", "fontFamily": "黑体", "fontSizePt": 14, "latinFamily": "Times New Roman", "latinSizePt": 14},
  {"paragraphIndex": 29, "id": "08ea54da480ec8176891ed1b631dfcd65ffa2b67d6f66eb38211fb90ad7e0a62", "originalText": "第二条 价款及结算", "fontFamily": "黑体", "fontSizePt": 14, "latinFamily": "Times New Roman", "latinSizePt": 14},
  {"paragraphIndex": 31, "id": "935aa8f8b6e9e47025251c001edf411d12234f02e881c0388569ba5dc03a9af4", "originalText": "第三条 付款条款", "fontFamily": "黑体", "fontSizePt": 14, "latinFamily": "Times New Roman", "latinSizePt": 14},
  {"paragraphIndex": 33, "id": "e5274f3269b37cc955d7eabbad7dcdb9d4585fb3c7d9f12b0fb6a8d88da995b8", "originalText": "第四条 特别约定", "fontFamily": "黑体", "fontSizePt": 14, "latinFamily": "Times New Roman", "latinSizePt": 14},
  {"paragraphIndex": 35, "id": "12f6a33727bd5b4cb679989d17d0d7de466bf3ce3dcbdcdfbdf5c50f6146bb4b", "originalText": "第五条 合同清单", "fontFamily": "黑体", "fontSizePt": 14, "latinFamily": "Times New Roman", "latinSizePt": 14}
] as const;
const titleControls = [
  {"paragraphIndex": 5, "id": "9746a6ed14ac6fea5d17b670c0a63fc4a1e1eb292b2a4fff89018b0064ba200e", "originalText": "{合同名称}"},
  {"paragraphIndex": 26, "id": "47a51f568907b470b8a31536fdd818d953a0a58c9c97095e26ca8233bf16e82a", "originalText": "通用合同"}
] as const;
const ordinaryControls = [
  {"paragraphIndex": 28, "id": "a68458b8bb2658aaffe03c6263e4b233f861912c8db3b8b2facc177b2f718ae0", "originalText": "{业务摘要}"},
  {"paragraphIndex": 30, "id": "85096cbbff9f9a9b5391c22e7b2fbd01f48dadde9967e1a1f4ef487a1bb680ad", "originalText": "合同金额为{合同金额大写}，结算周期为{结算周期}，付款比例为{付款比例}%。"},
  {"paragraphIndex": 32, "id": "bc5f416b751fa032875c85d84d4500140a190ed423b2312aac626a91a4335351", "originalText": "{付款条款}"},
  {"paragraphIndex": 34, "id": "dca22b0216c1b1a140f462c0585bf33131e586a5f963e0f5bd3a1830cdffc564", "originalText": "{特别约定}"},
  {"paragraphIndex": 52, "id": "f3185df482bbf40c5b438e954a68e6f22c4fa0dfd9aa389e85536eb501ac927d", "originalText": "签章页"}
] as const;
const additionId = "generic-manual-one";
const additionAnchorId = "e5274f3269b37cc955d7eabbad7dcdb9d4585fb3c7d9f12b0fb6a8d88da995b8";
const additionText = "双方人工补充通用合同约定应当保留。";
const addedBlockId = "added:generic-manual-one";
const explicitSourceBindings = [
  {"part": "word/document.xml", "paragraphIndex": 5, "originalText": "{合同名称}", "positionId": "9746a6ed14ac6fea5d17b670c0a63fc4a1e1eb292b2a4fff89018b0064ba200e", "start": 0, "end": 6, "fieldKey": "contract.name", "selectedText": "{合同名称}"},
  {"part": "word/document.xml", "paragraphIndex": 12, "originalText": "合同编号：{草稿编号}", "positionId": "8f7e8dbc37e9cb0e92110480b4efaad33e56ba064638b62483300f2f85bba1e6", "start": 5, "end": 11, "fieldKey": "contract.temporaryCode", "selectedText": "{草稿编号}"},
  {"part": "word/document.xml", "paragraphIndex": 13, "originalText": "甲方：建工智管建设有限公司", "positionId": "3e904de9feefa7721c443e6ae2fef631967fc45242e683f2d0abf2199cbf2eed", "start": 3, "end": 13, "fieldKey": "party.owner.name", "selectedText": "建工智管建设有限公司"},
  {"part": "word/document.xml", "paragraphIndex": 14, "originalText": "乙方：{相对方名称}", "positionId": "9076e077774561fbb6e4be17d301297f4c65a52d149dac249884ba4263b7f35b", "start": 3, "end": 10, "fieldKey": "party.counterparty.name", "selectedText": "{相对方名称}"},
  {"part": "word/document.xml", "paragraphIndex": 53, "originalText": "甲方（盖章）：建工智管建设有限公司", "positionId": "ed3161534e5f14358d18fa53359c07ed5829d42855fd49612135836c5bfc23cb", "start": 7, "end": 17, "fieldKey": "party.owner.name", "selectedText": "建工智管建设有限公司"},
  {"part": "word/document.xml", "paragraphIndex": 58, "originalText": "乙方（盖章）：{相对方名称}", "positionId": "8033dd005801a6eb1bb62de77687eb30ea001c3365708e5e28628184d410a395", "start": 7, "end": 14, "fieldKey": "party.counterparty.name", "selectedText": "{相对方名称}"},
  {"part": "word/header1.xml", "paragraphIndex": 0, "originalText": "{文档水印}", "positionId": "d07f43c254a03290e1fcbf340683df61f24a6e8dc3e17b89c89c87a0eaae8a30", "start": 0, "end": 6, "fieldKey": "document.watermark", "selectedText": "{文档水印}"}
] as const;
type PublicBody = Omit<Body, "blocks"> & { blocks: ContractBodyParagraph[]; flow: ContractBodyFlow[]; draftRevision: number; layoutTemplateVersionId: string; paragraphGroups: unknown };

describe("task10 fixed generic primary roles through public HTTP", () => {
  it("renders five independent generic source roles on legal save and freezes the server-selected version without changing ordinary facts", async () => {
    const repository = await task10HttpRepository(__dirname);
    const directory = await mkdtemp(join(tmpdir(), "jg-task10-generic-font-public-"));
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const sourcePath = join(repository, "services/api/assets/templates/generic-contract-v1.docx");
      const source = await readFile(sourcePath);
      expect(createHash("sha256").update(source).digest("hex")).toBe(sourceSha);
      expect(roleExpectations).toHaveLength(5);
      expect(new Set(roleExpectations.map(role => role.id)).size).toBe(5);
      const ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
      const sourceXml = new DOMParser().parseFromString(new PizZip(source).file("word/document.xml")!.asText(), "application/xml");
      const sourceParagraphs = Array.from(sourceXml.getElementsByTagNameNS(ns, "p"));
      const allAnchors = [...roleExpectations, ...titleControls, ...ordinaryControls].sort((a, b) => a.paragraphIndex - b.paragraphIndex);
      const sourceContext = allAnchors.map(anchor => {
        const paragraph = sourceParagraphs[anchor.paragraphIndex];
        const originalText = Array.from(paragraph.getElementsByTagNameNS(ns, "t")).map(node => node.textContent ?? "").join("");
        expect(originalText).toBe(anchor.originalText);
        expect(paragraph.parentNode?.nodeType).toBe(1);
        expect((paragraph.parentNode as Element).namespaceURI).toBe(ns);
        expect((paragraph.parentNode as Element).localName).toBe("body");
        expect(createHash("sha256").update(JSON.stringify([sourceSha, "word/document.xml", anchor.paragraphIndex, originalText])).digest("hex")).toBe(anchor.id);
        return { ...anchor, sourceQualified: true };
      });
      await writeFile(join(directory, "independent-source-context.json"), JSON.stringify({ sourceSha, roleExpectations, titleControls, ordinaryControls, sourceContext,
        latinNormativeMetadataOnly: true, publicLatinRunFieldsAvailable: false }, null, 2));
      // Same synthetic immutable published-layout fixture shape as confirmedBodyLayout;
      // only this source's explicit legal ranges differ, validated by the existing public mapping adapter.
      const parsedSource = readLayoutSourcePositions(source);
      expect(parsedSource.sourceSha256).toBe(sourceSha);
      for (const binding of explicitSourceBindings) {
        const matches = parsedSource.positions.filter(position => position.positionId === binding.positionId);
        expect(matches).toHaveLength(1);
        expect(matches[0]).toMatchObject({ part: binding.part, paragraphIndex: binding.paragraphIndex, text: binding.originalText });
        expect(matches[0].text.slice(binding.start, binding.end)).toBe(binding.selectedText);
      }
      const file = await server.files.uploadPrivateFile({ originalName: "通用字体确认样张.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sizeBytes: source.length, buffer: source, uploadedByUserId: "director" });
      const { mapping } = prepareLayoutSourceMapping(source, file.id, 1, explicitSourceBindings.map(({ positionId, start, end, fieldKey }) => ({ positionId, start, end, fieldKey })));
      expect(mapping.sourceSha256).toBe(sourceSha);
      expect(mapping.bindings).toHaveLength(7);
      expect(mapping.bindings.filter(binding => binding.fieldKey === "party.owner.name")).toHaveLength(2);
      expect(mapping.bindings.filter(binding => binding.fieldKey === "party.counterparty.name")).toHaveLength(2);
      const templateId = randomUUID(), layout = { id: randomUUID() };
      await server.store.prisma.contractLayoutTemplate.create({ data: { id: templateId, name: "通用字体确认样张", contractTypeKey: "other" } });
      await server.store.prisma.contractLayoutTemplateVersion.create({ data: { id: layout.id, layoutTemplateId: templateId, versionNo: 1, status: "published", draftRevision: 1, docxFileId: file.id, publishedAt: new Date(), publishedByUserId: "director", previewPdfFileId: "synthetic-confirmed-preview", placeholderSchema: { bills: [{ key: "genericItems" }], sourceMapping: { ...mapping, confirmation: { sourceFileId: file.id, sourceSha256: mapping.sourceSha256, draftRevision: 1, mappingFingerprint: mapping.fingerprint, previewJobId: "synthetic-confirmation-job", previewPdfFileId: "synthetic-confirmed-preview" } } }, inspectionReport: { status: "passed", requiredKeys: [] } } });
      await writeFile(join(directory, "explicit-mapping-qualification.json"), JSON.stringify({ sourceSha, explicitSourceBindings, mapping, immutableOriginalSourceKept: true, fixtureUsesExistingConfirmedShapeNotPublicationAcceptance: true }, null, 2));
      const draft = await createTask09Draft(server);
      expect((await saveTask09Draft(server, draft, "other", layout.id)).status).toBe(200);
      const setupResponse = await fetch(draft.base + "/workbench", { headers: draft.headers });
      expect(setupResponse.status).toBe(200);
      const setup = await setupResponse.json();
      expect(setup.bills.map((bill: { billKey: string }) => bill.billKey)).toEqual(["main"]);
      // Independent worked literals: gross/net100+200+300=600; all tax0.
      const rows = [1, 2, 3].map(i => ({ clientRowKey: "generic-font-00" + i, sortOrder: i - 1,
        itemName: "通用项目00" + i, specification: "G-00" + i, unit: "项", quantity: String(i), unitPrice: "100.0000", taxRatePercent: "0", customData: {} }));
      const setupData: Record<string, unknown> = { ...setup.version.draftData, contractName: title,
        contractBasics: { businessType: "other", relationship: "upward", amountBasis: "tax_inclusive", invoiceStatus: "pending" } };
      delete setupData.documentRenderProfile;
      const factInput = {
        idempotencyKey: randomUUID(), saveKind: "manual", expectedRevision: setup.version.draftRevision, changedSections: ["draft", "parties", "bills"],
        draft: { numericProtocolVersion: 2, draftData: setupData, clauses: [], pricingNature: "unit_price", amountSource: "bill_sum", layoutTemplateVersionId: layout.id,
          taxFacts: { invoiceType: null, taxMode: "single_rate", defaultTaxRatePercent: "0", source: "contract_document" } },
        parties: [{ roleKey: "party_a", displayOrder: 0, snapshot: { name: "当前单甲方" } }, { roleKey: "party_b", displayOrder: 0, snapshot: { name: "当前单乙方" } }],
        bills: setup.bills.map((bill: { billKey: string; revision: number }) => ({ billKey: bill.billKey, expectedRevision: bill.revision, numericProtocolVersion: 2, rows })),
        paymentTerms: null, attachments: [], negotiationDocuments: { referencedGeneratedDocumentIds: [] }
      };
      const factResponse = await fetch(draft.base, { method: "PUT", headers: { ...draft.headers, "x-contract-draft-lease": draft.leaseToken }, body: JSON.stringify(factInput) });
      const factText = await factResponse.text();
      await writeFile(join(directory, "public-fact-save.json"), JSON.stringify({ input: factInput, status: factResponse.status, body: factText }, null, 2));
      expect(factResponse.status === 200 ? "OK" : factText).toBe("OK");
      const currentResponse = await fetch(draft.base + "/workbench", { headers: draft.headers });
      expect(currentResponse.status).toBe(200);
      const current = await currentResponse.json();
      const beforeResponse = await fetch(draft.base + "/document-body", { headers: draft.headers });
      expect(beforeResponse.status).toBe(200);
      const before = await beforeResponse.json() as PublicBody;
      expect(before).toMatchObject({ sourceSha256: sourceSha, layoutTemplateVersionId: layout.id });
      const beforeOrder = before.flow.filter((node): node is Extract<ContractBodyFlow, { kind: "paragraph" }> => node.kind === "paragraph").map(node => node.paragraphId);
      for (const role of roleExpectations) {
        expect(beforeOrder.filter(id => id === role.id)).toHaveLength(1);
        expect(before.blocks.find(block => block.id === role.id)).toMatchObject({ text: role.originalText });
      }
      expect(roleExpectations.map(role => beforeOrder.indexOf(role.id))).toEqual(roleExpectations.map(role => beforeOrder.indexOf(role.id)).slice().sort((a, b) => a - b));
      for (const control of [...titleControls, ...ordinaryControls]) expect(before.blocks.filter(block => block.id === control.id)).toHaveLength(1);
      expect(before.blocks.find(block => block.id === titleControls[0].id)?.text).toBe(title);
      expect(before.blocks.find(block => block.id === titleControls[1].id)?.text).toBe("通用合同");
      expect(before.blocks.find(block => block.id === "f3185df482bbf40c5b438e954a68e6f22c4fa0dfd9aa389e85536eb501ac927d")?.text).toBe("签章页");
      // Existing addition protocol: only a real public, editable top-level source paragraph is used as anchor.
      expect(before.blocks.find(block => block.id === additionAnchorId)).toMatchObject({ text: "第四条 特别约定", editable: true });
      const draftData: Record<string, unknown> = { ...current.version.draftData,
        documentBody: { protocolVersion: 1, layoutTemplateVersionId: layout.id, sourceSha256: sourceSha, edits: [],
          additions: [{ id: additionId, afterPositionId: additionAnchorId, text: additionText }] } };
      delete draftData.documentRenderProfile;
      const input = { ...factInput, idempotencyKey: randomUUID(), expectedRevision: current.version.draftRevision,
        draft: { ...factInput.draft, draftData },
        bills: current.bills.map((bill: { billKey: string; revision: number }) => ({ billKey: bill.billKey, expectedRevision: bill.revision, numericProtocolVersion: 2, rows })) };
      expect(Object.hasOwn(input.draft.draftData, "documentRenderProfile")).toBe(false);
      await writeFile(join(directory, "public-save-without-profile.json"), JSON.stringify(input, null, 2));
      const savedResponse = await fetch(draft.base, { method: "PUT", headers: { ...draft.headers, "x-contract-draft-lease": draft.leaseToken }, body: JSON.stringify(input) });
      const savedText = await savedResponse.text();
      await writeFile(join(directory, "public-save-response.json"), JSON.stringify({ status: savedResponse.status, body: savedText }, null, 2));
      expect(savedResponse.status === 200 ? "OK" : savedText).toBe("OK");
      const wbResponse = await fetch(draft.base + "/workbench", { headers: draft.headers });
      expect(wbResponse.status).toBe(200);
      const wb = await wbResponse.json();
      const bodyResponse = await fetch(draft.base + "/document-body", { headers: draft.headers });
      expect(bodyResponse.status).toBe(200);
      const body = await bodyResponse.json() as PublicBody;
      await writeFile(join(directory, "public-observation.json"), JSON.stringify({ current, before, wb, body, sourceContext, roleExpectations, titleControls, ordinaryControls,
        finalSaveStatus: savedResponse.status, tracedSaveHasProfile: false, exportOrNativeRequested: false }, null, 2));
      // Qualify source IDs/text and legal business facts before the first font assertion.
      expect(wb.version).toMatchObject({ numericProtocolVersion: 2, amountYuan: "600.0000", layoutTemplateVersionId: layout.id,
        taxFacts: { taxMode: "single_rate", defaultTaxRatePercent: "0" }, draftData: { contractBasics: factInput.draft.draftData.contractBasics } });
      expect(wb.bills).toHaveLength(1);
      expect(wb.bills[0]).toMatchObject({ billKey: "main", pricingMode: "tax_inclusive", taxInclusiveAmountYuan: "600.0000", taxExclusiveAmountYuan: "600.0000", taxAmountYuan: "0.0000" });
      expect(wb.contract.contractTypeKey).toBe("material_purchase"); // Parent classification stays original; current valid business is other.
      expect(wb.bills[0].rows).toHaveLength(3);
      for (const [i, amount] of ["100.0000", "200.0000", "300.0000"].entries()) expect(wb.bills[0].rows[i]).toMatchObject({
        itemName: "通用项目00" + (i + 1), specification: "G-00" + (i + 1), unit: "项", quantity: String(i + 1), taxRatePercent: "0",
        taxInclusiveAmountYuan: amount, taxExclusiveAmountYuan: amount, taxAmountYuan: "0.0000"
      });
      const tables = body.flow.filter((node): node is Extract<ContractBodyFlow, { kind: "table" }> => node.kind === "table");
      expect(tables.map(table => [table.rows.length, table.columns.length])).toEqual([[4, 7], [1, 2]]);
      for (const [i, amount] of ["100.0000", "200.0000", "300.0000"].entries()) expect(tables[0].rows[i + 1].cells.map(cell => cell.paragraphIds.map(id => body.blocks.find(block => block.id === id)?.text ?? "").join(""))).toEqual([
        "通用项目00" + (i + 1), "G-00" + (i + 1), "项", String(i + 1), "100", amount, ""
      ]);
      const afterOrder = body.flow.filter((node): node is Extract<ContractBodyFlow, { kind: "paragraph" }> => node.kind === "paragraph").map(node => node.paragraphId);
      for (const role of roleExpectations) {
        expect(afterOrder.filter(id => id === role.id)).toHaveLength(1);
        expect(body.blocks.find(block => block.id === role.id)).toMatchObject({ text: role.originalText });
      }
      expect(roleExpectations.map(role => afterOrder.indexOf(role.id))).toEqual(roleExpectations.map(role => afterOrder.indexOf(role.id)).slice().sort((a, b) => a - b));
      await writeFile(join(directory, "pre-font-qualified-public-facts.json"), JSON.stringify({ legalSaveStatus: savedResponse.status, sourceSha, all5OriginalSourceIdsAndFullTextQualified: true,
        firstTarget: roleExpectations[0], workbench: wb, body, independentGrossNetTax: ["600.0000", "600.0000", "0.0000"] }, null, 2));
      // Sole first intended business RED: current public p27 font, never an undefined version stamp.
      expect(body.blocks.find(block => block.id === "67089b82ee8f3c6da3a1f876a8234c9f2e782df8f935c9fb6b334ac5db4a305d")!.format).toMatchObject({ fontFamily: "黑体", fontSizePt: 14 });
      for (const role of roleExpectations) expect(body.blocks.find(block => block.id === role.id)).toMatchObject({ id: role.id, text: role.originalText, format: { fontFamily: role.fontFamily, fontSizePt: role.fontSizePt } });
      for (const control of titleControls) expect(body.blocks.find(block => block.id === control.id)).toMatchObject({ text: control.paragraphIndex === 5 ? title : "通用合同", format: { fontFamily: "方正小标宋简体", fontSizePt: 22, align: "center" } });
      for (const control of ordinaryControls) expect(body.blocks.find(block => block.id === control.id)).toEqual(before.blocks.find(block => block.id === control.id));
      expect(body.blocks.find(block => block.id === "f3185df482bbf40c5b438e954a68e6f22c4fa0dfd9aa389e85536eb501ac927d")).toMatchObject({ text: "签章页", format: { fontFamily: "方正小标宋简体", fontSizePt: 22, align: "center" } });
      expect(body.blocks.filter(block => block.id === addedBlockId)).toHaveLength(1);
      expect(body.blocks.find(block => block.id === addedBlockId)).toMatchObject({ text: "补充条款1：双方人工补充通用合同约定应当保留。", editable: true, format: { fontFamily: "仿宋_GB2312", fontSizePt: 14 } });
      expect(afterOrder.indexOf(addedBlockId)).toBe(afterOrder.indexOf(additionAnchorId) + 1);
      for (const role of roleExpectations) {
        const oldFormat = { ...before.blocks.find(block => block.id === role.id)!.format };
        const newFormat = { ...body.blocks.find(block => block.id === role.id)!.format };
        delete oldFormat.fontFamily; delete oldFormat.fontSizePt; delete newFormat.fontFamily; delete newFormat.fontSizePt;
        expect(newFormat).toEqual(oldFormat);
      }
      // Only after all normative formatting targets may the new server-owned stamp be required.
      expect(wb.version.draftData.documentRenderProfile).toEqual({ typographyVersion: expectedVersion });
      expect(body).toMatchObject({ sourceSha256: sourceSha, layoutTemplateVersionId: layout.id, draftRevision: wb.version.draftRevision, documentContentRevision: wb.version.documentContentRevision });
      expect(wb.version.draftRevision).toBe(current.version.draftRevision + 1);
      expect(wb.version.documentContentRevision).toBe(current.version.documentContentRevision + 1);
      expect(wb.version.documentContentFingerprint).toMatch(/^[a-f0-9]{64}$/u);
      expect(wb.version.documentContentFingerprint).not.toBe(current.version.documentContentFingerprint);
      // One source-less readonly separator has an ordinal ID, not a persistent source position.
      // Qualify that exact bill-table -> separator -> source signature-label slot; never omit generated blocks.
      const signatureLabelId = "f3185df482bbf40c5b438e954a68e6f22c4fa0dfd9aa389e85536eb501ac927d";
      const qualifySeparator = (snapshot: PublicBody) => {
        const generated = snapshot.blocks.filter(block => block.id.startsWith("generated:"));
        expect(generated).toHaveLength(1);
        const signatureIndices = snapshot.flow.flatMap((node, index) => node.kind === "paragraph" && node.paragraphId === signatureLabelId ? [index] : []);
        expect(signatureIndices).toHaveLength(1);
        const signatureIndex = signatureIndices[0];
        expect(signatureIndex).toBeGreaterThan(1);
        const separatorNode = snapshot.flow[signatureIndex - 1], billTable = snapshot.flow[signatureIndex - 2];
        if (!separatorNode || separatorNode.kind !== "paragraph" || !billTable || billTable.kind !== "table") throw new Error("清单与签章页之间的只读分隔段资格不符");
        const separator = generated[0];
        expect(separator.id).toMatch(/^generated:\d+$/u);
        expect(separatorNode.paragraphId).toBe(separator.id);
        expect(snapshot.flow.filter(node => node.kind === "paragraph" && node.paragraphId === separator.id)).toHaveLength(1);
        expect(JSON.stringify(snapshot.flow).split(JSON.stringify(separator.id)).length - 1).toBe(1);
        expect(separator).toEqual({ id: separator.id, kind: "paragraph", text: "", editable: false,
          format: { align: "justify", fontFamily: "仿宋_GB2312", fontSizePt: 14 }, blankFields: [] });
        expect([billTable.rows.length, billTable.columns.length]).toEqual([4, 7]);
        return { separator, billTable, signatureNode: snapshot.flow[signatureIndex] };
      };
      const beforeSeparator = qualifySeparator(before), afterSeparator = qualifySeparator(body);
      expect(afterSeparator.billTable).toEqual(beforeSeparator.billTable);
      expect(afterSeparator.billTable).toEqual(tables[0]);
      expect(afterSeparator.signatureNode).toEqual(beforeSeparator.signatureNode);
      expect({ ...afterSeparator.separator, id: beforeSeparator.separator.id }).toEqual(beforeSeparator.separator);
      expect(before.blocks.filter(block => block.id === afterSeparator.separator.id && block.id !== beforeSeparator.separator.id)).toHaveLength(0);
      expect(body.blocks.filter(block => block.id === beforeSeparator.separator.id && block.id !== afterSeparator.separator.id)).toHaveLength(0);
      await writeFile(join(directory, "qualified-separator-alias.json"), JSON.stringify({ before: beforeSeparator, after: afterSeparator,
        scope: "Only one fully qualified source-less readonly empty separator across content revisions; source and addition IDs remain exact." }, null, 2));
      const aliasedBeforeBlocks = before.blocks.map(block => block.id === beforeSeparator.separator.id ? { ...block, id: afterSeparator.separator.id } : block);
      const aliasedBeforeFlow = before.flow.map<ContractBodyFlow>(node => node.kind === "paragraph" && node.paragraphId === beforeSeparator.separator.id ? { ...node, paragraphId: afterSeparator.separator.id } : node);
      expect(body.blocks.filter(block => block.id !== addedBlockId).map(block => block.id)).toEqual(aliasedBeforeBlocks.map(block => block.id));
      expect(body.blocks.filter(block => block.id !== addedBlockId).map(block => [block.id, block.editable, block.text])).toEqual(aliasedBeforeBlocks.map(block => [block.id, block.editable, block.text]));
      const expectedFlow = aliasedBeforeFlow.flatMap<ContractBodyFlow>(node => node.kind === "paragraph" && node.paragraphId === additionAnchorId ? [node, { kind: "paragraph" as const, paragraphId: addedBlockId }] : [node]);
      expect(body.flow).toEqual(expectedFlow);
      expect(body.paragraphGroups).toEqual(before.paragraphGroups);
      const roleIds = new Set<string>(roleExpectations.map(role => role.id));
      expect(body.blocks.filter(block => block.id !== addedBlockId && !roleIds.has(block.id)).map(block => [block.id, block.format])).toEqual(aliasedBeforeBlocks.filter(block => !roleIds.has(block.id)).map(block => [block.id, block.format]));
      expect(createHash("sha256").update(await readFile(join(repository, "services/api/assets/document-converter/runtime-lock.json"))).digest("hex")).toBe(lockSha);
      const queueResponse = await fetch(draft.base + "/preview-generation", { method: "POST", headers: draft.headers, body: JSON.stringify({ sourceRevision: body.draftRevision }) });
      const queueText = await queueResponse.text();
      await writeFile(join(directory, "public-queue-response.json"), JSON.stringify({ status: queueResponse.status, body: queueText }, null, 2));
      expect(queueResponse.status === 201 ? "OK" : queueText).toBe("OK");
      const generation = JSON.parse(queueText);
      expect(generation).toMatchObject({ status: "queued", sourceRevision: body.draftRevision, documentContentRevision: wb.version.documentContentRevision, documentContentFingerprint: wb.version.documentContentFingerprint });
      const documentsUrl = `${await server.app.getUrl()}/contract-workbench/${draft.version.id}/documents`;
      const listResponse = await fetch(documentsUrl, { headers: draft.headers });
      expect(listResponse.status).toBe(200);
      const documents = await listResponse.json();
      await writeFile(join(directory, "public-documents.json"), JSON.stringify(documents, null, 2));
      const queued = documents.find((row: { id: string }) => row.id === generation.generationId);
      expect(queued).toBeDefined();
      expect(queued).toMatchObject({ status: "queued", layoutTemplateVersionId: layout.id, documentContentRevision: wb.version.documentContentRevision, documentContentFingerprint: wb.version.documentContentFingerprint,
        inputSnapshot: { documentContentRevision: wb.version.documentContentRevision, documentContentFingerprint: wb.version.documentContentFingerprint,
          bodyDocument: { protocolVersion: 1, sourceSha256: sourceSha, layoutTemplateVersionId: layout.id, typographyVersion: expectedVersion, renderSemanticVersion: "contract-money-v1", tableLayoutVersion: "body-bill-loop-v2" },
          renderInput: { values: { "contract.typographyVersion": expectedVersion, "contract.renderSemanticVersion": "contract-money-v1", "contract.tableLayoutVersion": "body-bill-loop-v2" } } } });
      expect(queued.inputSnapshot.renderInput.values["bill.genericItems"]).toHaveLength(3);
      expect(queued.inputSnapshot.renderInput.values["bill.genericItems"].map((row: { itemName: string; quantity: string; taxInclusiveAmount: string }) => [row.itemName, row.quantity, row.taxInclusiveAmount])).toEqual([
        ["通用项目001", "1", "100.0000"], ["通用项目002", "2", "200.0000"], ["通用项目003", "3", "300.0000"]
      ]);
      expect(Object.hasOwn(queued.inputSnapshot.renderInput.values, "contract.reviewedLaborTaxBindingVersion")).toBe(false);
      expect(Object.hasOwn(queued.inputSnapshot.bodyDocument, "typographyVersion")).toBe(true);
      expect(Object.hasOwn(queued.inputSnapshot.renderInput.values, "contract.typographyVersion")).toBe(true);
      const keyTuple = [draft.version.id, wb.version.documentContentRevision, wb.version.documentContentFingerprint, layout.id, "draft", [], "contract-body-docx4j-v1", lockSha, "contract-money-v1", "body-bill-loop-v2", expectedVersion];
      const expectedKey = createHash("sha256").update(JSON.stringify(keyTuple)).digest("hex");
      expect(queued.idempotencyKey).toBe(expectedKey);
      await writeFile(join(directory, "public-queued-key.json"), JSON.stringify({ keyTuple, expectedKey, queued }, null, 2));
      const stableBodyResponse = await fetch(draft.base + "/document-body", { headers: draft.headers });
      expect(stableBodyResponse.status).toBe(200);
      expect(await stableBodyResponse.json()).toEqual(body);
      const afterResponse = await fetch(draft.base + "/workbench", { headers: draft.headers });
      expect(afterResponse.status).toBe(200);
      const after = await afterResponse.json();
      const stableListResponse = await fetch(documentsUrl, { headers: draft.headers });
      expect(stableListResponse.status).toBe(200);
      const stableDocuments = await stableListResponse.json();
      expect(stableDocuments.find((row: { id: string }) => row.id === generation.generationId)).toEqual(queued);
      expect(after.version).toMatchObject({ draftRevision: wb.version.draftRevision, documentContentRevision: wb.version.documentContentRevision, documentContentFingerprint: wb.version.documentContentFingerprint, amountYuan: "600.0000" });
      expect(after.version.draftData).toEqual(wb.version.draftData);
      expect(after.bills).toEqual(wb.bills);
      expect(createHash("sha256").update(await readFile(sourcePath)).digest("hex")).toBe(sourceSha);
      await writeFile(join(directory, "verified-receipt.json"), JSON.stringify({ verdict: "PUBLIC_GENERIC_5_ROLES_AND_FROZEN_SERVER_TYPOGRAPHY_GREEN", sourceSha, generation,
        keyTuple, expectedKey, documentContentRevision: wb.version.documentContentRevision, documentContentFingerprint: wb.version.documentContentFingerprint,
        profile: { typographyVersion: expectedVersion }, amountGrossNetTax: ["600.0000", "600.0000", "0.0000"], finalPublicWorkbench: after,
        processNextOrNativeRequested: false, latinRunFontAndPhysicalWordPdfNotProven: true }, null, 2));
      console.info("通用5角色公开证据：" + directory);
    } catch (cause) {
      await writeFile(join(directory, "failure.txt"), String(cause));
      throw new Error("通用5角色公开核对失败，证据 " + directory, { cause });
    } finally {
      let processorStopped = false, appClosed = false;
      try { await server.processor.onApplicationShutdown(); processorStopped = true; }
      finally { try { await server.app.close(); appClosed = true; } finally { await writeFile(join(directory, "cleanup-receipt.json"), JSON.stringify({ processorStopped, appClosed, ownedOperationSettled: true }, null, 2)); } }
    }
  }, 30_000);
});
