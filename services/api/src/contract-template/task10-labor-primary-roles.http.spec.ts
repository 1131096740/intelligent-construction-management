// One closed labor source-role public HTTP tracer; independent literal expectations.
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

const sourceSha = "d82812b363391fe9e629cd18555ce7ce951aa9fa9a479d0bada1092fc0174c47";
const expectedVersion = "reviewed-labor-primary-roles-v1";
const lockSha = "95f5243446393e03e14472002835ac8607634982b1be420a012b2ea5a5adafab";
const title = "劳务一级条款A2026合同";
const roleExpectations = [
  {"paragraphIndex": 30, "id": "fa570038683fa0c63594718acb646cdc426ed0a072b790300f8546e3b2498d1b", "originalText": "一、工程概况", "fontFamily": "黑体", "fontSizePt": 14, "latinFamily": "Times New Roman", "latinSizePt": 14},
  {"paragraphIndex": 33, "id": "deba9a9078640497b6bfb3c568201e7b5d74c2bfbd9f7f13d8cadbf883dda60c", "originalText": "二、承包范围及方式", "fontFamily": "黑体", "fontSizePt": 14, "latinFamily": "Times New Roman", "latinSizePt": 14},
  {"paragraphIndex": 40, "id": "60228df3c5dbbf85ea7e72f68af9d04fde32a4cf8f33bf78101592bbc4c09d75", "originalText": "三、质量标准", "fontFamily": "黑体", "fontSizePt": 14, "latinFamily": "Times New Roman", "latinSizePt": 14},
  {"paragraphIndex": 43, "id": "7274c1b0037b62bba350e6e3bbd47f7f072a8d4440e9c59bec03c31ed5465b18", "originalText": "四、材料使用要求", "fontFamily": "黑体", "fontSizePt": 14, "latinFamily": "Times New Roman", "latinSizePt": 14},
  {"paragraphIndex": 45, "id": "64d6496ed66486e574a4e5f5937095789d53e82d5fab2177907f8aa64d2c351c", "originalText": "五、工程变更", "fontFamily": "黑体", "fontSizePt": 14, "latinFamily": "Times New Roman", "latinSizePt": 14},
  {"paragraphIndex": 47, "id": "3fb813481ab7565959d4aebac37d980f551be1634e02518953509fc1fd0ff470", "originalText": "六、开工、竣工日期及质量要求", "fontFamily": "黑体", "fontSizePt": 14, "latinFamily": "Times New Roman", "latinSizePt": 14},
  {"paragraphIndex": 55, "id": "07d72637563ca4c8bdd59136de9037eb7ccbc89dba7666435875179c9743dd18", "originalText": "七、合同价款", "fontFamily": "黑体", "fontSizePt": 14, "latinFamily": "Times New Roman", "latinSizePt": 14},
  {"paragraphIndex": 60, "id": "0a6cc0dd9535d04f1d964bb2866f2e64d04ab857eb52e42ceea5f77a77b0784d", "originalText": "八、付款方式", "fontFamily": "黑体", "fontSizePt": 14, "latinFamily": "Times New Roman", "latinSizePt": 14},
  {"paragraphIndex": 65, "id": "035e12c43037c92ed60043c8922423f53183b5aed8f75b7ad4be98db5da4bc58", "originalText": "九、成品保护", "fontFamily": "黑体", "fontSizePt": 14, "latinFamily": "Times New Roman", "latinSizePt": 14},
  {"paragraphIndex": 67, "id": "548a81aafee2cf4a8ce71ea31019f01f3a5cc7eaadc07c128088fe8957649bcc", "originalText": "十、乙方承诺", "fontFamily": "黑体", "fontSizePt": 14, "latinFamily": "Times New Roman", "latinSizePt": 14},
  {"paragraphIndex": 72, "id": "01fb1fa59e5cb324b2e6a4f91bebd5b10f462618461b556404f5270c4311774b", "originalText": "十一、甲方的权利和义务", "fontFamily": "黑体", "fontSizePt": 14, "latinFamily": "Times New Roman", "latinSizePt": 14},
  {"paragraphIndex": 79, "id": "9fa32fadba4b782d825f611b486733af2cc51be7673f3bf84bde1d50923f8ebb", "originalText": "十二、乙方的权利和义务", "fontFamily": "黑体", "fontSizePt": 14, "latinFamily": "Times New Roman", "latinSizePt": 14},
  {"paragraphIndex": 100, "id": "d57483c87c6c94eec12eee8a75cc81a34e70d51d5d1fd811430e8719f9690adb", "originalText": "十三、安全与文明施工", "fontFamily": "黑体", "fontSizePt": 14, "latinFamily": "Times New Roman", "latinSizePt": 14},
  {"paragraphIndex": 102, "id": "59ebc939f3ce0cc7640368feb60644b215a4efc860e58301e207bf596d793cd7", "originalText": "十四、劳务分包作业安全与环境保护", "fontFamily": "黑体", "fontSizePt": 14, "latinFamily": "Times New Roman", "latinSizePt": 14},
  {"paragraphIndex": 104, "id": "47bebaad8f57ead55ef90a873fd71d0bb4dda77e1cdc91781eb38a8478369f30", "originalText": "十五、违约责任", "fontFamily": "黑体", "fontSizePt": 14, "latinFamily": "Times New Roman", "latinSizePt": 14},
  {"paragraphIndex": 116, "id": "54b3781e7aa5f0d32079ba6b4461601356359dc7c2adaa4030b4a8a8469416c3", "originalText": "十六、争议解决办法", "fontFamily": "黑体", "fontSizePt": 14, "latinFamily": "Times New Roman", "latinSizePt": 14},
  {"paragraphIndex": 118, "id": "b8d1f2882e5cdbd3073a48670b6eb0b6e6477c2ecbe8d67c4b578e9ba17ffb5f", "originalText": "十七、其他", "fontFamily": "黑体", "fontSizePt": 14, "latinFamily": "Times New Roman", "latinSizePt": 14}
] as const;
const titleControls = [
  {"paragraphIndex": 5, "id": "a6903774adc2a3d687c925c686d1ffb0e91635048d73d3aaf1ea98bb300f8e71", "originalText": "{合同名称}"},
  {"paragraphIndex": 26, "id": "28baeddd5d79e521017069ee8a329c587e25f599f634fdd9be65c2dd09b67e4f", "originalText": "{合同名称}"}
] as const;
const ordinaryControls = [
  {"paragraphIndex": 36, "id": "40275c9fbbe7b161ddbaff6734269aaff2eceb359563c52745fe87fb2cf4eda2", "originalText": "2、承包方式："},
  {"paragraphIndex": 49, "id": "661bf5a29170fd7b26dfb288f62ea2ff41d048e3ec3a4463a95e2673712100ef", "originalText": "节点工期："},
  {"paragraphIndex": 51, "id": "1f2590e66cb5010b038ea1312edd06f3f6c34f2351e106c03dfc73ae1c1177d1", "originalText": "工期顺延："},
  {"paragraphIndex": 73, "id": "a969e6f77f1cb442f6f9cf458cad873b35af871adf040ae6310117dfdd086540", "originalText": "1、甲方负责工地的一切准备工作，为乙方进场施工创造有利条件。"},
  {"paragraphIndex": 119, "id": "4e80efb7ff51585b569aa06046c8cef0813178572d1bac9514a9f74176f8403f", "originalText": "1、经甲方认可的设计图纸、工程量清单、材料清单、预算书或报价函、甲方书面指令或甲方拟定的工程管理规定作为合同附件。"},
  {"paragraphIndex": 125, "id": "b3dfbb100fe402b07f5f7e48f9f28199c5b7024e27ad4e16eae1270a4fc55134", "originalText": "附件一：《安全生产管理协议》"},
  {"paragraphIndex": 126, "id": "d5852514e08ff21b36ef8e860fa9bf8cd2950c5782975d28653e9a1dc4e47465", "originalText": "附件二：《民工工资兑现承诺书》"},
  {"paragraphIndex": 127, "id": "c9ac470ea3dca8c5338ec435db30e3f7d57c5fbd54b768ce7657f3b522784511", "originalText": "附件三：劳务分包价格清单"},
  {"paragraphIndex": 182, "id": "4329cee11fb2c89e746377142d6d8dfd95b24517d6229357fde5e34dadb17e73", "originalText": "附件一：《安全生产管理协议》"},
  {"paragraphIndex": 183, "id": "708850f6b033a91358db61611bcd6eb757f3264fa9183753139765c75820bad9", "originalText": "安全生产管理协议"},
  {"paragraphIndex": 220, "id": "1f29c293dffd51209abf820139a01ed43faf26192303846d373fc41a0a42666e", "originalText": "附件二：《民工工资兑现承诺书》"},
  {"paragraphIndex": 221, "id": "c1f91fad51311fd35f2447e1bf37a8422b6bac44d38a3461a6e4dae193a02630", "originalText": "关于不拖欠工程民工工资的承诺"}
] as const;
const ordinary = {"paragraphIndex": 44, "id": "f34d084771055c549d87f85f04ee7346c6942d5c6faa779d88239b7c37c854ef", "originalText": "材料的使用必须按设计要求，根据设计进行放样开割，材料损耗不能超出定额含量，如超出定额含量，超耗部分的材料费由乙方承担。"} as const;
type PublicBody = Omit<Body, "blocks"> & { blocks: ContractBodyParagraph[]; flow: ContractBodyFlow[]; draftRevision: number; layoutTemplateVersionId: string; paragraphGroups: unknown };

describe("task10 fixed labor primary roles through public HTTP", () => {
  it("renders seventeen independent labor source roles on legal save and freezes the server-selected version without changing ordinary facts", async () => {
    const repository = await task10HttpRepository(__dirname);
    const directory = await mkdtemp(join(tmpdir(), "jg-task10-labor-font-public-"));
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const sourcePath = join(repository, "services/api/assets/templates/labor-subcontract-real-v1.docx");
      const source = await readFile(sourcePath);
      expect(createHash("sha256").update(source).digest("hex")).toBe(sourceSha);
      expect(roleExpectations).toHaveLength(17);
      expect(new Set(roleExpectations.map(role => role.id)).size).toBe(17);
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
      const layout = await confirmedBodyLayout(server, source, "laborItems", "labor_subcontract");
      const draft = await createTask09Draft(server);
      expect((await saveTask09Draft(server, draft, "labor_subcontract", layout.id)).status).toBe(200);
      const setupResponse = await fetch(draft.base + "/workbench", { headers: draft.headers });
      expect(setupResponse.status).toBe(200);
      const setup = await setupResponse.json();
      expect(setup.bills.map((bill: { billKey: string }) => bill.billKey)).toEqual(["main"]);
      // Independent worked literals: gross/net100+200+300=600; all tax0.
      const rows = [1, 2, 3].map(i => ({ clientRowKey: "labor-font-00" + i, sortOrder: i - 1,
        itemName: "正式劳务行00" + i, unit: "项", quantity: String(i), unitPrice: "100.0000", taxRatePercent: "0", customData: {} }));
      const setupData: Record<string, unknown> = { ...setup.version.draftData, contractName: title,
        contractBasics: { businessType: "labor_subcontract", relationship: "upward", amountBasis: "tax_inclusive", invoiceStatus: "pending" } };
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
      expect(before.blocks.find(block => block.id === ordinary.id)).toMatchObject({ text: ordinary.originalText, editable: true });
      const manualText = ordinary.originalText + "双方人工补充劳务约定应当保留。";
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
      expect(wb.version).toMatchObject({ numericProtocolVersion: 2, amountYuan: "600.0000", layoutTemplateVersionId: layout.id,
        taxFacts: { taxMode: "single_rate", defaultTaxRatePercent: "0" }, draftData: { contractBasics: factInput.draft.draftData.contractBasics } });
      expect(wb.bills).toHaveLength(1);
      expect(wb.bills[0]).toMatchObject({ billKey: "main", pricingMode: "tax_inclusive", taxInclusiveAmountYuan: "600.0000", taxExclusiveAmountYuan: "600.0000", taxAmountYuan: "0.0000" });
      expect(wb.bills[0].rows).toHaveLength(3);
      for (const [i, amount] of ["100.0000", "200.0000", "300.0000"].entries()) expect(wb.bills[0].rows[i]).toMatchObject({
        itemName: "正式劳务行00" + (i + 1), unit: "项", quantity: String(i + 1), taxRatePercent: "0",
        taxInclusiveAmountYuan: amount, taxExclusiveAmountYuan: amount, taxAmountYuan: "0.0000"
      });
      const taxPositions = body.blocks.filter(block => block.text.startsWith("本合同采用以下第"));
      expect(taxPositions).toHaveLength(1);
      expect(taxPositions[0]).toMatchObject({ id: "298826034afdc7bb047479758631c74f5207b80b57b9e83858e8d9fa20032453", editable: false,
        text: "本合同采用以下第   （2）   项计价方式，乙方提供 R增值税专用发票/ □增值税普通发票，税率  0%。" });
      const afterOrder = body.flow.filter((node): node is Extract<ContractBodyFlow, { kind: "paragraph" }> => node.kind === "paragraph").map(node => node.paragraphId);
      for (const role of roleExpectations) {
        expect(afterOrder.filter(id => id === role.id)).toHaveLength(1);
        expect(body.blocks.find(block => block.id === role.id)).toMatchObject({ text: role.originalText });
      }
      expect(roleExpectations.map(role => afterOrder.indexOf(role.id))).toEqual(roleExpectations.map(role => afterOrder.indexOf(role.id)).slice().sort((a, b) => a - b));
      await writeFile(join(directory, "pre-font-qualified-public-facts.json"), JSON.stringify({ legalSaveStatus: savedResponse.status, sourceSha, all17OriginalSourceIdsAndFullTextQualified: true,
        firstTarget: roleExpectations[0], workbench: wb, body, independentGrossNetTax: ["600.0000", "600.0000", "0.0000"] }, null, 2));
      // Sole first intended business RED: current public p30 font, never an undefined version stamp.
      expect(body.blocks.find(block => block.id === "fa570038683fa0c63594718acb646cdc426ed0a072b790300f8546e3b2498d1b")!.format).toMatchObject({ fontFamily: "黑体", fontSizePt: 14 });
      for (const role of roleExpectations) expect(body.blocks.find(block => block.id === role.id)).toMatchObject({ id: role.id, text: role.originalText, format: { fontFamily: role.fontFamily, fontSizePt: role.fontSizePt } });
      for (const control of titleControls) expect(body.blocks.find(block => block.id === control.id)).toMatchObject({ text: title, format: { fontFamily: "方正小标宋简体", fontSizePt: 22, align: "center" } });
      for (const control of ordinaryControls) expect(body.blocks.find(block => block.id === control.id)).toMatchObject({ text: control.originalText, format: before.blocks.find(block => block.id === control.id)!.format });
      expect(body.blocks.find(block => block.id === ordinary.id)).toMatchObject({ text: manualText, editable: true, format: { fontFamily: "仿宋_GB2312", fontSizePt: 14 } });
      for (const role of roleExpectations) {
        const oldFormat = { ...before.blocks.find(block => block.id === role.id)!.format };
        const newFormat = { ...body.blocks.find(block => block.id === role.id)!.format };
        delete oldFormat.fontFamily; delete oldFormat.fontSizePt;
        delete newFormat.fontFamily; delete newFormat.fontSizePt;
        expect(newFormat).toEqual(oldFormat);
      }
      // Only after all normative formatting targets may the new server-owned stamp be required.
      expect(wb.version.draftData.documentRenderProfile).toEqual({ reviewedLaborTaxBindingVersion: "reviewed-labor-tax-v1", typographyVersion: expectedVersion });
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
      expect(tables.map(table => table.rows.length)).toEqual([9, 3, 4]);
      expect(tables[0].rows.map(row => row.cells.length)).toEqual([3, 3, 3, 3, 3, 3, 3, 3, 2]);
      expect(tables[1].rows.map(row => row.cells.length)).toEqual([2, 2, 1]);
      for (const [i, amount] of ["100.0000", "200.0000", "300.0000"].entries()) expect(tables[2].rows[i + 1].cells.map(cell => cell.paragraphIds.map(id => body.blocks.find(block => block.id === id)?.text ?? "").join(""))).toEqual([
        "", "正式劳务行00" + (i + 1), "项", String(i + 1), "100", amount, ""
      ]);
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
          renderInput: { values: { "contract.reviewedLaborTaxBindingVersion": "reviewed-labor-tax-v1", "contract.taxRateLabel": "0%", "contract.amountBasis": "tax_inclusive", "contract.taxInclusiveAmount": "600.0000", "contract.taxExclusiveAmount": "600.0000", "contract.taxAmount": "0.0000", "contract.typographyVersion": expectedVersion, "contract.renderSemanticVersion": "contract-money-v1", "contract.tableLayoutVersion": "body-bill-loop-v2" } } } });
      expect(Object.hasOwn(queued.inputSnapshot.bodyDocument, "typographyVersion")).toBe(true);
      expect(Object.hasOwn(queued.inputSnapshot.renderInput.values, "contract.typographyVersion")).toBe(true);
      const keyTuple = [draft.version.id, wb.version.documentContentRevision, wb.version.documentContentFingerprint, layout.id, "draft", [], "contract-body-docx4j-v1", lockSha, "contract-money-v1", "body-bill-loop-v2", "reviewed-labor-tax-v1", expectedVersion];
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
      await writeFile(join(directory, "verified-receipt.json"), JSON.stringify({ verdict: "PUBLIC_LABOR_17_ROLES_AND_FROZEN_SERVER_TYPOGRAPHY_GREEN", sourceSha, generation,
        keyTuple, expectedKey, documentContentRevision: wb.version.documentContentRevision, documentContentFingerprint: wb.version.documentContentFingerprint,
        profile: { reviewedLaborTaxBindingVersion: "reviewed-labor-tax-v1", typographyVersion: expectedVersion }, amountGrossNetTax: ["600.0000", "600.0000", "0.0000"], finalPublicWorkbench: after,
        processNextOrNativeRequested: false, latinRunFontAndPhysicalWordPdfNotProven: true }, null, 2));
      console.info("劳务17角色公开证据：" + directory);
    } catch (cause) {
      await writeFile(join(directory, "failure.txt"), String(cause));
      throw new Error("劳务17角色公开核对失败，证据 " + directory, { cause });
    } finally {
      let processorStopped = false, appClosed = false;
      try { await server.processor.onApplicationShutdown(); processorStopped = true; }
      finally { try { await server.app.close(); appClosed = true; } finally { await writeFile(join(directory, "cleanup-receipt.json"), JSON.stringify({ processorStopped, appClosed, ownedOperationSettled: true }, null, 2)); } }
    }
  }, 30_000);
});
