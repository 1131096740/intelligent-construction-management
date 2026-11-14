import { createHash, randomUUID } from "node:crypto";
import PizZip from "pizzip";
import { createTemplateTestServer, syntheticWordSource } from "./template-management.test-support";

describe("template source positions through real HTTP, DTO pipe and private files", () => {
  let server: Awaited<ReturnType<typeof createTemplateTestServer>>;
  let token: string;
  beforeAll(async () => {
    server = await createTemplateTestServer({ draftWorkbench: true });
    const response = await fetch(`${await server.app.getUrl()}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: server.actors[0].phone, password: server.password }) });
    expect(response.status).toBe(201);
    token = (await response.json() as { tokens: { accessToken: string } }).tokens.accessToken;
  });
  afterAll(async () => { await server?.app.close(); });

  it("reads current supervisor creation capability through the static public route", async () => {
    const response = await fetch(`${await server.app.getUrl()}/contract-layout-templates/creation-capability`, { headers: { authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ canCreate: true });
    expect((await fetch(`${await server.app.getUrl()}/contract-layout-template-versions/${randomUUID()}/maintenance-capability`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(404);
  });

  it("limits the existing business-template maintenance service entry to active directors", async () => {
    await expect(server.templates.assertCanMaintainBusinessEntry("director")).resolves.toBeUndefined();
    await expect(server.templates.assertCanMaintainBusinessEntry("staff")).rejects.toThrow("合同主管");
    await expect(server.templates.assertCanMaintainBusinessEntry("technical")).rejects.toThrow("合同主管");
  });

  it("awaits the unified template authorization and rejects staff before any new version", async () => {
    const template = await server.store.prisma.contractBusinessTemplate.create({ data: { code: "SYN-ENTRY", name: "统一入口权限样张", status: "draft", contractTypeKey: "material_purchase" } });
    const url = `${await server.app.getUrl()}/business-entry-definitions/contract_business_template/validate`;
    const payload = { target: { entityType: "contract_business_template", entityId: template.id }, values: { name: "主管修改名称" } };
    const before = await server.store.prisma.contractBusinessTemplateVersion.count({ where: { templateId: template.id } });
    const positive = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(payload) });
    expect(positive.status).toBe(201);
    for (const actor of server.actors.slice(1, 3)) {
      const login = await fetch(`${await server.app.getUrl()}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: actor.phone, password: server.password }) });
      const access = (await login.json() as { tokens: { accessToken: string } }).tokens.accessToken;
      const response = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${access}`, "content-type": "application/json" }, body: JSON.stringify(payload) });
      expect(response.status).toBe(403);
    }
    expect(await server.store.prisma.contractBusinessTemplateVersion.count({ where: { templateId: template.id } })).toBe(before);
    expect(await server.store.prisma.contractBusinessTemplate.findUnique({ where: { id: template.id } })).toMatchObject({ name: "统一入口权限样张" });
  });

  it("preserves staff read and selection of an existing published business template", async () => {
    const template = await server.store.prisma.contractBusinessTemplate.create({ data: { code: "SYN-READ", name: "既有已发布模板", contractTypeKey: "material_purchase", status: "published" } });
    await server.store.prisma.contractBusinessTemplateVersion.create({ data: { templateId: template.id, versionNo: 1, status: "published", fieldSchema: [], billSchema: [], clauseSchema: [], attachmentSchema: [], validationSchema: [] } });
    await server.store.prisma.contractBusinessTemplateVersion.create({ data: { templateId: template.id, versionNo: 2, status: "draft", fieldSchema: [], billSchema: [], clauseSchema: [], attachmentSchema: [], validationSchema: [] } });
    const login = await fetch(`${await server.app.getUrl()}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: server.actors[1].phone, password: server.password }) });
    const access = (await login.json() as { tokens: { accessToken: string } }).tokens.accessToken;
    const response = await fetch(`${await server.app.getUrl()}/contract-templates/${String(template.id)}`, { headers: { authorization: `Bearer ${access}` } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ template: { id: template.id }, versions: [expect.objectContaining({ status: "published" })] });
  });

  it("keeps unconfirmed draft source and preview private to the supervisor", async () => {
    const body = new FormData();
    body.append("file", new Blob([new Uint8Array(syntheticWordSource())]), "未确认私有模板.docx");
    const file = await fetch(`${await server.app.getUrl()}/files`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body }).then(response => response.json()) as { id: string };
    const created = await fetch(`${await server.app.getUrl()}/contract-layout-templates`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ name: "未确认模板", contractTypeKey: "material_purchase", docxFileId: file.id, placeholderSchema: { bills: [] } }) }).then(response => response.json()) as { template: { id: string }; version: { id: string } };
    const login = await fetch(`${await server.app.getUrl()}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: server.actors[1].phone, password: server.password }) });
    const access = (await login.json() as { tokens: { accessToken: string } }).tokens.accessToken;
    const headers = { authorization: `Bearer ${access}`, "content-type": "application/json" };
    expect((await fetch(`${await server.app.getUrl()}/contract-layout-templates/${created.template.id}`, { headers })).status).toBe(404);
    expect((await fetch(`${await server.app.getUrl()}/contract-layout-template-versions/${created.version.id}/preview-generation`, { headers })).status).toBe(403);
    expect((await fetch(`${await server.app.getUrl()}/files/${file.id}/download-ticket`, { method: "POST", headers, body: JSON.stringify({ confirmationPassword: server.password, downloadReason: "未确认源文件读取负控" }) })).status).toBe(403);
  });

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
    const capability = await fetch(`${await server.app.getUrl()}/contract-layout-template-versions/${layout.version.id}/maintenance-capability`, { headers: { authorization: `Bearer ${token}` } });
    expect(capability.status).toBe(200);
    expect(await capability.json()).toMatchObject({ versionId: layout.version.id, draftRevision: 1, availableActions: expect.arrayContaining([expect.objectContaining({ key: "risk_stop", enabled: false })]) });
    expect(parsed).toMatchObject({ availableActions: expect.arrayContaining([expect.objectContaining({ key: "map_source", enabled: true }), expect.objectContaining({ key: "confirm_source", enabled: false })]) });
    const version = await server.store.prisma.contractLayoutTemplateVersion.findUnique({ where: { id: layout.version.id } });
    const detail = await fetch(`${await server.app.getUrl()}/contract-layout-templates/${String(version!.layoutTemplateId)}`, { headers: { authorization: `Bearer ${token}` } }).then(response => response.json());
    expect(detail).toMatchObject({ versions: [expect.objectContaining({ availableActions: expect.arrayContaining([expect.objectContaining({ key: "save_draft", enabled: true }), expect.objectContaining({ key: "submit_version", enabled: false })]) })] });
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

  it("rejects aliased executable Word markup before returning source positions", async () => {
    const zip = new PizZip(syntheticWordSource());
    zip.file("word/unsafe.xml", '<alias:altChunk xmlns:alias="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>');
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
    expect(await response.text()).toContain("外部或可执行内容");
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
      await expect(server.templates.assertCanMaintainBusinessEntry(actor.id)).rejects.toThrow("当前账号不可用");
      await expect(server.layouts.creationCapability(actor.id)).rejects.toThrow("当前账号不可用");
      await expect(server.layouts.versionMaintenanceCapability(randomUUID(), actor.id)).rejects.toThrow("当前账号不可用");
    } finally {
      await server.store.prisma.user.update({ where: { id: actor.id }, data: { isActive: true } });
    }
  });

  it("denies template maintenance to staff and pure technical administrators", async () => {
    for (const actor of server.actors.filter(actor => ["staff", "technical"].includes(actor.id))) {
      const login = await fetch(`${await server.app.getUrl()}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: actor.phone, password: server.password }) });
      const access = (await login.json() as { tokens: { accessToken: string } }).tokens.accessToken;
      expect((await fetch(`${await server.app.getUrl()}/contract-layout-templates/creation-capability`, { headers: { authorization: `Bearer ${access}` } })).status).toBe(403);
      expect((await fetch(`${await server.app.getUrl()}/contract-layout-template-versions/${randomUUID()}/maintenance-capability`, { headers: { authorization: `Bearer ${access}` } })).status).toBe(403);
      const body = new FormData();
      body.append("file", new Blob([new Uint8Array(syntheticWordSource())]), "岗位边界.docx");
      const uploaded = await fetch(`${await server.app.getUrl()}/files`, { method: "POST", headers: { authorization: `Bearer ${access}` }, body });
      const file = await uploaded.json() as { id: string };
      const created = await fetch(`${await server.app.getUrl()}/contract-layout-templates`, { method: "POST", headers: { authorization: `Bearer ${access}`, "content-type": "application/json" }, body: JSON.stringify({ name: "不应发布", contractTypeKey: "material_purchase", docxFileId: file.id, placeholderSchema: { bills: [] } }) });
      expect(created.status).toBe(403);
      await expect(server.layouts.createLayout(actor.id, { name: "服务岗位边界", contractTypeKey: "material_purchase", docxFileId: file.id, placeholderSchema: { bills: [] } })).rejects.toThrow("合同主管");
    }
  });
});
