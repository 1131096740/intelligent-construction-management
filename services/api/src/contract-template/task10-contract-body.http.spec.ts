import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import PizZip from "pizzip";
import { createTemplateTestServer, syntheticWordSource } from "./template-management.test-support";
import { createTask09Draft, saveTask09Draft } from "./task09-draft-template.test-support";
import { loginTemplateActor } from "./template-selection.test-support";
import { confirmedBodyLayout, saveBody, type Body, type Server } from "./task10-body.test-support";

describe("task10 complete contract body through authenticated public draft HTTP", () => {
  let server: Server;
  beforeAll(async () => { server = await createTemplateTestServer({ draftWorkbench: true }); });
  afterAll(async () => { await server.app.close(); });

  it("reads the complete selected Word body with current authoritative parties and ordinary clauses", async () => {
    const layout = await confirmedBodyLayout(server);
    const draft = await createTask09Draft(server);
    const saved = await saveTask09Draft(server, draft, "material_purchase", layout.id);
    expect(saved.status === 200 ? "OK" : await saved.text()).toBe("OK");
    const fileReads = jest.spyOn(server.files, "getFileBuffer");
    try {
      const response = await fetch(`${draft.base}/document-body`, { headers: draft.headers });
      expect(response.status).toBe(200);
      const body = await response.json() as Body;
      expect(body.sourceSha256).toBe(layout.sha256);
      expect(body.blocks.map(block => block.text)).toEqual([
        "合同名称：上游新建当前合同名称", "甲方：当前单甲方", "乙方：当前单乙方", expect.stringMatching(/^编号：/u), expect.any(String), "交货地点：合成工地", "手工条款：本项普通约定按原文保留。", "甲方签章：当前单甲方", "乙方签章：当前单乙方"
      ]);
      expect(body.blocks.find(block => block.text === "手工条款：本项普通约定按原文保留。")).toMatchObject({ kind: "paragraph", editable: true });
      expect(body.blocks.find(block => block.text === "甲方：当前单甲方")).toMatchObject({ editable: false });
      expect(fileReads).toHaveBeenCalledTimes(1);
    } finally {
      fileReads.mockRestore();
    }
  });

  it.each([
    { change: "source deactivation", metadata: { storageStatus: "purged" }, status: 500 },
    { change: "source replacement", metadata: { objectKey: "replaced-template.docx" }, status: 400 }
  ])("refuses to render if the private file changes after download: $change", async ({ metadata, status }) => {
    const layout = await confirmedBodyLayout(server);
    const draft = await createTask09Draft(server);
    expect((await saveTask09Draft(server, draft, "material_purchase", layout.id)).status).toBe(200);
    const download = server.files.getFileBuffer.bind(server.files);
    const fileReads = jest.spyOn(server.files, "getFileBuffer").mockImplementationOnce(async (fileId, tx) => {
      const verified = await download(fileId, tx);
      await server.store.prisma.fileObject.update({ where: { id: fileId }, data: metadata });
      return verified;
    });
    try {
      const response = await fetch(`${draft.base}/document-body`, { headers: draft.headers });
      expect(response.status).toBe(status);
      expect(await response.json()).not.toHaveProperty("blocks");
      expect(fileReads).toHaveBeenCalledTimes(1);
    } finally {
      fileReads.mockRestore();
    }
  });

  it("saves an ordinary clause through the aggregate and rereads the same literal text", async () => {
    const layout = await confirmedBodyLayout(server);
    const draft = await createTask09Draft(server);
    expect((await saveTask09Draft(server, draft, "material_purchase", layout.id)).status).toBe(200);
    const body = await fetch(`${draft.base}/document-body`, { headers: draft.headers }).then(response => response.json()) as Body;
    const clause = body.blocks.find(block => block.text.startsWith("手工条款："))!;
    const saved = await saveBody(draft, { protocolVersion: 1, layoutTemplateVersionId: layout.id, sourceSha256: layout.sha256, edits: [{ positionId: clause.id, text: "手工条款：运输按{人工约定}办理，原文数字1.5340保留。" }] });
    expect(saved.status === 200 ? "OK" : await saved.text()).toBe("OK");
    const reread = await fetch(`${draft.base}/document-body`, { headers: draft.headers }).then(response => response.json()) as typeof body;
    expect(reread.blocks.find(block => block.id === clause.id)?.text).toBe("手工条款：运输按{人工约定}办理，原文数字1.5340保留。");
    expect(reread.documentContentRevision).toBeGreaterThan(body.documentContentRevision);
  });

  it("synchronizes authoritative party fields without discarding a manually saved ordinary clause", async () => {
    const layout = await confirmedBodyLayout(server);
    const draft = await createTask09Draft(server);
    expect((await saveTask09Draft(server, draft, "material_purchase", layout.id)).status).toBe(200);
    const body = await fetch(`${draft.base}/document-body`, { headers: draft.headers }).then(response => response.json()) as Body;
    const clause = body.blocks.find(block => block.text.startsWith("手工条款："))!;
    expect((await saveBody(draft, { protocolVersion: 1, layoutTemplateVersionId: layout.id, sourceSha256: layout.sha256, edits: [{ positionId: clause.id, text: "手工条款：此项人工约定必须保留。" }] })).status).toBe(200);
    // A basic-field client need not resend the body edit plan to keep it.
    expect((await saveBody(draft, undefined, "填写页更新后的权威甲方")).status).toBe(200);
    const reread = await fetch(`${draft.base}/document-body`, { headers: draft.headers }).then(response => response.json()) as Body;
    expect(reread.blocks.find(block => block.id === clause.id)?.text).toBe("手工条款：此项人工约定必须保留。");
    expect(reread.blocks.map(block => block.text)).toContain("甲方：填写页更新后的权威甲方");
    expect(reread.blocks.map(block => block.text)).toContain("甲方签章：填写页更新后的权威甲方");
  });

  it("rejects a second authoritative party value in the body and retains the saved draft", async () => {
    const layout = await confirmedBodyLayout(server);
    const draft = await createTask09Draft(server);
    expect((await saveTask09Draft(server, draft, "material_purchase", layout.id)).status).toBe(200);
    const before = await fetch(`${draft.base}/document-body`, { headers: draft.headers }).then(response => response.json()) as Body;
    const party = before.blocks.find(block => block.text === "甲方：当前单甲方")!;
    const saved = await saveBody(draft, { protocolVersion: 1, layoutTemplateVersionId: layout.id, sourceSha256: layout.sha256, edits: [{ positionId: party.id, text: "甲方：绕过填写页的另一家公司" }] });
    expect(saved.status).toBe(400);
    expect((await saved.json() as { message: string }).message).toContain("不能在正文另改关键资料");
    const after = await fetch(`${draft.base}/document-body`, { headers: draft.headers }).then(response => response.json());
    expect(after).toEqual(before);
  });

  it("inserts ordinary supplementary clauses at chosen positions with numbering in document order", async () => {
    const layout = await confirmedBodyLayout(server);
    const draft = await createTask09Draft(server);
    expect((await saveTask09Draft(server, draft, "material_purchase", layout.id)).status).toBe(200);
    const before = await fetch(`${draft.base}/document-body`, { headers: draft.headers }).then(response => response.json()) as Body;
    const delivery = before.blocks.find(block => block.text === "交货地点：合成工地")!;
    const ordinary = before.blocks.find(block => block.text.startsWith("手工条款："))!;
    const saved = await saveBody(draft, { protocolVersion: 1, layoutTemplateVersionId: layout.id, sourceSha256: layout.sha256, edits: [], additions: [
      { id: "transport", afterPositionId: ordinary.id, text: "运输费用由乙方承担。" },
      { id: "delivery", afterPositionId: delivery.id, text: "到货前一天通知甲方。" }
    ] });
    expect(saved.status === 200 ? "OK" : await saved.text()).toBe("OK");
    const after = await fetch(`${draft.base}/document-body`, { headers: draft.headers }).then(response => response.json()) as Body;
    expect(after.blocks.slice(5).map(block => block.text)).toEqual([
      "交货地点：合成工地", "补充条款1：到货前一天通知甲方。", "手工条款：本项普通约定按原文保留。", "补充条款2：运输费用由乙方承担。", "甲方签章：当前单甲方", "乙方签章：当前单乙方"
    ]);
    expect(after.blocks.find(block => block.id === "added:transport")).toMatchObject({ editable: true });
  });

  it("removes an ordinary clause and keeps that choice when authoritative details synchronize", async () => {
    const layout = await confirmedBodyLayout(server);
    const draft = await createTask09Draft(server);
    expect((await saveTask09Draft(server, draft, "material_purchase", layout.id)).status).toBe(200);
    const before = await fetch(`${draft.base}/document-body`, { headers: draft.headers }).then(response => response.json()) as Body;
    const ordinary = before.blocks.find(block => block.text.startsWith("手工条款："))!;
    const saved = await saveBody(draft, { protocolVersion: 1, layoutTemplateVersionId: layout.id, sourceSha256: layout.sha256, edits: [], deletedPositionIds: [ordinary.id] });
    expect(saved.status === 200 ? "OK" : await saved.text()).toBe("OK");
    expect((await saveBody(draft, undefined, "删除后同步甲方")).status).toBe(200);
    const after = await fetch(`${draft.base}/document-body`, { headers: draft.headers }).then(response => response.json()) as Body;
    expect(after.blocks.some(block => block.id === ordinary.id)).toBe(false);
    expect(after.blocks.map(block => block.text)).toContain("甲方签章：删除后同步甲方");
  });

  it("requires an explicit overwrite confirmation before full regeneration and retains the previous body save point", async () => {
    const layout = await confirmedBodyLayout(server);
    const draft = await createTask09Draft(server);
    expect((await saveTask09Draft(server, draft, "material_purchase", layout.id)).status).toBe(200);
    const before = await fetch(`${draft.base}/document-body`, { headers: draft.headers }).then(response => response.json()) as Body;
    const ordinary = before.blocks.find(block => block.text.startsWith("手工条款："))!;
    const basePlan = { protocolVersion: 1, layoutTemplateVersionId: layout.id, sourceSha256: layout.sha256 };
    expect((await saveBody(draft, { ...basePlan, edits: [{ positionId: ordinary.id, text: "重建前的重要人工约定。" }] })).status).toBe(200);
    const refused = await saveBody(draft, { ...basePlan, edits: [] });
    expect(refused.status).toBe(409);
    const retained = await fetch(`${draft.base}/document-body`, { headers: draft.headers }).then(response => response.json()) as Body;
    expect(retained.blocks.find(block => block.id === ordinary.id)?.text).toBe("重建前的重要人工约定。");
    const regenerated = await saveBody(draft, { ...basePlan, edits: [] }, "当前单甲方", [], { kind: "regenerate", confirmOverwrite: true });
    expect(regenerated.status === 200 ? "OK" : await regenerated.text()).toBe("OK");
    const after = await fetch(`${draft.base}/document-body`, { headers: draft.headers }).then(response => response.json()) as Body & { savePoints: Array<{ id: string; documentBody: unknown }> };
    expect(after.blocks.find(block => block.id === ordinary.id)?.text).toBe("手工条款：本项普通约定按原文保留。");
    expect(after.savePoints).toEqual([expect.objectContaining({ id: expect.any(String), documentBody: { ...basePlan, edits: [{ positionId: ordinary.id, text: "重建前的重要人工约定。" }] } })]);
  });

  it("marks an additional blank visibly and permits an ordinary body entry without changing authoritative fields", async () => {
    const source = new PizZip(syntheticWordSource(true));
    source.file("word/document.xml", source.file("word/document.xml")!.asText().replace("交货地点：合成工地", "交货地点：{交货地点}"));
    const layout = await confirmedBodyLayout(server, source.generate({ type: "nodebuffer" }));
    const draft = await createTask09Draft(server);
    expect((await saveTask09Draft(server, draft, "material_purchase", layout.id)).status).toBe(200);
    const before = await fetch(`${draft.base}/document-body`, { headers: draft.headers }).then(response => response.json()) as Body & { blocks: Array<{ blankFields: string[] }> };
    const blank = before.blocks.find(block => block.text.startsWith("交货地点："))!;
    expect(blank).toMatchObject({ text: "交货地点：【待补充：交货地点】", editable: true, blankFields: ["交货地点"] });
    const saved = await saveBody(draft, { protocolVersion: 1, layoutTemplateVersionId: layout.id, sourceSha256: layout.sha256, edits: [{ positionId: blank.id, text: "交货地点：北区仓库。" }] });
    expect(saved.status === 200 ? "OK" : await saved.text()).toBe("OK");
    const after = await fetch(`${draft.base}/document-body`, { headers: draft.headers }).then(response => response.json()) as typeof before;
    expect(after.blocks.find(block => block.id === blank.id)).toMatchObject({ text: "交货地点：北区仓库。", editable: true, blankFields: [] });
    expect(after.blocks.map(block => block.text)).toContain("甲方：当前单甲方");
  });

  it("keeps hand-written clauses when a template change is cancelled and records the original source on a confirmed change", async () => {
    const oldLayout = await confirmedBodyLayout(server), newLayout = await confirmedBodyLayout(server);
    const draft = await createTask09Draft(server);
    expect((await saveTask09Draft(server, draft, "material_purchase", oldLayout.id)).status).toBe(200);
    const before = await fetch(`${draft.base}/document-body`, { headers: draft.headers }).then(response => response.json()) as Body;
    const clause = before.blocks.find(block => block.text.startsWith("手工条款："))!;
    const originalPlan = { protocolVersion: 1, layoutTemplateVersionId: oldLayout.id, sourceSha256: oldLayout.sha256, edits: [{ positionId: clause.id, text: "换模板前保留原人工条款。" }] };
    expect((await saveBody(draft, originalPlan)).status).toBe(200);
    expect((await saveTask09Draft(server, draft, "material_purchase", newLayout.id)).status).toBe(409);
    const retained = await fetch(`${draft.base}/document-body`, { headers: draft.headers }).then(response => response.json()) as Body & { layoutTemplateVersionId: string };
    expect(retained.layoutTemplateVersionId).toBe(oldLayout.id);
    expect(retained.blocks.find(block => block.id === clause.id)?.text).toBe("换模板前保留原人工条款。");
    const confirmed = await saveBody(draft, { protocolVersion: 1, layoutTemplateVersionId: newLayout.id, sourceSha256: newLayout.sha256, edits: [] }, "当前单甲方", [], { kind: "regenerate", confirmOverwrite: true }, newLayout.id);
    expect(confirmed.status === 200 ? "OK" : await confirmed.text()).toBe("OK");
    const after = await fetch(`${draft.base}/document-body`, { headers: draft.headers }).then(response => response.json()) as typeof retained & { savePoints: Array<{ layoutTemplateVersionId: string; documentBody: unknown }> };
    expect(after.layoutTemplateVersionId).toBe(newLayout.id);
    expect(after.savePoints[0]).toMatchObject({ layoutTemplateVersionId: oldLayout.id, documentBody: originalPlan });
  });

  it("reorders ordinary paragraphs while preserving the authoritative header and original signature positions", async () => {
    const layout = await confirmedBodyLayout(server);
    const draft = await createTask09Draft(server);
    expect((await saveTask09Draft(server, draft, "material_purchase", layout.id)).status).toBe(200);
    const before = await fetch(`${draft.base}/document-body`, { headers: draft.headers }).then(response => response.json()) as Body;
    const ordinary = before.blocks.find(block => block.text.startsWith("手工条款："))!;
    const delivery = before.blocks.find(block => block.text === "交货地点：合成工地")!;
    const saved = await saveBody(draft, { protocolVersion: 1, layoutTemplateVersionId: layout.id, sourceSha256: layout.sha256, edits: [], paragraphOrder: [ordinary.id, delivery.id] });
    expect(saved.status === 200 ? "OK" : await saved.text()).toBe("OK");
    const after = await fetch(`${draft.base}/document-body`, { headers: draft.headers }).then(response => response.json()) as Body;
    expect(after.blocks.map(block => block.text)).toEqual([
      "合同名称：上游新建当前合同名称", "甲方：当前单甲方", "乙方：当前单乙方", expect.stringMatching(/^编号：/u), expect.any(String),
      "手工条款：本项普通约定按原文保留。", "交货地点：合成工地", "甲方签章：当前单甲方", "乙方签章：当前单乙方"
    ]);
  });

  it("does not let an unchanged paragraph order bypass the full-regeneration overwrite confirmation", async () => {
    const layout = await confirmedBodyLayout(server);
    const draft = await createTask09Draft(server);
    expect((await saveTask09Draft(server, draft, "material_purchase", layout.id)).status).toBe(200);
    const before = await fetch(`${draft.base}/document-body`, { headers: draft.headers }).then(response => response.json()) as Body;
    const ordinary = before.blocks.find(block => block.text.startsWith("手工条款："))!;
    const delivery = before.blocks.find(block => block.text === "交货地点：合成工地")!;
    const basePlan = { protocolVersion: 1, layoutTemplateVersionId: layout.id, sourceSha256: layout.sha256 };
    expect((await saveBody(draft, { ...basePlan, edits: [{ positionId: ordinary.id, text: "排序元数据不能清掉此人工约定。" }] })).status).toBe(200);
    const refused = await saveBody(draft, { ...basePlan, edits: [], paragraphOrder: [delivery.id, ordinary.id] });
    expect(refused.status).toBe(409);
    const after = await fetch(`${draft.base}/document-body`, { headers: draft.headers }).then(response => response.json()) as Body;
    expect(after.blocks.find(block => block.id === ordinary.id)?.text).toBe("排序元数据不能清掉此人工约定。");
  });

  it("allows a business-type-only save to retain the selected source and manual body until a matching template is chosen", async () => {
    const layout = await confirmedBodyLayout(server);
    const draft = await createTask09Draft(server);
    expect((await saveTask09Draft(server, draft, "material_purchase", layout.id)).status).toBe(200);
    const before = await fetch(`${draft.base}/document-body`, { headers: draft.headers }).then(response => response.json()) as Body;
    const ordinary = before.blocks.find(block => block.text.startsWith("手工条款："))!;
    const plan = { protocolVersion: 1, layoutTemplateVersionId: layout.id, sourceSha256: layout.sha256, edits: [{ positionId: ordinary.id, text: "先改业务类型也必须保留此手写约定。" }] };
    expect((await saveBody(draft, plan)).status).toBe(200);
    const changed = await saveTask09Draft(server, draft, "other", layout.id);
    expect(changed.status === 200 ? "OK" : await changed.text()).toBe("OK");
    const current = await fetch(`${draft.base}/workbench`, { headers: draft.headers }).then(response => response.json()) as { version: { draftRevision: number; layoutTemplateVersionId: string; draftData: Record<string, unknown> } };
    expect(current.version).toMatchObject({ layoutTemplateVersionId: layout.id, draftData: { contractBasics: { businessType: "other" }, documentBody: plan } });
    const generated = await fetch(`${draft.base}/preview-generation`, { method: "POST", headers: draft.headers, body: JSON.stringify({ sourceRevision: current.version.draftRevision }) });
    expect(generated.status).toBe(400);
    expect((await generated.json() as { message: string }).message).toContain("不匹配");
  });

  it("accepts the original Word source including its valid self-closing empty paragraph at the public source-read seam", async () => {
    const source = readFileSync(join(__dirname, "../../assets/templates/material-purchase-real-v1.docx"));
    const equivalent = new (await import("pizzip")).default(source);
    equivalent.file("word/document.xml", equivalent.file("word/document.xml")!.asText().replace(/<w:p\b([^>]*)\/>/gu, "<w:p$1></w:p>"));
    const headers = { authorization: `Bearer ${await loginTemplateActor(server, "director")}`, "content-type": "application/json" };
    const results = [];
    for (const [variant, buffer] of [["original", source], ["equivalent-explicit-close", equivalent.generate({ type: "nodebuffer" })]] as const) {
      const file = await server.files.uploadPrivateFile({ originalName: `${variant}材料Word.docx`, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sizeBytes: buffer.length, buffer, uploadedByUserId: "director" });
      const created = await fetch(`${await server.app.getUrl()}/contract-layout-templates`, { method: "POST", headers, body: JSON.stringify({ name: variant, contractTypeKey: "material_purchase", docxFileId: file.id, placeholderSchema: { bills: [] } }) });
      expect(created.status === 201 ? "OK" : await created.text()).toBe("OK");
      const { version } = await created.json() as { version: { id: string } };
      const response = await fetch(`${await server.app.getUrl()}/contract-layout-template-versions/${version.id}/source-positions`, { headers });
      const parsed = await response.json() as { sourceSha256: string; positions?: Array<{ text: string; part: string; paragraphIndex: number }> };
      results.push({ variant, status: response.status, sha256: parsed.sourceSha256, expectedSha256: createHash("sha256").update(buffer).digest("hex"), positions: parsed.positions });
    }
    expect(results.map(({ variant, status }) => ({ variant, status }))).toEqual([{ variant: "original", status: 200 }, { variant: "equivalent-explicit-close", status: 200 }]);
    for (const result of results) { expect(result.sha256).toBe(result.expectedSha256); expect(result.positions!.map(position => position.text)).toContain("甲方：{甲方名称}"); }
    expect(results[0].positions!.map(({ text, part, paragraphIndex }) => ({ text, part, paragraphIndex }))).toEqual(results[1].positions!.map(({ text, part, paragraphIndex }) => ({ text, part, paragraphIndex })));
  });

  describe("reviewed Word table source", () => {
    let layout: Awaited<ReturnType<typeof confirmedBodyLayout>>;
    let draft: Awaited<ReturnType<typeof createTask09Draft>>;

    beforeAll(async () => {
      const source = readFileSync(join(__dirname, "../../assets/templates/material-purchase-real-v1.docx"));
      layout = await confirmedBodyLayout(server, source, "materials");
      draft = await createTask09Draft(server);
    }, 30_000);

    it("reads actual Word table structure and title formatting instead of flattening the contract into plain paragraphs", async () => {
      const currentResponse = await fetch(`${draft.base}/workbench`, { headers: draft.headers });
      expect(currentResponse.status).toBe(200);
      const current = await currentResponse.json() as {
        version: { draftRevision: number }; bills: Array<{ billKey: string; revision: number }>
      };
      const saved = await fetch(draft.base, { method: "PUT", headers: { ...draft.headers, "x-contract-draft-lease": draft.leaseToken }, body: JSON.stringify({
        idempotencyKey: randomUUID(), saveKind: "manual", expectedRevision: current.version.draftRevision, changedSections: ["draft", "parties", "bills"],
        draft: { numericProtocolVersion: 2, draftData: { contractName: "上游新建当前合同名称",
          contractBasics: { businessType: "material_purchase", relationship: "upward", amountBasis: "tax_inclusive", invoiceStatus: "pending" }
        }, clauses: [], pricingNature: "unit_price", amountSource: "bill_sum", layoutTemplateVersionId: layout.id,
        taxFacts: { invoiceType: null, taxMode: "single_rate", defaultTaxRatePercent: "0", source: "contract_document" } },
        parties: [{ roleKey: "party_a", displayOrder: 0, snapshot: { name: "当前单甲方" } }, { roleKey: "party_b", displayOrder: 0, snapshot: { name: "当前单乙方" } }],
        bills: current.bills.map((bill, index) => ({ billKey: bill.billKey, expectedRevision: bill.revision, numericProtocolVersion: 2,
          rows: index ? [] : [{ clientRowKey: "table-row", sortOrder: 0, itemName: "正文清单钢材", unit: "吨", quantity: "2", unitPrice: "3.2500", taxRatePercent: "0", customData: {} }] })),
        paymentTerms: null, attachments: [], negotiationDocuments: { referencedGeneratedDocumentIds: [] }
      }) });
      expect(saved.status === 200 ? "OK" : await saved.text()).toBe("OK");
      const response = await fetch(`${draft.base}/document-body`, { headers: draft.headers });
      expect(response.status === 200 ? "OK" : await response.text()).toBe("OK");
      const body = await response.json() as {
        flow: Array<{ kind: string; columns?: number[]; rows?: Array<{ cells: Array<{ paragraphIds: string[] }> }> }>;
        blocks: Array<{ id: string; text: string; format: { fontFamily: string; fontSizePt: number; align: string } }>;
      };
      expect(body.flow.filter(block => block.kind === "table")).toHaveLength(2);
      const table = body.flow.find(block => block.kind === "table")!;
      expect(table.columns).toEqual([510, 1276, 1106, 680, 765, 1446, 510, 2211]);
      expect(table.rows![0].cells.map(cell => cell.paragraphIds.map(id => body.blocks.find(block => block.id === id)!.text).join("\n"))).toEqual(["序号", "货物名称", "规格型号", "计量单位", "数量", "含税单价", "税率(%)", "价税合计"]);
      expect(table.rows![1].cells.map(cell => cell.paragraphIds.map(id => body.blocks.find(block => block.id === id)!.text).join("\n"))).toContain("正文清单钢材");
      expect(body.blocks.find(block => block.text === "上游新建当前合同名称")!.format).toMatchObject({ fontFamily: "方正小标宋简体", fontSizePt: 22, align: "center" });
    });
  });
});
