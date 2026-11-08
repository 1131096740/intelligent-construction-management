// PRIVATE single public-HTTP tracer. Not activated, compiled or executed.
// Expected source roles: primary table SHA8fa957963c61b45740486a70208880cb2c0a4f104c04426962b6d309cd9ce064;
// secondary table SHA7e28f4af39d5de3ab0a9a81f1f22d9760e7e2491262b3c05b7b253ebb5fb8499.
// Values below are literal independent source/norm expectations, not production constants.
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ContractBodyFlow, ContractBodyParagraph } from "../contract-document/contract-body-document";
import { task10HttpRepository } from "./task10-http-repository.test-support";
import { createTemplateTestServer } from "./template-management.test-support";
import { confirmedBodyLayout, saveBody, type Body } from "./task10-body.test-support";
import { createTask09Draft, saveTask09Draft } from "./task09-draft-template.test-support";

const sourceSha = "44be99630d27578e9828bd7c6fa4925cdc26f552b84637e125c8acb0632b17bd";
const expectedVersion = "reviewed-material-primary-secondary-body25-v4";
const title = "材料主次条款A2026合同";
const roleExpectations = [
  { paragraphIndex: 26, id: "981566748de797f0cf4163f6d8a2c0f07d4dd7d307f5feeab12dbbda80d9a3e9", originalText: "{合同名称}", publicText: "材料主次条款A2026合同", fontFamily: "方正小标宋简体", fontSizePt: 22 },
  { paragraphIndex: 31, id: "57f235223908a8e8e9e5ec8ab353aeec459cda68819ed706d391c029d9879d72", originalText: "第一条  货物名称、规格型号、数量、价格等", publicText: "第一条  货物名称、规格型号、数量、价格等", fontFamily: "黑体", fontSizePt: 14 },
  { paragraphIndex: 52, id: "7a082149eeed8300700c1dffd8d51b303a0b1c1829061dba9d4d11fdc87cb522", originalText: "3.合同履行过程中风险处置办法", publicText: "3.合同履行过程中风险处置办法", fontFamily: "楷体_GB2312", fontSizePt: 14 },
  { paragraphIndex: 59, id: "8cbc7fa0dc5f9dfff3bd8dcbbcf3b0c85d5ec57483ac506154897ca7ff92b120", originalText: "第二条  质量技术标准及相关要求", publicText: "第二条  质量技术标准及相关要求", fontFamily: "黑体", fontSizePt: 14 },
  { paragraphIndex: 61, id: "039bb580de810755a55899ee448ff7640b3799cfe619ce0e0c82d2b3ada831bf", originalText: "第三条  交货时间、方式及供货期间", publicText: "第三条  交货时间、方式及供货期间", fontFamily: "黑体", fontSizePt: 14 },
  { paragraphIndex: 69, id: "3e8a650210ab5f8b52981a421514a6a5a78798ad9e81273da0719a1c71377d72", originalText: "第四条  货物的包装标准和包装物的提供与回收", publicText: "第四条  货物的包装标准和包装物的提供与回收", fontFamily: "黑体", fontSizePt: 14 },
  { paragraphIndex: 72, id: "9064f42005092444fed3adda9c53cddc3ca84692909d94cb507c42c81acb55ed", originalText: "第五条  验收", publicText: "第五条  验收", fontFamily: "黑体", fontSizePt: 14 },
  { paragraphIndex: 74, id: "ac328837c96accb7aa3ff7db00b7bd5223aa77b6a84e4793abcb0d9a176b3624", originalText: "2.数量验收", publicText: "2.数量验收", fontFamily: "楷体_GB2312", fontSizePt: 14 },
  { paragraphIndex: 77, id: "de98f02131af525488a5d73adc8b5265dd27d5d150ab923c85be438b215de38a", originalText: "3.质量验收", publicText: "3.质量验收", fontFamily: "楷体_GB2312", fontSizePt: 14 },
  { paragraphIndex: 84, id: "19d6291bf8a6d3c14d54a89f30c950adcf15a12764690ca459c65f53ef3eb075", originalText: "第六条  货款的对账与结算", publicText: "第六条  货款的对账与结算", fontFamily: "黑体", fontSizePt: 14 },
  { paragraphIndex: 91, id: "a0f5a2e8f22c196835b7d085893c7d47523fdb72475fa3cd4101d06f0698fbe3", originalText: "第七条 发票有关事项", publicText: "第七条 发票有关事项", fontFamily: "黑体", fontSizePt: 14 },
  { paragraphIndex: 94, id: "6be1a8bfe0211957fc11a8861ae6d8ec35d589a78056d57e5ea78c3544116e0d", originalText: "2.增值税发票开具时间和类型的要求：", publicText: "2.增值税发票开具时间和类型的要求：", fontFamily: "楷体_GB2312", fontSizePt: 14 },
  { paragraphIndex: 110, id: "58ff088727aa74cd1bb34b02c2033a4ae30acbd278505946b15aab0ef3bd2352", originalText: "第八条  货款的支付", publicText: "第八条  货款的支付", fontFamily: "黑体", fontSizePt: 14 },
  { paragraphIndex: 118, id: "a17506241d1a2cb53df88aefc5cecdf926f2e2d55d1f2a4dc96e71afecd9c986", originalText: "第九条  质量保证期", publicText: "第九条  质量保证期", fontFamily: "黑体", fontSizePt: 14 },
  { paragraphIndex: 122, id: "aa99e0cb52e990b1edf2e042229abc99afc7a1bece3057bd90cd13f9fcf4b26e", originalText: "第十条  相关服务", publicText: "第十条  相关服务", fontFamily: "黑体", fontSizePt: 14 },
  { paragraphIndex: 127, id: "1b3553e4c646773f99f4a4983be098d476045104186bfdfb95a6f06bf15ac4c0", originalText: "第十一条  履约担保", publicText: "第十一条  履约担保", fontFamily: "黑体", fontSizePt: 14 },
  { paragraphIndex: 130, id: "8d356cdc5ebfbb141351410cfbf8c96216214cbe87e7ea82bea57066a9891902", originalText: "第十二条  环境保护及安全要求", publicText: "第十二条  环境保护及安全要求", fontFamily: "黑体", fontSizePt: 14 },
  { paragraphIndex: 137, id: "bf25bcd6c599decc20c375ae45aecc75bd5a73e5ab7174ca93bf1fdfa8a75470", originalText: "第十三条  廉洁条款", publicText: "第十三条  廉洁条款", fontFamily: "黑体", fontSizePt: 14 },
  { paragraphIndex: 142, id: "4541bd2de1e5b14bb00626ee5e13bb7d9a153ce9747c476a6cc876d0acac46d5", originalText: "第十四条  双方的权利和义务", publicText: "第十四条  双方的权利和义务", fontFamily: "黑体", fontSizePt: 14 },
  { paragraphIndex: 143, id: "44d0ab6686fd7717df52502628343e16a7d907b3c3ed3cf172fad0a9c43d8d54", originalText: "(一) 买方的权利和义务", publicText: "(一) 买方的权利和义务", fontFamily: "楷体_GB2312", fontSizePt: 14 },
  { paragraphIndex: 151, id: "59c0e04d0d5b8eb4190bcf282128d1e5bcf839fcf7580a4a09387f5d57e8763d", originalText: "(二) 卖方的权利和义务", publicText: "(二) 卖方的权利和义务", fontFamily: "楷体_GB2312", fontSizePt: 14 },
  { paragraphIndex: 168, id: "1d0ac78debd74f3cf2357007d8268d754fe4041d64a521b07dec5519f2139989", originalText: "第十五条  违约责任", publicText: "第十五条  违约责任", fontFamily: "黑体", fontSizePt: 14 },
  { paragraphIndex: 180, id: "d1540407cb236b11a00d3ba56a3cf03c014c2071ec34600ead2cead537910f04", originalText: "第十六条  保密", publicText: "第十六条  保密", fontFamily: "黑体", fontSizePt: 14 },
  { paragraphIndex: 182, id: "9dccecdf0a84fd400b8a35dc8ea32c50e74641fced9f0ad15d9798392ec340a7", originalText: "第十七条  不可抗力", publicText: "第十七条  不可抗力", fontFamily: "黑体", fontSizePt: 14 },
  { paragraphIndex: 184, id: "b7d7e75afe728e71dd0deb3f77094c83befb99b73229beba8c71670667ddceb0", originalText: "第十八条  争议的解决", publicText: "第十八条  争议的解决", fontFamily: "黑体", fontSizePt: 14 },
  { paragraphIndex: 186, id: "47ed4b1e12d481f93d46b90f4680d85c23335d96bd18824547e4760127b63bd4", originalText: "第十九条  合同生效、合同的终止与解除", publicText: "第十九条  合同生效、合同的终止与解除", fontFamily: "黑体", fontSizePt: 14 },
  { paragraphIndex: 192, id: "ff018d5aaa492b1a0055fcb9d50d23e85aa52b562a7f8cf940d7cb0f59683d0c", originalText: "第二十条  工作联络", publicText: "第二十条  工作联络", fontFamily: "黑体", fontSizePt: 14 },
  { paragraphIndex: 196, id: "8612ac838c3965a150d63f65bdc87b3b758ec008b63567c13f48a2b4dca61fb9", originalText: "第二十一条  其他约定事项", publicText: "第二十一条  其他约定事项", fontFamily: "黑体", fontSizePt: 14 }
] as const;
const unclassifiedControls = [
  { paragraphIndex: 104, id: "19d19f7bd96a4e831b092331e6849e265b5a4fbc18ed92214c6dc8ac68b48722", text: "5.增值税专用发票丢失的补救措施：若买方发生丢失增值税专用发票发票联或抵扣联的情况,则卖方必须向买方提供该增值税专用发票记账联复印件等资料。 ", fontFamily: "仿宋_GB2312", fontSizePt: 14 },
  { paragraphIndex: 108, id: "ceecc16852ac1d0b47b4a95b36af279e7f12309ec679d564876eca7f1a68d083", text: "9.特别约定：由于国家政策的调整引起的合同相关要件的变更，将以国家政策为准，以适用国家政策规定。", fontFamily: "仿宋_GB2312", fontSizePt: 14 }
] as const;
const ordinaryId = "83d59eb52c32699fa63475d380aac6eb0c17e0eafe7411b51456fc07dbe930bf";
const ordinarySourceText = "4.若卖方违背上述规定且经买方法人单位或其上级纪委监察机关查实认定，或国家司法机关立案查处，视为卖方违约，卖方承担暂定合同总价的10%的违约金，违约金及卖方因违背廉洁规定行为所取得的不当利益一并在结算中扣除。";
type PublicBody = Omit<Body, "blocks"> & { blocks: ContractBodyParagraph[]; flow: ContractBodyFlow[]; draftRevision: number; layoutTemplateVersionId: string; paragraphGroups: unknown };
type Workbench = { version: { draftRevision: number; documentContentRevision: number; documentContentFingerprint: string; draftData: Record<string, unknown>; layoutTemplateVersionId: string }; bills: Array<{ billKey: string; revision: number }> };

describe("task10 fixed material primary and secondary roles through public HTTP", () => {
  it("uses a new server-owned typography version on legal save while retaining all source roles and ordinary controls", async () => {
    const repository = await task10HttpRepository(__dirname);
    const directory = await mkdtemp(join(tmpdir(), "jg-task10-material-full-roles-public-"));
    const server = await createTemplateTestServer({ draftWorkbench: true });
    try {
      const sourcePath = join(repository, "services/api/assets/templates/material-purchase-real-v1.docx");
      const source = await readFile(sourcePath);
      expect(createHash("sha256").update(source).digest("hex")).toBe(sourceSha);
      expect(roleExpectations).toHaveLength(28);
      expect(new Set(roleExpectations.map(role => role.id)).size).toBe(28);
      const layout = await confirmedBodyLayout(server, source, "materials");
      const draft = await createTask09Draft(server);
      expect((await saveTask09Draft(server, draft, "material_purchase", layout.id)).status).toBe(200);
      const rows = [{ clientRowKey: "full-role-material-row", sortOrder: 0, itemName: "正文清单钢材", unit: "吨", quantity: "2", unitPrice: "3.2500", taxRatePercent: "0", customData: {} }];
      // Existing legal fixture setup only; saveBody may echo the existing server profile.
      // The traced save below explicitly omits the profile and never selects a version.
      const factSave = await saveBody(draft, undefined, "当前单甲方", rows);
      expect(factSave.status === 200 ? "OK" : await factSave.text()).toBe("OK");
      const beforeResponse = await fetch(draft.base + "/document-body", { headers: draft.headers });
      expect(beforeResponse.status).toBe(200);
      const before = await beforeResponse.json() as PublicBody;
      expect(before).toMatchObject({ sourceSha256: sourceSha, layoutTemplateVersionId: layout.id });
      const beforeOrder = before.flow.filter((node): node is Extract<ContractBodyFlow, { kind: "paragraph" }> => node.kind === "paragraph").map(node => node.paragraphId);
      expect(roleExpectations.map(role => beforeOrder.indexOf(role.id))).toEqual(roleExpectations.map(role => beforeOrder.indexOf(role.id)).slice().sort((a, b) => a - b));
      for (const role of roleExpectations) {
        expect(beforeOrder.filter(id => id === role.id)).toHaveLength(1);
        const block = before.blocks.find(item => item.id === role.id);
        expect(block).toBeDefined();
        expect(block!.text).toBe(role.paragraphIndex === 26 ? "上游新建当前合同名称" : role.originalText);
      }
      const ordinary = before.blocks.find(block => block.id === ordinaryId);
      expect(ordinary).toMatchObject({ text: ordinarySourceText, editable: true });
      const manualText = ordinarySourceText + "双方人工补充约定应当保留。";
      const currentResponse = await fetch(draft.base + "/workbench", { headers: draft.headers });
      expect(currentResponse.status).toBe(200);
      const current = await currentResponse.json() as Workbench;
      const draftData: Record<string, unknown> = { ...current.version.draftData, contractName: title,
        documentBody: { protocolVersion: 1, layoutTemplateVersionId: layout.id, sourceSha256: sourceSha, edits: [{ positionId: ordinaryId, text: manualText }] } };
      delete draftData.documentRenderProfile;
      expect(Object.hasOwn(draftData, "documentRenderProfile")).toBe(false);
      const input = {
        idempotencyKey: randomUUID(), saveKind: "manual", expectedRevision: current.version.draftRevision, changedSections: ["draft", "parties", "bills"],
        draft: { numericProtocolVersion: 2, draftData, clauses: [], pricingNature: "unit_price", amountSource: "bill_sum", layoutTemplateVersionId: layout.id,
          taxFacts: { invoiceType: null, taxMode: "single_rate", defaultTaxRatePercent: "0", source: "contract_document" } },
        parties: [{ roleKey: "party_a", displayOrder: 0, snapshot: { name: "当前单甲方" } }, { roleKey: "party_b", displayOrder: 0, snapshot: { name: "当前单乙方" } }],
        bills: current.bills.map(bill => ({ billKey: bill.billKey, expectedRevision: bill.revision, numericProtocolVersion: 2, rows })),
        paymentTerms: null, attachments: [], negotiationDocuments: { referencedGeneratedDocumentIds: [] }
      };
      await writeFile(join(directory, "public-save-without-profile.json"), JSON.stringify(input, null, 2));
      const saved = await fetch(draft.base, { method: "PUT", headers: { ...draft.headers, "x-contract-draft-lease": draft.leaseToken }, body: JSON.stringify(input) });
      expect(saved.status === 200 ? "OK" : await saved.text()).toBe("OK");
      const wbResponse = await fetch(draft.base + "/workbench", { headers: draft.headers });
      expect(wbResponse.status).toBe(200);
      const workbench = await wbResponse.json();
      const bodyResponse = await fetch(draft.base + "/document-body", { headers: draft.headers });
      expect(bodyResponse.status).toBe(200);
      const body = await bodyResponse.json() as PublicBody;
      await writeFile(join(directory, "public-observation.json"), JSON.stringify({ before, current, workbench, body, roleExpectations, unclassifiedControls,
        tracedSaveHasProfile: Object.hasOwn(input.draft.draftData, "documentRenderProfile"), exportOrNativeRequested: false }, null, 2));
      // First business target is visible formatting, not merely the new stamp.
      const secondArticle = body.blocks.find(block => block.id === "8cbc7fa0dc5f9dfff3bd8dcbbcf3b0c85d5ec57483ac506154897ca7ff92b120");
      expect(secondArticle).toBeDefined();
      expect(secondArticle!.text).toBe("第二条  质量技术标准及相关要求");
      expect(secondArticle!.format).toMatchObject({ fontFamily: "黑体", fontSizePt: 14 });
      const risk = body.blocks.find(block => block.id === "7a082149eeed8300700c1dffd8d51b303a0b1c1829061dba9d4d11fdc87cb522");
      expect(risk).toBeDefined();
      expect(risk!.text).toBe("3.合同履行过程中风险处置办法");
      expect(risk!.format).toMatchObject({ fontFamily: "楷体_GB2312", fontSizePt: 14 });
      for (const role of roleExpectations) expect(body.blocks.find(block => block.id === role.id)).toMatchObject({ id: role.id, text: role.publicText, format: { fontFamily: role.fontFamily, fontSizePt: role.fontSizePt } });
      expect(workbench.version.draftData.documentRenderProfile).toEqual({ typographyVersion: expectedVersion, signatureDateVersion: "reviewed-material-signature-date-v1" });
      expect(body).toMatchObject({ sourceSha256: sourceSha, layoutTemplateVersionId: layout.id, draftRevision: current.version.draftRevision + 1, documentContentRevision: current.version.documentContentRevision + 1 });
      expect(body.draftRevision).toBe(workbench.version.draftRevision);
      expect(body.documentContentRevision).toBe(workbench.version.documentContentRevision);
      expect(workbench.version.documentContentFingerprint).toMatch(/^[a-f0-9]{64}$/u);
      expect(workbench.version.documentContentFingerprint).not.toBe(current.version.documentContentFingerprint);
      expect(workbench.version.amountYuan).toBe("6.5000");
      expect(workbench.bills).toHaveLength(1);
      expect(workbench.bills[0]).toMatchObject({ billKey: "main", taxInclusiveAmountYuan: "6.5000", taxExclusiveAmountYuan: "6.5000", taxAmountYuan: "0.0000" });
      const coverId = "fe8a01bb7008d14107fd6abe3584dee8f92c5544c883bbd85c67e4dcadd4a17c";
      expect(body.blocks.find(block => block.id === coverId)).toMatchObject({ text: title, format: { fontFamily: "方正小标宋简体", fontSizePt: 22, align: "center" } });
      expect(body.blocks.find(block => block.id === ordinaryId)).toMatchObject({ text: manualText, editable: true, format: { fontFamily: "仿宋_GB2312", fontSizePt: 14 } });
      for (const control of unclassifiedControls) expect(body.blocks.find(block => block.id === control.id)).toMatchObject({ text: control.text, format: { fontFamily: control.fontFamily, fontSizePt: control.fontSizePt } });
      expect(body.blocks.map(block => block.id)).toEqual(before.blocks.map(block => block.id));
      expect(body.blocks.map(block => [block.id, block.editable, block.text])).toEqual(before.blocks.map(block => [block.id, block.editable,
        block.id === ordinaryId ? manualText : block.id === coverId || block.id === "981566748de797f0cf4163f6d8a2c0f07d4dd7d307f5feeab12dbbda80d9a3e9" ? title : block.text]));
      expect(body.flow).toEqual(before.flow);
      expect(body.paragraphGroups).toEqual(before.paragraphGroups);
      const roleIds = new Set<string>(roleExpectations.map(role => role.id));
      expect(body.blocks.filter(block => !roleIds.has(block.id)).map(block => [block.id, block.format])).toEqual(before.blocks.filter(block => !roleIds.has(block.id)).map(block => [block.id, block.format]));
      const documentsResponse = await fetch(`${await server.app.getUrl()}/contract-workbench/${draft.version.id}/documents`, { headers: draft.headers });
      expect(documentsResponse.status).toBe(200);
      expect(await documentsResponse.json()).toEqual([]);
      expect(createHash("sha256").update(await readFile(sourcePath)).digest("hex")).toBe(sourceSha);
    } catch (cause) {
      await writeFile(join(directory, "failure.txt"), String(cause));
      throw new Error("material full-role public tracer failed; evidence " + directory, { cause });
    } finally {
      let processorStopped = false, appClosed = false;
      try { await server.processor.onApplicationShutdown(); processorStopped = true; }
      finally { try { await server.app.close(); appClosed = true; } finally { await writeFile(join(directory, "cleanup-receipt.json"), JSON.stringify({ processorStopped, appClosed, ownedOperationSettled: true }, null, 2)); } }
    }
  }, 30_000);
});
