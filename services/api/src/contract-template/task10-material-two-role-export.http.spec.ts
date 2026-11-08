import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import PizZip from "pizzip";
import { DOMParser, XMLSerializer, type Element } from "@xmldom/xmldom";
import { calculateContractDocumentContentFingerprint } from "../contract-workbench/contract-document-content";
import type { ContractBodyFlow, ContractBodyParagraph } from "../contract-document/contract-body-document";
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

const title = "材料采购A2026合同";
const articleText = "第一条  货物名称、规格型号、数量、价格等";
const totalLiteral = "1.本合同暂定总价（含税）：人民币陆元伍角。适用税率：0%。";
const typographyVersion = "reviewed-material-two-roles-v1";
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

describe("task10 material two normative roles in actual public private Word/PDF export", () => {
  it("consumes a historical V1 owner without upgrading it, preserves facts and hand edits, and exports the two reviewed Word roles in one actual pair", async () => {
    const python = process.env.TEMPLATE_PDF_INSPECTOR_PYTHON;
    if (!python || process.env.TEMPLATE_PDF_RUNTIME_MODE !== "font-profile") throw new Error("材料两角色实际检查需要原锁定物理环境");
    const repository = await realpath(resolve(__dirname, "../../../.."));
    if (repository !== "/private/tmp/jg-382-task10-final-integration-20261108" || await realpath(process.cwd()) !== join(repository, "services/api")) throw new Error("材料两角色实际检查需要准确任务10 API目录");
    expect(process.env.CONTRACT_DOCX4J_RUNTIME_MANIFEST).toBe(runtimePath);
    expect(process.env.TEMPLATE_PDF_RUNTIME_MANIFEST).toBe(inspectionPath);
    expect(sha(await readFile(runtimePath))).toBe(runtimeSha); expect(sha(await readFile(inspectionPath))).toBe(inspectionSha);
    expect(sha(await readFile(join(repository, "services/api/assets/document-converter/runtime-lock.json")))).toBe(lockSha);
    const directory = await mkdtemp(join(tmpdir(), "jg-task10-material-two-role-export-"));
    const runtime = JSON.parse(await readFile(runtimePath, "utf8")) as { scratchDirectory: string };
    const beforeScratch = await readdir(runtime.scratchDirectory);
    const server = await createTemplateTestServer({ draftWorkbench: true });
    const upload = jest.spyOn(server.files, "uploadPrivateFile");
    try {
      const sourcePath = join(repository, "services/api/assets/templates/material-purchase-real-v1.docx");
      const source = await readFile(sourcePath); expect(sha(source)).toBe(sourceSha);
      const layout = await confirmedBodyLayout(server, source, "materials");
      const draft = await createTask09Draft(server);
      const rows = [{ clientRowKey: "normative-material-row", sortOrder: 0, itemName: "正文清单钢材", unit: "吨", quantity: "2", unitPrice: "3.2500", taxRatePercent: "0", customData: {} }];
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
      const manualText = ordinary!.text + "双方人工补充约定应当保留。";
      const currentResponse = await fetch(draft.base + "/workbench", { headers: draft.headers }); expect(currentResponse.status).toBe(200);
      const current = await currentResponse.json(); expect(current.bills.map((bill: { billKey: string }) => bill.billKey)).toEqual(["main"]);
      // Same legal numeric2 aggregate shape as the approved public control;
      // the only added business literal is a title carrying Latin A and2026.
      const saved = await fetch(draft.base, { method: "PUT", headers: { ...draft.headers, "x-contract-draft-lease": draft.leaseToken }, body: JSON.stringify({
        idempotencyKey: randomUUID(), saveKind: "manual", expectedRevision: current.version.draftRevision, changedSections: ["draft", "parties", "bills"],
        draft: { numericProtocolVersion: 2, draftData: { ...current.version.draftData, contractName: title,
          documentBody: { protocolVersion: 1, layoutTemplateVersionId: layout.id, sourceSha256: sourceSha, edits: [{ positionId: ordinary!.id, text: manualText }] } },
          clauses: [], pricingNature: "unit_price", amountSource: "bill_sum", layoutTemplateVersionId: layout.id,
          taxFacts: { invoiceType: null, taxMode: "single_rate", defaultTaxRatePercent: "0", source: "contract_document" } },
        parties: [{ roleKey: "party_a", displayOrder: 0, snapshot: { name: "当前单甲方" } }, { roleKey: "party_b", displayOrder: 0, snapshot: { name: "当前单乙方" } }],
        bills: current.bills.map((bill: { billKey: string; revision: number }) => ({ billKey: bill.billKey, expectedRevision: bill.revision, numericProtocolVersion: 2, rows })),
        paymentTerms: null, attachments: [], negotiationDocuments: { referencedGeneratedDocumentIds: [] }
      }) });
      expect(saved.status === 200 ? "OK" : await saved.text()).toBe("OK");
      const wbResponse = await fetch(draft.base + "/workbench", { headers: draft.headers }); expect(wbResponse.status).toBe(200); let wb = await wbResponse.json();
      expect(wb.version).toMatchObject({ amountYuan: "6.5000", numericProtocolVersion: 2, taxFacts: { taxMode: "single_rate", defaultTaxRatePercent: "0" },
        draftData: { contractName: title, documentRenderProfile: { typographyVersion: "reviewed-material-primary-secondary-body25-v4" } } });
      expect(wb.version.documentContentFingerprint).toMatch(/^[a-f0-9]{64}$/u);
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
      const tables = body.flow.filter((node): node is Extract<ContractBodyFlow, { kind: "table" }> => node.kind === "table"); expect(tables.map(table => table.rows.length)).toEqual([2, 1]);
      const sameResponse = await fetch(draft.base + "/workbench", { headers: draft.headers }); expect(sameResponse.status).toBe(200);
      expect((await sameResponse.json()).version).toMatchObject({ draftRevision: body.draftRevision, documentContentRevision: body.documentContentRevision, documentContentFingerprint: wb.version.documentContentFingerprint });
      const repeatedBodyResponse = await fetch(draft.base + "/document-body", { headers: draft.headers }); expect(repeatedBodyResponse.status).toBe(200);
      expect(await repeatedBodyResponse.json()).toEqual(body);
      const repeatedWbResponse = await fetch(draft.base + "/workbench", { headers: draft.headers }); expect(repeatedWbResponse.status).toBe(200);
      const repeatedWb = await repeatedWbResponse.json(); expect(repeatedWb.version).toEqual(wb.version); expect(repeatedWb.draft).toEqual(wb.draft);
      await writeFile(join(directory, "historical-owner-public-repeated-read.json"), JSON.stringify(repeatedWb, null, 2));
      await writeFile(join(directory, "public-body-readback.json"), JSON.stringify(body, null, 2));
      await writeFile(join(directory, "normative-role-context.json"), JSON.stringify({ sourceSha256: sourceSha, title, articleText, coverId: cover.id, bodyTitleId: bodyTitle.id, firstArticleId: article.id,
        expected: { cover: { eastAsia: "方正小标宋简体", sizePt: 22 }, bodyTitle: { eastAsia: "方正小标宋简体", sizePt: 22, latin: "Times New Roman" }, firstArticle: { eastAsia: "黑体", sizePt: 14, latin: "Times New Roman" } },
        actualPairPaths: { docx: join(directory, "actual.docx"), pdf: join(directory, "actual.pdf") } }, null, 2));
      const documentsBefore = await fetch(`${await server.app.getUrl()}/contract-workbench/${draft.version.id}/documents`, { headers: draft.headers }); expect(documentsBefore.status).toBe(200); expect(await documentsBefore.json()).toEqual([]);
      const asRunPaths = ["services/api/src/contract-template/task10-material-two-role-export.http.spec.ts", "services/api/src/contract-template/task10-body.test-support.ts", "services/api/src/contract-template/task10-material-normative-first-roles.http.spec.ts", "services/api/src/contract-template/task09-draft-template.test-support.ts", "services/api/src/contract-template/template-management.test-support.ts", "services/api/src/contract-document/contract-body-document.ts", "services/api/src/contract-document/contract-document.service.ts", "services/api/src/contract-document/contract-document.processor.ts", "services/api/src/contract-document/contract-body-pdf-converter.ts", "services/api/src/contract-workbench/contract-draft-aggregate.service.ts", "services/api/src/contract-workbench/contract-workbench.service.ts", "services/api/src/contract-template/template-pdf-physical.test-support.ts", "services/api/test-support/inspect-contract-pdf-physical.py"];
      await writeFile(join(directory, "as-run-source-pins.json"), JSON.stringify(await Promise.all(asRunPaths.map(async path => ({ path, sha256: sha(await readFile(join(repository, path))) }))), null, 2));
      upload.mockClear();
      const queued = await fetch(draft.base + "/preview-generation", { method: "POST", headers: draft.headers, body: JSON.stringify({ sourceRevision: body.draftRevision }) });
      expect(queued.status === 201 ? "OK" : await queued.text()).toBe("OK"); const generation = await queued.json();
      expect(generation).toMatchObject({ status: "queued", documentContentRevision: body.documentContentRevision, documentContentFingerprint: wb.version.documentContentFingerprint });
      const list = async () => { const response = await fetch(`${await server.app.getUrl()}/contract-workbench/${draft.version.id}/documents`, { headers: draft.headers }); expect(response.status).toBe(200); return await response.json(); };
      const frozen = { purpose: "draft", layoutTemplateVersionId: layout.id, documentContentRevision: body.documentContentRevision, documentContentFingerprint: wb.version.documentContentFingerprint,
        inputSnapshot: { documentContentRevision: body.documentContentRevision, documentContentFingerprint: wb.version.documentContentFingerprint,
          bodyDocument: { sourceSha256: sourceSha, renderSemanticVersion: "contract-money-v1", tableLayoutVersion: "body-bill-loop-v2", typographyVersion, pdfEngine: "docx4j-17.3.5", runtimeLockSha256: lockSha },
          renderInput: { values: { "contract.typographyVersion": typographyVersion, "contract.taxRateLabel": "0%", "contract.amountBasis": "tax_inclusive", "contract.taxInclusiveAmount": "6.5000", "contract.taxExclusiveAmount": "6.5000", "contract.taxAmount": "0.0000" } } } };
      const queuedDocument = (await list()).find((row: { id: string }) => row.id === generation.generationId);
      expect(queuedDocument).toMatchObject({ ...frozen, status: "queued" });
      // Independent public tuple assertion; never invoke the service's private key helper.
      const historicalKeyTuple = [draft.version.id, historicalContentR, historicalF, layout.id, "draft", [],
        "contract-body-docx4j-v1", lockSha, "contract-money-v1", "body-bill-loop-v2", typographyVersion];
      expect(queuedDocument.idempotencyKey).toBe(sha(JSON.stringify(historicalKeyTuple)));
      await writeFile(join(directory, "historical-owner-public-queued.json"), JSON.stringify({ generation, queuedDocument, historicalKeyTuple }, null, 2));
      const workerStarted = performance.now(); let workerOverBudget = false;
      const timer = setTimeout(() => { workerOverBudget = true; }, 130_000);
      try { expect(await server.processor.processNext()).toBe(true); }
      finally { clearTimeout(timer); await writeFile(join(directory, "worker-budget.json"), JSON.stringify({ elapsedMs: performance.now() - workerStarted, budgetMs: 130_000, ownedOperationSettled: true })); }
      expect(workerOverBudget).toBe(false); expect(performance.now() - workerStarted).toBeLessThanOrEqual(130_000);
      const output = (await list()).find((row: { id: string }) => row.id === generation.generationId);
      expect(output).toMatchObject({ ...frozen, status: "success", docxFileId: expect.any(String), pdfFileId: expect.any(String) });
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
          body: JSON.stringify({ confirmationPassword: server.password, downloadReason: "材料两角色当前草稿双格式及原条款核验" }) }); expect(ticket.status).toBe(201);
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
      for (const [actualParagraph, originalParagraph] of [[titleParagraphs[0], sourceTitles[0]], [titleParagraphs[1], sourceTitles[1]], [articleParagraphs[0], sourceArticles[0]]])
        expect(direct(actualParagraph, "pPr").map(serialized)).toEqual(direct(originalParagraph, "pPr").map(serialized));
      for (const [paragraph, family, halfPoints] of [[titleParagraphs[0], "方正小标宋简体", "44"], [titleParagraphs[1], "方正小标宋简体", "44"], [articleParagraphs[0], "黑体", "28"]] as const) {
        const visibleRuns = Array.from(paragraph.getElementsByTagNameNS(ns, "r")).filter(run => textOf(run).length > 0); expect(visibleRuns.length).toBeGreaterThan(0);
        for (const run of visibleRuns) {
          const properties = direct(run, "rPr"); expect(properties).toHaveLength(1); const fonts = direct(properties[0], "rFonts"); expect(fonts).toHaveLength(1);
          expect(fonts[0].getAttributeNS(ns, "eastAsia")).toBe(family);
          expect(["ascii", "hAnsi", "cs"].map(key => fonts[0].getAttributeNS(ns, key))).toEqual(["Times New Roman", "Times New Roman", "Times New Roman"]);
          for (const name of ["sz", "szCs"]) { const sizes = direct(properties[0], name); expect(sizes).toHaveLength(1); expect(sizes[0].getAttributeNS(ns, "val")).toBe(halfPoints); }
        }
      }
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
      inspectActualTemplatePdf(files.docx, files.pdf, "task10-material-two-normative-roles-current-draft", output.inputSnapshot.inspection.runtime);
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

      for (const literal of [title, articleText, totalLiteral, manualText, "买方：当前单甲方", "卖方：当前单乙方", "买方（章）：当前单甲方", "卖方（章）：当前单乙方", "正文清单钢材", "草稿"]) expect(drawn).toContain(compact(literal));
      expect(drawn.split(title)).toHaveLength(3); expect(drawn.split("正文清单钢材")).toHaveLength(2);
      expect(upload.mock.calls).toHaveLength(2); expect(upload.mock.calls.map(([input]) => input.mimeType)).toEqual(["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/pdf"]);
      for (const [i, format] of [[0, "docx"], [1, "pdf"]] as const) expect(sha(upload.mock.calls[i][0].buffer)).toBe(sha(files[format]));
      expect(sha(await readFile(sourcePath))).toBe(sourceSha);
      await writeFile(join(directory, "verified-receipt.json"), JSON.stringify({ ...JSON.parse(await readFile(join(directory, "receipt.json"), "utf8")), verdict: "PUBLIC_PAIR_WORD_ROLE_AND_EXISTING_PHYSICAL_GATES_GREEN", pageCount: actual.pageCount,
        remaining: ["independent two-role PDF used-font/glyph/size companion must review this actual pair", "other normative roles and25pt", "signature physical geometry and native Word pagination", "formal adoption/non-draft signing"] }, null, 2));
      console.info("材料两角色实际双格式证据：" + directory);
    } catch (cause) { await writeFile(join(directory, "failure.txt"), String(cause)); throw new Error("材料两角色实际检查失败，证据 " + directory, { cause }); }
    finally {
      upload.mockRestore(); const started = performance.now(); let processorStopped = false, appClosed = false;
      try { await server.processor.onApplicationShutdown(); processorStopped = true; }
      finally { try { await server.app.close(); appClosed = true; } finally { await writeFile(join(directory, "cleanup-receipt.json"), JSON.stringify({ processorStopped, appClosed, ownedOperationSettled: true, elapsedMs: performance.now() - started }, null, 2)); } }
    }
  }, 400_000);
});
