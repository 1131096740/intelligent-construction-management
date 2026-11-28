import { createHash, createHmac } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { hash } from "bcryptjs";
import PizZip from "pizzip";
import { PrismaClient } from "@prisma/client";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AppModule } from "../app.module";
import { apiJsonReplacer } from "../api-json-replacer";
import { createApiValidationPipe } from "../validation/api-validation";

const run = process.env.RUN_ISSUE422_REAL_DB === "1" ? describe : describe.skip;

// #422 真库用例：档案跨单据搜索权限、附件短时链接/审计/过期/撤权、批量包逐文件授权与审计。
run("issue 422 archives and private attachments on real PostgreSQL and HTTP", () => {
  jest.setTimeout(180_000);
  const password = "Issue422-Real-Db-Password-01";
  const ids = {
    projectA: "i422-project-a",
    projectB: "i422-project-b",
    staffA: "i422-staff-a",
    revokedStaff: "i422-revoked-staff",
    finance: "i422-finance",
    employee: "i422-employee",
    contractA: "i422-contract-a",
    contractB: "i422-contract-b",
    versionA: "i422-version-a",
    versionB: "i422-version-b",
    fileA: "i422-file-a",
    fileB: "i422-file-b",
    fileC: "i422-file-c"
  };
  const phones: Record<string, string> = {
    staffA: "13900004221",
    revokedStaff: "13900004222",
    finance: "13900004223",
    employee: "13900004224"
  };
  const pdfBytes = Buffer.from("%PDF-1.4\nissue-422-private-archive");
  const pdfSha256 = createHash("sha256").update(pdfBytes).digest("hex");
  const tokens = new Map<string, string>();
  let app: INestApplication;
  let owner: PrismaClient;
  let base: string;

  const callRaw = async (actor: keyof typeof phones, path: string, body?: unknown, method?: string) => {
    const response = await fetch(`${base}${path}`, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: { "content-type": "application/json", authorization: `Bearer ${tokens.get(actor)}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
  const login = async (actor: keyof typeof phones) => {
    const response = await fetch(`${base}/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: phones[actor], password })
    });
    expect(response.status).toBe(201);
    const body = await response.json() as { tokens: { accessToken: string } };
    tokens.set(actor, body.tokens.accessToken);
  };
  const uploadTicket = async (actor: keyof typeof phones, fileId: string) => {
    const ticket = await callRaw(actor, `/files/${fileId}/download-ticket`, {});
    if (ticket.status !== 201) throw new Error(`TICKET_FAILED ${ticket.status} ${JSON.stringify(ticket.body)}`);
    return ticket.body as { downloadUrl: string };
  };

  beforeAll(async () => {
    const target = new URL(process.env.DATABASE_URL ?? "");
    if (process.env.NODE_ENV !== "test" || target.hostname !== "127.0.0.1" || !target.pathname.endsWith("_issue422_archives")) {
      throw new Error("ISSUE422_ISOLATED_DATABASE_REQUIRED");
    }
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication({ logger: ["error"] });
    app.getHttpAdapter().getInstance().set("json replacer", apiJsonReplacer);
    app.useGlobalPipes(createApiValidationPipe());
    await app.listen(0, "127.0.0.1");
    base = await app.getUrl();
    owner = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

    const passwordHash = await hash(password, 4);
    await owner.user.createMany({ data: [
      { id: ids.staffA, name: "合同员甲", phone: phones.staffA, passwordHash, mustChangePassword: false, isActive: true },
      { id: ids.revokedStaff, name: "合同员乙", phone: phones.revokedStaff, passwordHash, mustChangePassword: false, isActive: true },
      { id: ids.finance, name: "财务主管丙", phone: phones.finance, passwordHash, mustChangePassword: false, isActive: true },
      { id: ids.employee, name: "普通员工丁", phone: phones.employee, passwordHash, mustChangePassword: false, isActive: true }
    ] });
    await owner.project.createMany({ data: [
      { id: ids.projectA, code: "I422-A", name: "隔离钢材项目", isActive: true },
      { id: ids.projectB, code: "I422-B", name: "隔离幕墙项目", isActive: true }
    ] });
    await owner.position.createMany({ data: [
      { key: "contract_staff", name: "合同员" },
      { key: "contract_director", name: "合同部主管" },
      { key: "finance_staff", name: "财务" }
    ], skipDuplicates: true });
    const positions = await owner.position.findMany({ where: { key: { in: ["contract_staff", "contract_director", "finance_staff"] } } });
    const contractStaffPosition = positions.find((position) => position.key === "contract_staff")!;
    const contractDirectorPosition = positions.find((position) => position.key === "contract_director")!;
    const financePosition = positions.find((position) => position.key === "finance_staff")!;
    await owner.userPosition.createMany({ data: [
      { userId: ids.staffA, positionId: contractStaffPosition.id, projectId: ids.projectA },
      { userId: ids.revokedStaff, positionId: contractStaffPosition.id, projectId: ids.projectA },
      { userId: ids.finance, positionId: financePosition.id, projectId: null },
      { userId: ids.finance, positionId: contractDirectorPosition.id, projectId: null }
    ] });

    await owner.contract.createMany({ data: [
      { id: ids.contractA, projectId: ids.projectA, code: "HT-422-A", name: "隔离钢材采购合同", counterparty: "四川钢材供应商" },
      { id: ids.contractB, projectId: ids.projectB, code: "HT-422-B", name: "隔离幕墙分包合同", counterparty: "幕墙分包单位" }
    ] });
    await owner.contractVersion.createMany({ data: [
      { id: ids.versionA, contractId: ids.contractA, versionNo: 1, changeType: "initial", status: "effective", amountCents: 1_000_000n, draftData: {}, templateSnapshot: {}, clauseSnapshot: {} },
      { id: ids.versionB, contractId: ids.contractB, versionNo: 1, changeType: "initial", status: "effective", amountCents: 2_000_000n, draftData: {}, templateSnapshot: {}, clauseSnapshot: {} }
    ] });

    await owner.signedContractSettlement.createMany({ data: [
      { id: "i422-settlement-a", projectId: ids.projectA, contractKind: "contract", contractId: ids.contractA, ownerUserId: ids.staffA, state: "confirmed" },
      { id: "i422-settlement-b", projectId: ids.projectB, contractKind: "contract", contractId: ids.contractB, ownerUserId: ids.staffA, state: "confirmed" }
    ] });
    const storageRoot = process.env.FILE_STORAGE_ROOT!;
    const projectStoragePrefix = (projectId: string) =>
      `uploads/signed-contract-settlement/${createHash("sha256").update(projectId).digest("hex")}/`;
    await mkdir(join(storageRoot, projectStoragePrefix(ids.projectA)), { recursive: true });
    await mkdir(join(storageRoot, projectStoragePrefix(ids.projectB)), { recursive: true });
    const projectByFile: Record<string, string> = {
      [ids.fileA]: ids.projectA,
      [ids.fileB]: ids.projectB,
      [ids.fileC]: ids.projectA
    };
    for (const fileId of [ids.fileA, ids.fileB, ids.fileC]) {
      const objectKey = `${projectStoragePrefix(projectByFile[fileId])}${fileId}.pdf`;
      await writeFile(join(storageRoot, objectKey), pdfBytes);
      await owner.fileObject.create({ data: {
        id: fileId, bucket: "private-local", objectKey, originalName: `${fileId}.pdf`,
        mimeType: "application/pdf", sizeBytes: pdfBytes.length, uploadedByUserId: ids.staffA,
        contentSha256: pdfSha256, storageStatus: "active"
      } });
    }
    await owner.signedContractSettlementAttachment.createMany({ data: [
      { settlementId: "i422-settlement-a", fileId: ids.fileA, sha256: pdfSha256 },
      { settlementId: "i422-settlement-b", fileId: ids.fileB, sha256: pdfSha256 },
      { settlementId: "i422-settlement-a", fileId: ids.fileC, sha256: pdfSha256 }
    ] });
    await owner.archiveRecord.createMany({ data: [
      { id: "i422-archive-a", businessType: "contract_version", businessId: ids.versionA, fileId: ids.fileA, departmentScope: "contract" },
      { id: "i422-archive-b", businessType: "contract_version", businessId: ids.versionB, fileId: ids.fileB, departmentScope: "contract" },
      { id: "i422-archive-c", businessType: "contract_version", businessId: ids.versionA, fileId: ids.fileC, departmentScope: "contract" }
    ] });

    for (const actor of ["staffA", "revokedStaff", "finance", "employee"] as const) await login(actor);
  });

  afterAll(async () => {
    await app?.close();
    await owner?.$disconnect();
  });

  it("searches archives only inside the current document visibility and filters by project, contract, counterparty, and number", async () => {
    const ownProject = await callRaw("staffA", "/archives");
    expect(ownProject.status).toBe(200);
    expect(ownProject.body.rows.map((row: { fileId: string }) => row.fileId).sort()).toEqual([ids.fileA, ids.fileC].sort());
    expect(ownProject.body.rows.every((row: { project: string }) => row.project === "隔离钢材项目")).toBe(true);

    const byNumber = await callRaw("staffA", "/archives?keyword=HT-422-A");
    expect(byNumber.status).toBe(200);
    expect(byNumber.body.rows).toHaveLength(2);
    expect(byNumber.body.summary.total).toBe(2);

    const hiddenCounterparty = await callRaw("staffA", "/archives?counterparty=%E5%B9%95%E5%A2%99");
    expect(hiddenCounterparty.status).toBe(200);
    expect(hiddenCounterparty.body.rows).toEqual([]);
    expect(hiddenCounterparty.body.summary.total).toBe(0);

    const financeAll = await callRaw("finance", "/archives?contract=HT-422");
    expect(financeAll.status).toBe(200);
    expect(financeAll.body.rows).toHaveLength(3);
    expect(financeAll.body.summary.total).toBe(3);

    const financeCounterparty = await callRaw("finance", "/archives?counterparty=%E5%9B%9B%E5%B7%9D%E9%92%A2%E6%9D%90");
    expect(financeCounterparty.status).toBe(200);
    expect(financeCounterparty.body.rows.every((row: { counterpartyName: string }) => row.counterpartyName === "四川钢材供应商")).toBe(true);
    expect(financeCounterparty.body.rows).toHaveLength(2);

    const denied = await callRaw("employee", "/archives");
    expect(denied.status).toBe(403);
  });

  it("issues short-lived attachment tickets without password or reason, audits downloads, and rejects another project's file", async () => {
    const ticket = await uploadTicket("staffA", ids.fileA);
    expect(ticket.downloadUrl).toContain("token=");
    expect(ticket.downloadUrl).toContain(`downloadReason=${encodeURIComponent("单据可见权限内下载")}`);

    const downloaded = await fetch(`${base}${ticket.downloadUrl}`);
    expect(downloaded.status).toBe(200);
    expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(pdfBytes);
    expect(downloaded.headers.get("content-type")).toBe("application/pdf");

    const previewTicket = await callRaw("staffA", `/files/${ids.fileA}/download-ticket`, { accessMode: "preview" });
    expect(previewTicket.status).toBe(201);
    const preview = await fetch(`${base}${previewTicket.body.downloadUrl}`);
    expect(preview.status).toBe(200);
    expect(preview.headers.get("content-disposition")).toContain("inline;");
    expect(await owner.auditLog.findFirst({
      where: { action: "file.preview.ticket", actorUserId: ids.staffA, businessId: ids.fileA }
    })).not.toBeNull();

    const ticketAudit = await owner.auditLog.findFirst({
      where: { action: "file.download.ticket", actorUserId: ids.staffA, businessId: ids.fileA }
    });
    expect(ticketAudit).not.toBeNull();
    const downloadAudit = await owner.auditLog.findFirst({
      where: { action: "file.download", actorUserId: ids.staffA, businessId: ids.fileA }
    });
    expect(downloadAudit).not.toBeNull();

    const denied = await callRaw("staffA", `/files/${ids.fileB}/download-ticket`, {});
    expect(denied.status).toBe(403);
    expect(await owner.auditLog.findFirst({
      where: { action: "file.download.ticket", actorUserId: ids.staffA, businessId: ids.fileB }
    })).toBeNull();
  });

  it("rejects an expired short-lived link and a still-valid link after the role is revoked", async () => {
    const secret = process.env.FILE_DOWNLOAD_SECRET ?? "test-file-download-secret";
    const reason = "单据可见权限内下载";
    const expiresAt = new Date(Date.now() - 60_000).toISOString();
    const token = createHmac("sha256", secret)
      .update(`${ids.fileA}.${ids.staffA}.${expiresAt}.${reason}.download`)
      .digest("base64url");
    const expired = await fetch(`${base}/files/${ids.fileA}/download?actorUserId=${ids.staffA}`
      + `&expiresAt=${encodeURIComponent(expiresAt)}&downloadReason=${encodeURIComponent(reason)}`
      + `&accessMode=download&token=${encodeURIComponent(token)}`);
    expect(expired.status).toBe(400);
    expect((await expired.json() as { message: string }).message).toContain("下载链接已过期");

    const ticket = await uploadTicket("revokedStaff", ids.fileC);
    await owner.userPosition.deleteMany({ where: { userId: ids.revokedStaff } });
    const revoked = await fetch(`${base}${ticket.downloadUrl}`);
    expect(revoked.status).toBe(403);
  });

  it("authorizes every package file, rejects mixed unauthorized selections, and records package audit", async () => {
    const capability = await callRaw("staffA", `/files/download-package-capability?fileIds=${ids.fileA}`);
    expect(capability.status).toBe(200);
    expect(capability.body.action).toEqual({ key: "download_archive_package", enabled: true });

    const ownPackage = await fetch(`${base}/files/download-package`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${tokens.get("staffA")}` },
      body: JSON.stringify({ fileIds: [ids.fileA] })
    });
    expect(ownPackage.status).toBe(201);
    expect(ownPackage.headers.get("content-type")).toContain("application/zip");
    const ownZip = new PizZip(Buffer.from(await ownPackage.arrayBuffer()));
    expect(Object.keys(ownZip.files)).toHaveLength(1);

    const auditCountBeforeMixed = await owner.auditLog.count({
      where: { action: "file.package.download", actorUserId: ids.staffA }
    });
    const mixed = await fetch(`${base}/files/download-package`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${tokens.get("staffA")}` },
      body: JSON.stringify({ fileIds: [ids.fileA, ids.fileB] })
    });
    expect(mixed.status).toBe(403);
    expect(await owner.auditLog.count({
      where: { action: "file.package.download", actorUserId: ids.staffA }
    })).toBe(auditCountBeforeMixed);

    const financePackage = await fetch(`${base}/files/download-package`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${tokens.get("finance")}` },
      body: JSON.stringify({ fileIds: [ids.fileA, ids.fileB] })
    });
    expect(financePackage.status).toBe(201);
    const financeZip = new PizZip(Buffer.from(await financePackage.arrayBuffer()));
    expect(Object.keys(financeZip.files).sort()).toEqual(["i422-file-a.pdf", "i422-file-b.pdf"]);

    const audit = await owner.auditLog.findFirst({
      where: { action: "file.package.download", actorUserId: ids.finance },
      orderBy: { createdAt: "desc" }
    });
    expect(audit).not.toBeNull();
    expect(audit!.metadata).toMatchObject({
      fileCount: 2,
      fileIds: [ids.fileA, ids.fileB]
    });

    const tooMany = await callRaw("finance", "/files/download-package", {
      fileIds: Array.from({ length: 51 }, (_, index) => `i422-missing-${index}`)
    });
    expect(tooMany.status).toBe(400);
  });
});
