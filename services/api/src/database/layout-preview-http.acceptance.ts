import { prepareSeedLayoutDocxSource } from "../contract-document/seed-layout-docx-source";
import type { LayoutSourcePosition } from "../contract-template/layout-field-mapping";
import type { INestApplication } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { hash } from "bcryptjs";
import { PDFDocument } from "pdf-lib";
import { PrismaService } from "./prisma.service";
import { coreFlowSeedData } from "./core-flow-seed-data";
import { FileService, PrivateFileStorage } from "../file/file.service";

const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

function sampleBindings(positions: LayoutSourcePosition[], contractTypeKey: string) {
  const sourceFields = [
    ["{合同名称}", "contract.name"], ["{草稿编号}", "contract.temporaryCode"], ["{文档水印}", "document.watermark"],
    ...(contractTypeKey === "generic_contract"
      ? [["建工智管建设有限公司", "party.owner.name"], ["{相对方名称}", "party.counterparty.name"]]
      : [["{甲方名称}", "party.owner.name"], ["{乙方名称}", "party.counterparty.name"]])
  ];
  return positions.flatMap(({ positionId, text }) => sourceFields.flatMap(([marker, fieldKey]) => {
    const start = text.indexOf(marker);
    return start < 0 ? [] : [{ positionId, fieldKey, start, end: start + marker.length }];
  }));
}

export async function verifyLayoutPreviewHttp(
  app: INestApplication, baseUrl: string, owner: { id: string; phone: string; password: string }
) {
  const { initializeSeedLayout } = createRequire(__filename)("../../prisma/seed-layout-preview.cjs") as {
    initializeSeedLayout: (input: unknown) => Promise<unknown>;
  };
  const prisma = app.get(PrismaService);
  const files = app.get(FileService);
  const storage = new PrivateFileStorage();
  const suffix = randomUUID();
  const password = `Layout-${randomUUID()}`;
  async function request(method: string, path: string, token: string, body?: unknown) {
    return fetch(baseUrl + path, { method, headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  async function json<T>(method: string, path: string, token: string, body?: unknown): Promise<T> {
    const response = await request(method, path, token, body);
    const value = await response.json() as T;
    if (!response.ok) throw new Error(`版式验收 ${method} ${path}: ${response.status} ${JSON.stringify(value)}`);
    return value;
  }
  const login = async (phone: string, pass: string) => (await json<{ tokens: { accessToken: string } }>(
    "POST", "/auth/login", "", { phone, password: pass })).tokens.accessToken;
  const director = await login(owner.phone, owner.password);
  async function identity(role: string, index: number, projectId?: string) {
    const phone = `126${String(Date.now()).slice(-8)}${index}`;
    const user = await prisma.user.create({ data: { name: "版式隔离验收人员", phone,
      passwordHash: await hash(password, 4), mustChangePassword: false } });
    const position = await prisma.position.upsert({ where: { key: role }, update: {}, create: { key: role, name: role } });
    const assignment = await prisma.userPosition.create({ data: { userId: user.id, positionId: position.id, projectId } });
    return { user, assignment, phone, token: await login(phone, password) };
  }
  const staff = await identity("contract_staff", 1);
  const reader = await identity("employee", 2);
  const finance = await identity("finance_staff", 3);
  const admin = await identity("super_admin", 4);
  const chairman = await identity("chairman", 5);
  const project = await prisma.project.create({ data: { code: `layout-${suffix}`, name: "版式样张隔离项目" } });
  const projectStaff = await identity("contract_staff", 6, project.id);
  const previewDirector = await identity("contract_director", 7);
  const actorPassword = new Map([[director, owner.password], [staff.token, password], [reader.token, password],
    [finance.token, password], [admin.token, password], [chairman.token, password], [projectStaff.token, password], [previewDirector.token, password]]);
  async function ticket(fileId: string, token: string, accessMode: "preview" | "download") {
    const result = await json<{ downloadUrl: string }>("POST", `/files/${fileId}/download-ticket`, token, {
      confirmationPassword: actorPassword.get(token), downloadReason: "版式隔离验收", accessMode
    });
    return new URL(result.downloadUrl, baseUrl);
  }
  const samples = [coreFlowSeedData.materialPurchaseWorkbench, coreFlowSeedData.equipmentRentalWorkbench,
    coreFlowSeedData.laborSubcontractWorkbench, coreFlowSeedData.genericContractWorkbench];
  const browserFixtures: Array<{ templateId: string; name: string; sha: string; pages: number }> = [];
  for (const sample of samples) {
    const prefix = `${sample.template.contractTypeKey}-${suffix}`;
    const data = { ...sample, layout: { ...sample.layout,
      id: `${prefix}-layout`, versionId: `${prefix}-v1`, previewJob: { ...sample.layout.previewJob, id: `${prefix}-job` },
      docxFile: { ...sample.layout.docxFile, id: `${prefix}-docx`, objectKey: `layout-acceptance/${prefix}.docx`, bucket: storage.bucketName() },
      previewPdfFile: { ...sample.layout.previewPdfFile, id: `${prefix}-pdf`, objectKey: `layout-acceptance/${prefix}.pdf`, bucket: storage.bucketName() }
    } };
    const initialize = () => initializeSeedLayout({ prisma, data, uploaderId: owner.id,
      sourcePath: join(__dirname, "../../assets/templates", sample.layout.docxFile.originalName),
      writeFile: async (file: { objectKey: string }, bytes: Buffer) => {
        await storage.write(file.objectKey, bytes);
        return { sizeBytes: bytes.length, contentSha256: digest(bytes) };
      }
    });
    await expect(initialize()).resolves.toEqual({ status: "initialized" });
    // Simulate the already stored legacy V1 source in this synthetic database only.
    const legacySource = await readFile(join(__dirname, "../../assets/templates", sample.layout.docxFile.originalName));
    await storage.write(data.layout.docxFile.objectKey, legacySource);
    await prisma.fileObject.update({ where: { id: data.layout.docxFile.id }, data: {
      sizeBytes: legacySource.length, contentSha256: digest(legacySource)
    } });
    const original = await prisma.contractLayoutTemplateVersion.findUniqueOrThrow({ where: { id: data.layout.versionId } });
    const originalFile = await prisma.fileObject.findUniqueOrThrow({ where: { id: data.layout.previewPdfFile.id } });
    const originalJob = await prisma.contractLayoutPreviewJob.findUniqueOrThrow({ where: { id: data.layout.previewJob.id } });
    const originalBytes = await storage.read(data.layout.previewPdfFile.objectKey);
    const originalDocxFile = await prisma.fileObject.findUniqueOrThrow({ where: { id: data.layout.docxFile.id } });
    const clonePath = `/contract-layout-template-versions/${original.id}/clone`;
    expect((await request("POST", clonePath, staff.token)).status).toBe(403);
    expect((await request("POST", clonePath, reader.token)).status).toBe(403);
    const clone = await json<{ id: string; versionNo: number; draftRevision: number }>("POST", clonePath, director);
    expect(clone).toMatchObject({ versionNo: 2, status: "draft", layoutTemplateId: data.layout.id });
    const versionPath = `/contract-layout-template-versions/${clone.id}`;
    const prepared = prepareSeedLayoutDocxSource(legacySource);
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(prepared)], { type: data.layout.docxFile.mimeType }), "隔离演示V2.docx");
    const uploaded = await fetch(`${baseUrl}/files`, { method: "POST", headers: { authorization: `Bearer ${director}` }, body: form });
    expect(uploaded.status).toBe(201);
    const newSource = await uploaded.json() as { id: string };
    await json("PATCH", versionPath, director, { docxFileId: newSource.id, expectedRevision: clone.draftRevision });
    const sourcePositions = await json<{ sourceFileId: string; sourceSha256: string; draftRevision: number; positions: LayoutSourcePosition[] }>("GET", `${versionPath}/source-positions`, director);
    expect(sourcePositions).toMatchObject({ sourceFileId: newSource.id, sourceSha256: digest(prepared), draftRevision: clone.draftRevision + 1 });
    const sourceIdentity = { sourceFileId: sourcePositions.sourceFileId, sourceSha256: sourcePositions.sourceSha256 };
    const mapping = await json<{ draftRevision: number; mappingFingerprint: string }>("PATCH", `${versionPath}/source-mapping`, director, {
      ...sourceIdentity, expectedRevision: sourcePositions.draftRevision, bindings: sampleBindings(sourcePositions.positions, sample.template.contractTypeKey)
    });
    const inspection = await json("POST", `${versionPath}/inspection`, director);
    expect(inspection).toMatchObject({ blockingErrors: [], sourceRevision: mapping.draftRevision });
    const previewPath = `${versionPath}/preview-generation`;
    const queued = await json<{ id: string }>("POST", previewPath, director, sample.layout.previewJob.sampleData);
    expect(queued).toMatchObject({ status: "queued", sourceRevision: mapping.draftRevision });
    let preview: { id?: string; status: string; sourceRevision?: number; previewPdfFileId?: string; errorMessage?: string } = { status: "queued" };
    for (let attempt = 0; attempt < 300; attempt += 1) {
      preview = await json("GET", previewPath, director);
      if (["succeeded", "failed"].includes(preview.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (preview.status === "failed") throw new Error(`真实版式样张生成失败：${preview.errorMessage}`);
    expect(preview).toMatchObject({ id: queued.id, sourceRevision: mapping.draftRevision, status: "succeeded", previewPdfFileId: expect.any(String) });
    const pdfId = preview.previewPdfFileId!;
    expect((await request("GET", previewPath, staff.token)).status).toBe(403);
    expect((await request("GET", `/files/${pdfId}/download-ticket-capability`, staff.token)).status).toBe(403);
    for (const outsider of [reader, finance, admin, chairman, projectStaff]) {
      expect((await request("GET", `/files/${pdfId}/download-ticket-capability`, outsider.token)).status).toBe(403);
      expect((await request("GET", `/files/${data.layout.docxFile.id}/download-ticket-capability`, outsider.token)).status).toBe(403);
    }
    await json("GET", `/files/${pdfId}/download-ticket-capability`, director);
    const revokedTicket = await ticket(pdfId, previewDirector.token, "preview");
    await prisma.userPosition.delete({ where: { id: previewDirector.assignment.id } });
    try { expect((await fetch(revokedTicket)).status).toBe(403); }
    finally { await prisma.userPosition.create({ data: previewDirector.assignment }); }
    const confirmation = await json("POST", `${versionPath}/source-mapping-confirmation`, director, {
      ...sourceIdentity, expectedRevision: mapping.draftRevision, mappingFingerprint: mapping.mappingFingerprint
    });
    expect(confirmation).toMatchObject({ confirmed: true, draftRevision: mapping.draftRevision, previewPdfFileId: pdfId });
    const submitted = await json("POST", `${versionPath}/submission`, director);
    expect(submitted).toMatchObject({ status: "submitted", submittedByUserId: owner.id });
    const publication = { changeSummary: "隔离验收真实样张 V2，保留 V1" };
    expect((await request("POST", `${versionPath}/publication`, staff.token, publication)).status).toBe(403);
    const published = await json("POST", `${versionPath}/publication`, director, publication);
    expect(published).toMatchObject({ status: "published", publishedByUserId: owner.id, previewPdfFileId: pdfId });
    expect(await prisma.contractLayoutTemplateVersion.findUnique({ where: { id: original.id } })).toEqual(original);
    expect(await prisma.fileObject.findUnique({ where: { id: originalFile.id } })).toEqual(originalFile);
    expect(await prisma.contractLayoutPreviewJob.findUnique({ where: { id: originalJob.id } })).toEqual(originalJob);
    await expect(initialize()).resolves.toEqual({ status: "preserved" });
    expect(digest(await storage.read(data.layout.previewPdfFile.objectKey))).toBe(digest(originalBytes));
    expect(digest(await storage.read(data.layout.docxFile.objectKey))).toBe(digest(legacySource));
    expect(await prisma.fileObject.findUnique({ where: { id: originalDocxFile.id } })).toEqual(originalDocxFile);
    const source = await files.getFileBuffer(pdfId);
    expect((await PDFDocument.load(source.buffer)).getPageCount()).toBeGreaterThan(0);
    expect(source.buffer.length).toBeGreaterThan(1000);
    if (process.env.LAYOUT_PREVIEW_ARTIFACT_DIR) {
      await mkdir(process.env.LAYOUT_PREVIEW_ARTIFACT_DIR, { recursive: true });
      await writeFile(join(process.env.LAYOUT_PREVIEW_ARTIFACT_DIR, `${sample.template.contractTypeKey}-v2-preview.pdf`), source.buffer, { flag: "wx" });
      await writeFile(join(process.env.LAYOUT_PREVIEW_ARTIFACT_DIR, `${sample.template.contractTypeKey}-v2-source.docx`), prepared, { flag: "wx" });
    }
    for (const token of [director, staff.token, reader.token, finance.token, admin.token, chairman.token, projectStaff.token]) {
      for (const mode of ["preview", "download"] as const) {
        const url = await ticket(pdfId, token, mode);
        const response = await fetch(url);
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain("application/pdf");
        expect(response.headers.get("content-disposition")).toMatch(mode === "preview" ? /^inline/ : /^attachment/);
        expect(digest(Buffer.from(await response.arrayBuffer()))).toBe(digest(source.buffer));
        url.searchParams.set("accessMode", mode === "preview" ? "download" : "preview");
        expect((await fetch(url)).status).toBe(400);
      }
    }
    const inactiveTicket = await ticket(pdfId, reader.token, "preview");
    await prisma.user.update({ where: { id: reader.user.id }, data: { isActive: false } });
    expect((await fetch(inactiveTicket)).status).toBe(403);
    await prisma.user.update({ where: { id: reader.user.id }, data: { isActive: true } });
    const oldTicket = await ticket(pdfId, reader.token, "preview");
    expect(await json("POST", `${versionPath}/stop`, director)).toMatchObject({ status: "stopped" });
    expect((await fetch(oldTicket)).status).toBe(403);
    await ticket(pdfId, staff.token, "download");
    // Restore fixture publication only for browser read acceptance, never production history.
    await prisma.contractLayoutTemplateVersion.update({ where: { id: clone.id }, data: { status: "published" } });
    const driftTicket = await ticket(pdfId, reader.token, "preview");
    await prisma.contractLayoutTemplateVersion.update({ where: { id: clone.id }, data: { previewPdfFileId: null } });
    expect((await fetch(driftTicket)).status).toBe(403);
    await prisma.contractLayoutTemplateVersion.update({ where: { id: clone.id }, data: { previewPdfFileId: pdfId } });
    const stale = await files.uploadPrivateFile({ originalName: "旧任务输出.pdf", mimeType: "application/pdf",
      sizeBytes: source.buffer.length, buffer: source.buffer, uploadedByUserId: owner.id });
    await prisma.contractLayoutPreviewJob.create({ data: { layoutTemplateVersionId: clone.id,
      sourceRevision: 0, status: "stale", sampleData: {}, previewPdfFileId: stale.id, createdByUserId: owner.id } });
    expect((await request("GET", `/files/${stale.id}/download-ticket-capability`, director)).status).toBe(403);
    const audit = await prisma.auditLog.findMany({ where: { businessId: pdfId } });
    for (const action of ["file.preview.ticket", "file.download.ticket", "file.preview", "file.download"]) {
      expect(audit.some((entry) => entry.action === action)).toBe(true);
    }
    browserFixtures.push({ templateId: data.layout.id, name: data.layout.name, sha: digest(source.buffer), pages: (await PDFDocument.load(source.buffer)).getPageCount() });
  }
  const unrelated = await files.uploadPrivateFile({ originalName: "其他私有文件.pdf", mimeType: "application/pdf",
    sizeBytes: 5, uploadedByUserId: owner.id, buffer: Buffer.from("other") });
  for (const token of [staff.token, finance.token, reader.token, admin.token, chairman.token]) {
    expect((await request("GET", `/files/${unrelated.id}/download-ticket-capability`, token)).status).toBe(403);
  }
  expect((await fetch(`${baseUrl}/files/${unrelated.id}/download`)).status).toBe(400);
  if (process.env.RUN_POL114_BROWSER === "1") {
    await new Promise<void>((resolve, reject) => {
      const env = { ...process.env }; delete env.JEST_WORKER_ID;
      const child = spawn(process.env.PNPM_BIN ?? "pnpm", ["--filter", "@jiangkong/web-admin", "exec", "playwright", "test",
        "--config", "playwright.layout-preview-real.config.ts", "--global-timeout=120000"], { cwd: join(__dirname, "../../../.."), env: {
        ...env, LAYOUT_PREVIEW_API_URL: baseUrl, LAYOUT_PREVIEW_PHONE: staff.phone, LAYOUT_PREVIEW_PASSWORD: password,
        LAYOUT_PREVIEW_FIXTURES: JSON.stringify(browserFixtures)
      }, stdio: "inherit" });
      child.once("error", reject); child.once("close", (code) => code === 0 ? resolve() : reject(new Error("版式真实浏览器验收失败")));
    });
  }
  if (process.env.LAYOUT_PREVIEW_RECEIPT) await writeFile(process.env.LAYOUT_PREVIEW_RECEIPT, JSON.stringify(browserFixtures));
}
