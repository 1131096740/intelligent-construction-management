// One closed mechanical source-role public HTTP tracer; independent literal expectations.
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
import { confirmedBodyLayout, type Body } from "./task10-body.test-support";
import { createTask09Draft, saveTask09Draft } from "./task09-draft-template.test-support";

const sourceSha = "b846a2f93a3f118581a58fe137b9a74c0433a7faa271eed1569068da6d5cef89";
const expectedVersion = "reviewed-mechanical-primary-secondary-roles-v1";
const lockSha = "95f5243446393e03e14472002835ac8607634982b1be420a012b2ea5a5adafab";
const title = "机械主次条款A2026合同";
const roleExpectations = [
  {"paragraphIndex": 31, "id": "f9107b6301d17d122b98d12829efdf5386e93f1fec03943739af80900acff5d4", "originalText": "第一条  租赁机械设备名称、规格型号、数量及金额", "fontFamily": "黑体", "fontSizePt": 14, "latinFamily": "Times New Roman", "latinSizePt": 14},
  {"paragraphIndex": 54, "id": "86d314a4f9e34ad25c76840fbe3939ec0074f590230275ec68deddc82c8d65c6", "originalText": "第二条  合同期限", "fontFamily": "黑体", "fontSizePt": 14, "latinFamily": "Times New Roman", "latinSizePt": 14},
  {"paragraphIndex": 56, "id": "4449c493564d28170aebaac4d3cc771ecf4b0d72621b02da1cb30b5b1b6ed7a7", "originalText": "2.具体设备租赁期限的计算", "fontFamily": "楷体_GB2312", "fontSizePt": 14, "latinFamily": "Times New Roman", "latinSizePt": 14},
  {"paragraphIndex": 61, "id": "813509044676597fb723ae8e7357dac08f021c2fdd5e5f7a55b01805fb01862c", "originalText": "第三条  机械设备进出场交接与验收", "fontFamily": "黑体", "fontSizePt": 14, "latinFamily": "Times New Roman", "latinSizePt": 14},
  {"paragraphIndex": 68, "id": "ac06fbd385147ed2afae2ecfe88058c4c12c45ed1fbca5a16de6b3ddc5a105c7", "originalText": "第四条  租金及对账结算方式", "fontFamily": "黑体", "fontSizePt": 14, "latinFamily": "Times New Roman", "latinSizePt": 14},
  {"paragraphIndex": 89, "id": "4e85b82638e7dd7442754215be67c564d7bcad81f321f18b518e8706b3ecc58e", "originalText": "第五条  发票有关事项", "fontFamily": "黑体", "fontSizePt": 14, "latinFamily": "Times New Roman", "latinSizePt": 14},
  {"paragraphIndex": 92, "id": "16ff51af4b144df540844176ad48f4aea1e06ed9aebbf507fa8fe06ef8373fbb", "originalText": "2.甲乙双方开票信息", "fontFamily": "楷体_GB2312", "fontSizePt": 14, "latinFamily": "Times New Roman", "latinSizePt": 14},
  {"paragraphIndex": 109, "id": "7f477fa87eb18d3c9bab6e313be451389bd7e19049b403b34f36d35963b0e427", "originalText": "3.增值税发票开具时间和类型的要求：", "fontFamily": "楷体_GB2312", "fontSizePt": 14, "latinFamily": "Times New Roman", "latinSizePt": 14},
  {"paragraphIndex": 121, "id": "c042e59248c1f302ec460b871d7bcc0f25324a0af88669d62a4a9e331b230e99", "originalText": "第六条  支付", "fontFamily": "黑体", "fontSizePt": 14, "latinFamily": "Times New Roman", "latinSizePt": 14},
  {"paragraphIndex": 128, "id": "8e5bb377a1e3cec95ab62d941f22efda0069874a4dca118f17302414dd7fb5b9", "originalText": "第七条  双方权利义务", "fontFamily": "黑体", "fontSizePt": 14, "latinFamily": "Times New Roman", "latinSizePt": 14},
  {"paragraphIndex": 145, "id": "21801ba254f09589258e22a7e79f2bc9d5f04b6f50bdc73c0f0688973a0ec934", "originalText": "第八条  违约责任", "fontFamily": "黑体", "fontSizePt": 14, "latinFamily": "Times New Roman", "latinSizePt": 14},
  {"paragraphIndex": 160, "id": "5cb5a320f36340e15d8c2cf630aab69a65cd0d6abbb6be4787106abc65bbfa50", "originalText": "第九条  保密", "fontFamily": "黑体", "fontSizePt": 14, "latinFamily": "Times New Roman", "latinSizePt": 14},
  {"paragraphIndex": 162, "id": "cb5d1f5ccb347f7bfd08be380763c01f307a95ddc7b8103f09cf0d9d4aba43cc", "originalText": "第十条  不可抗力", "fontFamily": "黑体", "fontSizePt": 14, "latinFamily": "Times New Roman", "latinSizePt": 14},
  {"paragraphIndex": 165, "id": "22a4a1a16b8b7b2fd153598eb544d881d7f64ad42f577aca14b8b5774890db53", "originalText": "第十一条  争议的解决", "fontFamily": "黑体", "fontSizePt": 14, "latinFamily": "Times New Roman", "latinSizePt": 14},
  {"paragraphIndex": 167, "id": "c5fc94628a78370da09383aa2b4391b2f816c7e479afcce2e6fcd3bc16f43ccc", "originalText": "第十二条  合同生效、合同的终止与解除", "fontFamily": "黑体", "fontSizePt": 14, "latinFamily": "Times New Roman", "latinSizePt": 14},
  {"paragraphIndex": 173, "id": "76a1a804213c721a7060a9bf6532b0caa61e02b7839a0129cc1388ede86519e2", "originalText": "第十三条  其他", "fontFamily": "黑体", "fontSizePt": 14, "latinFamily": "Times New Roman", "latinSizePt": 14}
] as const;
const titleControls = [
  {"paragraphIndex": 5, "id": "da073e3f72746be7b95298f1594eaedebc92cdd4e1dbad46fc73d2931521fd3e", "originalText": "{合同名称}"},
  {"paragraphIndex": 26, "id": "3d174053a7c524ba9716b6916362904c1f595ed6d4f8ad298babd15103243e30", "originalText": "{合同名称}"}
] as const;
const ordinaryControls = [
  {"paragraphIndex": 52, "id": "1b8aa65a7d1d9cc8a447a00b08d0e8729437f1067e41b26057cb8659bc1fa179", "originalText": "2.本合同租赁数量、合同总价均为暂估，最终按甲方实际租赁使用并经双方签字确认的结算数据为准。乙方自愿承担合同签订量未发生部分的风险，乙方不得以任何形式要求甲方承担合同签订量未发生部分的费用或损失。"},
  {"paragraphIndex": 116, "id": "973595d2ec2ae3a8d9e4f2638a6d38a00aa1b9f7892c936cddf42054749456e8", "originalText": "4.增值税专用发票丢失的补救措施：若甲方今后发生丢失增值税专用发票发票联或抵扣联的情况,则乙方必须向甲方提供该增值税专用发票记账联复印件等资料。 "}
] as const;
const ordinary = {"paragraphIndex": 30, "id": "e1d8e9935847b24feb9e8062d50aa7001859cec29186dae615a82bf800acac87", "originalText": "甲方因工程施工需要租赁乙方的机械设备，根据《中华人民共和国民法典》及相关法律法规，为明确双方的权利和义务，经双方协商，特订立本合同，以便共同遵守。"} as const;
type PublicBody = Omit<Body, "blocks"> & { blocks: ContractBodyParagraph[]; flow: ContractBodyFlow[]; draftRevision: number; layoutTemplateVersionId: string; paragraphGroups: unknown };

describe("task10 fixed mechanical primary and secondary roles through public HTTP", () => {
  it("renders sixteen independent mechanical source roles on legal save and freezes the server-selected version without changing ordinary facts", async () => {
    const repository = await task10HttpRepository(__dirname);
    const directory = await mkdtemp(join(tmpdir(), "jg-task10-mechanical-font-public-"));
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const sourcePath = join(repository, "services/api/assets/templates/equipment-rental-real-v1.docx");
      const source = await readFile(sourcePath);
      expect(createHash("sha256").update(source).digest("hex")).toBe(sourceSha);
      expect(roleExpectations).toHaveLength(16);
      expect(new Set(roleExpectations.map(role => role.id)).size).toBe(16);
      const ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
      const sourceXml = new DOMParser().parseFromString(new PizZip(source).file("word/document.xml")!.asText(), "application/xml");
      const sourceParagraphs = Array.from(sourceXml.getElementsByTagNameNS(ns, "p"));
      const allAnchors = [...roleExpectations, ...titleControls, ...ordinaryControls, ordinary].sort((a, b) => a.paragraphIndex - b.paragraphIndex);
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
      await writeFile(join(directory, "independent-source-context.json"), JSON.stringify({ sourceSha, roleExpectations, titleControls, ordinaryControls, ordinary, sourceContext,
        latinNormativeMetadataOnly: true, publicLatinRunFieldsAvailable: false }, null, 2));
      const layout = await confirmedBodyLayout(server, source, "equipmentRentals", "equipment_rental");
      const draft = await createTask09Draft(server);
      expect((await saveTask09Draft(server, draft, "equipment_rental", layout.id)).status).toBe(200);
      const setupResponse = await fetch(draft.base + "/workbench", { headers: draft.headers });
      expect(setupResponse.status).toBe(200);
      const setup = await setupResponse.json();
      expect(setup.bills.map((bill: { billKey: string }) => bill.billKey)).toEqual(["main"]);
      // One hour at gross11, 10%: independent exact net10/tax1. No material label/column assumptions.
      const rows = [{ clientRowKey: "mechanical-font-one-hour", sortOrder: 0, itemName: "正文清单机械", specification: "M-001", unit: "小时", quantity: "1", unitPrice: "11.0000", taxRatePercent: "10", customData: {} }];
      const setupData: Record<string, unknown> = { ...setup.version.draftData, contractName: title,
        contractBasics: { businessType: "equipment_rental", relationship: "upward", amountBasis: "tax_inclusive", invoiceStatus: "pending" } };
      delete setupData.documentRenderProfile;
      const factInput = {
        idempotencyKey: randomUUID(), saveKind: "manual", expectedRevision: setup.version.draftRevision, changedSections: ["draft", "parties", "bills"],
        draft: { numericProtocolVersion: 2, draftData: setupData, clauses: [], pricingNature: "unit_price", amountSource: "bill_sum", layoutTemplateVersionId: layout.id,
          taxFacts: { invoiceType: null, taxMode: "single_rate", defaultTaxRatePercent: "10", source: "contract_document" } },
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
      expect(before.blocks.find(block => block.id === ordinary.id)).toMatchObject({ text: ordinary.originalText, editable: true });
      const manualText = ordinary.originalText + "双方人工补充机械租赁约定应当保留。";
      const draftData: Record<string, unknown> = { ...current.version.draftData,
        documentBody: { protocolVersion: 1, layoutTemplateVersionId: layout.id, sourceSha256: sourceSha, edits: [{ positionId: ordinary.id, text: manualText }] } };
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
      expect(wb.version).toMatchObject({ numericProtocolVersion: 2, amountYuan: "11.0000", layoutTemplateVersionId: layout.id,
        taxFacts: { taxMode: "single_rate", defaultTaxRatePercent: "10" }, draftData: { contractBasics: factInput.draft.draftData.contractBasics } });
      expect(wb.bills).toHaveLength(1);
      expect(wb.bills[0]).toMatchObject({ billKey: "main", pricingMode: "tax_inclusive", taxInclusiveAmountYuan: "11.0000", taxExclusiveAmountYuan: "10.0000", taxAmountYuan: "1.0000" });
      expect(wb.bills[0].rows).toHaveLength(1);
      expect(wb.bills[0].rows[0]).toMatchObject({ itemName: "正文清单机械", specification: "M-001", unit: "小时", quantity: "1", taxRatePercent: "10",
        taxInclusiveAmountYuan: "11.0000", taxExclusiveAmountYuan: "10.0000", taxAmountYuan: "1.0000" });
      const afterOrder = body.flow.filter((node): node is Extract<ContractBodyFlow, { kind: "paragraph" }> => node.kind === "paragraph").map(node => node.paragraphId);
      for (const role of roleExpectations) {
        expect(afterOrder.filter(id => id === role.id)).toHaveLength(1);
        expect(body.blocks.find(block => block.id === role.id)).toMatchObject({ text: role.originalText });
      }
      expect(roleExpectations.map(role => afterOrder.indexOf(role.id))).toEqual(roleExpectations.map(role => afterOrder.indexOf(role.id)).slice().sort((a, b) => a - b));
      await writeFile(join(directory, "pre-font-qualified-public-facts.json"), JSON.stringify({ legalSaveStatus: savedResponse.status, sourceSha, all16OriginalSourceIdsAndFullTextQualified: true,
        firstTarget: roleExpectations[0], workbench: wb, body, independentGrossNetTax: ["11.0000", "10.0000", "1.0000"] }, null, 2));
      // Sole first intended business RED: current public p31 font, never an undefined version stamp.
      expect(body.blocks.find(block => block.id === "f9107b6301d17d122b98d12829efdf5386e93f1fec03943739af80900acff5d4")!.format).toMatchObject({ fontFamily: "黑体", fontSizePt: 14 });
      for (const role of roleExpectations) expect(body.blocks.find(block => block.id === role.id)).toMatchObject({ id: role.id, text: role.originalText, format: { fontFamily: role.fontFamily, fontSizePt: role.fontSizePt } });
      for (const control of titleControls) expect(body.blocks.find(block => block.id === control.id)).toMatchObject({ text: title, format: { fontFamily: "方正小标宋简体", fontSizePt: 22, align: "center" } });
      for (const control of ordinaryControls) expect(body.blocks.find(block => block.id === control.id)).toMatchObject({ text: control.originalText, format: { fontFamily: "仿宋_GB2312", fontSizePt: 14 } });
      expect(body.blocks.find(block => block.id === ordinary.id)).toMatchObject({ text: manualText, editable: true, format: { fontFamily: "仿宋_GB2312", fontSizePt: 14 } });
      // Only after all normative formatting targets may the new server-owned stamp be required.
      expect(wb.version.draftData.documentRenderProfile).toEqual({ typographyVersion: expectedVersion });
      expect(body).toMatchObject({ sourceSha256: sourceSha, layoutTemplateVersionId: layout.id, draftRevision: wb.version.draftRevision, documentContentRevision: wb.version.documentContentRevision });
      expect(wb.version.draftRevision).toBe(current.version.draftRevision + 1);
      expect(wb.version.documentContentRevision).toBe(current.version.documentContentRevision + 1);
      expect(wb.version.documentContentFingerprint).toMatch(/^[a-f0-9]{64}$/u);
      expect(wb.version.documentContentFingerprint).not.toBe(current.version.documentContentFingerprint);
      expect(body.blocks.map(block => block.id)).toEqual(before.blocks.map(block => block.id));
      expect(body.blocks.map(block => [block.id, block.editable, block.text])).toEqual(before.blocks.map(block => [block.id, block.editable, block.id === ordinary.id ? manualText : block.text]));
      expect(body.flow).toEqual(before.flow);
      expect(body.paragraphGroups).toEqual(before.paragraphGroups);
      const roleIds = new Set<string>(roleExpectations.map(role => role.id));
      expect(body.blocks.filter(block => !roleIds.has(block.id)).map(block => [block.id, block.format])).toEqual(before.blocks.filter(block => !roleIds.has(block.id)).map(block => [block.id, block.format]));
      const tables = body.flow.filter((node): node is Extract<ContractBodyFlow, { kind: "table" }> => node.kind === "table");
      expect(tables.map(table => [table.rows.length, table.columns.length])).toEqual([[2, 8], [1, 2]]);
      const cells = tables[0].rows[1].cells.map(cell => cell.paragraphIds.map(id => body.blocks.find(block => block.id === id)?.text ?? "").join(""));
      expect(cells).toEqual(["正文清单机械", "M-001", "1", "小时", "11", "10%", "11.0000", ""]);
      expect(body.blocks.map(block => block.text)).toContain("合同金额大写：人民币壹拾壹元整");
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
      expect(after.version).toMatchObject({ draftRevision: wb.version.draftRevision, documentContentRevision: wb.version.documentContentRevision, documentContentFingerprint: wb.version.documentContentFingerprint, amountYuan: "11.0000" });
      expect(after.version.draftData).toEqual(wb.version.draftData);
      expect(after.bills).toEqual(wb.bills);
      expect(createHash("sha256").update(await readFile(sourcePath)).digest("hex")).toBe(sourceSha);
      await writeFile(join(directory, "verified-receipt.json"), JSON.stringify({ verdict: "PUBLIC_MECHANICAL_16_ROLES_AND_FROZEN_SERVER_TYPOGRAPHY_GREEN", sourceSha, generation,
        keyTuple, expectedKey, documentContentRevision: wb.version.documentContentRevision, documentContentFingerprint: wb.version.documentContentFingerprint,
        profile: { typographyVersion: expectedVersion }, amountGrossNetTax: ["11.0000", "10.0000", "1.0000"], finalPublicWorkbench: after,
        processNextOrNativeRequested: false, latinRunFontAndPhysicalWordPdfNotProven: true }, null, 2));
      console.info("机械16角色公开证据：" + directory);
    } catch (cause) {
      await writeFile(join(directory, "failure.txt"), String(cause));
      throw new Error("机械16角色公开核对失败，证据 " + directory, { cause });
    } finally {
      let processorStopped = false, appClosed = false;
      try { await server.processor.onApplicationShutdown(); processorStopped = true; }
      finally { try { await server.app.close(); appClosed = true; } finally { await writeFile(join(directory, "cleanup-receipt.json"), JSON.stringify({ processorStopped, appClosed, ownedOperationSettled: true }, null, 2)); } }
    }
  }, 30_000);
});
