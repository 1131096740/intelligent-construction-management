import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import PizZip from "pizzip";
import { createTemplateTestServer, syntheticWordSource } from "./template-management.test-support";

describe("template source positions through real HTTP, DTO pipe and private files", () => {
  let server: Awaited<ReturnType<typeof createTemplateTestServer>>;
  let token: string;
  beforeAll(async () => {
    server = await createTemplateTestServer();
    const response = await fetch(`${await server.app.getUrl()}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: server.actors[0].phone, password: server.password }) });
    expect(response.status).toBe(201);
    token = (await response.json() as { tokens: { accessToken: string } }).tokens.accessToken;
  });
  afterAll(async () => { await server?.app.close(); });

  async function preparedPublishedLayout(includeSignatures = false) {
    const url = await server.app.getUrl();
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const request = (path: string, method = "GET", body?: unknown) => fetch(url + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const uploadBody = new FormData();
    uploadBody.append("file", new Blob([new Uint8Array(syntheticWordSource(includeSignatures))]), "真实生成映射样张.docx");
    const file = await fetch(url + "/files", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: uploadBody }).then(response => response.json()) as { id: string };
    // Seed a pre-existing published template through real public services.
    // The upload HTTP restoration is a separate, currently RED acceptance gate.
    const { version } = await server.layouts.createLayout("director", { name: "公开链已确认模板", contractTypeKey: "material_purchase", docxFileId: file.id, placeholderSchema: { bills: [] } });
    const base = `/contract-layout-template-versions/${version.id}`;
    const source = await request(base + "/source-positions").then(response => response.json()) as { sourceSha256: string; positions: Array<{ positionId: string; text: string }> };
    const fields = ["contract.name", "party.owner.name", "party.counterparty.name", "contract.temporaryCode", "document.watermark"];
    const bindings = source.positions.slice(0, 5).map((position, i) => ({ positionId: position.positionId, start: i === 0 ? 5 : i === 4 ? 0 : 3, end: position.text.length, fieldKey: fields[i] }));
    if (includeSignatures) for (const [index, fieldKey] of [[7, "party.owner.name"], [8, "party.counterparty.name"]] as const) {
      const position = source.positions[index];
      bindings.push({ positionId: position.positionId, start: 5, end: position.text.length, fieldKey });
    }
    const mapping = await server.layouts.saveSourceMapping(version.id, "director", { expectedRevision: 1, sourceFileId: file.id, sourceSha256: source.sourceSha256, bindings });
    expect((await server.layouts.inspectVersion(version.id, "director")).blockingErrors).toEqual([]);
    await server.layouts.queuePreview(version.id, "director", { contract: { name: "已确认合同" }, party: { owner: { name: "确认甲方" }, counterparty: { name: "确认乙方" } } });
    await server.processor.processNext();
    expect(await server.layouts.confirmSourceMapping(version.id, "director", { expectedRevision: 2, sourceFileId: file.id, sourceSha256: source.sourceSha256, mappingFingerprint: mapping.mappingFingerprint })).toMatchObject({ confirmed: true });
    expect((await server.layouts.submitVersion(version.id, "director")).status).toBe("submitted");
    expect((await server.layouts.publishVersion(version.id, "director", "主管确认公开映射与真实预览")).status).toBe("published");
    return { id: version.id, fileId: file.id, sourceSha256: source.sourceSha256, mappingFingerprint: mapping.mappingFingerprint };
  }

  it("maps existing registered business fields without guessing an unknown target", async () => {
    const body = new FormData();
    body.append("file", new Blob([new Uint8Array(syntheticWordSource())]), "既有交货地点字段.docx");
    const file = await fetch(`${await server.app.getUrl()}/files`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body }).then(response => response.json()) as { id: string };
    const created = await fetch(`${await server.app.getUrl()}/contract-layout-templates`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ name: "既有交货地点字段", contractTypeKey: "material_purchase", docxFileId: file.id, placeholderSchema: { bills: [] } }) }).then(response => response.json()) as { version: { id: string } };
    const base = `${await server.app.getUrl()}/contract-layout-template-versions/${created.version.id}`;
    const source = await fetch(base + "/source-positions", { headers: { authorization: `Bearer ${token}` } }).then(response => response.json()) as { sourceSha256: string; positions: Array<{ positionId: string; text: string }> };
    const fields = ["contract.name", "party.owner.name", "party.counterparty.name", "contract.temporaryCode", "document.watermark", "field.deliveryLocation"];
    const bindings = source.positions.slice(0, 6).map((position, i) => ({ positionId: position.positionId, start: i === 0 || i === 5 ? 5 : i === 4 ? 0 : 3, end: position.text.length, fieldKey: fields[i] }));
    const unknown = await fetch(base + "/source-mapping", { method: "PATCH", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: 1, sourceFileId: file.id, sourceSha256: source.sourceSha256, bindings: bindings.map((binding, index) => index === 5 ? { ...binding, fieldKey: "field.notRegistered" } : binding) }) });
    expect(unknown.status).toBe(400);
    const response = await fetch(base + "/source-mapping", { method: "PATCH", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: 1, sourceFileId: file.id, sourceSha256: source.sourceSha256, bindings }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ preview: expect.arrayContaining([{ positionId: expect.any(String), part: "word/document.xml", paragraphIndex: 5, text: "交货地点：{field.deliveryLocation}" }]) });
  });

  it("lists draft and stopped template versions for supervisor maintenance", async () => {
    const response = await fetch(`${await server.app.getUrl()}/contract-layout-templates/maintenance`, { headers: { authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    expect(Array.isArray(await response.json())).toBe(true);
  });

  it("shows actual Word paragraph positions bound to the uploaded private source revision", async () => {
    const source = syntheticWordSource();
    const body = new FormData();
    body.append("file", new Blob([new Uint8Array(source)], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), "合成待映射.docx");
    const uploaded = await fetch(`${await server.app.getUrl()}/files`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body });
    expect(uploaded.status).toBe(201);
    const file = await uploaded.json() as { id: string };
    const created = await fetch(`${await server.app.getUrl()}/contract-layout-templates`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ name: "合成模板", contractTypeKey: "material_purchase", docxFileId: file.id, placeholderSchema: { bills: [] } }) });
    expect(created.status).toBe(201);
    const layout = await created.json() as { version: { id: string } };
    const response = await fetch(`${await server.app.getUrl()}/contract-layout-template-versions/${layout.version.id}/source-positions`, { headers: { authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    const parsed = await response.json() as { sourceFileId: string; sourceSha256: string; draftRevision: number; positions: Array<{ text: string; positionId: string }> };
    expect(parsed).toMatchObject({ sourceFileId: file.id, sourceSha256: createHash("sha256").update(source).digest("hex"), draftRevision: 1 });
    expect(parsed.positions.map(position => position.text)).toEqual(["合同名称：合成工程合同", "甲方：合成甲方公司", "乙方：合成乙方公司", "编号：{草稿编号}", "{文档水印}", "交货地点：合成工地", "手工条款：本项普通约定按原文保留。"]);
    expect(new Set(parsed.positions.map(position => position.positionId)).size).toBe(7);
  });

  it("rejects namespaced external Word relationships before returning source positions", async () => {
    const zip = new PizZip(syntheticWordSource());
    zip.file("word/_rels/document.xml.rels", '<r:Relationships xmlns:r="http://schemas.openxmlformats.org/package/2006/relationships"><r:Relationship Id="external" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" TargetMode="External" Target="https://template-no-network.invalid/image.png"/></r:Relationships>');
    const source = zip.generate({ type: "nodebuffer" });
    const body = new FormData();
    body.append("file", new Blob([new Uint8Array(source)]), "外部引用拒绝样张.docx");
    const upload = await fetch(`${await server.app.getUrl()}/files`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body });
    expect(upload.status).toBe(201);
    const file = await upload.json() as { id: string };
    const create = await fetch(`${await server.app.getUrl()}/contract-layout-templates`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ name: "外部引用拒绝", contractTypeKey: "material_purchase", docxFileId: file.id, placeholderSchema: { bills: [] } }) });
    expect(create.status).toBe(201);
    const layout = await create.json() as { version: { id: string } };
    const response = await fetch(`${await server.app.getUrl()}/contract-layout-template-versions/${layout.version.id}/source-positions`, { headers: { authorization: `Bearer ${token}` } });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("外部文件引用");
    const preview = await fetch(`${await server.app.getUrl()}/contract-layout-template-versions/${layout.version.id}/preview-generation`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: "{}" });
    expect(preview.status).toBe(400);
    expect(await server.store.prisma.contractLayoutPreviewJob.count({ where: { layoutTemplateVersionId: layout.version.id } })).toBe(0);

  });

  it("rejects client-authored mapping confirmation in generic template metadata", async () => {
    const body = new FormData();
    body.append("file", new Blob([new Uint8Array(syntheticWordSource())]), "禁止伪造确认.docx");
    const uploaded = await fetch(`${await server.app.getUrl()}/files`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body });
    const file = await uploaded.json() as { id: string };
    const created = await fetch(`${await server.app.getUrl()}/contract-layout-templates`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ name: "禁止伪造确认", contractTypeKey: "material_purchase", docxFileId: file.id, placeholderSchema: { bills: [], sourceMapping: { confirmation: { actorUserId: "director" } } } }) });
    expect(created.status).toBe(400);
    expect(await created.text()).toContain("专用填写位置");
  });

  it("rejects untrusted XML entities in actual uploaded Word packages", async () => {
    const zip = new PizZip(syntheticWordSource());
    zip.file("word/document.xml", '<!DOCTYPE w:document [<!ENTITY secret SYSTEM "file:///etc/passwd">]><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>&secret;</w:t></w:r></w:p></w:body></w:document>');
    const body = new FormData();
    body.append("file", new Blob([new Uint8Array(zip.generate({ type: "nodebuffer" }))]), "实体拒绝样张.docx");
    const uploaded = await fetch(`${await server.app.getUrl()}/files`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body });
    const file = await uploaded.json() as { id: string };
    const created = await fetch(`${await server.app.getUrl()}/contract-layout-templates`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ name: "实体拒绝", contractTypeKey: "material_purchase", docxFileId: file.id, placeholderSchema: { bills: [] } }) });
    const layout = await created.json() as { version: { id: string } };
    const response = await fetch(`${await server.app.getUrl()}/contract-layout-template-versions/${layout.version.id}/source-positions`, { headers: { authorization: `Bearer ${token}` } });
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("root:");
  });

  it("bounds aggregate relationship XML before DOM parsing", async () => {
    const zip = new PizZip(syntheticWordSource());
    for (let i = 0; i < 3; i++) zip.file(`word/_rels/large${i}.xml.rels`, '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + ' '.repeat(3 * 1024 * 1024) + '</Relationships>');
    const body = new FormData();
    body.append("file", new Blob([new Uint8Array(zip.generate({ type: "nodebuffer", compression: "DEFLATE" }))]), "关系容量边界.docx");
    const uploaded = await fetch(`${await server.app.getUrl()}/files`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body });
    const file = await uploaded.json() as { id: string };
    const created = await fetch(`${await server.app.getUrl()}/contract-layout-templates`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ name: "关系容量边界", contractTypeKey: "material_purchase", docxFileId: file.id, placeholderSchema: { bills: [] } }) });
    const layout = await created.json() as { version: { id: string } };
    const response = await fetch(`${await server.app.getUrl()}/contract-layout-template-versions/${layout.version.id}/source-positions`, { headers: { authorization: `Bearer ${token}` } });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("总内容过大");
  });

  it("rechecks active company authority when a service is called without HTTP guards", async () => {
    const actor = server.actors[0];
    await server.store.prisma.user.update({ where: { id: actor.id }, data: { isActive: false } });
    try {
      await expect(server.layouts.createLayout(actor.id, { name: "停用账号", contractTypeKey: "material_purchase", docxFileId: "not-a-file", placeholderSchema: { bills: [] } })).rejects.toThrow("当前账号不可用");
    } finally {
      await server.store.prisma.user.update({ where: { id: actor.id }, data: { isActive: true } });
    }
  });

  it("denies template maintenance to staff and pure technical administrators", async () => {
    for (const actor of server.actors.filter(actor => ["staff", "technical"].includes(actor.id))) {
      const login = await fetch(`${await server.app.getUrl()}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: actor.phone, password: server.password }) });
      const access = (await login.json() as { tokens: { accessToken: string } }).tokens.accessToken;
      const body = new FormData();
      body.append("file", new Blob([new Uint8Array(syntheticWordSource())]), "岗位边界.docx");
      const uploaded = await fetch(`${await server.app.getUrl()}/files`, { method: "POST", headers: { authorization: `Bearer ${access}` }, body });
      const file = await uploaded.json() as { id: string };
      const created = await fetch(`${await server.app.getUrl()}/contract-layout-templates`, { method: "POST", headers: { authorization: `Bearer ${access}`, "content-type": "application/json" }, body: JSON.stringify({ name: "不应发布", contractTypeKey: "material_purchase", docxFileId: file.id, placeholderSchema: { bills: [] } }) });
      expect(created.status).toBe(403);
      await expect(server.layouts.createLayout(actor.id, { name: "服务岗位边界", contractTypeKey: "material_purchase", docxFileId: file.id, placeholderSchema: { bills: [] } })).rejects.toThrow("合同主管");
    }
  });

  it("saves only the director's explicit source ranges and invalidates the old revision", async () => {
    const body = new FormData();
    body.append("file", new Blob([new Uint8Array(syntheticWordSource())]), "显式映射样张.docx");
    const upload = await fetch(`${await server.app.getUrl()}/files`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body });
    expect(upload.status).toBe(201);
    const file = await upload.json() as { id: string };
    const create = await fetch(`${await server.app.getUrl()}/contract-layout-templates`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ name: "主管显式映射", contractTypeKey: "material_purchase", docxFileId: file.id, placeholderSchema: { bills: [] } }) });
    const version = (await create.json() as { version: { id: string } }).version;
    const source = await fetch(`${await server.app.getUrl()}/contract-layout-template-versions/${version.id}/source-positions`, { headers: { authorization: `Bearer ${token}` } }).then(response => response.json()) as { sourceSha256: string; positions: Array<{ positionId: string; text: string }> };
    const fields = ["contract.name", "party.owner.name", "party.counterparty.name", "contract.temporaryCode", "document.watermark"];
    const bindings = source.positions.slice(0, 5).map((position, i) => ({ positionId: position.positionId, start: i === 0 ? 5 : i === 4 ? 0 : 3, end: position.text.length, fieldKey: fields[i] }));
    const response = await fetch(`${await server.app.getUrl()}/contract-layout-template-versions/${version.id}/source-mapping`, { method: "PATCH", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: 1, sourceFileId: file.id, sourceSha256: source.sourceSha256, bindings }) });
    expect(response.status).toBe(200);
    const mapping = await response.json() as { draftRevision: number; mappingFingerprint: string; confirmed: boolean; preview: Array<{ text: string }> };
    expect(mapping.draftRevision).toBe(2);
    expect(mapping.mappingFingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(mapping.confirmed).toBe(false);
    expect(mapping.preview.map(position => position.text)).toEqual(["合同名称：{contract.name}", "甲方：{party.owner.name}", "乙方：{party.counterparty.name}", "编号：{contract.temporaryCode}", "{document.watermark}", "交货地点：合成工地", "手工条款：本项普通约定按原文保留。"]);
    const stale = await fetch(`${await server.app.getUrl()}/contract-layout-template-versions/${version.id}/source-mapping`, { method: "PATCH", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: 1, sourceFileId: file.id, sourceSha256: source.sourceSha256, bindings }) });
    expect(stale.status).toBe(409);
    const inspected = await fetch(`${await server.app.getUrl()}/contract-layout-template-versions/${version.id}/inspection`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
    expect(inspected.status).toBe(201);
    const report = await inspected.json() as { blockingErrors: string[]; placeholders: string[]; sourceRevision: number };
    expect(report.blockingErrors).toEqual([]);
    expect(report.placeholders).toEqual(expect.arrayContaining(fields));
    expect(report.sourceRevision).toBe(2);
    const queued = await fetch(`${await server.app.getUrl()}/contract-layout-template-versions/${version.id}/preview-generation`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ contract: { name: "主管确认合同", temporaryCode: "TEST-11" }, party: { owner: { name: "确认甲方" }, counterparty: { name: "确认乙方" } }, document: { watermark: "映射预览" } }) });
    expect(queued.status).toBe(201);
    await server.processor.processNext();
    const preview = await fetch(`${await server.app.getUrl()}/contract-layout-template-versions/${version.id}/preview-generation`, { headers: { authorization: `Bearer ${token}` } }).then(response => response.json()) as { status: string; previewPdfFileId: string; errorMessage?: string };
    expect(preview).toMatchObject({ status: "succeeded" });
    const pdf = await server.files.getFileBuffer(preview.previewPdfFileId);
    expect(pdf.buffer.subarray(0, 5).toString()).toBe("%PDF-");
    const text = execFileSync(process.env.TEMPLATE_PDF_INSPECTOR_PYTHON ?? "python3", ["-c", "import sys,pymupdf; d=pymupdf.open(stream=sys.stdin.buffer.read(),filetype='pdf'); print(''.join(p.get_text() for p in d))"], { input: pdf.buffer, encoding: "utf8" });
    expect(text).toContain("主管确认合同");
    expect(text).toContain("确认甲方");
    expect(text).toContain("确认乙方");
    expect(text).not.toContain("合成甲方公司");
    expect(text).not.toContain("合成乙方公司");
    const unconfirmed = await fetch(`${await server.app.getUrl()}/contract-layout-template-versions/${version.id}/submission`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
    expect(unconfirmed.status).toBe(400);
    const confirmation = await fetch(`${await server.app.getUrl()}/contract-layout-template-versions/${version.id}/source-mapping-confirmation`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: 2, sourceFileId: file.id, sourceSha256: source.sourceSha256, mappingFingerprint: mapping.mappingFingerprint }) });
    expect(confirmation.status).toBe(201);
    expect(await confirmation.json()).toMatchObject({ confirmed: true, draftRevision: 2, previewPdfFileId: preview.previewPdfFileId });
    const changedPreview = await fetch(`${await server.app.getUrl()}/contract-layout-template-versions/${version.id}/preview-generation`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ contract: { name: "重新预览必须确认" } }) });
    expect(changedPreview.status).toBe(201);
    const submitted = await fetch(`${await server.app.getUrl()}/contract-layout-template-versions/${version.id}/submission`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
    expect(submitted.status).toBe(400);
    await server.processor.processNext();


  });
  it("freezes the confirmed source mapping in real document queue inputs", async () => {
    const layout = await preparedPublishedLayout(true);
    const contractId = randomUUID();
    const versionId = randomUUID();
    const projectId = randomUUID();
    await server.store.prisma.project.create({ data: { id: projectId, name: "合成合同项目", isActive: true } });
    await server.store.prisma.contract.create({ data: { id: contractId, projectId, name: "实际选版合同", temporaryCode: "T11-DRAFT", code: null, contractTypeKey: "material_purchase", ownerUserId: "staff", voidedAt: null } });
    await server.store.prisma.contractVersion.create({ data: { id: versionId, contractId, changeType: "original", draftRevision: 1, documentContentRevision: 1, documentContentFingerprint: "a".repeat(64), draftData: {}, clauseSnapshot: [], numericProtocolVersion: 2, amountYuan: null, amountCents: 0n, invoiceType: null, defaultTaxRatePercent: null, companyEntityNameSnapshot: null, latestDraftPreviewDocumentId: null } });
    for (const [roleKey, name] of [["party_a", "实际甲方"], ["party_b", "实际乙方"]]) await server.store.prisma.contractPartySnapshot.create({ data: { contractVersionId: versionId, roleKey, snapshot: { name } } });
    const queued = await server.documents.queue(versionId, "staff", { purpose: "draft", layoutTemplateVersionId: layout.id });
    expect(queued.inputSnapshot).toMatchObject({ templateFileId: layout.fileId, layoutSourceMapping: { sourceFileId: layout.fileId, sourceSha256: layout.sourceSha256, draftRevision: 2, fingerprint: layout.mappingFingerprint } });
    await server.processor.processNext();
    const generated = await server.store.prisma.contractGeneratedDocument.findUnique({ where: { id: queued.id } });
    expect(generated).toMatchObject({ status: "success" });
    const docx = await server.files.getFileBuffer(String(generated!.docxFileId));
    const xml = new PizZip(docx.buffer).file("word/document.xml")!.asText();
    expect(xml).toContain("实际选版合同");
    expect(xml).toContain("实际甲方");
    expect(xml).toContain("实际乙方");
    expect(xml).not.toContain("合成甲方公司");
    expect(xml).toContain("手工条款：本项普通约定按原文保留。");
    const pdf = await server.files.getFileBuffer(String(generated!.pdfFileId));
    const text = execFileSync(process.env.TEMPLATE_PDF_INSPECTOR_PYTHON ?? "python3", ["-c", "import sys,pymupdf; d=pymupdf.open(stream=sys.stdin.buffer.read(),filetype='pdf'); print(''.join(p.get_text() for p in d))"], { input: pdf.buffer, encoding: "utf8" });
    expect(text).toContain("实际选版合同");
    expect(text).toContain("实际甲方");
    expect(text).toContain("实际乙方");
    expect(text.match(/实际甲方/gu)).toHaveLength(2);
    expect(text.match(/实际乙方/gu)).toHaveLength(2);
    expect(text).not.toContain("合成甲方公司");
    expect(text).toContain("手工条款：本项普通约定按原文保留。");
    if (process.env.TEMPLATE_TEST_ARTIFACT_DIR) {
      mkdirSync(process.env.TEMPLATE_TEST_ARTIFACT_DIR, { recursive: true });
      const directory = mkdtempSync(join(process.env.TEMPLATE_TEST_ARTIFACT_DIR, "run-"));
      const source = await server.files.getFileBuffer(layout.fileId);
      writeFileSync(join(directory, "source.docx"), source.buffer);
      writeFileSync(join(directory, "generated.docx"), docx.buffer);
      writeFileSync(join(directory, "generated.pdf"), pdf.buffer);
      writeFileSync(join(directory, "receipt.json"), JSON.stringify({ protocolVersion: 1, sourceSha256: layout.sourceSha256, mappingFingerprint: layout.mappingFingerprint, docxSha256: createHash("sha256").update(docx.buffer).digest("hex"), pdfSha256: createHash("sha256").update(pdf.buffer).digest("hex"), generatedFromFrozenMapping: true, scope: "synthetic private files and real local Word/PDF converter; not production acceptance" }, null, 2));
    }
    expect((await server.layouts.stopVersion(layout.id, "director")).status).toBe("stopped");
    await expect(server.documents.queue(versionId, "staff", { purpose: "draft", layoutTemplateVersionId: layout.id })).rejects.toThrow("尚未发布");
    const staffLogin = await fetch(`${await server.app.getUrl()}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: server.actors[1].phone, password: server.password }) });
    const staffToken = (await staffLogin.json() as { tokens: { accessToken: string } }).tokens.accessToken;
    const ticket = await fetch(`${await server.app.getUrl()}/files/${String(generated!.pdfFileId)}/download-ticket`, { method: "POST", headers: { authorization: `Bearer ${staffToken}`, "content-type": "application/json" }, body: JSON.stringify({ confirmationPassword: server.password, downloadReason: "验证停用模板不影响已生成历史合同" }) });
    expect(ticket.status).toBe(201);
    const ticketBody = await ticket.json() as { downloadUrl: string };
    const historical = await fetch(`${await server.app.getUrl()}${ticketBody.downloadUrl}`);
    expect(historical.status).toBe(200);
    expect(createHash("sha256").update(Buffer.from(await historical.arrayBuffer())).digest("hex")).toBe(createHash("sha256").update(pdf.buffer).digest("hex"));
    const supervisorTicket = await fetch(`${await server.app.getUrl()}/files/${String(generated!.pdfFileId)}/download-ticket`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ confirmationPassword: server.password, downloadReason: "合同主管核阅停用模板的历史合同" }) });
    expect(supervisorTicket.status).toBe(201);
    const supervisorBody = await supervisorTicket.json() as { downloadUrl: string };
    const supervisorRead = await fetch(`${await server.app.getUrl()}${supervisorBody.downloadUrl}`);
    expect(supervisorRead.status).toBe(200);
    expect(createHash("sha256").update(Buffer.from(await supervisorRead.arrayBuffer())).digest("hex")).toBe(createHash("sha256").update(pdf.buffer).digest("hex"));
    async function requestTicket(actorId: string) {
      const actor = server.actors.find(value => value.id === actorId)!;
      const login = await fetch(`${await server.app.getUrl()}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: actor.phone, password: server.password }) });
      const access = (await login.json() as { tokens: { accessToken: string } }).tokens.accessToken;
      return fetch(`${await server.app.getUrl()}/files/${String(generated!.pdfFileId)}/download-ticket`, { method: "POST", headers: { authorization: `Bearer ${access}`, "content-type": "application/json" }, body: JSON.stringify({ confirmationPassword: server.password, downloadReason: "合成合同历史读取权限矩阵" }) });
    }
    // Known binding plus a missing/throwing infrastructure lookup must not
    // fall back to the original uploader. The actual read authority is not mocked.
    const lookup = jest.spyOn(server.moduleRef, "get");
    lookup.mockImplementationOnce(() => undefined as never);
    expect((await requestTicket("staff")).status).toBe(403);
    lookup.mockImplementationOnce(() => { throw new Error("controlled authority lookup unavailable"); });
    expect((await requestTicket("staff")).status).toBe(403);
    lookup.mockRestore();
    await server.store.prisma.projectMember.create({ data: { userId: "employee", projectId, positionKey: "employee" } });
    expect((await requestTicket("employee")).status).toBe(403);
    await server.store.prisma.contract.update({ where: { id: contractId }, data: { ownerUserId: "employee" } });
    expect((await requestTicket("staff")).status).toBe(403);
    expect((await fetch(`${await server.app.getUrl()}${ticketBody.downloadUrl}`)).status).toBe(403);
    await server.store.prisma.contract.update({ where: { id: contractId }, data: { ownerUserId: "staff" } });
    await server.store.prisma.projectMember.create({ data: { userId: "director", projectId, positionKey: "employee" } });
    const directorAssignment = await server.store.prisma.userPosition.findFirst({ where: { userId: "director", projectId: null } });
    await server.store.prisma.userPosition.delete({ where: { id: directorAssignment!.id } });
    expect((await fetch(`${await server.app.getUrl()}${supervisorBody.downloadUrl}`)).status).toBe(403);
    await server.store.prisma.userPosition.create({ data: { id: directorAssignment!.id, userId: "director", projectId: null, positionId: "contract_director" } });
    expect((await fetch(`${await server.app.getUrl()}${supervisorBody.downloadUrl}`)).status).toBe(200);
    // Synthetic persisted states exercise existing formal/history authorization;
    // they do not claim a real approval, migration or formalization operation.
    await server.store.prisma.contractVersion.update({ where: { id: versionId }, data: { status: "effective", firstSubmittedAt: new Date() } });
    const beforeSummary = server.store.participantProjectionCount;
    expect((await requestTicket("employee")).status).toBe(403);
    expect(server.store.participantProjectionCount).toBeGreaterThan(beforeSummary);
    expect((await requestTicket("finance")).status).toBe(201);
    const otherProjectId = randomUUID();
    await server.store.prisma.project.create({ data: { id: otherProjectId, isActive: true } });
    await server.store.prisma.position.create({ data: { id: "project_manager", key: "project_manager" } });
    const assignment = await server.store.prisma.userPosition.create({ data: { userId: "manager", positionId: "project_manager", projectId: otherProjectId } });
    expect((await requestTicket("manager")).status).toBe(403);
    await server.store.prisma.userPosition.update({ where: { id: assignment.id }, data: { projectId } });
    expect((await requestTicket("manager")).status).toBe(201);
    const approval = await server.store.prisma.approvalInstance.create({ data: { businessType: "contract_version", businessId: versionId, applicantUserId: "staff", status: "approved" } });
    await server.store.prisma.approvalActionLog.create({ data: { approvalInstanceId: approval.id, actorUserId: "employee", action: "approve" } });
    expect((await requestTicket("employee")).status).toBe(201);
    await server.store.prisma.user.update({ where: { id: "director" }, data: { isActive: false } });
    expect((await fetch(`${await server.app.getUrl()}${supervisorBody.downloadUrl}`)).status).toBe(403);
    await server.store.prisma.user.update({ where: { id: "director" }, data: { isActive: true } });





  });

});
