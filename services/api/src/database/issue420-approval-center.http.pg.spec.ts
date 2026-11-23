import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { hash } from "bcryptjs";
import { PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { PrismaClient } from "@prisma/client";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AppModule } from "../app.module";
import { apiJsonReplacer } from "../api-json-replacer";
import { createApiValidationPipe } from "../validation/api-validation";

const run = process.env.RUN_ISSUE420_REAL_DB === "1" ? describe : describe.skip;

// #420 真库用例：四视图可见性、当前轮办理中审批单 PDF、驳回重提只保留最新轮。
run("issue 420 approval center on real PostgreSQL and HTTP", () => {
  jest.setTimeout(180_000);
  const password = "Issue420-Real-Db-Password-01";
  const ids = {
    project: "i420-project", applicant: "i420-applicant", manager: "i420-manager",
    finance: "i420-finance", outsider: "i420-outsider", contract: "i420-contract",
    version: "i420-contract-v1", terms: "i420-terms-v1", payment: "i420-payment",
    round1: "i420-round-1", round2: "i420-round-2"
  };
  const phones: Record<string, string> = {
    applicant: "13900004201", manager: "13900004202", finance: "13900004203", outsider: "13900004204"
  };
  const tokens = new Map<string, string>();
  let app: INestApplication;
  let owner: PrismaClient;
  let base: string;
  const signature = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=", "base64");
  const signatureSha256 = createHash("sha256").update(signature).digest("hex");

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

  beforeAll(async () => {
    const target = new URL(process.env.DATABASE_URL ?? "");
    if (process.env.NODE_ENV !== "test" || target.hostname !== "127.0.0.1" || !target.pathname.endsWith("_issue420_approval")) {
      throw new Error("ISSUE420_ISOLATED_DATABASE_REQUIRED");
    }
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication({ logger: ["error"] });
    app.getHttpAdapter().getInstance().set("json replacer", apiJsonReplacer);
    app.useGlobalPipes(createApiValidationPipe());
    await app.listen(0, "127.0.0.1");
    base = await app.getUrl();
    owner = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

    const passwordHash = await hash(password, 4);
    await owner.user.createMany({ data: [
      { id: ids.applicant, name: "经办人甲", phone: phones.applicant, passwordHash, mustChangePassword: false, isActive: true },
      { id: ids.manager, name: "项目经理乙", phone: phones.manager, passwordHash, mustChangePassword: false, isActive: true },
      { id: ids.finance, name: "财务丙", phone: phones.finance, passwordHash, mustChangePassword: false, isActive: true },
      { id: ids.outsider, name: "无关人员丁", phone: phones.outsider, passwordHash, mustChangePassword: false, isActive: true }
    ] });
    await owner.project.create({ data: { id: ids.project, code: "I420-PROJECT", name: "隔离审批中心项目", isActive: true } });
    await owner.position.createMany({ data: [
      { key: "finance_staff", name: "财务" },
      { key: "project_manager", name: "项目经理" }
    ], skipDuplicates: true });
    const positions = await owner.position.findMany({ where: { key: { in: ["finance_staff", "project_manager"] } } });
    await owner.userPosition.create({ data: {
      userId: ids.finance, positionId: positions.find(position => position.key === "finance_staff")!.id, projectId: null
    } });
    await owner.projectMember.create({ data: { projectId: ids.project, userId: ids.manager, positionKey: "project_manager" } });

    await owner.contract.create({ data: { id: ids.contract, projectId: ids.project, code: "HT-I420-001",
      name: "隔离钢材采购合同", counterparty: "隔离供应商", companyEntityName: "四川建工智管建筑工程有限公司" } });
    await owner.contractVersion.create({ data: { id: ids.version, contractId: ids.contract, versionNo: 1,
      changeType: "initial", status: "effective", amountCents: 5_000_000n,
      draftData: {}, templateSnapshot: {}, clauseSnapshot: {} } });
    await owner.paymentTermsVersion.create({ data: { id: ids.terms, contractId: ids.contract,
      contractVersionId: ids.version, versionNo: 1, status: "effective", originalText: "按进度付款" } });
    await owner.paymentRequest.create({ data: { id: ids.payment, projectId: ids.project, contractId: ids.contract,
      contractVersionId: ids.version, paymentTermsVersionId: ids.terms, code: "FK-I420-001",
      status: "approval_pending", requestedAmountCents: 1_200_000n, approvedAmountCents: null,
      paidAmountCents: 0n, sourceType: "contract_advance", paymentMatter: "隔离真库进度付款" } });

    const fileId = "i420-signature-file";
    const objectKey = `signatures/${fileId}.png`;
    const storageRoot = process.env.FILE_STORAGE_ROOT!;
    await mkdir(join(storageRoot, "signatures"), { recursive: true });
    await writeFile(join(storageRoot, objectKey), signature);
    await owner.fileObject.create({ data: { id: fileId, bucket: "private", objectKey, originalName: "签名.png",
      mimeType: "image/png", sizeBytes: signature.length, uploadedByUserId: ids.manager,
      contentSha256: signatureSha256, storageStatus: "active" } });
    await owner.handwrittenSignatureVersion.create({ data: { id: "i420-signature-version", userId: ids.manager,
      fileId, contentSha256: signatureSha256, source: "canvas" } });

    const duty = (name: string, roleKeys: string[], approvedRoleKeys: string[] = []) => ({
      name, mode: "any", roleKeys, approvedRoleKeys, protocolVersion: 1, executionMode: "parallel"
    });
    await owner.approvalInstance.create({ data: { id: ids.round1, flowType: "payment.approve", businessType: "payment_request",
      businessId: ids.payment, status: "in_progress", currentNodeIndex: 0,
      applicantUserId: ids.applicant, createdAt: new Date("2026-11-20T01:00:00Z"), updatedAt: new Date("2026-11-20T01:00:00Z"),
      frozenNodes: [
        duty("合同部主管", ["contract_director"]),
        duty("项目经理", ["project_manager"], ["project_manager"]),
        duty("财务主管", ["finance_director"]),
        duty("总经理/董事长", ["chairman", "general_manager"])
      ] } as never });
    await owner.approvalActionLog.create({ data: { id: "i420-round-1-approve", approvalInstanceId: ids.round1,
      actorUserId: ids.manager, action: "approve", approvedRoleKey: "project_manager",
      signatureFileIdSnapshot: fileId, signatureVersionIdSnapshot: "i420-signature-version",
      signatureSha256Snapshot: signatureSha256, metadata: { approverName: "旧轮签字人" },
      createdAt: new Date("2026-11-20T02:00:00Z") } });

    for (const actor of ["applicant", "manager", "finance", "outsider"] as const) await login(actor);
  });

  afterAll(async () => {
    await app?.close();
    await owner?.$disconnect();
  });

  it("我方可查看只对管理读取岗位开放，查看权不等于办理权", async () => {
    const viewer = await callRaw("finance", `/approval-progress/${ids.round1}?view=viewable`);
    expect(viewer.status).toBe(200);
    expect(viewer.body.viewerOnly).toBe(true);
    expect(viewer.body.canHandle).toBe(false);
    expect(viewer.body.viewerOnly === true && viewer.body.canHandle === false).toBe(true);

    const strict = await callRaw("finance", `/approval-progress/${ids.round1}`);
    expect(strict.status).toBe(404);

    const outsider = await callRaw("outsider", `/approval-progress/${ids.round1}?view=viewable`);
    expect(outsider.status).toBe(404);

    const viewableList = await callRaw("finance", "/approval-progress?view=viewable");
    expect(viewableList.status).toBe(200);
    expect(viewableList.body.items.map((item: { id: string }) => item.id)).toContain(ids.round1);

    const outsiderList = await callRaw("outsider", "/approval-progress?view=viewable");
    expect(outsiderList.status).toBe(200);
    expect(outsiderList.body.items).toEqual([]);

    const applicant = await callRaw("applicant", `/approval-progress/${ids.round1}`);
    expect(applicant.status).toBe(200);
    expect(applicant.body.viewerOnly).toBe(false);
    expect(applicant.body.parallelCompletion).toEqual({ completed: 1, total: 4 });
    expect(applicant.body.nodes[1].signatures).toEqual([expect.objectContaining({ name: "旧轮签字人", role: "project_manager" })]);
    expect(applicant.body.nodes[2].signatures).toEqual([]);
  });

  it("办理中可下载当前轮审批单：已签显示签字、未签留空、带水印并记下载审计", async () => {
    const capability = await callRaw("applicant", `/approval-forms/payment_request/${ids.payment}/capability`);
    expect(capability.status).toBe(200);
    expect(capability.body).toEqual({ available: true, incomplete: true });

    const denied = await callRaw("outsider", `/approval-forms/payment_request/${ids.payment}/capability`);
    expect(denied.status).toBe(200);
    expect(denied.body).toEqual({ available: false });

    const response = await fetch(`${base}/approval-forms/payment_request/${ids.payment}/download`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tokens.get("applicant")}` },
      body: JSON.stringify({ confirmationPassword: password, downloadReason: "核对办理中审批单" })
    });
    expect(response.status).toBe(201);
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    const disposition = response.headers.get("content-disposition") ?? "";
    expect(decodeURIComponent(disposition)).toContain("审批未完成");

    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(0);
    const signatureImages = pdf.context.enumerateIndirectObjects().filter(([, object]) =>
      object instanceof PDFRawStream && object.dict.get(PDFName.of("Subtype")) === PDFName.of("Image"));
    expect(signatureImages.length).toBeGreaterThanOrEqual(1);

    const audit = await owner.auditLog.findFirstOrThrow({
      where: { action: "approval.form.download", businessType: "payment_request", businessId: ids.payment },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }]
    });
    expect(audit.actorUserId).toBe(ids.applicant);
    expect((audit.metadata as Record<string, unknown>).incomplete).toBe(true);
    expect((audit.metadata as Record<string, unknown>).approvalInstanceId).toBe(ids.round1);
  });

  it("驳回后重提只保留最新轮审批单，旧轮签字不进入新PDF", async () => {
    const duty = (name: string, roleKeys: string[]) => ({
      name, mode: "any", roleKeys, approvedRoleKeys: [] as string[], protocolVersion: 1, executionMode: "parallel"
    });
    await owner.approvalActionLog.create({ data: { id: "i420-round-1-reject", approvalInstanceId: ids.round1,
      actorUserId: ids.finance, action: "reject", approvedRoleKey: "finance_director",
      comment: "金额需复核", metadata: {}, createdAt: new Date("2026-11-20T03:00:00Z") } });
    await owner.approvalInstance.create({ data: { id: ids.round2, flowType: "payment.approve", businessType: "payment_request",
      businessId: ids.payment, status: "in_progress", currentNodeIndex: 0, applicantUserId: ids.applicant,
      createdAt: new Date("2026-11-21T01:00:00Z"), updatedAt: new Date("2026-11-21T01:00:00Z"), frozenNodes: [
        duty("合同部主管", ["contract_director"]), duty("项目经理", ["project_manager"]),
        duty("财务主管", ["finance_director"]), duty("总经理/董事长", ["chairman", "general_manager"])
      ] } as never });

    const progress = await callRaw("applicant", `/approval-progress/${ids.round2}`);
    expect(progress.status).toBe(200);
    expect(progress.body.nodes.every((node: { signatures: unknown[] }) => node.signatures.length === 0)).toBe(true);

    const response = await fetch(`${base}/approval-forms/payment_request/${ids.payment}/download`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tokens.get("applicant")}` },
      body: JSON.stringify({ confirmationPassword: password, downloadReason: "核对驳回重提后的当前轮" })
    });
    expect(response.status).toBe(201);
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    const audit = await owner.auditLog.findFirstOrThrow({
      where: { action: "approval.form.download", businessType: "payment_request", businessId: ids.payment },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }]
    });
    expect((audit.metadata as Record<string, unknown>).approvalInstanceId).toBe(ids.round2);
    expect((audit.metadata as Record<string, unknown>).incomplete).toBe(true);
  });
});
