import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { calculateContractDocumentContentFingerprint } from "../contract-workbench/contract-document-content";
import { task10HttpRepository } from "./task10-http-repository.test-support";
import { createTemplateTestServer } from "./template-management.test-support";
import { confirmedBodyLayout, type Body } from "./task10-body.test-support";
import { createTask09Draft } from "./task09-draft-template.test-support";

const sha = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const sourceSha = "d82812b363391fe9e629cd18555ce7ce951aa9fa9a479d0bada1092fc0174c47";
const warning = "当前合同使用历史税率内容，请保存填写资料后更新正文税务内容。";
const taxPositionId = "298826034afdc7bb047479758631c74f5207b80b57b9e83858e8d9fa20032453";
type PublicBody = Body & { contractVersionId: string; draftRevision: number; layoutTemplateVersionId: string; warnings?: string[] };
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

describe("task10 backend body warnings real browser", () => {
  it("shows the real legacy warning until a real form autosave and fresh body read clear it", async () => {
    const repository = await task10HttpRepository(__dirname);
    const browserProject = process.env.TASK10_BODY_WARNING_PROJECT ?? "desktop";
    if (browserProject !== "desktop" && browserProject !== "mobile") throw new Error("正文提示浏览器检查项目必须明确为desktop或mobile");
    const directory = await mkdtemp(join(tmpdir(), "jg-task10-body-warning-browser-"));
    const server = await createTemplateTestServer({ draftWorkbench: true });
    let stage = "preparation-public-auto-baseline";
    try {
      const sourcePath = join(repository, "services/api/assets/templates/labor-subcontract-real-v1.docx");
      const source = await readFile(sourcePath); expect(sha(source)).toBe(sourceSha);
      const layout = await confirmedBodyLayout(server, source, "laborItems", "labor_subcontract");
      const draft = await createTask09Draft(server);
      const wbRead = async () => { const response = await fetch(draft.base + "/workbench", { headers: draft.headers }); expect(response.status).toBe(200); return response.json(); };
      const initial = await wbRead(); expect(initial.version.layoutTemplateVersionId).toBeNull();
      const baselineKey = randomUUID();
      const knownRows = [1, 2, 3].map(i => ({ clientRowKey: "c4-labor-00" + i, sortOrder: i - 1, itemName: "正式劳务行00" + i,
        unit: "项", quantity: String(i), unitPrice: "100.0000", taxRatePercent: "0", customData: {} }));
      const taxFacts = { invoiceType: null, taxMode: "single_rate", defaultTaxRatePercent: "0", source: "contract_document" };
      const baselinePayload = { idempotencyKey: baselineKey, saveKind: "auto", expectedRevision: initial.version.draftRevision,
        changedSections: ["draft", "parties", "bills"],
        draft: { numericProtocolVersion: 2, draftData: { contractName: "上游新建当前合同名称",
          contractBasics: { businessType: "labor_subcontract", relationship: "upward", amountBasis: "tax_inclusive", invoiceStatus: "pending" } },
          clauses: [], pricingNature: "unit_price", amountSource: "bill_sum", taxFacts },
        parties: [{ roleKey: "party_a", displayOrder: 0, snapshot: { name: "合成劳务甲方" } }, { roleKey: "party_b", displayOrder: 0, snapshot: { name: "当前单乙方" } }],
        bills: initial.bills.map((bill: PublicBill) => ({ billKey: bill.billKey, expectedRevision: bill.revision, numericProtocolVersion: 2, rows: knownRows })),
        paymentTerms: null, attachments: [], negotiationDocuments: { referencedGeneratedDocumentIds: [] } };
      const baselineResponse = await fetch(draft.base, { method: "PUT", headers: { ...draft.headers, "x-contract-draft-lease": draft.leaseToken }, body: JSON.stringify(baselinePayload) });
      expect(baselineResponse.status === 200 ? "OK" : await baselineResponse.text()).toBe("OK");
      const baselineAck = await baselineResponse.json(); const baseline = await wbRead();
      expect(baseline.version).toMatchObject({ status: "draft", numericProtocolVersion: 2, amountYuan: "600.0000", amountCents: "60000",
        layoutTemplateVersionId: null, pricingNature: "unit_price", amountSource: "bill_sum", estimatedAmountCents: null, amountAdjustmentReason: null,
        taxFacts: { invoiceType: null, taxMode: "single_rate", defaultTaxRatePercent: "0", source: "contract_document" } });
      expect(baseline.version.documentContentFingerprint).toMatch(/^[a-f0-9]{64}$/u);
      expect(baseline.version.draftRevision).toBe(baselineAck.serverRevision);
      expect(baseline.version.documentContentRevision).toBe(baselineAck.documentContentRevision);
      expect(baseline.version.documentContentFingerprint).toBe(baselineAck.documentContentFingerprint);
      expect(Object.hasOwn(baseline.draft, "documentRenderProfile")).toBe(false);
      expect(Object.hasOwn(baseline.draft, "documentBody")).toBe(false); expect(Object.hasOwn(baseline.draft, "documentBodyAction")).toBe(false);
      expect(baseline.draft).toEqual(baseline.version.draftData); expect(baseline.contract.code).toBeNull();
      expect(baseline.bills).toHaveLength(1); expect(baseline.bills[0]).toMatchObject({ billKey: "main", pricingMode: "tax_inclusive",
        numericProtocolVersion: 2, taxInclusiveAmountYuan: "600.0000", taxExclusiveAmountYuan: "600.0000", taxAmountYuan: "0.0000" });
      expect(baseline.bills[0].rows).toHaveLength(3);
      for (const [i, amount] of ["100.0000", "200.0000", "300.0000"].entries()) {
        const row = baseline.bills[0].rows[i] as PublicRow;
        expect(row).toMatchObject({ sortOrder: i, itemName: "正式劳务行00" + (i + 1), unit: "项", quantity: String(i + 1),
          taxRate: "0", taxRatePercent: "0", taxRateSource: "version_default", precisionPolicy: "four_decimal", pricingFactStatus: "confirmed",
          numericProtocolVersion: 2, numericSource: "decimal_input", numericReviewStatus: "verified", taxInclusiveAmountYuan: amount,
          taxExclusiveAmountYuan: amount, taxAmountYuan: "0.0000", itemCode: null, specification: null, settlementBasis: null, isProvisional: false, customData: {} });
        expect(row.unitPrice).toMatch(/^100(?:\.0+)?$/u); expect(row.taxExclusiveUnitPrice).toMatch(/^100(?:\.0+)?$/u);
        expect(typeof row.rowKey).toBe("string"); expect(row.rowKey.length).toBeGreaterThan(0);
      }
      expect(baseline.paymentTerms).toMatchObject({ originalText: "", stages: [] }); expect(baseline.attachments).toEqual([]);
      expect(baseline.version.clauseSnapshot).toEqual([]);

      stage = "preparation-public-input-projection-calibration";
      // PUBLIC exported function is ONLY a fixture-data builder. No expected newF is ever computed below.
      // The projection is from complete public WB facts plus fixed worked decimal literals, not private DB reads.
      const fixtureInput = {
        templateSnapshot: baseline.version.templateSnapshot, layoutTemplateVersionId: null as string | null,
        parties: baseline.parties.map((party: PublicParty) => ({ roleKey: party.roleKey, displayOrder: party.displayOrder,
          businessPartyVersionId: party.businessPartyVersionId ?? null, snapshot: party.snapshot })),
        subjectAndScope: baseline.draft,
        amountAndTax: { pricingNature: baseline.version.pricingNature, amountSource: baseline.version.amountSource,
          amountCents: baseline.version.amountCents, numericProtocolVersion: 2, amountYuan: baseline.version.amountYuan,
          estimatedAmountCents: baseline.version.estimatedAmountCents, amountAdjustmentReason: baseline.version.amountAdjustmentReason, taxFacts,
          bills: baseline.bills.map((bill: PublicBill) => ({ billKey: bill.billKey, name: bill.name, amountRole: bill.amountRole,
            pricingMode: bill.pricingMode, quantityScale: bill.quantityScale, unitPriceScale: bill.unitPriceScale, schemaSnapshot: bill.schemaSnapshot,
            sourceExcelFileId: bill.sourceExcelFileId, taxInclusiveAmountCents: bill.taxInclusiveAmountCents,
            numericProtocolVersion: bill.numericProtocolVersion, taxInclusiveAmountYuan: bill.taxInclusiveAmountYuan,
            taxExclusiveAmountYuan: bill.taxExclusiveAmountYuan, taxAmountYuan: bill.taxAmountYuan,
            taxExclusiveAmountCents: bill.taxExclusiveAmountCents, taxAmountCents: bill.taxAmountCents,
            rows: bill.rows.map((row: PublicRow) => ({ rowKey: row.rowKey, sortOrder: row.sortOrder, itemCode: row.itemCode,
              itemName: row.itemName, specification: row.specification, unit: row.unit, quantity: row.quantity,
              unitPrice: "100", taxRate: "0", taxRateSource: row.taxRateSource, pricingFactStatus: row.pricingFactStatus,
              precisionPolicy: row.precisionPolicy, numericProtocolVersion: row.numericProtocolVersion, numericSource: row.numericSource,
              numericReviewStatus: row.numericReviewStatus, taxInclusiveAmountYuan: row.taxInclusiveAmountYuan,
              taxExclusiveAmountYuan: row.taxExclusiveAmountYuan, taxAmountYuan: row.taxAmountYuan,
              taxInclusiveAmountCents: row.taxInclusiveAmountCents, taxExclusiveAmountCents: row.taxExclusiveAmountCents,
              taxAmountCents: row.taxAmountCents, taxExclusiveUnitPrice: "100", isProvisional: row.isProvisional,
              settlementBasis: row.settlementBasis, customData: row.customData })) })) },
        paymentTerms: { originalText: baseline.paymentTerms.originalText, stages: [] }, clauses: baseline.version.clauseSnapshot, attachments: []
      };
      const calibratedF = calculateContractDocumentContentFingerprint(fixtureInput);
      expect(calibratedF).toBe(baseline.version.documentContentFingerprint);
      const historicalF = calculateContractDocumentContentFingerprint({ ...fixtureInput, layoutTemplateVersionId: layout.id });
      expect(historicalF).toMatch(/^[a-f0-9]{64}$/u); expect(historicalF).not.toBe(calibratedF);
      const oldDraftR = baseline.version.draftRevision + 1, oldContentR = baseline.version.documentContentRevision + 1;
      await writeFile(join(directory, "fixture-data-construction.json"), JSON.stringify({ stage, baselineCoordinates: {
        draftRevision: baseline.version.draftRevision, documentContentRevision: baseline.version.documentContentRevision, fingerprint: calibratedF },
        historicalCoordinates: { draftRevision: oldDraftR, documentContentRevision: oldContentR, fingerprint: historicalF, layoutId: layout.id },
        baselineRequestKeySha256: sha(baselineKey), calibrationIsFixtureConsistencyNotFingerprintAcceptance: true,
        noExpectedNewFingerprintCalculated: true, historicalImportDoesNotClaimCompleteAuditHistory: true }, null, 2));
      // The ONLY historical fixture persistence write: successor coordinates preserve the baseline receipt's original R/F.
      // No checkpoint/receipt/audit rewriting and no adapter reads/counters as acceptance assertions.
      await server.store.prisma.contractVersion.update({ where: { id: draft.version.id }, data: {
        layoutTemplateVersionId: layout.id, draftRevision: oldDraftR, documentContentRevision: oldContentR, documentContentFingerprint: historicalF
      } });
      // No adapter read or write occurs after this point. All verification/actions are real public HTTP.
      stage = "historical-public-preconditions";
      const before = await wbRead();
      expect(before.version).toMatchObject({ draftRevision: oldDraftR, documentContentRevision: oldContentR, documentContentFingerprint: historicalF,
        layoutTemplateVersionId: layout.id, amountYuan: "600.0000" });
      expect(Object.hasOwn(before.draft, "documentRenderProfile")).toBe(false); expect(before.draft).toEqual(baseline.draft);
      const documentsRead = async () => {
        const response = await fetch(`${await server.app.getUrl()}/contract-workbench/${draft.version.id}/documents`, { headers: draft.headers });
        expect(response.status).toBe(200); return response.json();
      };
      const bodyRead = async () => { const response = await fetch(draft.base + "/document-body", { headers: draft.headers }); expect(response.status).toBe(200); return await response.json() as PublicBody; };
      const taxBlock = (body: PublicBody) => { const positions = body.blocks.filter(block => block.text.startsWith("本合同采用以下第")); expect(positions).toHaveLength(1); return positions[0]; };
      const billFacts = (bills: PublicBill[]) => bills.map(bill => ({ ...bill, rows: bill.rows.map(row => {
        const facts = { ...row } as PublicRow & { availableActions?: unknown; remainderCancellation?: unknown };
        delete facts.availableActions; delete facts.remainderCancellation; return facts;
      }) }));
      const documentsBefore = await documentsRead(); expect(documentsBefore).toEqual([]);
      stage = "target-old-public-reads-must-not-upgrade";
      const oldBody1 = await bodyRead(); const afterRead1 = await wbRead();
      const oldBody2 = await bodyRead(); const afterRead2 = await wbRead(); const documentsAfterRead = await documentsRead();
      await writeFile(join(directory, "public-old-read-observation.json"), JSON.stringify({ stage, before, afterRead1, afterRead2,
        body1: oldBody1, body2: oldBody2, documentsBefore, documentsAfterRead, generationOrNativeRequested: false }, null, 2));
      for (const body of [oldBody1, oldBody2]) {
        expect(body).toMatchObject({ contractVersionId: draft.version.id, sourceSha256: sourceSha, layoutTemplateVersionId: layout.id,
          draftRevision: oldDraftR, documentContentRevision: oldContentR, warnings: [warning] });
        const tax = taxBlock(body); expect(tax.id).toBe(taxPositionId); expect(tax.editable).toBe(true); expect(tax.text).toMatch(/税率\s*3\s*%/u);
      }
      for (const read of [afterRead1, afterRead2]) {
        expect(read.version).toEqual(before.version); expect(read.draft).toEqual(before.draft);
        expect(read.parties).toEqual(before.parties); expect(read.bills).toEqual(before.bills);
        expect(Object.hasOwn(read.draft, "documentRenderProfile")).toBe(false);
      }
      expect(documentsAfterRead).toEqual(documentsBefore);

      stage = "public-lease-release-and-real-browser";
      const released = await fetch(draft.base + "/edit-lease", { method: "DELETE", headers: { ...draft.headers, "x-contract-draft-lease": draft.leaseToken }, body: "{}" });
      expect(released.status).toBe(200); expect(await released.json()).toMatchObject({ released: true });
      const sources = ["apps/web-admin/src/api/contract-workbench.api.ts", "apps/web-admin/src/pages/contracts/workbench/ContractBodyEditor.vue", "apps/web-admin/src/pages/contracts/workbench/ContractBodyFlow.vue", "apps/web-admin/src/pages/contracts/ContractWorkbenchPage.vue", "apps/web-admin/src/pages/contracts/workbench/use-contract-draft.ts", "services/api/src/contract-template/task10-body-warning-browser.http.spec.ts"];
      await writeFile(join(directory, "startup-source.json"), JSON.stringify(await Promise.all(sources.map(async path => ({ path, sha256: sha(await readFile(join(repository, path))) }))), null, 2));
      const environment: NodeJS.ProcessEnv = {};
      for (const key of ["HOME", "TMPDIR", "LANG", "LC_ALL", "TZ", "PNPM_HOME"]) if (process.env[key] !== undefined) environment[key] = process.env[key];
      environment.PATH = "/Users/leoyang/.nvm/versions/node/v20.20.2/bin:/Users/leoyang/.local/bin:/usr/bin:/bin";
      environment.NODE_ENV = "test";
      const args = ["--filter", "@jiangkong/web-admin", "exec", "playwright", "test", "--config", "playwright.task10-body-warning.config.ts", "--project", browserProject, "--max-failures=1"];
      try {
        const result = await promisify(execFile)("/Users/leoyang/.local/bin/pnpm", args, { cwd: repository,
          env: { ...environment, VITE_API_PROXY_TARGET: await server.app.getUrl(), TASK10_BODY_BROWSER_OUTPUT: join(directory, "browser"),
            TASK10_BODY_BROWSER_INPUT: JSON.stringify({ contractId: draft.contract.id, versionId: draft.version.id, sourceSha256: sourceSha,
              layoutId: layout.id, oldDraftR, oldContentR, oldF: historicalF, warning, taxPositionId,
              rowKeys: before.bills[0].rows.map((row: PublicRow) => row.rowKey), staff: { phone: server.actors[1].phone, password: server.password } }) },
          timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
        await writeFile(join(directory, "browser.log"), result.stdout + result.stderr);
      } catch (cause) {
        const failed = cause as { stdout?: string; stderr?: string };
        await writeFile(join(directory, "browser-failure.log"), (failed.stdout ?? "") + (failed.stderr ?? ""));
        throw cause;
      }
      stage = "public-post-browser-upgrade";
      const after = await wbRead(), newBody = await bodyRead(), documentsFinal = await documentsRead();
      expect(after.version.draftRevision).toBeGreaterThan(oldDraftR); expect(after.version.documentContentRevision).toBeGreaterThan(oldContentR);
      expect(after.version.documentContentFingerprint).not.toBe(historicalF);
      expect(after.draft).toEqual({ ...before.draft, contractName: "历史正文提示已核对", partyValues: {}, documentRenderProfile: { reviewedLaborTaxBindingVersion: "reviewed-labor-tax-v1", typographyVersion: "reviewed-labor-primary-roles-v1" } });
      expect(after.version).toMatchObject({ layoutTemplateVersionId: layout.id, amountYuan: "600.0000", numericProtocolVersion: 2, taxFacts: before.version.taxFacts });
      expect(after.parties).toEqual(before.parties); expect(billFacts(after.bills)).toEqual(billFacts(before.bills));
      expect(newBody).toMatchObject({ sourceSha256: sourceSha, layoutTemplateVersionId: layout.id, draftRevision: after.version.draftRevision, documentContentRevision: after.version.documentContentRevision, warnings: [] });
      const tax = taxBlock(newBody); expect(tax.id).toBe(taxPositionId); expect(tax.editable).toBe(false); expect(tax.text).toMatch(/税率\s*0%/u);
      expect(documentsFinal).toEqual([]); expect(after.contract.code).toBeNull();
      await writeFile(join(directory, "public-post-browser.json"), JSON.stringify({ oldDraftR, oldContentR, oldF: historicalF, after, newBody, documentsFinal, nativeRequested: false }, null, 2));
      console.info("任务10正文真实警告UI证据：" + directory);
    } catch (cause) {
      await writeFile(join(directory, "failure.txt"), JSON.stringify({ stage, message: String(cause) }, null, 2));
      throw new Error("正文提示真实UI检查失败，阶段 " + stage + "，证据 " + directory, { cause });
    } finally {
      let processorStopped = false, appClosed = false;
      try { await server.processor.onApplicationShutdown(); processorStopped = true; }
      finally { try { await server.app.close(); appClosed = true; } finally { await writeFile(join(directory, "cleanup-receipt.json"), JSON.stringify({ processorStopped, appClosed, ownedOperationSettled: true }, null, 2)); } }
    }
  }, 150_000);
});
