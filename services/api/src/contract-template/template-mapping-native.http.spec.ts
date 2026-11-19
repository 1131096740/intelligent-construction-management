import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inspectActualTemplatePdf } from "./template-pdf-physical.test-support";
import { createHash, randomUUID } from "node:crypto";
import PizZip from "pizzip";
import { seedSelectionDraft, saveSelectionThroughHttp } from "./template-selection.test-support";
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

  async function preparedPublishedLayout(includeSignatures = false) {
    const url = await server.app.getUrl();
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const request = (path: string, method = "GET", body?: unknown) => fetch(url + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const uploadBody = new FormData();
    uploadBody.append("file", new Blob([new Uint8Array(syntheticWordSource(includeSignatures))]), "真实生成映射样张.docx");
    const file = await fetch(url + "/files", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: uploadBody }).then(response => response.json()) as { id: string };
    const created = await request("/contract-layout-templates", "POST", { name: "公开链已确认模板", contractTypeKey: "material_purchase", docxFileId: file.id, placeholderSchema: { bills: [] } });
    expect(created.status).toBe(201);
    const { version } = await created.json() as { version: { id: string } };
    const base = `/contract-layout-template-versions/${version.id}`;
    const source = await request(base + "/source-positions").then(response => response.json()) as { sourceSha256: string; positions: Array<{ positionId: string; text: string }> };
    const fields = ["contract.name", "party.owner.name", "party.counterparty.name", "contract.temporaryCode", "document.watermark"];
    const bindings = source.positions.slice(0, 5).map((position, i) => ({ positionId: position.positionId, start: i === 0 ? 5 : i === 4 ? 0 : 3, end: position.text.length, fieldKey: fields[i] }));
    if (includeSignatures) for (const [index, fieldKey] of [[7, "party.owner.name"], [8, "party.counterparty.name"]] as const) {
      const position = source.positions[index];
      bindings.push({ positionId: position.positionId, start: 5, end: position.text.length, fieldKey });
    }
    const mapped = await request(base + "/source-mapping", "PATCH", { expectedRevision: 1, sourceFileId: file.id, sourceSha256: source.sourceSha256, bindings });
    expect(mapped.status).toBe(200);
    const mapping = await mapped.json() as { mappingFingerprint: string };
    expect((await request(base + "/inspection", "POST")).status).toBe(201);
    expect((await request(base + "/preview-generation", "POST", { contract: { name: "已确认合同" }, party: { owner: { name: "确认甲方" }, counterparty: { name: "确认乙方" } } })).status).toBe(201);
    await server.processor.processNext();
    expect((await request(base + "/source-mapping-confirmation", "POST", { expectedRevision: 2, sourceFileId: file.id, sourceSha256: source.sourceSha256, mappingFingerprint: mapping.mappingFingerprint })).status).toBe(201);
    expect((await request(base + "/submission", "POST")).status).toBe(201);
    expect((await request(base + "/publication", "POST", { changeSummary: "主管确认公开映射与真实预览" })).status).toBe(201);
    return { id: version.id, fileId: file.id, sourceSha256: source.sourceSha256, mappingFingerprint: mapping.mappingFingerprint };
  }

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
    const text = inspectActualTemplatePdf((await server.files.getFileBuffer(file.id)).buffer, pdf.buffer, "public mapped preview");
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
    const serverUrl = await server.app.getUrl();
    const { contractId, versionId, projectId } = await seedSelectionDraft(server, false, "实际选版合同");
    await saveSelectionThroughHttp(server, versionId, layout.id);
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
    const text = inspectActualTemplatePdf(docx.buffer, pdf.buffer, "public frozen-mapping generated document");
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
    const http = (path: string, method = "GET", body?: unknown) => fetch(`${serverUrl}${path}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const cloneResponse = await http(`/contract-layout-template-versions/${layout.id}/clone`, "POST");
    expect(cloneResponse.status).toBe(201);
    const clone = await cloneResponse.json() as { id: string };
    const word = new PizZip(syntheticWordSource(true));
    word.file("word/document.xml", word.file("word/document.xml")!.asText().replace("合成工程合同", "新版工程合同"));
    const replacementBody = new FormData();
    replacementBody.append("file", new Blob([new Uint8Array(word.generate({ type: "nodebuffer" }))]), "新版本源.docx");
    const replacement = await fetch(`${serverUrl}/files`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: replacementBody }).then(response => response.json()) as { id: string };
    expect((await http(`/contract-layout-template-versions/${clone.id}`, "PATCH", { expectedRevision: 1, docxFileId: replacement.id })).status).toBe(200);
    const changedSource = await http(`/contract-layout-template-versions/${clone.id}/source-positions`).then(response => response.json()) as { confirmed: boolean; mappingFingerprint: string | null; sourceFileId: string };
    expect(changedSource).toMatchObject({ confirmed: false, mappingFingerprint: null, sourceFileId: replacement.id });
    expect((await http(`/contract-layout-template-versions/${clone.id}/source-mapping-confirmation`, "POST", { expectedRevision: 2, sourceFileId: layout.fileId, sourceSha256: layout.sourceSha256, mappingFingerprint: layout.mappingFingerprint })).status).toBe(409);
    expect((await http(`/contract-layout-template-versions/${clone.id}/preview-generation`, "POST", {})).status).toBe(400);
    expect((await http(`/contract-layout-template-versions/${layout.id}/stop`, "POST")).status).toBe(201);
    await expect(server.documents.queue(versionId, "staff", { purpose: "draft", layoutTemplateVersionId: layout.id })).rejects.toThrow("尚未发布");
    // A real failed job's frozen inputs cannot bypass the current published gate.
    const failed = await server.store.prisma.contractGeneratedDocument.create({ data: { ...generated, id: randomUUID(), status: "failed", docxFileId: null, pdfFileId: null } });
    await expect(server.documents.retry(String(failed.id), "staff")).rejects.toThrow("尚未发布");
    expect(await server.store.prisma.contractGeneratedDocument.findUnique({ where: { id: failed.id } })).toMatchObject({ status: "failed" });
    expect(await server.store.prisma.contractGeneratedDocument.findUnique({ where: { id: generated!.id } })).toMatchObject({ status: "success", docxFileId: generated!.docxFileId, pdfFileId: generated!.pdfFileId });
    for (const retired of ["discard", "revoke"]) expect((await http(`/contract-layout-template-versions/${clone.id}/${retired}`, "POST", {})).status).toBe(410);
    expect(createHash("sha256").update((await server.files.getFileBuffer(layout.fileId)).buffer).digest("hex")).toBe(layout.sourceSha256);

    await expect(server.documents.queue(versionId, "staff", { purpose: "draft", layoutTemplateVersionId: layout.id })).rejects.toThrow("尚未发布");
    const staffLogin = await fetch(`${await server.app.getUrl()}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: server.actors[1].phone, password: server.password }) });
    const staffToken = (await staffLogin.json() as { tokens: { accessToken: string } }).tokens.accessToken;
    const historyPreview = await fetch(`${serverUrl}/contract-layout-template-versions/${layout.id}/preview-generation`, { headers: { authorization: `Bearer ${staffToken}` } });
    expect(historyPreview.status).toBe(200);
    expect(await historyPreview.json()).toMatchObject({ status: "succeeded", sourceRevision: 2 });
    const historyVersion = await server.store.prisma.contractLayoutTemplateVersion.findUnique({ where: { id: layout.id } });
    const historyDetail = await fetch(`${serverUrl}/contract-layout-templates/${String(historyVersion!.layoutTemplateId)}`, { headers: { authorization: `Bearer ${staffToken}` } }).then(response => response.json()) as { versions: Array<{ id: string; availableActions: Array<{ enabled: boolean }> }> };
    expect(historyDetail.versions.find(version => version.id === layout.id)!.availableActions.every(action => !action.enabled)).toBe(true);
    const ticket = await fetch(`${await server.app.getUrl()}/files/${String(generated!.pdfFileId)}/download-ticket`, { method: "POST", headers: { authorization: `Bearer ${staffToken}`, "content-type": "application/json" }, body: JSON.stringify({ confirmationPassword: server.password, downloadReason: "验证停用模板不影响已生成历史合同" }) });
    expect(ticket.status).toBe(201);
    const ticketBody = await ticket.json() as { downloadUrl: string; expiresAt: string };
    const historical = await fetch(`${await server.app.getUrl()}${ticketBody.downloadUrl}`);
    expect(historical.status).toBe(200);
    expect(createHash("sha256").update(Buffer.from(await historical.arrayBuffer())).digest("hex")).toBe(createHash("sha256").update(pdf.buffer).digest("hex"));
    const supervisorTicket = await fetch(`${await server.app.getUrl()}/files/${String(generated!.pdfFileId)}/download-ticket`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ confirmationPassword: server.password, downloadReason: "合同主管核阅停用模板的历史合同" }) });
    expect(supervisorTicket.status).toBe(201);
    const supervisorBody = await supervisorTicket.json() as { downloadUrl: string; expiresAt: string };
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
    expect(Date.parse(ticketBody.expiresAt)).toBeGreaterThan(Date.now());
    expect((await fetch(`${await server.app.getUrl()}${ticketBody.downloadUrl}`)).status).toBe(200);
    await server.store.prisma.contract.update({ where: { id: contractId }, data: { ownerUserId: "employee" } });
    expect((await requestTicket("staff")).status).toBe(403);
    expect((await fetch(`${await server.app.getUrl()}${ticketBody.downloadUrl}`)).status).toBe(403);
    expect(Date.parse(ticketBody.expiresAt)).toBeGreaterThan(Date.now());
    await server.store.prisma.contract.update({ where: { id: contractId }, data: { ownerUserId: "staff" } });
    expect((await fetch(`${await server.app.getUrl()}${ticketBody.downloadUrl}`)).status).toBe(200);
    await server.store.prisma.projectMember.create({ data: { userId: "director", projectId, positionKey: "employee" } });
    const directorAssignment = await server.store.prisma.userPosition.findFirst({ where: { userId: "director", projectId: null } });
    expect(Date.parse(supervisorBody.expiresAt)).toBeGreaterThan(Date.now());
    expect((await fetch(`${await server.app.getUrl()}${supervisorBody.downloadUrl}`)).status).toBe(200);
    await server.store.prisma.userPosition.delete({ where: { id: directorAssignment!.id } });
    expect((await fetch(`${await server.app.getUrl()}${supervisorBody.downloadUrl}`)).status).toBe(403);
    expect(Date.parse(supervisorBody.expiresAt)).toBeGreaterThan(Date.now());
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
