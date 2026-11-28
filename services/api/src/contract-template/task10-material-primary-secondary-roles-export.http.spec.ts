import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import PizZip from "pizzip";
import { DOMParser, XMLSerializer, type Element } from "@xmldom/xmldom";
import { calculateContractDocumentContentFingerprint } from "../contract-workbench/contract-document-content";
import type { ContractBodyFlow, ContractBodyParagraph } from "../contract-document/contract-body-document";
import { task10HttpRepository } from "./task10-http-repository.test-support";
import { createTemplateTestServer } from "./template-management.test-support";
import { confirmedBodyLayout, saveBody, type Body } from "./task10-body.test-support";
import { createTask09Draft, saveTask09Draft } from "./task09-draft-template.test-support";
import { inspectActualTemplatePdf } from "./template-pdf-physical.test-support";

const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const runtimePath = "/private/tmp/jg-task10-docx4j-runtime-20261106-r2/runtime-manifest.json";
const inspectionPath = "/private/tmp/jg-task10-docx4j-runtime-20261106-r2/inspection-manifest.json";
const runtimeSha = "200e2a3be3008e0b9c9c2bca1579024fd1df93d3616613c7fd834c38dd49080a";
const inspectionSha = "c1e9ea341612950b257cc894c5a67fe4c8b9a4b8bdc98962a2cb9d2193edcade";
const lockSha = "95f5243446393e03e14472002835ac8607634982b1be420a012b2ea5a5adafab";
const sourceSha = "44be99630d27578e9828bd7c6fa4925cdc26f552b84637e125c8acb0632b17bd";

const title = "材料主次条款A2026合同";
const articleText = "第一条  货物名称、规格型号、数量、价格等";
const totalLiteral = "1.本合同暂定总价（含税）：人民币陆元伍角。适用税率：0%。";
const typographyVersion = "reviewed-material-primary-secondary-roles-v2";
// Independent canonical source audit8a39415c; no production role/version constants.
const roleExpectations = [
  {"paragraphIndex": 26, "id": "981566748de797f0cf4163f6d8a2c0f07d4dd7d307f5feeab12dbbda80d9a3e9", "originalText": "{合同名称}", "publicText": "材料主次条款A2026合同", "fontFamily": "方正小标宋简体", "fontSizePt": 22},
  {"paragraphIndex": 31, "id": "57f235223908a8e8e9e5ec8ab353aeec459cda68819ed706d391c029d9879d72", "originalText": "第一条  货物名称、规格型号、数量、价格等", "publicText": "第一条  货物名称、规格型号、数量、价格等", "fontFamily": "黑体", "fontSizePt": 14},
  {"paragraphIndex": 52, "id": "7a082149eeed8300700c1dffd8d51b303a0b1c1829061dba9d4d11fdc87cb522", "originalText": "3.合同履行过程中风险处置办法", "publicText": "3.合同履行过程中风险处置办法", "fontFamily": "楷体_GB2312", "fontSizePt": 14},
  {"paragraphIndex": 59, "id": "8cbc7fa0dc5f9dfff3bd8dcbbcf3b0c85d5ec57483ac506154897ca7ff92b120", "originalText": "第二条  质量技术标准及相关要求", "publicText": "第二条  质量技术标准及相关要求", "fontFamily": "黑体", "fontSizePt": 14},
  {"paragraphIndex": 61, "id": "039bb580de810755a55899ee448ff7640b3799cfe619ce0e0c82d2b3ada831bf", "originalText": "第三条  交货时间、方式及供货期间", "publicText": "第三条  交货时间、方式及供货期间", "fontFamily": "黑体", "fontSizePt": 14},
  {"paragraphIndex": 69, "id": "3e8a650210ab5f8b52981a421514a6a5a78798ad9e81273da0719a1c71377d72", "originalText": "第四条  货物的包装标准和包装物的提供与回收", "publicText": "第四条  货物的包装标准和包装物的提供与回收", "fontFamily": "黑体", "fontSizePt": 14},
  {"paragraphIndex": 72, "id": "9064f42005092444fed3adda9c53cddc3ca84692909d94cb507c42c81acb55ed", "originalText": "第五条  验收", "publicText": "第五条  验收", "fontFamily": "黑体", "fontSizePt": 14},
  {"paragraphIndex": 74, "id": "ac328837c96accb7aa3ff7db00b7bd5223aa77b6a84e4793abcb0d9a176b3624", "originalText": "2.数量验收", "publicText": "2.数量验收", "fontFamily": "楷体_GB2312", "fontSizePt": 14},
  {"paragraphIndex": 77, "id": "de98f02131af525488a5d73adc8b5265dd27d5d150ab923c85be438b215de38a", "originalText": "3.质量验收", "publicText": "3.质量验收", "fontFamily": "楷体_GB2312", "fontSizePt": 14},
  {"paragraphIndex": 84, "id": "19d6291bf8a6d3c14d54a89f30c950adcf15a12764690ca459c65f53ef3eb075", "originalText": "第六条  货款的对账与结算", "publicText": "第六条  货款的对账与结算", "fontFamily": "黑体", "fontSizePt": 14},
  {"paragraphIndex": 91, "id": "a0f5a2e8f22c196835b7d085893c7d47523fdb72475fa3cd4101d06f0698fbe3", "originalText": "第七条 发票有关事项", "publicText": "第七条 发票有关事项", "fontFamily": "黑体", "fontSizePt": 14},
  {"paragraphIndex": 94, "id": "6be1a8bfe0211957fc11a8861ae6d8ec35d589a78056d57e5ea78c3544116e0d", "originalText": "2.增值税发票开具时间和类型的要求：", "publicText": "2.增值税发票开具时间和类型的要求：", "fontFamily": "楷体_GB2312", "fontSizePt": 14},
  {"paragraphIndex": 110, "id": "58ff088727aa74cd1bb34b02c2033a4ae30acbd278505946b15aab0ef3bd2352", "originalText": "第八条  货款的支付", "publicText": "第八条  货款的支付", "fontFamily": "黑体", "fontSizePt": 14},
  {"paragraphIndex": 118, "id": "a17506241d1a2cb53df88aefc5cecdf926f2e2d55d1f2a4dc96e71afecd9c986", "originalText": "第九条  质量保证期", "publicText": "第九条  质量保证期", "fontFamily": "黑体", "fontSizePt": 14},
  {"paragraphIndex": 122, "id": "aa99e0cb52e990b1edf2e042229abc99afc7a1bece3057bd90cd13f9fcf4b26e", "originalText": "第十条  相关服务", "publicText": "第十条  相关服务", "fontFamily": "黑体", "fontSizePt": 14},
  {"paragraphIndex": 127, "id": "1b3553e4c646773f99f4a4983be098d476045104186bfdfb95a6f06bf15ac4c0", "originalText": "第十一条  履约担保", "publicText": "第十一条  履约担保", "fontFamily": "黑体", "fontSizePt": 14},
  {"paragraphIndex": 130, "id": "8d356cdc5ebfbb141351410cfbf8c96216214cbe87e7ea82bea57066a9891902", "originalText": "第十二条  环境保护及安全要求", "publicText": "第十二条  环境保护及安全要求", "fontFamily": "黑体", "fontSizePt": 14},
  {"paragraphIndex": 137, "id": "bf25bcd6c599decc20c375ae45aecc75bd5a73e5ab7174ca93bf1fdfa8a75470", "originalText": "第十三条  廉洁条款", "publicText": "第十三条  廉洁条款", "fontFamily": "黑体", "fontSizePt": 14},
  {"paragraphIndex": 142, "id": "4541bd2de1e5b14bb00626ee5e13bb7d9a153ce9747c476a6cc876d0acac46d5", "originalText": "第十四条  双方的权利和义务", "publicText": "第十四条  双方的权利和义务", "fontFamily": "黑体", "fontSizePt": 14},
  {"paragraphIndex": 143, "id": "44d0ab6686fd7717df52502628343e16a7d907b3c3ed3cf172fad0a9c43d8d54", "originalText": "(一) 买方的权利和义务", "publicText": "(一) 买方的权利和义务", "fontFamily": "楷体_GB2312", "fontSizePt": 14},
  {"paragraphIndex": 151, "id": "59c0e04d0d5b8eb4190bcf282128d1e5bcf839fcf7580a4a09387f5d57e8763d", "originalText": "(二) 卖方的权利和义务", "publicText": "(二) 卖方的权利和义务", "fontFamily": "楷体_GB2312", "fontSizePt": 14},
  {"paragraphIndex": 168, "id": "1d0ac78debd74f3cf2357007d8268d754fe4041d64a521b07dec5519f2139989", "originalText": "第十五条  违约责任", "publicText": "第十五条  违约责任", "fontFamily": "黑体", "fontSizePt": 14},
  {"paragraphIndex": 180, "id": "d1540407cb236b11a00d3ba56a3cf03c014c2071ec34600ead2cead537910f04", "originalText": "第十六条  保密", "publicText": "第十六条  保密", "fontFamily": "黑体", "fontSizePt": 14},
  {"paragraphIndex": 182, "id": "9dccecdf0a84fd400b8a35dc8ea32c50e74641fced9f0ad15d9798392ec340a7", "originalText": "第十七条  不可抗力", "publicText": "第十七条  不可抗力", "fontFamily": "黑体", "fontSizePt": 14},
  {"paragraphIndex": 184, "id": "b7d7e75afe728e71dd0deb3f77094c83befb99b73229beba8c71670667ddceb0", "originalText": "第十八条  争议的解决", "publicText": "第十八条  争议的解决", "fontFamily": "黑体", "fontSizePt": 14},
  {"paragraphIndex": 186, "id": "47ed4b1e12d481f93d46b90f4680d85c23335d96bd18824547e4760127b63bd4", "originalText": "第十九条  合同生效、合同的终止与解除", "publicText": "第十九条  合同生效、合同的终止与解除", "fontFamily": "黑体", "fontSizePt": 14},
  {"paragraphIndex": 192, "id": "ff018d5aaa492b1a0055fcb9d50d23e85aa52b562a7f8cf940d7cb0f59683d0c", "originalText": "第二十条  工作联络", "publicText": "第二十条  工作联络", "fontFamily": "黑体", "fontSizePt": 14},
  {"paragraphIndex": 196, "id": "8612ac838c3965a150d63f65bdc87b3b758ec008b63567c13f48a2b4dca61fb9", "originalText": "第二十一条  其他约定事项", "publicText": "第二十一条  其他约定事项", "fontFamily": "黑体", "fontSizePt": 14},
] as const;
const unclassifiedControls = [
  {"paragraphIndex": 104, "id": "19d19f7bd96a4e831b092331e6849e265b5a4fbc18ed92214c6dc8ac68b48722", "text": "5.增值税专用发票丢失的补救措施：若买方发生丢失增值税专用发票发票联或抵扣联的情况,则卖方必须向买方提供该增值税专用发票记账联复印件等资料。 ", "fontFamily": "仿宋_GB2312", "fontSizePt": 14},
  {"paragraphIndex": 108, "id": "ceecc16852ac1d0b47b4a95b36af279e7f12309ec679d564876eca7f1a68d083", "text": "9.特别约定：由于国家政策的调整引起的合同相关要件的变更，将以国家政策为准，以适用国家政策规定。", "fontFamily": "仿宋_GB2312", "fontSizePt": 14},
] as const;
const ordinarySource = {"id": "83d59eb52c32699fa63475d380aac6eb0c17e0eafe7411b51456fc07dbe930bf", "text": "4.若卖方违背上述规定且经买方法人单位或其上级纪委监察机关查实认定，或国家司法机关立案查处，视为卖方违约，卖方承担暂定合同总价的10%的违约金，违约金及卖方因违背廉洁规定行为所取得的不当利益一并在结算中扣除。", "expectedFamily": "仿宋_GB2312", "expectedSizePt": 14} as const;
type PublicBody = Omit<Body, "blocks"> & { blocks: ContractBodyParagraph[]; flow: ContractBodyFlow[]; draftRevision: number; layoutTemplateVersionId: string };

interface PublicRow {
  id: string; rowKey: string; sortOrder: number; itemCode: string | null; itemName: string; specification: string | null;
  unit: string; quantity: string; unitPrice: string; taxRate: string; taxRatePercent: string; taxRateSource: string;
  pricingFactStatus: string; precisionPolicy: string; numericProtocolVersion: number; numericSource: string; numericReviewStatus: string;
  taxInclusiveAmountYuan: string; taxExclusiveAmountYuan: string; taxAmountYuan: string;
  taxInclusiveAmountCents: string; taxExclusiveAmountCents: string; taxAmountCents: string; taxExclusiveUnitPrice: string;
  isProvisional: boolean; settlementBasis: string | null; customData: Record<string, unknown>;
}
interface PublicBill {
  id: string; billKey: string; name: string; revision: number; amountRole: string; pricingMode: string; quantityScale: number; unitPriceScale: number;
  schemaSnapshot: unknown; sourceExcelFileId: string | null; numericProtocolVersion: number;
  taxInclusiveAmountYuan: string; taxExclusiveAmountYuan: string; taxAmountYuan: string;
  taxInclusiveAmountCents: string; taxExclusiveAmountCents: string; taxAmountCents: string; rows: PublicRow[];
}
interface PublicParty { id: string; roleKey: string; displayOrder: number; businessPartyVersionId?: string | null; snapshot: Record<string, unknown> }

describe("task10 material V2 primary and secondary roles in actual public Word/PDF export", () => {
  it("consumes an explicit historical V2 owner and exports all28 source roles, original facts and hand edits in one authorized actual pair", async () => {
    const python = process.env.TEMPLATE_PDF_INSPECTOR_PYTHON;
    if (!python || process.env.TEMPLATE_PDF_RUNTIME_MODE !== "font-profile") throw new Error("材料V2全部28角色实际检查需要原锁定物理环境");
    const repository = await task10HttpRepository(__dirname);
    expect(process.env.CONTRACT_DOCX4J_RUNTIME_MANIFEST).toBe(runtimePath);
    expect(process.env.TEMPLATE_PDF_RUNTIME_MANIFEST).toBe(inspectionPath);
    expect(sha(await readFile(runtimePath))).toBe(runtimeSha); expect(sha(await readFile(inspectionPath))).toBe(inspectionSha);
    expect(sha(await readFile(join(repository, "services/api/assets/document-converter/runtime-lock.json")))).toBe(lockSha);
    const directory = await mkdtemp(join(tmpdir(), "jg-task10-material-v2-role-export-"));
    const runtime = JSON.parse(await readFile(runtimePath, "utf8")) as { scratchDirectory: string };
    const beforeScratch = await readdir(runtime.scratchDirectory);
    const server = await createTemplateTestServer({ draftWorkbench: true });
    const upload = jest.spyOn(server.files, "uploadPrivateFile");
    try {
      const sourcePath = join(repository, "services/api/assets/templates/material-purchase-real-v1.docx");
      const source = await readFile(sourcePath); expect(sha(source)).toBe(sourceSha);
      const layout = await confirmedBodyLayout(server, source, "materials");
      const draft = await createTask09Draft(server);
      const rows = [{ clientRowKey: "v2-full-role-material-row", sortOrder: 0, itemName: "正文清单钢材", unit: "吨", quantity: "2", unitPrice: "3.2500", taxRatePercent: "0", customData: {} }];
      expect((await saveTask09Draft(server, draft, "material_purchase", layout.id)).status).toBe(200);
      const factSave = await saveBody(draft, undefined, "当前单甲方", rows);
      expect(factSave.status === 200 ? "OK" : await factSave.text()).toBe("OK");
      const firstResponse = await fetch(draft.base + "/document-body", { headers: draft.headers }); expect(firstResponse.status).toBe(200);
      const before = await firstResponse.json() as PublicBody;
      const ordered = before.flow.filter((node): node is Extract<ContractBodyFlow, { kind: "paragraph" }> => node.kind === "paragraph").map(node => before.blocks.find(block => block.id === node.paragraphId)!);
      expect(ordered.every(Boolean)).toBe(true);
      const titles = ordered.filter(block => block.text === "上游新建当前合同名称"); expect(titles).toHaveLength(2);
      const [cover, bodyTitle] = titles; const coverAt = ordered.indexOf(cover), titleAt = ordered.indexOf(bodyTitle);
      expect(coverAt).toBeLessThan(titleAt);
      expect(ordered.slice(coverAt + 1, titleAt).some(block => block.text.startsWith("合同编号："))).toBe(true);
      expect(ordered.slice(coverAt + 1, titleAt).some(block => block.text.startsWith("签订日期："))).toBe(true);
      const articles = ordered.filter(block => block.text === articleText); expect(articles).toHaveLength(1);
      const article = articles[0]; expect(titleAt).toBeLessThan(ordered.indexOf(article));
      expect(ordered.slice(titleAt + 1, ordered.indexOf(article)).some(block => block.text.trim() === "买方：当前单甲方")).toBe(true);
      expect(ordered.slice(titleAt + 1, ordered.indexOf(article)).some(block => block.text.trim() === "卖方：当前单乙方")).toBe(true);
      expect([cover.id, bodyTitle.id, article.id]).toEqual(["fe8a01bb7008d14107fd6abe3584dee8f92c5544c883bbd85c67e4dcadd4a17c", "981566748de797f0cf4163f6d8a2c0f07d4dd7d307f5feeab12dbbda80d9a3e9", "57f235223908a8e8e9e5ec8ab353aeec459cda68819ed706d391c029d9879d72"]);
      const ordinary = before.blocks.find(block => block.editable && block.text.startsWith("4.若卖方违背")); expect(ordinary).toBeDefined();
      expect(ordinary).toMatchObject({ id: ordinarySource.id, text: ordinarySource.text, editable: true });
      const manualText = ordinarySource.text + "双方人工补充约定应当保留。";
      const currentResponse = await fetch(draft.base + "/workbench", { headers: draft.headers }); expect(currentResponse.status).toBe(200);
      const current = await currentResponse.json(); expect(current.bills.map((bill: { billKey: string }) => bill.billKey)).toEqual(["main"]);
      // All fact setup is public. The traced save omits the server-owned profile.
      const draftData: Record<string, unknown> = { ...current.version.draftData, contractName: title,
        documentBody: { protocolVersion: 1, layoutTemplateVersionId: layout.id, sourceSha256: sourceSha,
          edits: [{ positionId: ordinary!.id, text: manualText }] } };
      delete draftData.documentRenderProfile;
      expect(Object.hasOwn(draftData, "documentRenderProfile")).toBe(false);
      const aggregateInput = {
        idempotencyKey: randomUUID(), saveKind: "manual", expectedRevision: current.version.draftRevision, changedSections: ["draft", "parties", "bills"],
        draft: { numericProtocolVersion: 2, draftData,
          clauses: [], pricingNature: "unit_price", amountSource: "bill_sum", layoutTemplateVersionId: layout.id,
          taxFacts: { invoiceType: null, taxMode: "single_rate", defaultTaxRatePercent: "0", source: "contract_document" } },
        parties: [{ roleKey: "party_a", displayOrder: 0, snapshot: { name: "当前单甲方" } }, { roleKey: "party_b", displayOrder: 0, snapshot: { name: "当前单乙方" } }],
        bills: current.bills.map((bill: { billKey: string; revision: number }) => ({ billKey: bill.billKey, expectedRevision: bill.revision, numericProtocolVersion: 2, rows })),
        paymentTerms: null, attachments: [], negotiationDocuments: { referencedGeneratedDocumentIds: [] }
      };
      await writeFile(join(directory, "public-save-without-profile.json"), JSON.stringify(aggregateInput, null, 2));
      const saved = await fetch(draft.base, { method: "PUT", headers: { ...draft.headers, "x-contract-draft-lease": draft.leaseToken }, body: JSON.stringify(aggregateInput) });
      expect(saved.status === 200 ? "OK" : await saved.text()).toBe("OK");
      const wbResponse = await fetch(draft.base + "/workbench", { headers: draft.headers }); expect(wbResponse.status).toBe(200); let wb = await wbResponse.json();
      expect(wb.version).toMatchObject({ amountYuan: "6.5000", numericProtocolVersion: 2, taxFacts: { taxMode: "single_rate", defaultTaxRatePercent: "0" },
        draftData: { contractName: title, documentRenderProfile: { typographyVersion: "reviewed-material-primary-secondary-body25-v4" } } });
      expect(wb.version.draftData.documentRenderProfile).toEqual({ typographyVersion: "reviewed-material-primary-secondary-body25-v4", signatureDateVersion: "reviewed-material-signature-date-v1" });
      expect(wb.version.documentContentFingerprint).toMatch(/^[a-f0-9]{64}$/u);
      expect(wb.version.documentContentFingerprint).not.toBe(current.version.documentContentFingerprint);
      expect(wb.bills).toHaveLength(1); expect(wb.bills[0]).toMatchObject({ billKey: "main", taxInclusiveAmountYuan: "6.5000", taxExclusiveAmountYuan: "6.5000", taxAmountYuan: "0.0000" });
      expect(wb.bills[0].rows).toHaveLength(1); expect(wb.bills[0].rows[0]).toMatchObject({ itemName: "正文清单钢材", quantity: "2", unit: "吨", unitPrice: "3.25", taxRatePercent: "0", taxInclusiveAmountYuan: "6.5000", taxExclusiveAmountYuan: "6.5000", taxAmountYuan: "0.0000" });
      // Historical fixture preparation ONLY, after every real business save has completed.
      // The exported F builder calibrates the complete public projection first;
      // its result is not an expected producer/worker fingerprint acceptance value.
      const currentSaved = wb;
      expect(currentSaved.draft).toEqual(currentSaved.version.draftData);
      expect(currentSaved.paymentTerms).toMatchObject({ originalText: "", stages: [] });
      expect(currentSaved.attachments).toEqual([]); expect(currentSaved.version.clauseSnapshot).toEqual([]);
      const fixtureInput = {
        templateSnapshot: currentSaved.version.templateSnapshot, layoutTemplateVersionId: layout.id,
        parties: currentSaved.parties.map((party: PublicParty) => ({ roleKey: party.roleKey, displayOrder: party.displayOrder,
          businessPartyVersionId: party.businessPartyVersionId ?? null, snapshot: party.snapshot })),
        subjectAndScope: currentSaved.draft,
        amountAndTax: { pricingNature: currentSaved.version.pricingNature, amountSource: currentSaved.version.amountSource,
          amountCents: currentSaved.version.amountCents, numericProtocolVersion: 2, amountYuan: currentSaved.version.amountYuan,
          estimatedAmountCents: currentSaved.version.estimatedAmountCents, amountAdjustmentReason: currentSaved.version.amountAdjustmentReason,
          taxFacts: { invoiceType: currentSaved.version.taxFacts.invoiceType, taxMode: currentSaved.version.taxFacts.taxMode,
            defaultTaxRatePercent: currentSaved.version.taxFacts.defaultTaxRatePercent, source: currentSaved.version.taxFacts.source },
          bills: currentSaved.bills.map((bill: PublicBill) => ({ billKey: bill.billKey, name: bill.name, amountRole: bill.amountRole,
            pricingMode: bill.pricingMode, quantityScale: bill.quantityScale, unitPriceScale: bill.unitPriceScale, schemaSnapshot: bill.schemaSnapshot,
            sourceExcelFileId: bill.sourceExcelFileId, taxInclusiveAmountCents: bill.taxInclusiveAmountCents,
            numericProtocolVersion: bill.numericProtocolVersion, taxInclusiveAmountYuan: bill.taxInclusiveAmountYuan,
            taxExclusiveAmountYuan: bill.taxExclusiveAmountYuan, taxAmountYuan: bill.taxAmountYuan,
            taxExclusiveAmountCents: bill.taxExclusiveAmountCents, taxAmountCents: bill.taxAmountCents,
            rows: bill.rows.map((row: PublicRow) => ({ rowKey: row.rowKey, sortOrder: row.sortOrder, itemCode: row.itemCode,
              itemName: row.itemName, specification: row.specification, unit: row.unit, quantity: row.quantity,
              unitPrice: row.unitPrice, taxRate: row.taxRate, taxRateSource: row.taxRateSource, pricingFactStatus: row.pricingFactStatus,
              precisionPolicy: row.precisionPolicy, numericProtocolVersion: row.numericProtocolVersion, numericSource: row.numericSource,
              numericReviewStatus: row.numericReviewStatus, taxInclusiveAmountYuan: row.taxInclusiveAmountYuan,
              taxExclusiveAmountYuan: row.taxExclusiveAmountYuan, taxAmountYuan: row.taxAmountYuan,
              taxInclusiveAmountCents: row.taxInclusiveAmountCents, taxExclusiveAmountCents: row.taxExclusiveAmountCents,
              taxAmountCents: row.taxAmountCents, taxExclusiveUnitPrice: row.taxExclusiveUnitPrice, isProvisional: row.isProvisional,
              settlementBasis: row.settlementBasis, customData: row.customData })) })) },
        paymentTerms: { originalText: currentSaved.paymentTerms.originalText, stages: [] },
        clauses: currentSaved.version.clauseSnapshot, attachments: []
      };
      const calibratedF = calculateContractDocumentContentFingerprint(fixtureInput);
      expect(calibratedF).toBe(currentSaved.version.documentContentFingerprint);
      const historicalDraft = { ...currentSaved.draft, documentRenderProfile: { typographyVersion } };
      const historicalF = calculateContractDocumentContentFingerprint({ ...fixtureInput, subjectAndScope: historicalDraft });
      expect(historicalF).toMatch(/^[a-f0-9]{64}$/u); expect(historicalF).not.toBe(calibratedF);
      const historicalDraftR = currentSaved.version.draftRevision + 1, historicalContentR = currentSaved.version.documentContentRevision + 1;
      await writeFile(join(directory, "historical-owner-fixture-construction.json"), JSON.stringify({
        publicBaseline: currentSaved, calibratedF, historicalDraft, historicalCoordinates: {
          draftRevision: historicalDraftR, documentContentRevision: historicalContentR, fingerprint: historicalF, layoutTemplateVersionId: layout.id },
        calibrationIsFixtureConsistencyNotFingerprintAcceptance: true, syntheticHistoricalImportNotCompleteAuditLifecycle: true
      }, null, 2));
      // Sole historical persistence write. Existing aggregate receipt/checkpoint/audit remain at their original coordinates.
      await server.store.prisma.contractVersion.update({ where: { id: draft.version.id }, data: {
        draftData: historicalDraft, layoutTemplateVersionId: layout.id, draftRevision: historicalDraftR,
        documentContentRevision: historicalContentR, documentContentFingerprint: historicalF
      } });
      Object.defineProperty(server, "store", { configurable: false, get() { throw new Error("历史准备完成后禁止测试访问store"); } });
      const historicalWbResponse = await fetch(draft.base + "/workbench", { headers: draft.headers }); expect(historicalWbResponse.status).toBe(200);
      wb = await historicalWbResponse.json();
      expect(wb.version).toEqual({ ...currentSaved.version, draftData: historicalDraft, layoutTemplateVersionId: layout.id,
        draftRevision: historicalDraftR, documentContentRevision: historicalContentR, documentContentFingerprint: historicalF,
        updatedAt: wb.version.updatedAt });
      expect(typeof wb.version.updatedAt).toBe("string");
      expect(Date.parse(wb.version.updatedAt)).toBeGreaterThanOrEqual(Date.parse(currentSaved.version.updatedAt));
      expect(wb.draft).toEqual(historicalDraft);
      for (const section of ["parties", "bills", "paymentTerms", "attachments"]) expect(wb[section]).toEqual(currentSaved[section]);
      await writeFile(join(directory, "historical-owner-public-workbench.json"), JSON.stringify(wb, null, 2));
      const bodyResponse = await fetch(draft.base + "/document-body", { headers: draft.headers }); expect(bodyResponse.status).toBe(200); const body = await bodyResponse.json() as PublicBody;
      expect(body).toMatchObject({ sourceSha256: sourceSha, layoutTemplateVersionId: layout.id, draftRevision: wb.version.draftRevision, documentContentRevision: wb.version.documentContentRevision });
      expect(body.blocks.map(block => block.id)).toEqual(before.blocks.map(block => block.id));
      expect(body.blocks.find(block => block.id === ordinary!.id)).toMatchObject({ text: manualText, editable: true });
      for (const [id, text, family, size] of [[cover.id, title, "方正小标宋简体", 22], [bodyTitle.id, title, "方正小标宋简体", 22], [article.id, articleText, "黑体", 14]] as const)
        expect(body.blocks.find(block => block.id === id)).toMatchObject({ text, format: { fontFamily: family, fontSizePt: size } });
      expect(roleExpectations).toHaveLength(28);
      expect(new Set(roleExpectations.map(role => role.id)).size).toBe(28);
      for (const role of roleExpectations) expect(body.blocks.find(block => block.id === role.id)).toMatchObject({
        id: role.id, text: role.publicText, format: { fontFamily: role.fontFamily, fontSizePt: role.fontSizePt }
      });
      for (const control of unclassifiedControls) expect(body.blocks.find(block => block.id === control.id)).toMatchObject({
        text: control.text, format: { fontFamily: control.fontFamily, fontSizePt: control.fontSizePt }
      });
      const roleIds = new Set<string>(roleExpectations.map(role => role.id));
      expect(body.blocks.filter(block => !roleIds.has(block.id)).map(block => [block.id, block.format])).toEqual(
        before.blocks.filter(block => !roleIds.has(block.id)).map(block => [block.id, block.format]));
      await writeFile(join(directory, "public-v2-saved-facts.json"), JSON.stringify({ wb, body, roleExpectations,
        profileOmittedFromTracedSave: !Object.hasOwn(draftData, "documentRenderProfile"), exportOrNativeYet: false }, null, 2));
      const tables = body.flow.filter((node): node is Extract<ContractBodyFlow, { kind: "table" }> => node.kind === "table"); expect(tables.map(table => table.rows.length)).toEqual([2, 1]);
      const sameResponse = await fetch(draft.base + "/workbench", { headers: draft.headers }); expect(sameResponse.status).toBe(200);
      expect((await sameResponse.json()).version).toMatchObject({ draftRevision: body.draftRevision, documentContentRevision: body.documentContentRevision, documentContentFingerprint: wb.version.documentContentFingerprint });
      await writeFile(join(directory, "public-body-readback.json"), JSON.stringify(body, null, 2));
      await writeFile(join(directory, "normative-role-context.json"), JSON.stringify({ sourceSha256: sourceSha, title,
        typographyVersion, roleExpectations, unclassifiedControls, coverId: cover.id, ordinaryId: ordinary!.id,
        manualText, totalLiteral, expectedLatin: "Times New Roman", actualPairPaths: {
          docx: join(directory, "actual.docx"), pdf: join(directory, "actual.pdf") },
        limits: ["Word28 role/rPr/pPr proof first", "PDF28 program/GID/outline/size association is a separate observer"] }, null, 2));
      const documentsBefore = await fetch(`${await server.app.getUrl()}/contract-workbench/${draft.version.id}/documents`, { headers: draft.headers }); expect(documentsBefore.status).toBe(200); expect(await documentsBefore.json()).toEqual([]);
      const asRunPaths = ["services/api/src/contract-template/task10-http-repository.test-support.ts", "services/api/src/contract-template/task10-material-primary-secondary-roles-export.http.spec.ts", "services/api/src/contract-template/task10-body.test-support.ts", "services/api/src/contract-template/task10-material-primary-secondary-roles.http.spec.ts", "services/api/src/contract-template/task09-draft-template.test-support.ts", "services/api/src/contract-template/template-management.test-support.ts", "services/api/src/contract-document/contract-body-document.ts", "services/api/src/contract-document/contract-document.service.ts", "services/api/src/contract-document/contract-document.processor.ts", "services/api/src/contract-document/contract-body-pdf-converter.ts", "services/api/src/contract-workbench/contract-draft-aggregate.service.ts", "services/api/src/contract-workbench/contract-workbench.service.ts", "services/api/src/contract-template/template-pdf-physical.test-support.ts", "services/api/test-support/inspect-contract-pdf-physical.py"];
      await writeFile(join(directory, "as-run-source-pins.json"), JSON.stringify(await Promise.all(asRunPaths.map(async path => ({ path, sha256: sha(await readFile(join(repository, path))) }))), null, 2));
      upload.mockClear();
      const queued = await fetch(draft.base + "/preview-generation", { method: "POST", headers: draft.headers, body: JSON.stringify({ sourceRevision: body.draftRevision }) });
      expect(queued.status === 201 ? "OK" : await queued.text()).toBe("OK"); const generation = await queued.json();
      expect(generation).toMatchObject({ status: "queued", documentContentRevision: body.documentContentRevision, documentContentFingerprint: wb.version.documentContentFingerprint });
      const list = async () => { const response = await fetch(`${await server.app.getUrl()}/contract-workbench/${draft.version.id}/documents`, { headers: draft.headers }); expect(response.status).toBe(200); return await response.json(); };
      const frozen = { purpose: "draft", layoutTemplateVersionId: layout.id, documentContentRevision: body.documentContentRevision, documentContentFingerprint: wb.version.documentContentFingerprint,
        inputSnapshot: { documentContentRevision: body.documentContentRevision, documentContentFingerprint: wb.version.documentContentFingerprint,
          bodyDocument: { sourceSha256: sourceSha, renderSemanticVersion: "contract-money-v1", tableLayoutVersion: "body-bill-loop-v2", typographyVersion, pdfEngine: "docx4j-17.3.5", runtimeLockSha256: lockSha },
          renderInput: { values: { "contract.typographyVersion": typographyVersion, "contract.renderSemanticVersion": "contract-money-v1", "contract.tableLayoutVersion": "body-bill-loop-v2", "contract.taxRateLabel": "0%", "contract.amountBasis": "tax_inclusive", "contract.taxInclusiveAmount": "6.5000", "contract.taxExclusiveAmount": "6.5000", "contract.taxAmount": "0.0000" } } } };
      const queuedDocument = (await list()).find((row: { id: string }) => row.id === generation.generationId);
      expect(queuedDocument).toMatchObject({ ...frozen, status: "queued" });
      // Exact public tuple, independent of the service's private key helper.
      const queuedKeyTuple = [draft.version.id, body.documentContentRevision, wb.version.documentContentFingerprint, layout.id, "draft", [],
        "contract-body-docx4j-v1", lockSha, "contract-money-v1", "body-bill-loop-v2", typographyVersion];
      expect(queuedDocument.idempotencyKey).toBe(sha(JSON.stringify(queuedKeyTuple)));
      await writeFile(join(directory, "public-v2-queued-key.json"), JSON.stringify({ queuedKeyTuple, queuedDocument }, null, 2));
      const workerStarted = performance.now(); let workerOverBudget = false;
      const timer = setTimeout(() => { workerOverBudget = true; }, 130_000);
      try { expect(await server.processor.processNext()).toBe(true); }
      finally { clearTimeout(timer); await writeFile(join(directory, "worker-budget.json"), JSON.stringify({ elapsedMs: performance.now() - workerStarted, budgetMs: 130_000, ownedOperationSettled: true })); }
      expect(workerOverBudget).toBe(false); expect(performance.now() - workerStarted).toBeLessThanOrEqual(130_000);
      const output = (await list()).find((row: { id: string }) => row.id === generation.generationId);
      expect(output).toMatchObject({ ...frozen, status: "success", docxFileId: expect.any(String), pdfFileId: expect.any(String) });
      expect(output.idempotencyKey).toBe(queuedDocument.idempotencyKey);
      expect(output.inputSnapshot.inspection.runtime).toMatchObject({ engine: "docx4j-17.3.5-jdk17", runtimeLockSha256: lockSha, runtimeManifestSha256: runtimeSha, conversionCalls: 1, boundaryDenials: 3 });
      const scratch = (await readdir(runtime.scratchDirectory)).filter(name => !beforeScratch.includes(name)); expect(scratch).toHaveLength(1);
      const completed = JSON.parse(await readFile(join(runtime.scratchDirectory, scratch[0], "completed.json"), "utf8"));
      expect(completed).toMatchObject({ runtimeLockSha256: lockSha, runtimeManifestSha256: runtimeSha, conversionCalls: 1, boundaryDenials: 3 });
      const rawPdf = join(runtime.scratchDirectory, scratch[0], "output.pdf"); expect((await stat(rawPdf)).size).toBeLessThanOrEqual(100_000_000); expect(sha(await readFile(rawPdf))).toBe(completed.pdfSha256);
      await writeFile(join(directory, "runtime-completed-receipt.json"), JSON.stringify(completed, null, 2));
      const files = {} as Record<"docx" | "pdf", Buffer>;
      for (const [format, id] of [["docx", output.docxFileId], ["pdf", output.pdfFileId]] as const) {
        const capability = await fetch(`${await server.app.getUrl()}/files/${id}/download-ticket-capability`, { headers: draft.headers }); expect(capability.status).toBe(200);
        expect(await capability.json()).toMatchObject({ action: { key: "create_private_file_download_ticket", enabled: true }, availableActions: expect.arrayContaining(["create_private_file_download_ticket"]) });
        const ticket = await fetch(`${await server.app.getUrl()}/files/${id}/download-ticket`, { method: "POST", headers: draft.headers,
          body: JSON.stringify({ confirmationPassword: server.password, downloadReason: "材料V2全部28角色当前草稿双格式及原条款核验" }) }); expect(ticket.status).toBe(201);
        const { downloadUrl } = await ticket.json(); expect(downloadUrl).toMatch(/^\/files\/[^/?#]+\/download\?/u); const downloaded = await fetch(`${await server.app.getUrl()}${downloadUrl}`, { headers: draft.headers }); expect(downloaded.status).toBe(200);
        files[format] = Buffer.from(await downloaded.arrayBuffer()); await writeFile(join(directory, "actual." + format), files[format]);
      }
      expect(sha(files.docx)).toBe(output.inputSnapshot.inspection.runtime.exportedDocxSha256); expect(sha(files.pdf)).toBe(output.inputSnapshot.inspection.runtime.exportedPdfSha256);
      expect(files.pdf.subarray(0, 5).toString()).toBe("%PDF-"); expect(files.pdf.length).toBeLessThanOrEqual(100_000_000);
      await writeFile(join(directory, "receipt.json"), JSON.stringify({ sourceSha256: sourceSha, generation, output,
        docxSha256: sha(files.docx), pdfSha256: sha(files.pdf), verdict: "PENDING", legalSigningAcceptance: false }, null, 2));

      const zip = new PizZip(files.docx), original = new PizZip(source); const ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
      const parse = (xml: string) => new DOMParser().parseFromString(xml, "application/xml"); const word = parse(zip.file("word/document.xml")!.asText()), sourceWord = parse(original.file("word/document.xml")!.asText());
      const textOf = (element: Element) => Array.from(element.getElementsByTagNameNS(ns, "t")).map(t => t.textContent ?? "").join("");
      const paragraphs = Array.from(word.getElementsByTagNameNS(ns, "p")), sourceParagraphs = Array.from(sourceWord.getElementsByTagNameNS(ns, "p"));
      const texts = paragraphs.map(textOf), sourceTexts = sourceParagraphs.map(textOf), compact = (s: string) => s.replace(/\s/gu, "");
      expect(texts).toContain(totalLiteral); expect(texts).toContain(manualText); expect(texts.filter(text => text === title)).toHaveLength(2);
      for (const text of sourceTexts.filter(text => text.trim() && !/[{}]/u.test(text) && text !== ordinary!.text)) expect(texts).toContain(text);
      const titleParagraphs = paragraphs.filter(p => textOf(p) === title); expect(titleParagraphs).toHaveLength(2);
      const sourceTitles = sourceParagraphs.filter(p => textOf(p) === "{合同名称}"); expect(sourceTitles).toHaveLength(2);
      const articleParagraphs = paragraphs.filter(p => textOf(p) === articleText); expect(articleParagraphs).toHaveLength(1);
      const sourceArticles = sourceParagraphs.filter(p => textOf(p) === articleText); expect(sourceArticles).toHaveLength(1);
      // Source order identifies cover then body title; no observed font chooses roles.
      expect(paragraphs.indexOf(titleParagraphs[0])).toBeLessThan(paragraphs.indexOf(titleParagraphs[1]));
      expect(paragraphs.indexOf(titleParagraphs[1])).toBeLessThan(paragraphs.indexOf(articleParagraphs[0]));
      const direct = (parent: Element, name: string) => Array.from(parent.childNodes).filter((node): node is Element => node.nodeType === 1 && (node as Element).namespaceURI === ns && (node as Element).localName === name);
      const serialized = (element: Element) => new XMLSerializer().serializeToString(element);
      const sourceBody = sourceWord.getElementsByTagNameNS(ns, "body")[0];
      const actualBody = word.getElementsByTagNameNS(ns, "body")[0];
      const visibleRuns = (paragraph: Element) => Array.from(paragraph.getElementsByTagNameNS(ns, "r")).filter(run => textOf(run).length > 0);
      // Ignore exactly the version-owned font/size fields; all other source rPr remains.
      const preservedRunProperties = (run: Element) => {
        const properties = direct(run, "rPr")[0];
        if (!properties) return [];
        const copy = properties.cloneNode(true) as Element;
        for (const property of direct(copy, "sz").concat(direct(copy, "szCs"))) copy.removeChild(property);
        for (const fonts of direct(copy, "rFonts")) {
          for (const key of ["eastAsia", "ascii", "hAnsi", "cs", "asciiTheme", "hAnsiTheme", "eastAsiaTheme", "cstheme"]) fonts.removeAttributeNS(ns, key);
          if (!fonts.attributes.length) copy.removeChild(fonts);
        }
        return Array.from(copy.childNodes).filter((node): node is Element => node.nodeType === 1).map(serialized);
      };
      const assertVisibleRunFont = (paragraph: Element, family: string, sizePt: number) => {
        const runs = visibleRuns(paragraph); expect(runs.length).toBeGreaterThan(0);
        for (const run of runs) {
          const properties = direct(run, "rPr"); expect(properties).toHaveLength(1);
          const fonts = direct(properties[0], "rFonts"); expect(fonts).toHaveLength(1);
          expect(fonts[0].getAttributeNS(ns, "eastAsia")).toBe(family);
          expect(["ascii", "hAnsi", "cs"].map(key => fonts[0].getAttributeNS(ns, key))).toEqual(["Times New Roman", "Times New Roman", "Times New Roman"]);
          for (const theme of ["asciiTheme", "hAnsiTheme", "eastAsiaTheme", "cstheme"]) expect(fonts[0].hasAttributeNS(ns, theme)).toBe(false);
          for (const name of ["sz", "szCs"]) { const sizes = direct(properties[0], name); expect(sizes).toHaveLength(1); expect(sizes[0].getAttributeNS(ns, "val")).toBe(String(sizePt * 2)); }
        }
      };
      const wordRoleFacts = roleExpectations.map(role => {
        const originalParagraph = sourceParagraphs[role.paragraphIndex];
        expect(originalParagraph).toBeDefined(); expect(textOf(originalParagraph)).toBe(role.originalText);
        expect(originalParagraph.parentNode).toBe(sourceBody);
        expect(sha(JSON.stringify([sourceSha, "word/document.xml", role.paragraphIndex, role.originalText]))).toBe(role.id);
        // All headings are unique fulltext anchors. The duplicate contract title
        // is disambiguated by the already-checked source cover/body order/context.
        const matches = paragraphs.filter(paragraph => textOf(paragraph) === role.publicText);
        expect(matches).toHaveLength(role.paragraphIndex === 26 ? 2 : 1);
        const paragraph = role.paragraphIndex === 26 ? titleParagraphs[1] : matches[0];
        expect(paragraph.parentNode).toBe(actualBody);
        expect(direct(paragraph, "pPr").map(serialized)).toEqual(direct(originalParagraph, "pPr").map(serialized));
        assertVisibleRunFont(paragraph, role.fontFamily, role.fontSizePt);
        expect(visibleRuns(paragraph).map(preservedRunProperties)).toEqual(visibleRuns(originalParagraph).map(preservedRunProperties));
        return { id: role.id, originalText: role.originalText, expectedText: role.publicText,
          paragraphIndex: paragraphs.indexOf(paragraph), sourceParagraphIndex: role.paragraphIndex,
          expectedEastAsia: role.fontFamily, expectedSizePt: role.fontSizePt,
          sourcePPr: direct(originalParagraph, "pPr").map(serialized), actualPPr: direct(paragraph, "pPr").map(serialized),
          actualVisibleRuns: visibleRuns(paragraph).map(run => ({ text: textOf(run), rPr: direct(run, "rPr").map(serialized) })) };
      });
      expect(wordRoleFacts.map(fact => fact.paragraphIndex)).toEqual(wordRoleFacts.map(fact => fact.paragraphIndex).slice().sort((a, b) => a - b));
      expect(new Set(wordRoleFacts.map(fact => fact.paragraphIndex)).size).toBe(28);
      for (const control of unclassifiedControls) {
        const originalParagraph = sourceParagraphs[control.paragraphIndex];
        expect(textOf(originalParagraph)).toBe(control.text);
        expect(sha(JSON.stringify([sourceSha, "word/document.xml", control.paragraphIndex, control.text]))).toBe(control.id);
        const matches = paragraphs.filter(paragraph => textOf(paragraph) === control.text); expect(matches).toHaveLength(1);
        expect(direct(matches[0], "pPr").map(serialized)).toEqual(direct(originalParagraph, "pPr").map(serialized));
        expect(visibleRuns(matches[0]).map(run => direct(run, "rPr").map(serialized))).toEqual(visibleRuns(originalParagraph).map(run => direct(run, "rPr").map(serialized)));
        assertVisibleRunFont(matches[0], control.fontFamily, control.fontSizePt);
      }
      const sourceOrdinaryMatches = sourceParagraphs.filter(paragraph => textOf(paragraph) === ordinarySource.text);
      expect(sourceOrdinaryMatches).toHaveLength(1);
      const originalOrdinary = sourceOrdinaryMatches[0];
      expect(originalOrdinary.parentNode).toBe(sourceBody);
      expect(sha(JSON.stringify([sourceSha, "word/document.xml", sourceParagraphs.indexOf(originalOrdinary), ordinarySource.text]))).toBe(ordinarySource.id);
      const actualOrdinary = paragraphs.filter(paragraph => textOf(paragraph) === manualText);
      expect(actualOrdinary).toHaveLength(1);
      expect(direct(actualOrdinary[0], "pPr").map(serialized)).toEqual(direct(originalOrdinary, "pPr").map(serialized));
      assertVisibleRunFont(actualOrdinary[0], "仿宋_GB2312", 14);
      expect(direct(titleParagraphs[0], "pPr").map(serialized)).toEqual(direct(sourceTitles[0], "pPr").map(serialized));
      assertVisibleRunFont(titleParagraphs[0], "方正小标宋简体", 22);
      await writeFile(join(directory, "word28-source-qualified-facts.json"), JSON.stringify({ sourceSha256: sourceSha, typographyVersion,
        sourceRoleAuditSHA: "8a39415c1d0e3210d3d2418dcf7c77717ab4723e212ea282c299bf8d850b29eb",
        wordRoleFacts, ordinarySourceText: ordinary!.text, manualText, unclassifiedControls,
        wordMainParagraphs: texts, sourceMainParagraphs: sourceTexts }, null, 2));
      // Cover is a preservation control, separate from the two changed roles.
      expect(Array.from(titleParagraphs[0].getElementsByTagNameNS(ns, "r")).filter(run => textOf(run).length).map(run => direct(run, "rPr").map(serialized))).toEqual(
        Array.from(sourceTitles[0].getElementsByTagNameNS(ns, "r")).filter(run => textOf(run).length).map(run => direct(run, "rPr").map(serialized)));
      const wordTables = Array.from(word.getElementsByTagNameNS(ns, "tbl")); expect(wordTables).toHaveLength(2);
      expect(wordTables.map(table => Array.from(table.getElementsByTagNameNS(ns, "gridCol")).map(col => Number(col.getAttributeNS(ns, "w"))))).toEqual([[510, 1276, 1106, 680, 765, 1446, 510, 2211], [4252, 4252]]);
      const materialRows = Array.from(wordTables[0].getElementsByTagNameNS(ns, "tr")); expect(materialRows).toHaveLength(2);
      expect(Array.from(materialRows[1].getElementsByTagNameNS(ns, "tc")).map(textOf)).toEqual(["", "正文清单钢材", "", "吨", "2", "3.25", "0%", "6.5000"]);
      const signatureRows = Array.from(wordTables[1].getElementsByTagNameNS(ns, "tr")); expect(signatureRows).toHaveLength(1);
      const signatureCells = Array.from(signatureRows[0].getElementsByTagNameNS(ns, "tc")); expect(signatureCells).toHaveLength(2);
      expect(signatureCells.map(textOf)).toEqual(["买方（章）：当前单甲方法定代表人或委托代理人：联系电话： 地址：", "卖方（章）：当前单乙方法定代表人或委托代理人：联系电话：地址："]);
      for (const table of wordTables) { expect(table.getElementsByTagNameNS(ns, "tblHeader").length).toBe(0); for (const row of Array.from(table.getElementsByTagNameNS(ns, "tr"))) expect(row.getElementsByTagNameNS(ns, "cantSplit").length).toBe(1); }
      expect(Object.values(zip.files).filter(part => !part.dir).map(part => part.name).sort()).toEqual(Object.values(original.files).filter(part => !part.dir).map(part => part.name).sort());
      expect(zip.file("word/header1.xml")!.asText()).toContain("草稿");
      const bound = new Set(["word/document.xml", "word/settings.xml", "word/header-contract-watermark.xml", "word/header1.xml"]);
      for (const part of Object.values(original.files).filter(part => !part.dir && !bound.has(part.name))) {
        const actual = zip.file(part.name)!.asNodeBuffer(), originalBytes = part.asNodeBuffer();
        if (part.name === "[Content_Types].xml") expect(actual).toEqual(Buffer.from(originalBytes.toString("utf8").replace(/\r\n/g, "\n"))); else expect(actual).toEqual(originalBytes);
      }
      inspectActualTemplatePdf(files.docx, files.pdf, "task10-material-v2-28-source-roles-current-draft", output.inputSnapshot.inspection.runtime);
      const script = `import pymupdf,sys,json

def text(span):
    return ''.join(chr(c[0]) for c in span['chars'])

d = pymupdf.open(sys.argv[1])
pages = []
for p in d:
    spans = p.get_texttrace()
    projected, pairs = [], []
    i = 0
    while i < len(spans):
        a = spans[i]
        b = spans[i + 1] if i + 1 < len(spans) else None
        # Official get_texttrace2Tr representation: one fill+stroke drawing.
        # No text-only/bbox tolerance/global dedup/visibility filtering.
        same_draw = (b is not None and a['type'] == 0 and b['type'] == 1
            and b['seqno'] == a['seqno'] + 1 and a['opacity'] > 0 and b['opacity'] > 0
            and a.keys() == b.keys()
            and all(a[key] == b[key] for key in a if key not in ('type', 'seqno')))
        projected.append(text(a))
        if same_draw:
            pairs.append({'sourceIndices': [i, i + 1], 'fill': a, 'stroke': b})
            i += 2
        else:
            i += 1
    pages.append({'page': p.number + 1, 'width': p.rect.width, 'height': p.rect.height,
        'drawnText': ''.join(projected), 'rawDrawnText': ''.join(text(s) for s in spans),
        'rawSpans': spans, 'fillStrokePairs': pairs})
out = {'pageCount': len(d), 'pages': pages}
with open(sys.argv[2], 'x') as stream:
    json.dump(out, stream, ensure_ascii=False, indent=2)
# Full raw evidence stays in the owned artifact; bounded stdout contains only
# the text used by the original public-pair assertions, never a changed expected.
print(json.dumps({'pageCount': len(d), 'pages': [{'drawnText': p['drawnText']} for p in pages]}, ensure_ascii=False))`;
      const drawings = await promisify(execFile)(python, ["-c", script, join(directory, "actual.pdf"), join(directory, "actual-drawings.json")], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
      const actual = JSON.parse(drawings.stdout) as { pageCount: number; pages: Array<{ drawnText: string }> };
      const drawn = compact(actual.pages.map(page => page.drawnText).join(""));

      for (const literal of [title, articleText, totalLiteral, manualText, "买方：当前单甲方", "卖方：当前单乙方", "买方（章）：当前单甲方", "卖方（章）：当前单乙方", "正文清单钢材", "6.5000", "草稿",
        ...roleExpectations.map(role => role.publicText), ...unclassifiedControls.map(control => control.text)]) expect(drawn).toContain(compact(literal));
      // Diagnostic paragraph coverage is raw evidence, not a general paragraph-to-
      // ink/occlusion theorem. Page breaks/headers may interleave long paragraphs.
      await writeFile(join(directory, "pdf-word-text-diagnostics.json"), JSON.stringify({ sourceSha256: sourceSha,
        exportedDocxSha256: sha(files.docx), exportedPdfSha256: sha(files.pdf), pageCount: actual.pageCount,
        roleTextPresence: roleExpectations.map(role => ({ id: role.id, text: role.publicText, present: drawn.includes(compact(role.publicText)) })),
        wordParagraphs: texts.filter(text => text.trim()).map(text => ({ text, contiguousInProjectedDrawing: drawn.includes(compact(text)) })),
        limits: ["strict-glyph helper + required text checks only", "No full28 font-program/GID/outline/physical-size association yet", "No full occlusion/visibility theorem", "One bill row, not45-row long-table acceptance"] }, null, 2));
      expect(drawn.split(title)).toHaveLength(3); expect(drawn.split("正文清单钢材")).toHaveLength(2);
      expect(upload.mock.calls).toHaveLength(2); expect(upload.mock.calls.map(([input]) => input.mimeType)).toEqual(["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/pdf"]);
      for (const [i, format] of [[0, "docx"], [1, "pdf"]] as const) expect(sha(upload.mock.calls[i][0].buffer)).toBe(sha(files[format]));
      const finalWbResponse = await fetch(draft.base + "/workbench", { headers: draft.headers }); expect(finalWbResponse.status).toBe(200);
      const finalWb = await finalWbResponse.json();
      expect(finalWb.version).toMatchObject({ draftRevision: body.draftRevision, documentContentRevision: body.documentContentRevision,
        documentContentFingerprint: wb.version.documentContentFingerprint, draftData: wb.version.draftData });
      expect((await list()).find((row: { id: string }) => row.id === generation.generationId)).toMatchObject({ ...frozen, status: "success", idempotencyKey: queuedDocument.idempotencyKey, docxFileId: output.docxFileId, pdfFileId: output.pdfFileId });
      await writeFile(join(directory, "public-after-worker.json"), JSON.stringify(finalWb, null, 2));
      expect(sha(await readFile(sourcePath))).toBe(sourceSha);
      await writeFile(join(directory, "verified-receipt.json"), JSON.stringify({ ...JSON.parse(await readFile(join(directory, "receipt.json"), "utf8")), verdict: "PUBLIC_V2_PAIR_WORD28_AND_EXISTING_GLYPH_GATES_GREEN", pageCount: actual.pageCount,
        remaining: ["independent full28 PDF used-font/program/GID/outline/size observer must review this exact pair", "full paragraph-to-ink visibility/occlusion association and25pt", "45-row table pagination/geometry", "signature physical geometry and native Word pagination", "formal adoption/non-draft signing"] }, null, 2));
      console.info("材料V2全部28角色实际双格式证据：" + directory);
    } catch (cause) { await writeFile(join(directory, "failure.txt"), String(cause)); throw new Error("材料V2全部28角色实际检查失败，证据 " + directory, { cause }); }
    finally {
      upload.mockRestore(); const started = performance.now(); let processorStopped = false, appClosed = false;
      try { await server.processor.onApplicationShutdown(); processorStopped = true; }
      finally { try { await server.app.close(); appClosed = true; } finally { await writeFile(join(directory, "cleanup-receipt.json"), JSON.stringify({ processorStopped, appClosed, ownedOperationSettled: true, elapsedMs: performance.now() - started }, null, 2)); } }
    }
  }, 400_000);
});
