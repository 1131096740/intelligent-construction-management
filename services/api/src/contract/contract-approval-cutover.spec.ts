import { createHash, randomUUID } from "node:crypto";
import { hash } from "bcryptjs";
import { PDFDocument } from "pdf-lib";
import { isFormalApprovalV6 } from "../approval/approval-pdf-watermark";
import type { INestApplication } from "@nestjs/common";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { OperationalWriteFreezeService } from "../operational-write-freeze/operational-write-freeze.service";
import { AuditService } from "../audit/audit.service";
import { FileService, PrivateFileStorage } from "../file/file.service";
import { activateLegacyContractApprovalCutover, inspectLegacyContractApprovalCutover, inspectLegacyContractApprovalInventory } from "./contract-approval-cutover";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=",
  "base64"
);
const contentSha256 = createHash("sha256").update(png).digest("hex");

function fixture() {
  const node = (name: string, role: string, scope: "global" | "project", userId: string) => ({
    name, mode: "any", roleKeys: [role],
    candidateUserIds: [userId], candidateUserIdsByRole: { [role]: [userId] }, roleScopesByRole: { [role]: scope }
  });
  const nodes = [
    node("合同部主管", "contract_director", "global", "contract-director"),
    node("项目经理", "project_manager", "project", "manager"),
    node("财务主管", "finance_director", "global", "finance"),
    {
      name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"],
      candidateUserIds: ["executive"], candidateUserIdsByRole: { chairman: ["executive"], general_manager: [] },
      roleScopesByRole: { chairman: "global", general_manager: "global" }
    }
  ].map(node => ({ ...node, originatorUserIds: ["applicant"] }));
  const round = {
    id: "legacy-round", businessId: "version", status: "in_progress", currentNodeIndex: 1,
    frozenNodes: nodes, updatedAt: new Date("2026-11-22T00:00:01Z")
  };
  const version = { status: "in_approval", numericProtocolVersion: 1, updatedAt: new Date("2026-11-22T00:00:00Z") };
  const action = {
    id: "original-approval", action: "approve", actorUserId: "contract-director",
    representedUserId: "contract-director", approvedRoleKey: "contract_director", signatureFileIdSnapshot: "file",
    signatureVersionIdSnapshot: "signature", signatureSha256Snapshot: contentSha256,
    metadata: { approverName: "原合同主管" }
  };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ readOnly: "on" }]),
    contractVersion: {
      findUnique: jest.fn().mockResolvedValue(version),
      findMany: jest.fn().mockResolvedValue([{ id: round.businessId }])
    },
    approvalInstance: { findMany: jest.fn().mockResolvedValue([round]), update: jest.fn() },
    user: { findUnique: jest.fn().mockResolvedValue({ isActive: true }) },
    approvalActionLog: { findMany: jest.fn().mockResolvedValue([action]) },
    approvalDelegation: { findFirst: jest.fn().mockResolvedValue(null) },
    handwrittenSignatureVersion: { findUnique: jest.fn().mockResolvedValue({ fileId: "file", userId: "contract-director", source: "canvas", contentSha256 }) }
  };
  const prisma = { $transaction: jest.fn((run: (client: typeof tx) => unknown) => run(tx)) };
  const files = { getFileBuffer: jest.fn().mockResolvedValue({ file: { storageStatus: "active", contentSha256 }, buffer: png }) };
  const inspect = () => inspectLegacyContractApprovalCutover(prisma as never, files, round.businessId);
  return { tx, prisma, files, nodes, round, version, action, inspect };
}

describe("read-only historical contract approval cutover", () => {
  it("maps the actual serial cursor and frozen candidates without rewriting the ordered duties or signing history", async () => {
    const { nodes, round, action, prisma, inspect } = fixture();
    const original = structuredClone({ round, action });
    await expect(inspect()).resolves.toEqual({
      status: "planned", approvalInstanceId: "legacy-round", frozenNodes: nodes,
      completedActionIds: ["original-approval"], pendingNodeIndexes: [1, 2, 3]
    });
    expect({ round, action }).toEqual(original);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead
    });
  });

  it("activates only the exact restored version and unsigned executive round while retaining the original completed duty", async () => {
    const { tx, prisma, files, round, version, nodes, action } = fixture();
    const audit = { record: jest.fn() };
    const freeze = new OperationalWriteFreezeService();
    const expected = { approvalInstanceId: round.id, versionUpdatedAt: version.updatedAt, approvalUpdatedAt: round.updatedAt };
    const env = jest.replaceProperty(process, "env", { ...process.env,
      OPERATIONAL_WRITE_FREEZE_MODE: "modules", OPERATIONAL_WRITE_FREEZE_MODULES: "payment" });
    try {
      await expect(activateLegacyContractApprovalCutover(prisma as never, files, audit,
        "operator", round.businessId, expected, freeze)).rejects.toMatchObject({ status: 409 });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      process.env.OPERATIONAL_WRITE_FREEZE_MODULES = "contract";
      await expect(activateLegacyContractApprovalCutover(prisma as never, files, audit,
        "operator", round.businessId, { ...expected, versionUpdatedAt: new Date(0) }, freeze)).rejects.toMatchObject({ status: 409 });
      expect(tx.approvalInstance.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
      await expect(activateLegacyContractApprovalCutover(prisma as never, files, audit,
        "operator", round.businessId, expected, freeze)).resolves.toEqual({ approvalInstanceId: round.id });
    } finally {
      env.restore();
    }
    expect(tx.approvalInstance.update).toHaveBeenCalledWith({
      where: { id: round.id },
      data: { frozenNodes: nodes.map((node, index) => ({
        ...node, protocolVersion: 1, executionMode: "parallel", legacyContractCutover: true,
        approvedRoleKeys: index === 0 ? ["contract_director"] : []
      })) }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: "contract.approval.legacy_cutover", metadata: expect.objectContaining({ completedActionIds: [action.id] })
    }));
  });

  it("does not infer retroactive principals for an ownerless role-only round", async () => {
    const { round, files, inspect } = fixture();
    round.currentNodeIndex = 0;
    round.frozenNodes = [{
      name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"],
      roleScopesByRole: { chairman: "global", general_manager: "global" }
    }] as typeof round.frozenNodes;
    await expect(inspect()).resolves.toEqual({ status: "blocked", reason: "unproven_frozen_principals" });
    expect(files.getFileBuffer).not.toHaveBeenCalled();
  });

  it("does not substitute a signer, skip a restored duty, or discard a reset action", async () => {
    const { tx, action, inspect } = fixture();
    tx.approvalActionLog.findMany.mockResolvedValueOnce([{ ...action, approvedRoleKey: "finance_director" }]);
    await expect(inspect()).resolves.toEqual({ status: "blocked", reason: "ambiguous_action_history" });
    tx.approvalActionLog.findMany.mockResolvedValueOnce([]);
    await expect(inspect()).resolves.toEqual({ status: "blocked", reason: "ambiguous_action_history" });
    tx.approvalActionLog.findMany.mockResolvedValueOnce([action, { id: "bounce", action: "reject_previous" }]);
    await expect(inspect()).resolves.toEqual({ status: "blocked", reason: "ambiguous_action_history" });
  });

  it("blocks current or historical delegation and an ambiguous active round", async () => {
    const { tx, action, round, inspect } = fixture();
    tx.approvalDelegation.findFirst.mockResolvedValueOnce({ id: "standing-delegation" });
    await expect(inspect()).resolves.toEqual({ status: "blocked", reason: "legacy_assignment" });
    tx.approvalActionLog.findMany.mockResolvedValueOnce([{ ...action, actorUserId: "delegate", representedUserId: action.actorUserId }]);
    await expect(inspect()).resolves.toEqual({ status: "blocked", reason: "legacy_assignment" });
    tx.approvalInstance.findMany.mockResolvedValueOnce([round, { ...round, id: "second-round" }]);
    await expect(inspect()).resolves.toEqual({ status: "blocked", reason: "active_round_not_unique" });
  });

  it("requires the exact persisted signature version and verifies the original file bytes", async () => {
    const { tx, files, inspect } = fixture();
    tx.handwrittenSignatureVersion.findUnique.mockResolvedValueOnce({ fileId: "new-file", userId: "contract-director", source: "canvas", contentSha256 });
    await expect(inspect()).resolves.toEqual({ status: "blocked", reason: "invalid_signature_evidence" });
    files.getFileBuffer.mockResolvedValueOnce({ file: { storageStatus: "active", contentSha256 }, buffer: Buffer.from("different bytes") });
    await expect(inspect()).resolves.toEqual({ status: "blocked", reason: "invalid_signature_evidence" });
  });

  it("counts planned and blocked versions from one read-only snapshot and omits their identifiers", async () => {
    const { tx, prisma, files } = fixture();
    tx.contractVersion.findMany.mockResolvedValueOnce([{ id: "signed-contract" }, { id: "missing-image" }]);
    files.getFileBuffer.mockResolvedValueOnce({ file: { storageStatus: "active", contentSha256 }, buffer: png })
      .mockRejectedValueOnce(new Error("私有文件不存在"));
    await expect(inspectLegacyContractApprovalInventory(prisma as never, files)).resolves.toEqual({
      total: 2, planned: 1, blocked: 1, blockedByReason: { signature_file_unavailable: 1 }
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("refuses to inventory contracts from a writable transaction", async () => {
    const { tx, prisma, files } = fixture();
    tx.$queryRaw.mockResolvedValueOnce([{ readOnly: "off" }]);
    await expect(inspectLegacyContractApprovalInventory(prisma as never, files)).rejects.toThrow("合同审批迁移盘点必须使用只读事务");
    expect(tx.contractVersion.findMany).not.toHaveBeenCalled();
  });
});

const postgres = process.env.ISSUE424_CONTRACT_PLAN_OWNER_URL ? it : it.skip;
postgres("inventories original evidence and exercises the actual frozen and reopened approval HTTP endpoint on PG16", async () => {
  const ownerUrl = new URL(process.env.ISSUE424_CONTRACT_PLAN_OWNER_URL!);
  const readerUrl = new URL(process.env.ISSUE424_CONTRACT_PLAN_READER_URL!);
  if (process.env.NODE_ENV !== "test" || [ownerUrl, readerUrl].some(url =>
    url.hostname !== "127.0.0.1" || url.pathname !== "/jg424_contract_plan" || url.port !== ownerUrl.port)) {
    throw new Error("只允许使用本机一次性合同审批规划专库");
  }
  const owner = new PrismaClient({ datasources: { db: { url: ownerUrl.href } } });
  const reader = new PrismaClient({ datasources: { db: { url: readerUrl.href } } });
  const root = await mkdtemp(join(tmpdir(), "jg424-contract-plan-files-"));
  const objectKey = "original-signature.png";
  const env = jest.replaceProperty(process, "env", { ...process.env, DATABASE_URL: ownerUrl.href,
    FILE_STORAGE_DRIVER: "local", FILE_STORAGE_ROOT: root, JWT_ACCESS_SECRET: randomUUID(), JWT_REFRESH_SECRET: randomUUID(),
    FILE_DOWNLOAD_SECRET: randomUUID(), SMS_ENABLED: "false", APPROVAL_SMS_ENABLED: "false" });
  let app: INestApplication | undefined;
  try {
    expect(await reader.$queryRaw`SELECT current_user AS role, current_setting('default_transaction_read_only') AS "readOnly"`)
      .toEqual([{ role: "jg424_contract_reader", readOnly: "on" }]);
    const { nodes: frozen, action: evidence } = fixture();
    const applicant = await owner.user.create({ data: { name: "合成合同员" } });
    const nodes = frozen.map(node => ({ ...node, originatorUserIds: [applicant.id] }));
    const signer = await owner.user.create({ data: { id: evidence.actorUserId, name: "原合同主管" } });
    const project = await owner.project.create({ data: { code: "I424-CON", name: "合同审批迁移合成项目" } });
    const company = await owner.companyEntity.create({ data: { name: "隔离签约公司" } });
    const contract = await owner.contract.create({ data: {
      projectId: project.id, ownerUserId: applicant.id, code: "I424-CON-01", name: "待审批合同", counterparty: "合成相对方"
    } });
    const version = await owner.contractVersion.create({ data: {
      contractId: contract.id, versionNo: 1, changeType: "original", status: "in_approval",
      numericProtocolVersion: 1, contractGovernanceVersion: 1, signingSubjectType: "our_company",
      companyEntityIdSnapshot: company.id, companyEntityNameSnapshot: company.name,
      amountCents: 100n, draftData: { contractName: "原合同测试名称", partyValues: { party_b: "原签约相对方" } },
      templateSnapshot: {}, clauseSnapshot: []
    } });
    await owner.paymentTermsVersion.create({ data: {
      contractId: contract.id, contractVersionId: version.id, versionNo: 1, status: "draft", originalText: "虚构付款条款"
    } });
    const round = await owner.approvalInstance.create({ data: {
      businessType: "contract_version", businessId: version.id, flowType: "contract.approve", status: "in_progress",
      applicantUserId: applicant.id, currentNodeIndex: 1, frozenNodes: nodes as unknown as Prisma.InputJsonValue
    } });
    const storage = new PrivateFileStorage();
    const files = new FileService(reader as never, new AuditService(), storage);
    await storage.write(objectKey, png);
    const file = await owner.fileObject.create({ data: {
      bucket: storage.bucketName(), objectKey, originalName: objectKey, mimeType: "image/png", sizeBytes: png.length,
      uploadedByUserId: signer.id, contentSha256
    } });
    const signature = await owner.handwrittenSignatureVersion.create({ data: { userId: signer.id, fileId: file.id, contentSha256 } });
    const action = await owner.approvalActionLog.create({ data: {
      ...evidence, signatureFileIdSnapshot: file.id, signatureVersionIdSnapshot: signature.id, approvalInstanceId: round.id
    } });
    await expect(inspectLegacyContractApprovalCutover(reader, files, version.id)).resolves.toEqual({
      status: "planned", approvalInstanceId: round.id, frozenNodes: nodes, completedActionIds: [action.id], pendingNodeIndexes: [1, 2, 3]
    });
    await expect(inspectLegacyContractApprovalInventory(reader, files)).resolves.toEqual({
      total: 1, planned: 1, blocked: 0, blockedByReason: {}
    });
    expect(await owner.approvalInstance.findUniqueOrThrow({ where: { id: round.id } })).toEqual(round);
    expect(await owner.approvalActionLog.findMany({ where: { approvalInstanceId: round.id } })).toEqual([action]);

    const audit = new AuditService();
    const ownerFiles = new FileService(owner as never, audit, storage);
    const coordinates = { approvalInstanceId: round.id, versionUpdatedAt: version.updatedAt, approvalUpdatedAt: round.updatedAt };
    const freeze = new OperationalWriteFreezeService();
    process.env.OPERATIONAL_WRITE_FREEZE_MODE = "off";
    delete process.env.OPERATIONAL_WRITE_FREEZE_MODULES;
    await expect(activateLegacyContractApprovalCutover(owner, ownerFiles, audit, applicant.id, version.id,
      coordinates, freeze)).rejects.toMatchObject({ status: 409 });
    expect(await owner.approvalInstance.findUniqueOrThrow({ where: { id: round.id } })).toEqual(round);
    process.env.OPERATIONAL_WRITE_FREEZE_MODE = "modules";
    process.env.OPERATIONAL_WRITE_FREEZE_MODULES = "contract";
    await expect(activateLegacyContractApprovalCutover(owner, ownerFiles, audit, applicant.id, version.id,
      { ...coordinates, approvalInstanceId: "previous-round" }, freeze)).rejects.toMatchObject({ status: 409 });
    await expect(activateLegacyContractApprovalCutover(owner, ownerFiles, audit, applicant.id, version.id,
      coordinates, freeze)).resolves.toEqual({ approvalInstanceId: round.id });

    const password = "Fixture-Issue424-Local";
    const passwordHash = await hash(password, 4);
    const createApprover = async (id: string, role: string, phone: string) => {
      const user = await owner.user.create({ data: { id, name: "隔离审批人 " + id, phone, passwordHash, mustChangePassword: false } });
      if (role === "project_manager") {
        await owner.projectMember.create({ data: { projectId: project.id, userId: id, positionKey: role } });
      } else {
        const position = await owner.position.findUnique({ where: { key: role } }) ??
          await owner.position.create({ data: { key: role, name: role } });
        await owner.userPosition.create({ data: { userId: id, positionId: position.id } });
      }
      const key = id + ".png";
      await storage.write(key, png);
      const privateFile = await owner.fileObject.create({ data: {
        bucket: storage.bucketName(), objectKey: key, originalName: key, mimeType: "image/png", sizeBytes: png.length,
        uploadedByUserId: id, contentSha256
      } });
      await owner.handwrittenSignatureVersion.create({ data: { userId: id, fileId: privateFile.id, contentSha256 } });
      return user;
    };
    const executive = await createApprover("executive", "chairman", "13900004231");
    const wrongExecutive = await createApprover("not-frozen-chairman", "chairman", "13900004232");
    const finance = await createApprover("finance", "finance_director", "13900004233");
    const manager = await createApprover("manager", "project_manager", "13900004234");
    const { NestFactory } = await import("@nestjs/core");
    const { AppModule } = await import("../app.module");
    const { apiJsonReplacer } = await import("../api-json-replacer");
    const { createApiValidationPipe } = await import("../validation/api-validation");
    app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
    app.getHttpAdapter().getInstance().set("json replacer", apiJsonReplacer);
    app.useGlobalPipes(createApiValidationPipe());
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl();
    const post = (route: string, body: object, token?: string) => fetch(base + route, { method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
      body: JSON.stringify(body)
    });
    const login = async (phone: string | null) => {
      const response = await post("/auth/login", { phone, password });
      expect(response.status).toBe(201);
      return (await response.json() as { tokens: { accessToken: string } }).tokens.accessToken;
    };
    const [executiveToken, otherExecutiveToken, financeToken, managerToken] =
      await Promise.all([executive, wrongExecutive, finance, manager].map(user => login(user.phone)));
    const review = (body: object, token?: string) => post(`/contracts/${version.id}/approval`, body, token);
    const get = (route: string, token: string) => fetch(base + route, { headers: { Authorization: "Bearer " + token } });
    const reviewCoordinates = async (index: number) => {
      return {
        expectedContractUpdatedAt: (await owner.contractVersion.findUniqueOrThrow({ where: { id: version.id } })).updatedAt.toISOString(),
        expectedApprovalInstanceId: round.id, expectedNodeIndex: index,
        expectedApprovalUpdatedAt: (await owner.approvalInstance.findUniqueOrThrow({ where: { id: round.id } })).updatedAt.toISOString()
      };
    };
    const beforeExecutive = await reviewCoordinates(3);
    const reviewOwnerRisk = {
      ...beforeExecutive, decision: "approve" as const, ownerContractRiskConfirmed: true,
      expectedOwnerContractRisk: {
        status: "missing_owner_contract" as const, ownerContractAmountCents: "0", downstreamContractAmountCents: "100",
        excessAmountCents: "100", message: "项目尚未登记生效业主主合同，本次合同终审必须显式确认风险。",
        requiresExplicitConfirmation: true
      }
    };
    expect((await review(reviewOwnerRisk, executiveToken)).status).toBe(503);
    process.env.OPERATIONAL_WRITE_FREEZE_MODE = "off";
    delete process.env.OPERATIONAL_WRITE_FREEZE_MODULES;
    expect((await review(reviewOwnerRisk)).status).toBe(401);
    expect((await review(reviewOwnerRisk, otherExecutiveToken)).status).toBe(403);

    const detailResponse = await get(`/contracts/${contract.id}`, executiveToken);
    expect(detailResponse.status).toBe(200);
    const detail = await detailResponse.json();
    expect(detail).toMatchObject({
      reviewApprovalContext: beforeExecutive,
      ownerContractRisk: { status: "missing_owner_contract", requiresExplicitConfirmation: true },
      availableActions: expect.arrayContaining([expect.objectContaining({ key: "download_approval_form", enabled: true })])
    });
    const progressRoute = `/approval-progress/${round.id}`;
    const progressResponse = await get(progressRoute, executiveToken);
    expect(progressResponse.status).toBe(200);
    expect(await progressResponse.json()).toMatchObject({
      canHandle: true, parallelCompletion: { completed: 1, total: 4 },
      pendingRecipients: expect.arrayContaining([expect.objectContaining({ id: executive.id })])
    });
    expect((await get(progressRoute, otherExecutiveToken)).status).toBe(404);
    const pdfPath = `/approval-forms/contract_version/${version.id}`;
    const formCapability = await get(pdfPath + "/capability", executiveToken);
    expect(formCapability.status).toBe(200);
    expect(await formCapability.json()).toEqual({ available: true, incomplete: true });
    const downloadBody = { confirmationPassword: password, downloadReason: "核对接续审批记录" };
    expect((await post(pdfPath + "/download", downloadBody, otherExecutiveToken)).status).toBe(403);
    const pdfResponse = await post(pdfPath + "/download", downloadBody, executiveToken);
    expect(pdfResponse.status).toBe(201);
    expect(pdfResponse.headers.get("content-type")).toContain("application/pdf");
    expect(pdfResponse.headers.get("cache-control")).toBe("no-store");
    expect(decodeURIComponent(pdfResponse.headers.get("content-disposition") ?? "")).toContain("审批未完成-审批单-I424-CON-01.pdf");
    const pdf = Buffer.from(await pdfResponse.arrayBuffer());
    expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThan(0);
    expect(await isFormalApprovalV6(pdf)).toBe(false);
    expect(await owner.auditLog.count({ where: { action: "approval.form.download", businessId: version.id } })).toBe(1);
    expect(await owner.pdfDocument.count({ where: { businessType: "contract_version", businessId: version.id } })).toBe(0);

    expect((await review({ ...reviewOwnerRisk, expectedApprovalUpdatedAt: round.updatedAt.toISOString() }, executiveToken)).status).toBe(409);
    const approvedEarly = await review(reviewOwnerRisk, executiveToken);
    expect(approvedEarly.status).toBe(201);
    expect(await approvedEarly.json()).toMatchObject({ status: "in_approval" });
    expect((await review({ ...reviewOwnerRisk, ...await reviewCoordinates(3) }, executiveToken)).status).toBe(403);
    const marked = await owner.approvalInstance.findUniqueOrThrow({ where: { id: round.id } });
    const markedNodes = marked.frozenNodes as Prisma.JsonObject[];
    await owner.approvalInstance.update({ where: { id: round.id }, data: {
      frozenNodes: markedNodes.map((node, index) => index === 0 ? { ...node, originatorUserIds: [] } : node)
    } });
    const inconsistent = await get(progressRoute, managerToken);
    expect(inconsistent.status).toBe(200);
    expect(await inconsistent.json()).toMatchObject({ canHandle: false, pendingRecipients: [], canRemind: false });
    const reviewWhileInconsistent = await review({ ...await reviewCoordinates(1), decision: "approve" }, managerToken);
    expect(reviewWhileInconsistent.status).toBe(409);
    await owner.approvalInstance.update({ where: { id: round.id }, data: { frozenNodes: markedNodes as Prisma.InputJsonArray } });

    const managerCoordinates = await reviewCoordinates(1);
    expect((await review({ ...managerCoordinates, decision: "reject_previous", comment: "核对合同资料" }, managerToken)).status).toBe(400);
    const approvedManager = await review({ ...managerCoordinates, decision: "approve" }, managerToken);
    expect(approvedManager.status).toBe(201);
    expect(await approvedManager.json()).toMatchObject({ status: "in_approval" });

    const competing = await owner.contract.create({ data: {
      projectId: project.id, ownerUserId: applicant.id, code: "I424-CON-02", name: "风险变更测试合同", counterparty: "合成相对方"
    } });
    const competingVersion = await owner.contractVersion.create({ data: {
      contractId: competing.id, versionNo: 1, changeType: "original", status: "in_approval",
      signingSubjectType: "our_company", amountCents: 20n, draftData: {}, templateSnapshot: {}, clauseSnapshot: []
    } });
    const financeRequest = { ...await reviewCoordinates(2), decision: "approve" as const };
    const beforeMismatch = await owner.approvalActionLog.findMany({ where: { approvalInstanceId: round.id }, orderBy: { id: "asc" } });
    const mismatch = await review(financeRequest, financeToken);
    expect(mismatch.status).toBe(409);
    expect(await mismatch.json()).toMatchObject({ code: "CONTRACT_OWNER_RISK_SNAPSHOT_CONFLICT" });
    expect(await reviewCoordinates(2)).toEqual({
      expectedContractUpdatedAt: financeRequest.expectedContractUpdatedAt, expectedApprovalInstanceId: round.id,
      expectedNodeIndex: 2, expectedApprovalUpdatedAt: financeRequest.expectedApprovalUpdatedAt
    });
    expect(await owner.approvalActionLog.findMany({ where: { approvalInstanceId: round.id }, orderBy: { id: "asc" } })).toEqual(beforeMismatch);
    expect(await owner.contractSealTask.count({ where: { approvalInstanceId: round.id } })).toBe(0);

    // Restore the identical fixture state to prove same-risk completion; this is not a business recovery path.
    await owner.contractVersion.update({ where: { id: competingVersion.id }, data: { status: "draft" } });
    const approvedFinal = await review(financeRequest, financeToken);
    expect(approvedFinal.status).toBe(201);
    expect(await approvedFinal.json()).toMatchObject({ status: "approved_pending_seal" });
    expect(await owner.contractSealTask.findUnique({ where: { approvalInstanceId: round.id } }))
      .toMatchObject({ status: "pending_approval", handlerUserId: applicant.id });
    expect(await owner.approvalActionLog.findUnique({ where: { id: action.id } })).toEqual(action);
    expect((await ownerFiles.getFileBuffer(file.id)).buffer).toEqual(png);
    expect(await owner.approvalActionLog.count({ where: { approvalInstanceId: round.id, action: "approve" } })).toBe(4);
  } finally {
    try { await app?.close(); }
    finally {
      env.restore();
      await Promise.all([
        owner.$disconnect(), reader.$disconnect(), rm(root, { recursive: true, force: true })
      ]);
    }
  }
}, 20_000);
