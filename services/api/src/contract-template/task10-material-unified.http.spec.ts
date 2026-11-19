import PizZip from "pizzip";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { createTemplateTestServer } from "./template-management.test-support";
import { createTask09Draft } from "./task09-draft-template.test-support";
import { confirmedBodyLayout } from "./task10-body.test-support";
import { loginTemplateActor } from "./template-selection.test-support";

type Draft = Awaited<ReturnType<typeof createTask09Draft>>;
async function saveRows(draft: Draft, rows: Array<Record<string, unknown>>, layoutId?: string) {
  const current = await fetch(draft.base + "/workbench", { headers: draft.headers }).then(response => response.json());
  return fetch(draft.base, { method: "PUT", headers: { ...draft.headers, "x-contract-draft-lease": draft.leaseToken }, body: JSON.stringify({
    idempotencyKey: randomUUID(), saveKind: "manual", expectedRevision: current.version.draftRevision, changedSections: ["draft", "parties"],
    draft: { numericProtocolVersion: 2, draftData: { ...current.version.draftData, contractName: "材料运输统一清单公有观测" }, clauses: [], pricingNature: "unit_price", amountSource: "bill_sum", ...(layoutId ? { layoutTemplateVersionId: layoutId } : {}), taxFacts: { invoiceType: null, taxMode: "single_rate", defaultTaxRatePercent: "13", source: "contract_document" } },
    parties: [{ roleKey: "party_a", displayOrder: 0, snapshot: { name: "统一清单合成甲方" } }, { roleKey: "party_b", displayOrder: 0, snapshot: { name: "统一清单合成乙方" } }],
    bills: current.bills.map((bill: { billKey: string; revision: number }, index: number) => ({ billKey: bill.billKey, expectedRevision: bill.revision, numericProtocolVersion: 2, rows: index === 0 ? rows : [] })), paymentTerms: null, attachments: [], negotiationDocuments: { referencedGeneratedDocumentIds: [] }
  }) });
}

describe("Task10 confirmed unified material transport facts through public HTTP", () => {
  it("observes persisted rounded net unit facts without inventing a tax-unit calculation", async () => {
    const server = await createTemplateTestServer({ draftWorkbench: true });
    const directory = await mkdtemp(join(tmpdir(), "jg-task10-unified-unit-facts-"));
    try {
      const draft = await createTask09Draft(server);
      const saved = await saveRows(draft, [{ clientRowKey: "tiny-quantity", sortOrder: 0, itemName: "微量合成材料", unit: "件", quantity: "0.0001", unitPrice: "0.5", taxRatePercent: "13", taxRateSource: "row_override", customData: {} }]);
      const outcome = await saved.json();
      await writeFile(join(directory, "public-save.json"), JSON.stringify({ status: saved.status, outcome }, null, 2));
      expect(saved.status).toBe(200);
      const read = await fetch(draft.base + "/workbench", { headers: draft.headers }); expect(read.status).toBe(200); const facts = await read.json();
      await writeFile(join(directory, "public-facts.json"), JSON.stringify({ facts, scope: "Only observation of existing persisted numeric facts; no new tax-unit authority, native conversion or product completion" }, null, 2));
      expect(facts.bills).toHaveLength(1); expect(facts.bills[0].billKey).toBe("main");
      expect(facts.bills[0].rows[0]).toMatchObject({ quantity: "0.0001", unitPrice: "0.50", taxInclusiveAmountYuan: "0.0001", taxExclusiveAmountYuan: "0.0001", taxAmountYuan: "0.0000", taxExclusiveUnitPrice: "1" });
      console.info("统一清单单位价现事实：" + directory);
    } finally { await server.processor.onApplicationShutdown(); await server.app.close(); }
  });

  it("preserves original two-loop source and observes nested PAGE refusal at the public source boundary", async () => {
    const server = await createTemplateTestServer({ draftWorkbench: true });
    const directory = await mkdtemp(join(tmpdir(), "jg-task10-unified-original-two-loop-"));
    try {
      const source = await readFile(resolve(__dirname, "../../../../scripts/probes/task08-documents/samples/material-purchase-real-v1.docx"));
      const sourceSha = createHash("sha256").update(source).digest("hex"); expect(sourceSha).toBe("8d707f8ecd65e2ca69c6920991dcb542cbc23ada42cf39a62299ab25e5820334");
      const token = await loginTemplateActor(server, "director"), base = await server.app.getUrl(); const headers = { authorization: "Bearer " + token, "content-type": "application/json" };
      const form = new FormData(); form.append("file", new Blob([new Uint8Array(source)]), "原材料运输双表.docx");
      const uploaded = await fetch(base + "/files", { method: "POST", headers: { authorization: headers.authorization }, body: form }); expect(uploaded.status).toBe(201); const file = await uploaded.json();
      const created = await fetch(base + "/contract-layout-templates", { method: "POST", headers, body: JSON.stringify({ name: "原材料双表观测", contractTypeKey: "material_purchase", docxFileId: file.id, placeholderSchema: { bills: [{ key: "materials" }] } }) });
      const creation = await created.json(); await writeFile(join(directory, "public-create.json"), JSON.stringify({ sourceSha, status: created.status, creation }, null, 2)); expect(created.status).toBe(201);
      const positions = await fetch(base + "/contract-layout-template-versions/" + creation.version.id + "/source-positions", { headers });
      const sourceFacts = await positions.json(); await writeFile(join(directory, "public-source-positions.json"), JSON.stringify({ status: positions.status, sourceFacts, scope: "Original nested PAGE containers refused; not a transport/body projection result" }, null, 2));
      expect(positions.status).toBe(400); expect(sourceFacts.message).toBe("模板包含嵌套正文段落，请拆分后重新上传");
      const ticket = await fetch(base + "/files/" + file.id + "/download-ticket", { method: "POST", headers, body: JSON.stringify({ confirmationPassword: server.password, downloadReason: "核对原材料双表准入拒绝后源文件未变" }) }); expect(ticket.status).toBe(201); const value = await ticket.json();
      const downloaded = await fetch(base + value.downloadUrl); expect(downloaded.status).toBe(200); expect(createHash("sha256").update(Buffer.from(await downloaded.arrayBuffer())).digest("hex")).toBe(sourceSha);
      console.info("统一清单原双表公有观测：" + directory);
    } finally { await server.processor.onApplicationShutdown(); await server.app.close(); }
  });
  describe("reviewed unified material projection", () => {
    let server: Awaited<ReturnType<typeof createTemplateTestServer>>;
    let directory: string;
    let layout: Awaited<ReturnType<typeof confirmedBodyLayout>>;
    let draft: Draft;
    let preparationMs: number;
    let saveMs: number;
    let bodyReadMs: number;
    const rows = [
      { clientRowKey: "material", sortOrder: 0, itemName: "统一材料有税行", unit: "件", quantity: "2", unitPrice: "113", taxRatePercent: "13", customData: { rowNumber: "999", taxUnitPrice: "8888.0000", manufacturer: "合成厂家甲", ordinaryExtra: "保留原自定义字段", "contract.taxAmount": "123456789.0000" } },
      { clientRowKey: "transport", sortOrder: 1, itemName: "统一运输有税行", unit: "趟", quantity: "2", unitPrice: "56.5", taxRatePercent: "13", customData: { rowNumber: "998", taxUnitPrice: "8887.0000" } },
      { clientRowKey: "tiny", sortOrder: 2, itemName: "微量单位价不一致", unit: "件", quantity: "0.0001", unitPrice: "0.5", taxRatePercent: "13", customData: { rowNumber: "997", taxUnitPrice: "8886.0000" } },
      { clientRowKey: "unknown", sortOrder: 3, itemName: "数量未约定", unit: "项", quantity: null, unitPrice: "113", taxRatePercent: "13", customData: { rowNumber: "996", taxUnitPrice: "8885.0000" } }
    ];

    beforeEach(async () => {
      const started = performance.now();
      server = await createTemplateTestServer({ draftWorkbench: true });
      directory = await mkdtemp(join(tmpdir(), "jg-task10-unified-readonly-projection-"));
      const source = await readFile(resolve(__dirname, "../../assets/templates/material-purchase-unified-v2.docx"));
      expect(createHash("sha256").update(source).digest("hex")).toBe("3fcd682276933ccf69014ac30ddcb32e7e15322a3c433e19db437478fac95722");
      layout = await confirmedBodyLayout(server, source, "materials", "material_purchase", "材料运输统一版技术catalog");
      draft = await createTask09Draft(server);
      preparationMs = Math.round(performance.now() - started);
    });

    beforeEach(async () => {
      const started = performance.now();
      const saved = await saveRows(draft, rows, layout.id); const result = await saved.json(); expect({ status: saved.status, result }).toMatchObject({ status: 200 });
      saveMs = Math.round(performance.now() - started);
    });

    beforeEach(async () => {
      const started = performance.now();
      const response = await fetch(draft.base + "/document-body", { headers: draft.headers }); const body = await response.json();
      await writeFile(join(directory, "public-body.json"), JSON.stringify({ status: response.status, body, sourceSha: layout.sha256, expectedOrdinal: ["1", "2", "3", "4"], expectedTaxUnit: ["13.0000", "6.5000", "待确定", "待确定"], scope: "Synthetic immutable published catalog solely for public contract consumption; no adoption or publication claim" }, null, 2)); expect(response.status).toBe(200);
      bodyReadMs = Math.round(performance.now() - started);
    });

    afterEach(async () => {
      if (!server) return;
      try { await server.processor.onApplicationShutdown(); }
      finally { await server.app.close(); }
    });

    it("keeps unified ordinal and tax unit display server-derived despite customData and unknown facts", async () => {
      const started = performance.now();
      const factsResponse = await fetch(draft.base + "/workbench", { headers: draft.headers }); expect(factsResponse.status).toBe(200); const facts = await factsResponse.json();
      const queuedResponse = await fetch(draft.base + "/preview-generation", { method: "POST", headers: draft.headers, body: JSON.stringify({ sourceRevision: facts.version.draftRevision }) }); expect(queuedResponse.status).toBe(201); const queued = await queuedResponse.json();
      const listed = await fetch((await server.app.getUrl()) + "/contract-workbench/" + draft.version.id + "/documents", { headers: draft.headers }); expect(listed.status).toBe(200); const output = (await listed.json()).find((job: { id: string }) => job.id === queued.generationId);
      await writeFile(join(directory, "public-pending-facts.json"), JSON.stringify({ facts, queued, output, nativeExecuted: false }, null, 2));
      const projected = output.inputSnapshot.renderInput.values["bill.materials"];
      expect(projected.map((row: { rowNumber: string }) => row.rowNumber)).toEqual(["1", "2", "3", "4"]);
      expect(projected.map((row: { taxUnitPrice: string }) => row.taxUnitPrice)).toEqual(["13.0000", "6.5000", "待确定", "待确定"]);
      expect(projected[0]).toMatchObject({ manufacturer: "合成厂家甲", ordinaryExtra: "保留原自定义字段" });
      expect(output.inputSnapshot.renderInput.values["contract.taxAmount"]).toBe("待确定");
      expect(facts.bills[0].rows[2]).toMatchObject({ taxExclusiveUnitPrice: "1", taxAmountYuan: "0.0000" });
      expect(facts.bills[0].rows[3]).toMatchObject({ quantity: null, taxExclusiveUnitPrice: null, taxAmountYuan: null });
      expect(facts.bills[0].rows.map((row: { customData: unknown }) => row.customData)).toEqual(rows.map(row => row.customData));
      console.info("统一清单只读投影证据：" + directory);
      console.info("统一清单公开 HTTP 耗时", JSON.stringify({
        preparationMs, saveMs, bodyReadMs, queueAndReadbackMs: Math.round(performance.now() - started)
      }));
    });
  });

  it.each(["approved", "unknown font"])("accepts the new plain PAGE version and binds authoritative net and tax totals with %s inspection", async (fontCase) => {
    const server = await createTemplateTestServer(); const directory = await mkdtemp(join(tmpdir(), "jg-task10-unified-public-mapping-"));
    try {
      let source: Buffer = await readFile(resolve(__dirname, "../../assets/templates/material-purchase-unified-v2.docx"));
      if (fontCase === "unknown font") {
        const zip = new PizZip(source), styles = zip.file("word/styles.xml")!.asText();
        expect(styles).toContain('w:ascii="Times New Roman"');
        zip.file("word/styles.xml", styles.replaceAll('w:ascii="Times New Roman"', 'w:ascii="Unapproved_A07_Font"'));
        source = zip.generate({ type: "nodebuffer" });
      }
      const sourceSha = createHash("sha256").update(source).digest("hex");
      if (fontCase === "approved") expect(sourceSha).toBe("3fcd682276933ccf69014ac30ddcb32e7e15322a3c433e19db437478fac95722");
      const token = await loginTemplateActor(server, "director"), base = await server.app.getUrl(), headers = { authorization: "Bearer " + token, "content-type": "application/json" };
      const request = (path: string, method = "GET", data?: unknown) => fetch(base + path, { method, headers, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
      const form = new FormData(); form.append("file", new Blob([new Uint8Array(source)]), "材料及运输统一清单新版.docx");
      const uploaded = await fetch(base + "/files", { method: "POST", headers: { authorization: headers.authorization }, body: form }); expect(uploaded.status).toBe(201); const file = await uploaded.json();
      const created = await request("/contract-layout-templates", "POST", { name: "材料运输统一版公有检查", contractTypeKey: "material_purchase", docxFileId: file.id, placeholderSchema: { bills: [{ key: "materials" }] } }); expect(created.status).toBe(201); const layout = await created.json(); const path = "/contract-layout-template-versions/" + layout.version.id;
      const read = await request(path + "/source-positions"); const positions = await read.json(); await writeFile(join(directory, "public-new-source-positions.json"), JSON.stringify({ status: read.status, positions }, null, 2)); expect(read.status).toBe(200); expect(positions.sourceSha256).toBe(sourceSha);
      const fields = [["contract.name", ["合同名称"]], ["party.owner.name", ["甲方名称"]], ["party.counterparty.name", ["乙方名称"]], ["contract.temporaryCode", ["合同编号"]], ["document.watermark", ["文档水印"]], ["contract.taxExclusiveAmount", ["材料不含税合计", "不含税总额"]], ["contract.taxExclusiveAmountUppercase", ["不含税总额大写"]], ["contract.taxAmount", ["材料税额合计", "税额总计"]], ["contract.taxAmountUppercase", ["税额总计大写"]], ["contract.amount", ["材料含税合计"]], ["field.invoiceType", ["发票类型"]]] as const;
      const bindings = positions.positions.flatMap((position: { positionId: string; text: string }) => fields.flatMap(([fieldKey, names]) => names.flatMap(name => { const literal = `{${name}}`, start = position.text.indexOf(literal); return start < 0 ? [] : [{ positionId: position.positionId, start, end: start + literal.length, fieldKey }]; })));
      const response = await request(path + "/source-mapping", "PATCH", { expectedRevision: 1, sourceFileId: file.id, sourceSha256: sourceSha, bindings }); const mapped = await response.json(); await writeFile(join(directory, "public-mapping.json"), JSON.stringify({ status: response.status, bindings, mapped }, null, 2)); expect(response.status).toBe(200);
      const inspected = await request(path + "/inspection", "POST"); const report = await inspected.json(); await writeFile(join(directory, "public-inspection.json"), JSON.stringify({ status: inspected.status, report, noFormalAdoption: true }, null, 2)); expect(inspected.status).toBe(201); expect(report.unknownPlaceholders).toEqual([]);
      expect(report.blockingErrors).toEqual(fontCase === "approved" ? [] : ["Disallowed fonts: Unapproved_A07_Font"]);
      expect(report.blockingErrors.join(" ")).not.toContain("zh-CN");
      console.info("统一清单公有映射与检查：" + directory);
    } finally { await server.processor.onApplicationShutdown(); await server.app.close(); }
  });

});
