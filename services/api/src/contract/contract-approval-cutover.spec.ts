import { createHash } from "node:crypto";
import { mkdtemp, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { FileService, PrivateFileStorage } from "../file/file.service";
import { inspectLegacyContractApprovalCutover, inspectLegacyContractApprovalInventory } from "./contract-approval-cutover";

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
  ];
  const round = {
    id: "legacy-round", businessId: "version", status: "in_progress", currentNodeIndex: 1, frozenNodes: nodes
  };
  const action = {
    id: "original-approval", action: "approve", actorUserId: "contract-director",
    representedUserId: "contract-director", approvedRoleKey: "contract_director", signatureFileIdSnapshot: "file",
    signatureVersionIdSnapshot: "signature", signatureSha256Snapshot: contentSha256,
    metadata: { approverName: "原合同主管" }
  };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ readOnly: "on" }]),
    contractVersion: {
      findUnique: jest.fn().mockResolvedValue({ status: "in_approval", numericProtocolVersion: 1 }),
      findMany: jest.fn().mockResolvedValue([{ id: round.businessId }])
    },
    approvalInstance: { findMany: jest.fn().mockResolvedValue([round]) },
    approvalActionLog: { findMany: jest.fn().mockResolvedValue([action]) },
    approvalDelegation: { findFirst: jest.fn().mockResolvedValue(null) },
    handwrittenSignatureVersion: { findUnique: jest.fn().mockResolvedValue({ fileId: "file", userId: "contract-director", source: "canvas", contentSha256 }) }
  };
  const prisma = { $transaction: jest.fn((run: (client: typeof tx) => unknown) => run(tx)) };
  const files = { getFileBuffer: jest.fn().mockResolvedValue({ file: { storageStatus: "active", contentSha256 }, buffer: png }) };
  const inspect = () => inspectLegacyContractApprovalCutover(prisma as never, files, round.businessId);
  return { tx, prisma, files, nodes, round, action, inspect };
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
postgres("reads the old signed round and private image on PG16 with a read-only database role", async () => {
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
  const env = jest.replaceProperty(process, "env", { ...process.env, FILE_STORAGE_DRIVER: "local", FILE_STORAGE_ROOT: root });
  try {
    expect(await reader.$queryRaw`SELECT current_user AS role, current_setting('default_transaction_read_only') AS "readOnly"`)
      .toEqual([{ role: "jg424_contract_reader", readOnly: "on" }]);
    const { nodes, action: evidence } = fixture();
    const applicant = await owner.user.create({ data: { name: "合成合同员" } });
    const signer = await owner.user.create({ data: { id: evidence.actorUserId, name: "原合同主管" } });
    const project = await owner.project.create({ data: { code: "I424-CON", name: "合同审批迁移合成项目" } });
    const contract = await owner.contract.create({ data: {
      projectId: project.id, ownerUserId: applicant.id, code: "I424-CON-01", name: "待审批合同", counterparty: "合成相对方"
    } });
    const version = await owner.contractVersion.create({ data: {
      contractId: contract.id, versionNo: 1, changeType: "original", status: "in_approval",
      numericProtocolVersion: 1, amountCents: 100n, draftData: {}, templateSnapshot: {}, clauseSnapshot: []
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
  } finally {
    env.restore();
    await Promise.all([
      owner.$disconnect(), reader.$disconnect(), rm(join(root, objectKey), { force: true }).then(() => rmdir(root))
    ]);
  }
});
