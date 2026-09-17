import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { hash } from "bcryptjs";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import sharpModule = require("sharp");
import { AppModule } from "../app.module";
import { apiJsonReplacer } from "../api-json-replacer";
import { PrismaService } from "../database/prisma.service";
import { createApiValidationPipe } from "../validation/api-validation";

const sharp = sharpModule as unknown as typeof import("sharp").default;

const enabled = process.env.RUN_POL115_SPOT_ENTRY_PG16 === "1";
type Session = {
  user: unknown;
  tokens: { accessToken: string; refreshToken: string; expiresIn: number };
};
type Detail = {
  procurement: { id: string; status: string; statusLabel: string };
  currentVersion: Version;
  versions: Version[];
  lines: Array<{ id: string; sortOrder: number; materialName: string; specification: string | null; unit: string; quantity: string; note: string | null }>;
  attachments: Array<{ recordId: string; fileId: string; fileName: string; purpose: string; mimeType: string; sizeBytes: number; status: string; statusLabel: string; uploadedByName: string; uploadedAt: string; confirmedByName: string | null; confirmedAt: string | null; canDownload: boolean; disabledReason: string | null }>;
  approval: { currentNodeName: string | null };
  reviewApprovalContext: null | {
    expectedVersionId: string;
    expectedApprovalInstanceId: string;
    expectedNodeIndex: number;
  };
  approvalTimeline: Array<{ id: string; action: string; actionLabel: string; actorUserId: string; actorName: string; comment: string | null; nodeName: string | null; roleName: string | null; createdAt: string }>;
  payments: Array<{ id: string; actualPaidAmountCents?: string; refundAmountCents?: string; netPaidAmountCents?: string }>;
  paymentSummary: unknown;
  receipt: unknown;
  discrepancy: unknown;
};
type Version = {
  id: string; versionNo: number; reason: string; status: string; statusLabel: string; note: string | null;
  applicationDepartment: string; applicationName: string; purchaserName: string; purchaserDepartment: string; requestedArrivalAt: string;
  handlerUserId: string; changeReason: string | null; changeSummary: unknown; submittedAt: string | null; approvedAt: string | null;
  abandonedAt: string | null; abandonReason: string | null; createdByUserId: string; createdAt: string; updatedAt: string;
};

describe("#115 零星采购申请生命周期真实 HTTP 与 PostgreSQL 16", () => {
  let app: INestApplication;
  let baseUrl = "";
  let applicant: Session;
  let director: Session;
  let manager: Session;
  let refundFinance: Session;
  const sessions = new Map<string, Session>();
  let accountPassword = "";
  let payerCompanyEntityId = "";
  const projectIds = { api: randomUUID(), desktop: randomUUID(), mobile: randomUUID() };
  const previousPilot = process.env.SPOT_PROCUREMENT_PILOT_PROJECT_IDS;

  beforeAll(async () => {
    if (!enabled) return;
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (process.env.NODE_ENV === "production" || url.hostname !== "127.0.0.1" || url.pathname !== "/jiangkong_pol115_spot_entry_test") {
      throw new Error("零采入口测试只允许本机专用 PostgreSQL 数据库");
    }
    process.env.SPOT_PROCUREMENT_PILOT_PROJECT_IDS = Object.values(projectIds).join(",");
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication({ logger: false });
    app.getHttpAdapter().getInstance().set("json replacer", apiJsonReplacer);
    app.useGlobalPipes(createApiValidationPipe());
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();

    const prisma = app.get(PrismaService);
    const suffix = randomUUID();
    const password = randomUUID();
    accountPassword = password;
    const users = await Promise.all([
      ["零采申请人", "material_staff"],
      ["零采物资主管", "material_director"],
      ["零采项目经理", "project_manager"],
      ["零采综合主管", "comprehensive_director"],
      ["零采财务主管", "finance_director"],
      ["零采董事长", "chairman"],
      ["零采财务员", "finance_staff"]
    ].map(async ([name, role]) => ({
      role,
      user: await prisma.user.create({ data: { name, phone: `pol115-spot-${role}-${suffix}`, passwordHash: await hash(password, 4), mustChangePassword: false } })
    })));
    const constructionEnterprise = await prisma.businessParty.create({ data: { name: "零采合成施工企业", normalizedName: `pol115-spot-construction-${suffix}`, unifiedSocialCreditCode: `POL115CE${suffix.replaceAll("-", "").slice(0, 10)}`, createdByUserId: users[0]!.user.id } });
    const constructionEnterpriseVersion = await prisma.businessPartyVersion.create({ data: { businessPartyId: constructionEnterprise.id, versionNo: 1, snapshot: { name: constructionEnterprise.name, unifiedSocialCreditCode: constructionEnterprise.unifiedSocialCreditCode }, createdByUserId: users[0]!.user.id } });
    payerCompanyEntityId = (await prisma.companyEntity.create({ data: { name: "零采合成付款主体", unifiedSocialCreditCode: `POL115${suffix.replaceAll("-", "").slice(0, 12)}`, dataStatus: "complete" } })).id;
    for (const [kind, id] of Object.entries(projectIds)) {
      await prisma.project.create({ data: { id, code: `POL115-SPOT-${kind}-${suffix.slice(0, 6)}`, name: `零采${kind}隔离项目` } });
    }
    for (const { role, user } of users) {
      const position = await prisma.position.upsert({ where: { key: role }, create: { key: role, name: role }, update: {} });
      await prisma.userPosition.createMany({ data: Object.values(projectIds).map((projectId) => ({ userId: user.id, positionId: position.id, projectId })) });
      if (role === "comprehensive_director") await prisma.userPosition.create({ data: { userId: user.id, positionId: position.id, projectId: null } });
      const response = await fetch(`${baseUrl}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: user.phone, password }) });
      expect(response.status).toBe(201);
      const session = await response.json() as Session;
      sessions.set(role, session);
      if (role === "material_staff") applicant = session;
      if (role === "material_director") director = session;
      if (role === "project_manager") manager = session;
    }
    const refundFinanceUser = await prisma.user.create({ data: { name: "零采退款财务员", phone: `pol115-spot-refund-finance-${suffix}`, passwordHash: await hash(password, 4), mustChangePassword: false } });
    const financePosition = await prisma.position.findUniqueOrThrow({ where: { key: "finance_staff" } });
    await prisma.userPosition.createMany({ data: Object.values(projectIds).map((projectId) => ({ userId: refundFinanceUser.id, positionId: financePosition.id, projectId })) });
    const refundFinanceLogin = await fetch(`${baseUrl}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: refundFinanceUser.phone, password }) });
    expect(refundFinanceLogin.status).toBe(201);
    refundFinance = await refundFinanceLogin.json() as Session;
    const profileBefore = await json(`/projects/${projectIds.api}/operating-profile`, sessions.get("comprehensive_director")!);
    expect(profileBefore.status).toBe(200);
    expect((profileBefore.body as unknown as { constructionEnterprise: unknown }).constructionEnterprise).toBeNull();
    for (const projectId of Object.values(projectIds)) {
      const assignment = await json(`/projects/${projectId}/construction-enterprise`, sessions.get("finance_director")!, "POST", {
        businessPartyVersionId: constructionEnterpriseVersion.id,
        effectiveFrom: "2026-01-01T00:00:00.000Z",
        changeReason: "#115 零采退款合成项目公开配置"
      });
      expect(assignment.status).toBe(201);
    }
    const profileAfter = await json(`/projects/${projectIds.api}/operating-profile`, sessions.get("comprehensive_director")!);
    expect(profileAfter.status).toBe(200);
    expect(profileAfter.body).toMatchObject({ constructionEnterprise: { businessPartyVersionId: constructionEnterpriseVersion.id, name: constructionEnterprise.name } });
    for (const session of [director, manager, sessions.get("comprehensive_director")!, sessions.get("finance_director")!, sessions.get("chairman")!]) {
      const body = new FormData();
      body.append("file", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=", "base64")], { type: "image/png" }), "合成签名.png");
      expect((await fetch(`${baseUrl}/me/signature/canvas`, { method: "POST", headers: { authorization: `Bearer ${session.tokens.accessToken}` }, body })).status).toBe(201);
    }
  }, 60_000);

  afterAll(async () => {
    if (app) await app.close();
    if (previousPilot === undefined) delete process.env.SPOT_PROCUREMENT_PILOT_PROJECT_IDS;
    else process.env.SPOT_PROCUREMENT_PILOT_PROJECT_IDS = previousPilot;
  });

  async function json(path: string, session: Session, method = "GET", body?: unknown) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${session.tokens.accessToken}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) as Detail & { procurementId: string } : null };
  }

  function expectHttpStatus<T extends { status: number; body: unknown }>(label: string, response: T, expected: number) {
    if (response.status !== expected) {
      throw new Error(`${label}失败: ${response.status} ${safeResponseBody(response.body)}`);
    }
    return response;
  }

  function safeResponseBody(value: unknown): string {
    const redact = (current: unknown): unknown => {
      if (Array.isArray(current)) return current.map(redact);
      if (current && typeof current === "object") {
        return Object.fromEntries(Object.entries(current).map(([key, child]) => [
          key,
          /password|token|authorization|cookie|secret/iu.test(key) ? "<REDACTED>" : redact(child)
        ]));
      }
      return current;
    };
    return JSON.stringify(redact(value));
  }

  async function createDraft(projectId: string, label: string) {
    const upload = new FormData();
    upload.append("file", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=", "base64")], { type: "image/png" }), `合成报价-${label}.png`);
    upload.append("idempotencyKey", randomUUID());
    const uploaded = await fetch(`${baseUrl}/spot-procurements/projects/${projectId}/draft-file-uploads`, { method: "POST", headers: { authorization: `Bearer ${applicant.tokens.accessToken}` }, body: upload });
    const uploadText = await uploaded.text();
    if (uploaded.status !== 201) throw new Error(`零采附件上传失败：${uploaded.status} ${uploadText}`);
    const file = JSON.parse(uploadText) as { id: string };
    const created = await json("/spot-procurements", applicant, "POST", {
      projectId, applicationDepartment: "工程部", applicationName: "现场申请人", requestedArrivalAt: "2026-10-01",
      reason: `旧版采购原因-${label}`, lines: [{ materialName: "水泥", specification: "P.O 42.5", unit: "袋", quantity: "10", note: "合成验收" }],
      attachments: [{ fileId: file.id, category: "merchant_quote" }]
    });
    expect(created.status).toBe(201);
    expect(created.body!.procurementId).toEqual(expect.any(String));
    return created.body!.procurementId;
  }

  function immutableDraftFacts(detail: Detail) {
    const version = detail.currentVersion;
    return {
      version: {
        reason: version.reason, note: version.note, applicationDepartment: version.applicationDepartment,
        applicationName: version.applicationName, purchaserName: version.purchaserName,
        purchaserDepartment: version.purchaserDepartment, requestedArrivalAt: version.requestedArrivalAt,
        handlerUserId: version.handlerUserId, abandonedAt: version.abandonedAt,
        abandonReason: version.abandonReason
      },
      lines: detail.lines.map((line) => ({
        sortOrder: line.sortOrder, materialName: line.materialName, specification: line.specification,
        unit: line.unit, quantity: line.quantity, note: line.note
      })),
      attachments: detail.attachments.map((attachment) => ({
        fileId: attachment.fileId, fileName: attachment.fileName, purpose: attachment.purpose,
        mimeType: attachment.mimeType, sizeBytes: attachment.sizeBytes, status: attachment.status,
        statusLabel: attachment.statusLabel, uploadedByName: attachment.uploadedByName,
        uploadedAt: attachment.uploadedAt, confirmedByName: attachment.confirmedByName,
        confirmedAt: attachment.confirmedAt, canDownload: attachment.canDownload,
        disabledReason: attachment.disabledReason
      }))
    };
  }

  function rejectionInvariant(detail: Detail) {
    return {
      procurement: detail.procurement,
      currentVersion: detail.currentVersion,
      versions: detail.versions,
      lines: detail.lines,
      attachments: detail.attachments,
      approval: detail.approval,
      reviewApprovalContext: detail.reviewApprovalContext,
      approvalTimeline: detail.approvalTimeline
    };
  }

  function refundInvariant(detail: Detail) {
    expect(detail.payments).toEqual(expect.arrayContaining([expect.objectContaining({ id: expect.any(String) })]));
    expect(detail.paymentSummary).toEqual(expect.any(Object));
    expect(detail.receipt).toEqual(expect.any(Object));
    expect(detail.discrepancy).toEqual(expect.any(Object));
    return { payments: detail.payments, paymentSummary: detail.paymentSummary, receipt: detail.receipt, discrepancy: detail.discrepancy };
  }

  async function prepareAwaitingRefund(projectId: string, label: string) {
    const id = await createDraft(projectId, `refund-${label}`);
    expectHttpStatus(`${label}申请提交`, await json(`/spot-procurements/${id}/submission`, applicant, "POST", {}), 201);
    for (const reviewer of [director, manager]) {
      const view = expectHttpStatus(`${label}申请审批坐标`, await json(`/spot-procurements/${id}`, reviewer), 200).body as Detail;
      expectHttpStatus(`${label}申请审批`, await json(`/spot-procurements/${id}/approval`, reviewer, "POST", { decision: "approve", comment: `${label}合成通过`, ...view.reviewApprovalContext! }), 201);
    }
    const approved = expectHttpStatus(`${label}申请结果`, await json(`/spot-procurements/${id}`, applicant), 200).body as Detail;
    const paymentId = approved.payments[0]!.id;
    const paymentDraft = expectHttpStatus(`${label}付款草稿`, await json(`/spot-procurement-payments/${paymentId}`, applicant), 200).body as unknown as { procurementMaterials: Array<{ id: string }> };
    expectHttpStatus(`${label}付款补全`, await json(`/spot-procurement-payments/${paymentId}/draft`, applicant, "PATCH", {
      paymentType: "company_direct", merchantName: "合成商户", payeeName: "合成商户",
      paymentLines: [{ procurementLineId: paymentDraft.procurementMaterials[0]!.id, paymentQuantity: "10", unitPrice: "100", expectedInvoiceCondition: "no_invoice" }],
      channels: [{ channelType: "bank_transfer", accountName: "合成商户", accountNumber: "622200001234", bankName: "合成银行", isPrimary: true }],
      paymentMethods: ["bank_transfer"], attachments: [], settlementAmountCents: "100000", supplierBalanceAmountCents: "0",
      paymentPath: "supplier_direct", paymentMethod: "bank_transfer", payeeAccountName: "合成商户", payeeBankName: "合成银行", payeeBankAccount: "622200001234", expectedPaymentAt: "2026-09-17"
    }), 200);
    expectHttpStatus(`${label}付款提交`, await json(`/spot-procurement-payments/${paymentId}/submission`, applicant, "POST", {}), 201);
    const executor = sessions.get("finance_staff")!;
    expectHttpStatus(`${label}付款主体`, await json(`/spot-procurement-payments/${paymentId}/payer`, executor, "PATCH", { companyEntityId: payerCompanyEntityId, paymentMethods: ["bank_transfer"] }), 200);
    for (const role of ["comprehensive_director", "project_manager", "finance_director", "chairman"]) {
      expectHttpStatus(`${label}付款审批${role}`, await json(`/spot-procurement-payments/${paymentId}/approval`, sessions.get(role)!, "POST", { decision: "approve", comment: `${label}${role}通过` }), 201);
    }
    const paymentView = expectHttpStatus(`${label}付款读取`, await json(`/spot-procurement-payments/${paymentId}`, executor), 200).body as unknown as { paymentChannels: Array<{ id: string; channelType: string }> };
    const channelId = paymentView.paymentChannels.find((channel) => channel.channelType === "bank_transfer")!.id;
    const voucher = await uploadFile(`/spot-procurement-payments/${paymentId}/execution-voucher-file-uploads`, executor, `${label}实付凭证.png`, randomUUID());
    if (voucher.status !== 201) throw new Error(`${label}实付凭证失败: ${safeResponseBody(voucher)}`);
    const quotaFile = await uploadGenericFile(executor, `${label}垫资依据.png`);
    const quota = expectHttpStatus(`${label}垫资申请`, await json(`/projects/${projectId}/financing-quotas`, executor, "POST", { idempotencyKey: randomUUID(), amountCents: "100000", reason: `${label}测试垫资`, attachmentFileId: quotaFile.id }), 201).body as unknown as { quotaId: string };
    for (const role of ["finance_director", "chairman"] as const) {
      const capability = expectHttpStatus(`${label}垫资坐标`, await json(`/projects/${projectId}/financing-quotas/${quota.quotaId}/review-capability`, sessions.get(role)!), 200).body as unknown as { lifecycleToken: string };
      expectHttpStatus(`${label}垫资审批`, await json(`/projects/${projectId}/financing-quotas/${quota.quotaId}/approval`, sessions.get(role)!, "POST", { actionId: randomUUID(), expectedLifecycleToken: capability.lifecycleToken, decision: "approve", confirmationPassword: accountPassword }), 201);
    }
    expectHttpStatus(`${label}实付`, await json(`/spot-procurement-payments/${paymentId}/executions`, executor, "POST", { amountCents: "100000", paidAt: "2026-09-17", paymentMethod: "bank_transfer", voucherFileId: voucher.id, paymentChannelId: channelId, idempotencyKey: randomUUID(), confirmationPassword: accountPassword }), 201);
    const image = await sharp({ create: { width: 320, height: 240, channels: 3, background: "#4f8a5b" } }).png().toBuffer();
    const photo = await uploadFile(`/spot-procurements/${id}/receipt-photo-file-uploads`, applicant, `${label}收货.png`, randomUUID(), image);
    expectHttpStatus(`${label}照片绑定`, await json(`/spot-procurements/${id}/receipt/photos`, applicant, "POST", { originalFileId: photo.id, source: "camera", category: "material_scene" }), 201);
    expectHttpStatus(`${label}收货草稿`, await json(`/spot-procurements/${id}/receipt/draft`, applicant, "PATCH", { lines: [{ procurementLineId: approved.lines[0]!.id, qualifiedQuantity: "8", unqualifiedQuantity: "0", freeGiftQuantity: "0", replenishmentPending: false, discrepancyNote: "少货2袋" }] }), 200);
    expectHttpStatus(`${label}收货提交`, await json(`/spot-procurements/${id}/receipt/submission`, applicant, "POST", {}), 201);
    expectHttpStatus(`${label}收货审核`, await json(`/spot-procurements/${id}/receipt/review`, director, "POST", { decision: "approved", comment: "确认少货" }), 201);
    expectHttpStatus(`${label}差异发起`, await json(`/spot-procurements/${id}/discrepancy`, applicant, "POST", { operation: "initiate", resolutionType: "full_refund", note: "商户退还少货差额" }), 201);
    expectHttpStatus(`${label}差异确认`, await json(`/spot-procurements/${id}/discrepancy`, director, "POST", { operation: "confirm", resolutionType: "full_refund", note: "商户退还少货差额" }), 201);
    return { procurementId: id, paymentId };
  }

  (enabled ? it : it.skip)("公开链保留旧版本并冻结两级审批坐标", async () => {
    const id = await createDraft(projectIds.api, "api");
    const initial = (await json(`/spot-procurements/${id}`, applicant)).body!;
    expect(initial).toMatchObject({ currentVersion: { versionNo: 1, status: "draft", reason: "旧版采购原因-api" }, attachments: [{ fileName: "合成报价-api.png" }] });
    const initialFacts = immutableDraftFacts(initial);
    expect((await json(`/spot-procurements/${id}/submission`, applicant, "POST", {})).status).toBe(201);
    const firstDirectorView = (await json(`/spot-procurements/${id}`, director)).body!;
    const firstCoordinates = firstDirectorView.reviewApprovalContext!;
    const beforeWrongManager = (await json(`/spot-procurements/${id}`, applicant)).body!;
    expect((await json(`/spot-procurements/${id}/approval`, manager, "POST", { decision: "approve", comment: "错误越级", ...firstCoordinates })).status).toBe(403);
    expect(rejectionInvariant((await json(`/spot-procurements/${id}`, applicant)).body!)).toEqual(rejectionInvariant(beforeWrongManager));
    expect((await json(`/spot-procurements/${id}/approval`, director, "POST", { decision: "return_to_applicant", comment: "请补充现场用途", ...firstCoordinates })).status).toBe(201);
    const returned = await json(`/spot-procurements/${id}`, applicant);
    expect(returned.body).toMatchObject({ procurement: { status: "draft" }, currentVersion: { versionNo: 2, status: "draft" }, versions: [{ versionNo: 2 }, { versionNo: 1, reason: "旧版采购原因-api" }] });
    expect(immutableDraftFacts(returned.body!)).toEqual(initialFacts);
    const frozenV1AfterReturn = returned.body!.versions.find((version) => version.versionNo === 1)!;

    const uploadKey = randomUUID();
    const uploadRevisionAttachment = async () => {
      const form = new FormData();
      form.append("file", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=", "base64")], { type: "image/png" }), "合成补充说明-api.png");
      form.append("idempotencyKey", uploadKey);
      const response = await fetch(`${baseUrl}/spot-procurements/${id}/draft-file-uploads`, { method: "POST", headers: { authorization: `Bearer ${applicant.tokens.accessToken}` }, body: form });
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) as { id: string } : null };
    };
    const firstUpload = await uploadRevisionAttachment();
    const replayUpload = await uploadRevisionAttachment();
    expect(firstUpload).toMatchObject({ status: 201, body: { id: expect.any(String) } });
    expect(replayUpload).toEqual(firstUpload);
    expect((await json(`/spot-procurements/${id}/draft`, applicant, "PATCH", {
      applicationDepartment: "工程部", applicationName: "现场申请人", requestedArrivalAt: "2026-10-02", reason: "新版补充后采购原因",
      lines: [{ materialName: "水泥", specification: "P.O 42.5", unit: "袋", quantity: "12", note: "已补充" }],
      attachments: [
        { fileId: returned.body!.attachments[0]!.fileId, category: "merchant_quote" },
        { fileId: firstUpload.body!.id, category: "other" }
      ]
    })).status).toBe(200);
    const revisedDraft = (await json(`/spot-procurements/${id}`, applicant)).body!;
    expect(revisedDraft.lines).toEqual([expect.objectContaining({ materialName: "水泥", quantity: "12", note: "已补充" })]);
    expect(revisedDraft.attachments).toHaveLength(2);
    expect(revisedDraft.attachments.map(({ fileId, fileName, purpose }) => ({ fileId, fileName, purpose }))).toEqual(expect.arrayContaining([
      { fileId: initial.attachments[0]!.fileId, fileName: "合成报价-api.png", purpose: "merchant_quote" },
      { fileId: firstUpload.body!.id, fileName: "合成补充说明-api.png", purpose: "other" }
    ]));
    expect(revisedDraft.versions.find((version) => version.versionNo === 1)).toEqual(frozenV1AfterReturn);
    expect((await json(`/spot-procurements/${id}/submission`, applicant, "POST", {})).status).toBe(201);
    const secondDirectorView = (await json(`/spot-procurements/${id}`, director)).body!;
    const secondCoordinates = secondDirectorView.reviewApprovalContext!;
    const beforeStaleCoordinates = (await json(`/spot-procurements/${id}`, applicant)).body!;
    expect((await json(`/spot-procurements/${id}/approval`, director, "POST", { decision: "approve", comment: "旧坐标", ...firstCoordinates })).status).toBe(409);
    expect(rejectionInvariant((await json(`/spot-procurements/${id}`, applicant)).body!)).toEqual(rejectionInvariant(beforeStaleCoordinates));
    expect((await json(`/spot-procurements/${id}/approval`, manager, "POST", { decision: "approve", comment: "错误越级", ...secondCoordinates })).status).toBe(403);
    expect(rejectionInvariant((await json(`/spot-procurements/${id}`, applicant)).body!)).toEqual(rejectionInvariant(beforeStaleCoordinates));
    expect((await json(`/spot-procurements/${id}/approval`, director, "POST", { decision: "approve", comment: "物资范围已核对", ...secondCoordinates })).status).toBe(201);
    const managerPreflight = await json(`/spot-procurements/${id}`, manager);
    expect(managerPreflight.body).toMatchObject({ approval: { currentNodeName: expect.stringContaining("项目经理") }, reviewApprovalContext: { expectedNodeIndex: 1 } });
    const managerCoordinates = managerPreflight.body!.reviewApprovalContext!;
    const beforeWrongDirector = (await json(`/spot-procurements/${id}`, applicant)).body!;
    expect((await json(`/spot-procurements/${id}/approval`, director, "POST", { decision: "approve", comment: "错误越级", ...managerCoordinates })).status).toBe(403);
    expect(rejectionInvariant((await json(`/spot-procurements/${id}`, applicant)).body!)).toEqual(rejectionInvariant(beforeWrongDirector));
    expect((await json(`/spot-procurements/${id}/approval`, manager, "POST", { decision: "approve", comment: "项目需求确认", ...managerCoordinates })).status).toBe(201);
    const final = await json(`/spot-procurements/${id}`, applicant);
    expect(final.body).toMatchObject({ procurement: { status: "approved_in_progress", statusLabel: "采购已批，办理中" }, currentVersion: { versionNo: 2, reason: "新版补充后采购原因" } });
    expect(final.body!.versions.find((version) => version.versionNo === 1)).toEqual(frozenV1AfterReturn);
    expect(final.body!.lines).toEqual(revisedDraft.lines);
    expect(final.body!.attachments).toEqual(revisedDraft.attachments);
    expect(final.body!.approvalTimeline.map(({ action, comment, roleName }) => ({ action, comment, roleName }))).toEqual([
      { action: "approve", comment: "物资范围已核对", roleName: "物资主管" },
      { action: "approve", comment: "项目需求确认", roleName: "项目经理" }
    ]);
  }, 60_000);

  (enabled ? it : it.skip)("公开链从实付与少货收货到财务登记退款", async () => {
    const id = await createDraft(projectIds.api, "refund");
    expectHttpStatus("采购提交", await json(`/spot-procurements/${id}/submission`, applicant, "POST", {}), 201);
    expectHttpStatus("物资审批", await reviewCurrent(id, director, "approve", "物资确认"), 201);
    expectHttpStatus("项目审批", await reviewCurrent(id, manager, "approve", "项目确认"), 201);
    const approved = (await json(`/spot-procurements/${id}`, applicant)).body!;
    const paymentId = approved.payments[0]!.id;
    const paymentDraft = await json(`/spot-procurement-payments/${paymentId}`, applicant);
    expect(paymentDraft.status).toBe(200);
    const paymentFacts = paymentDraft.body as unknown as { procurementMaterials: Array<{ id: string; approvedQuantity: string }> };
    expectHttpStatus("付款草稿补全", await json(`/spot-procurement-payments/${paymentId}/draft`, applicant, "PATCH", {
      paymentType: "company_direct", merchantName: "合成商户", payeeName: "合成商户",
      paymentLines: [{ procurementLineId: paymentFacts.procurementMaterials[0]!.id, paymentQuantity: "10", unitPrice: "100", expectedInvoiceCondition: "no_invoice" }],
      channels: [{ channelType: "bank_transfer", accountName: "合成商户", accountNumber: "622200001234", bankName: "合成银行", isPrimary: true }],
      paymentMethods: ["bank_transfer"], attachments: [], settlementAmountCents: "100000", supplierBalanceAmountCents: "0",
      paymentPath: "supplier_direct", paymentMethod: "bank_transfer", payeeAccountName: "合成商户", payeeBankName: "合成银行",
      payeeBankAccount: "622200001234", expectedPaymentAt: "2026-09-17", paymentNote: "合成退款链"
    }), 200);
    expectHttpStatus("付款提交", await json(`/spot-procurement-payments/${paymentId}/submission`, applicant, "POST", {}), 201);
    const finance = sessions.get("finance_staff")!;
    const payerCandidates = await json("/company-entities", sessions.get("comprehensive_director")!);
    expect(payerCandidates.status).toBe(200);
    expect((payerCandidates.body as unknown as Array<{ id: string }>).map((candidate) => candidate.id)).toContain(payerCompanyEntityId);
    expectHttpStatus("付款主体补全", await json(`/spot-procurement-payments/${paymentId}/payer`, finance, "PATCH", { companyEntityId: payerCompanyEntityId, paymentMethods: ["bank_transfer"] }), 200);
    for (const role of ["comprehensive_director", "project_manager", "finance_director", "chairman"]) {
      const approvalResult = await json(`/spot-procurement-payments/${paymentId}/approval`, sessions.get(role)!, "POST", { decision: "approve", comment: `${role}合成通过` });
      if (approvalResult.status !== 201) throw new Error(`付款审批 ${role} 失败: ${approvalResult.status} ${safeResponseBody(approvalResult.body)}`);
    }
    const approvedPayment = expectHttpStatus("付款审批结果读取", await json(`/spot-procurement-payments/${paymentId}`, finance), 200);
    const paymentChannels = (approvedPayment.body as unknown as { paymentChannels: Array<{ id: string; channelType: string }> }).paymentChannels;
    expect(paymentChannels).toEqual(expect.arrayContaining([expect.objectContaining({ id: expect.any(String), channelType: "bank_transfer" })]));
    const paymentChannelId = paymentChannels.find((channel) => channel.channelType === "bank_transfer")!.id;
    const executionVoucherKey = randomUUID();
    const paymentVoucher = await uploadFile(`/spot-procurement-payments/${paymentId}/execution-voucher-file-uploads`, finance, "实付凭证.png", executionVoucherKey);
    if (paymentVoucher.status !== 201) throw new Error(`实付凭证上传失败: ${safeResponseBody(paymentVoucher)}`);
    expect(await uploadFile(`/spot-procurement-payments/${paymentId}/execution-voucher-file-uploads`, finance, "实付凭证.png", executionVoucherKey)).toEqual(paymentVoucher);
    const quotaAttachment = await uploadGenericFile(finance, "垫资依据.png");
    if (quotaAttachment.status !== 201) throw new Error(`垫资依据上传失败: ${safeResponseBody(quotaAttachment)}`);
    const quotaRequest = expectHttpStatus("项目垫资申请", await json(`/projects/${projectIds.api}/financing-quotas`, finance, "POST", {
      idempotencyKey: randomUUID(),
      amountCents: "100000",
      reason: "#115 零采退款合成项目垫资额度",
      attachmentFileId: quotaAttachment.id
    }), 201);
    const quotaId = (quotaRequest.body as unknown as { quotaId: string }).quotaId;
    expect(quotaId).toEqual(expect.any(String));
    for (const role of ["finance_director", "chairman"] as const) {
      const capability = expectHttpStatus("垫资审批坐标读取", await json(`/projects/${projectIds.api}/financing-quotas/${quotaId}/review-capability`, sessions.get(role)!), 200);
      const lifecycleToken = (capability.body as unknown as { lifecycleToken: string }).lifecycleToken;
      expectHttpStatus(`垫资审批 ${role}`, await json(`/projects/${projectIds.api}/financing-quotas/${quotaId}/approval`, sessions.get(role)!, "POST", {
        actionId: randomUUID(), expectedLifecycleToken: lifecycleToken, decision: "approve", confirmationPassword: accountPassword
      }), 201);
    }
    const quotaWorkbench = expectHttpStatus("垫资额度公开回读", await json(`/projects/${projectIds.api}/financing-quotas`, finance), 200);
    expect(quotaWorkbench.body).toMatchObject({ rows: [expect.objectContaining({ id: quotaId, status: "approved", availableAmountCents: "100000" })] });
    expectHttpStatus("实际付款登记", await json(`/spot-procurement-payments/${paymentId}/executions`, finance, "POST", {
      amountCents: "100000", paidAt: "2026-09-17", paymentMethod: "bank_transfer", voucherFileId: paymentVoucher.id,
      paymentChannelId, idempotencyKey: randomUUID(), confirmationPassword: accountPassword
    }), 201);

    const receiptImage = await sharp({ create: { width: 320, height: 240, channels: 3, background: "#4f8a5b" } }).png().toBuffer();
    const receiptPhoto = await uploadFile(`/spot-procurements/${id}/receipt-photo-file-uploads`, applicant, "收货现场.png", randomUUID(), receiptImage);
    if (receiptPhoto.status !== 201) throw new Error(`收货照片上传失败: ${safeResponseBody(receiptPhoto)}`);
    expectHttpStatus("收货照片绑定", await json(`/spot-procurements/${id}/receipt/photos`, applicant, "POST", { originalFileId: receiptPhoto.id, source: "camera", category: "material_scene", note: "合成少货" }), 201);
    expectHttpStatus("少货草稿", await json(`/spot-procurements/${id}/receipt/draft`, applicant, "PATCH", {
      note: "少货两袋", lines: [{ procurementLineId: approved.lines[0]!.id, qualifiedQuantity: "8", unqualifiedQuantity: "0", freeGiftQuantity: "0", replenishmentPending: false, discrepancyNote: "少货2袋" }]
    }), 200);
    expectHttpStatus("收货提交", await json(`/spot-procurements/${id}/receipt/submission`, applicant, "POST", {}), 201);
    expectHttpStatus("少货审核", await json(`/spot-procurements/${id}/receipt/review`, director, "POST", { decision: "approved", comment: "确认少货" }), 201);
    expectHttpStatus("差异发起", await json(`/spot-procurements/${id}/discrepancy`, applicant, "POST", { operation: "initiate", resolutionType: "full_refund", note: "商户退还少货差额" }), 201);
    expectHttpStatus("差异物资确认", await json(`/spot-procurements/${id}/discrepancy`, director, "POST", { operation: "confirm", resolutionType: "full_refund", note: "商户退还少货差额" }), 201);
    expect((await json(`/spot-procurements/${id}/receipt`, refundFinance)).status).toBe(403);
    const refundVoucher = await uploadFile(`/spot-procurements/${id}/refund-voucher-file-uploads`, refundFinance, "退款凭证.png");
    if (refundVoucher.status !== 201) throw new Error(`退款凭证上传失败: ${safeResponseBody(refundVoucher)}`);
    const refundKey = randomUUID();
    const refundBody = { amountCents: "20000", receivedAt: "2026-09-17", refundMethod: "bank_transfer", voucherFileId: refundVoucher.id, idempotencyKey: refundKey };
    const beforeWrongRole = (await json(`/spot-procurements/${id}`, applicant)).body!;
    expect((await json(`/spot-procurements/${id}/refunds`, applicant, "POST", refundBody)).status).toBe(403);
    expect(refundInvariant((await json(`/spot-procurements/${id}`, applicant)).body!)).toEqual(refundInvariant(beforeWrongRole));
    expect((await json(`/spot-procurements/${id}/refunds`, refundFinance, "POST", { ...refundBody, amountCents: "19999" })).status).toBe(400);
    expect(refundInvariant((await json(`/spot-procurements/${id}`, applicant)).body!)).toEqual(refundInvariant(beforeWrongRole));
    const refunded = await json(`/spot-procurements/${id}/refunds`, refundFinance, "POST", refundBody);
    expect(refunded).toMatchObject({ status: 201, body: { refund: { id: expect.any(String), amountCents: "20000" }, discrepancy: { status: "resolved" } } });
    const afterFirstRefund = refundInvariant((await json(`/spot-procurements/${id}`, applicant)).body!);
    expect(await json(`/spot-procurements/${id}/refunds`, refundFinance, "POST", refundBody)).toEqual(refunded);
    expectHttpStatus("退款登记人历史付款回读", await json(`/spot-procurement-payments/${paymentId}`, refundFinance), 200);
    expect((await json(`/spot-procurements/${id}/receipt`, refundFinance)).status).toBe(403);
    const afterRefund = (await json(`/spot-procurements/${id}`, applicant)).body!;
    expect(refundInvariant(afterRefund)).toEqual(afterFirstRefund);
    expect(afterRefund).toMatchObject({
      payments: [expect.objectContaining({ id: paymentId, actualPaidAmountCents: "100000", refundAmountCents: "20000", netPaidAmountCents: "80000" })],
      discrepancy: expect.objectContaining({ status: "resolved", refund: expect.objectContaining({ amountCents: "20000" }) })
    });
  }, 90_000);

  async function reviewCurrent(id: string, session: Session, decision: "approve" | "return_to_applicant", comment: string) {
    const detail = await json(`/spot-procurements/${id}`, session);
    return json(`/spot-procurements/${id}/approval`, session, "POST", { decision, comment, ...detail.body!.reviewApprovalContext });
  }

  async function uploadFile(path: string, session: Session, fileName: string, idempotencyKey = randomUUID(), buffer = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=", "base64")) {
    const form = new FormData();
    form.append("file", new Blob([buffer], { type: "image/png" }), fileName);
    form.append("idempotencyKey", idempotencyKey);
    const response = await fetch(`${baseUrl}${path}`, { method: "POST", headers: { authorization: `Bearer ${session.tokens.accessToken}` }, body: form });
    const text = await response.text();
    return { status: response.status, ...(text ? JSON.parse(text) as { id: string } : { id: "" }) };
  }

  async function uploadGenericFile(session: Session, fileName: string) {
    const form = new FormData();
    form.append("file", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=", "base64")], { type: "image/png" }), fileName);
    const response = await fetch(`${baseUrl}/files`, { method: "POST", headers: { authorization: `Bearer ${session.tokens.accessToken}` }, body: form });
    const text = await response.text();
    return { status: response.status, ...(text ? JSON.parse(text) as { id: string } : { id: "" }) };
  }

  (enabled && process.env.RUN_POL115_BROWSER === "1" ? it : it.skip)("桌面和手机走真实零采申请页面", async () => {
    const refundCoordinates = {
      desktop: await prepareAwaitingRefund(projectIds.desktop, "desktop"),
      mobile: await prepareAwaitingRefund(projectIds.mobile, "mobile")
    };
    await new Promise<void>((done, reject) => {
      const env: NodeJS.ProcessEnv = { ...process.env, POL115_API_URL: baseUrl, POL115_BROWSER_SESSION: JSON.stringify(applicant), POL115_SPOT_DIRECTOR_SESSION: JSON.stringify(director), POL115_SPOT_MANAGER_SESSION: JSON.stringify(manager), POL115_SPOT_REFUND_SESSION: JSON.stringify(refundFinance), POL115_SPOT_PROJECT_IDS: JSON.stringify({ desktop: projectIds.desktop, mobile: projectIds.mobile }), POL115_SPOT_REFUND_COORDINATES: JSON.stringify(refundCoordinates), POL115_BROWSER_SPEC: "pol115-spot-procurement-real.e2e.ts" };
      delete env.JEST_WORKER_ID;
      const child = spawn("pnpm", ["exec", "playwright", "test", "--config", "playwright.pol115-real.config.ts", "--grep", "(零采申请退回修订后完成两级审批|付款详情登记退款并回读)"], { cwd: resolve(__dirname, "../../../../apps/web-admin"), env, stdio: "inherit" });
      child.on("error", reject);
      child.on("exit", (code) => code === 0 ? done() : reject(new Error("零采真实浏览器验证失败")));
    });
  }, 180_000);
});
