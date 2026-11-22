import { BadRequestException, ForbiddenException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AuthService } from "../auth/auth.service";
import type { ProjectVisibilityService } from "../auth/project-visibility.service";
import type { PrismaService } from "../database/prisma.service";
import { SignedContractSettlementService } from "./signed-contract-settlement.service";

const base = {
  id: "settlement",
  projectId: "project",
  contractId: "contract",
  contractKind: "downstream",
  ownerUserId: "staff",
  number: "原纸质编号",
  amountYuan: new Prisma.Decimal("-8"),
  state: "pending_review",
  revision: 2,
  attachments: [{ fileId: "file", sha256: "a".repeat(64), file: { originalName: "原件.pdf", storageStatus: "active", contentSha256: "a".repeat(64) } }]
};

function fixture() {
  const tx = {
    project: { findFirst: jest.fn().mockResolvedValue({ id: "project" }) },
    contract: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue({ id: "contract", contractTypeKey: "equipment_rental", name: "设备合同", counterparty: "设备公司" }) },
    contractPartySnapshot: { findFirst: jest.fn().mockResolvedValue({ businessPartyVersionId: "supplier-v1" }) },
    contractVersion: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue({ id: "contract-v2", versionNo: 2, signingSubjectType: "our_company", companyEntityVersionId: "payer-v1", companyEntityIdSnapshot: "our-company", companyEntityNameSnapshot: "施工公司" }) },
    projectAffiliateContractFact: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue({
      id: "outside-original", externalContractReference: "表外合同", documentVersion: 3, contractType: "equipment_rental",
      affiliateBusinessPartyVersionId: "affiliate-v1", counterpartyVersionId: "supplier-v2"
    }) },
    projectAffiliateCompanyContract: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue({
      id: "upward-original", contractName: "对上合同", documentVersion: 2,
      affiliateBusinessPartyVersionId: "affiliate-v1", companyEntityVersionId: "participating-company-v1"
    }) },
    projectAffiliateSettlementFact: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]), groupBy: jest.fn().mockResolvedValue([]) },
    contractTakeover: { findMany: jest.fn().mockResolvedValue([]) },
    settlement: { aggregate: jest.fn().mockResolvedValue({ _sum: { amountCents: 1000n } }) },
    fileObject: { findMany: jest.fn().mockResolvedValue([{ id: "file", contentSha256: "a".repeat(64), mimeType: "application/pdf" }]) },
    signedContractSettlementAttachment: { findFirst: jest.fn().mockResolvedValue(null), createMany: jest.fn() },
    signedContractSettlement: {
      create: jest.fn().mockResolvedValue({ id: "settlement" }),
      findFirst: jest.fn().mockResolvedValue(base),
      findMany: jest.fn().mockResolvedValue([{ ...base, reviewedAt: new Date("2026-11-22"), confirmationNo: 1n }]),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amountYuan: null }, _max: { confirmationNo: null } }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 })
    },
    $queryRaw: jest.fn().mockResolvedValue([])
  };
  const user = { findUnique: jest.fn() };
  const auth = { confirmPassword: jest.fn() };
  const prisma = { user, $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)) };
  const visibility = { effectiveRoleKeysByProjectInTransaction: jest.fn().mockResolvedValue(new Map([["project", ["contract_director"]]])) };
  const svc = new SignedContractSettlementService(prisma as unknown as PrismaService, visibility as unknown as ProjectVisibilityService, auth as unknown as AuthService);
  return { svc, tx, visibility, user, auth };
}

describe("已签结算复核业务", () => {
  it("沿用原合同选择接口读取受限岗位的三类项目合同", async () => {
    const { svc, tx } = fixture();
    const priorKey = process.env.SIGNED_SETTLEMENT_ATTACHMENT_WITNESS_KEY;
    process.env.SIGNED_SETTLEMENT_ATTACHMENT_WITNESS_KEY = "a".repeat(64);
    try {
      const binding = { database: "isolated", role: "runtime", xid: "88", backend: "5", expires: "1795370000" };
      const result = [
        { id: "downstream", kind: "downstream", relationship: "inside", label: "表内合同" },
        { id: "outside", kind: "outside_fact", relationship: "outside", label: "表外合同" },
        { id: "upward", kind: "upward", relationship: "upward", label: "对上合同" }
      ];
      tx.$queryRaw.mockResolvedValueOnce([binding]).mockResolvedValueOnce([{ result }]);
      await expect(svc.contracts("project", "staff")).resolves.toEqual(result);
      expect(tx.$queryRaw).toHaveBeenNthCalledWith(2, expect.arrayContaining([expect.stringContaining("jg_signed_settlement_contract_read_v1")]),
        "project", "staff", "picker", null, null, binding.expires, expect.stringMatching(/^[a-f0-9]{64}$/));
    } finally {
      if (priorKey === undefined) delete process.env.SIGNED_SETTLEMENT_ATTACHMENT_WITNESS_KEY;
      else process.env.SIGNED_SETTLEMENT_ATTACHMENT_WITNESS_KEY = priorKey;
    }
  });

  it("合同概览由定向投影合并正式累计和历史起点", async () => {
    const { svc, tx } = fixture();
    const priorKey = process.env.SIGNED_SETTLEMENT_ATTACHMENT_WITNESS_KEY;
    process.env.SIGNED_SETTLEMENT_ATTACHMENT_WITNESS_KEY = "a".repeat(64);
    try {
      const binding = { database: "isolated", role: "runtime", xid: "88", backend: "5", expires: "1795370000" };
      tx.$queryRaw.mockResolvedValueOnce([binding]).mockResolvedValueOnce([{ projection: { confirmedYuan: "70.0001", canReadSignedAttachments: true, rows: [] } }])
        .mockResolvedValueOnce([binding]).mockResolvedValueOnce([{result:{contractVersionId:"contract-v2",originalFileId:null,relationship:"inside",name:"设备合同"}}]);
      const result = await svc.overview("project", "director", "downstream", "contract");
      expect(result.confirmedYuan).toBe("70.0001");
      expect(tx.$queryRaw).toHaveBeenNthCalledWith(2, expect.arrayContaining([expect.stringContaining("jg_signed_settlement_confirmed_projection_v1")]),
        "project", "director", "downstream", "contract", "overview", binding.expires, expect.stringMatching(/^[a-f0-9]{64}$/));
      expect(tx.signedContractSettlement.aggregate).not.toHaveBeenCalled();
      expect(tx.settlement.aggregate).not.toHaveBeenCalled();
    } finally {
      if (priorKey === undefined) delete process.env.SIGNED_SETTLEMENT_ATTACHMENT_WITNESS_KEY;
      else process.env.SIGNED_SETTLEMENT_ATTACHMENT_WITNESS_KEY = priorKey;
    }
  });

  it("使用定向复核入口，不直接修改结算表", async () => {
    const { svc, tx } = fixture();
    const oldKey = process.env.SIGNED_SETTLEMENT_DRAFT_WITNESS_KEY;
    process.env.SIGNED_SETTLEMENT_DRAFT_WITNESS_KEY = "b".repeat(64);
    try {
      const binding = { database: "isolated", role: "runtime", xid: "88", backend: "5", expires: "1795370000" };
      const reviewed = { id: "settlement", state: "confirmed", confirmationNo: "1" };
      tx.$queryRaw.mockResolvedValueOnce([binding]).mockResolvedValueOnce([{ reviewed }]);
      await expect(svc.review("project", "settlement", "director", 2, "confirm")).resolves.toEqual(reviewed);
      expect(tx.$queryRaw).toHaveBeenNthCalledWith(2, expect.arrayContaining([expect.stringContaining("jg_review_signed_settlement_draft_v1")]),
        "project", "settlement", "director", 2, "confirm", null, false, binding.expires, expect.stringMatching(/^[a-f0-9]{64}$/));
      expect(tx.signedContractSettlement.updateMany).not.toHaveBeenCalled();
      } finally {
      if (oldKey === undefined) delete process.env.SIGNED_SETTLEMENT_DRAFT_WITNESS_KEY;
      else process.env.SIGNED_SETTLEMENT_DRAFT_WITNESS_KEY = oldKey;
    }
  });

  it("事务外验证自审密码，只把验证结果与见证传给数据库", async () => {
    const { svc, tx, auth, user } = fixture();
    const oldKey = process.env.SIGNED_SETTLEMENT_DRAFT_WITNESS_KEY;
    process.env.SIGNED_SETTLEMENT_DRAFT_WITNESS_KEY = "b".repeat(64);
    try {
      const binding = { database: "isolated", role: "runtime", xid: "88", backend: "5", expires: "1795370000" };
      user.findUnique.mockResolvedValue({ isActive: true, passwordHash: "credential-fingerprint" });
      tx.$queryRaw.mockResolvedValueOnce([binding]).mockResolvedValueOnce([{ reviewed: { state: "returned" } }]);
      await expect(svc.review("project", "settlement", "director", 2, "return", "  原因  ", "本人密码")).resolves.toEqual({ state: "returned" });
      expect(auth.confirmPassword).toHaveBeenCalledWith("director", "本人密码", expect.any(Object));
      expect(auth.confirmPassword.mock.invocationCallOrder[0]).toBeLessThan(tx.$queryRaw.mock.invocationCallOrder[0]);
      expect(tx.$queryRaw).toHaveBeenNthCalledWith(2, expect.arrayContaining([expect.stringContaining("jg_review_signed_settlement_draft_v1")]),
        "project", "settlement", "director", 2, "return", "原因", true, binding.expires, expect.stringMatching(/^[a-f0-9]{64}$/));
    } finally {
      if (oldKey === undefined) delete process.env.SIGNED_SETTLEMENT_DRAFT_WITNESS_KEY;
      else process.env.SIGNED_SETTLEMENT_DRAFT_WITNESS_KEY = oldKey;
    }
  });
});

describe("已签结算付款依据附件", () => {
  it.each([
    ["project_manager", false, []],
    ["contract_staff", true, ["file"]]
  ])("按项目岗位 %s 的定向投影返回付款依据", async (role, canRead, fileIds) => {
    const { svc, tx } = fixture();
    const priorKey = process.env.SIGNED_SETTLEMENT_ATTACHMENT_WITNESS_KEY;
    process.env.SIGNED_SETTLEMENT_ATTACHMENT_WITNESS_KEY = "a".repeat(64);
    try {
      const binding = { database: "isolated", role: "runtime", xid: "88", backend: "5", expires: "1795370000" };
      tx.$queryRaw.mockResolvedValueOnce([binding]).mockResolvedValueOnce([{ projection: {
        confirmedYuan: "2.0000", canReadSignedAttachments: canRead,
        rows: [{ id: "signed", number: "original", amountYuan: "-8.0000", confirmedAt: "2026-11-22T00:00:00.000Z", confirmationNo: "1", attachmentFileIds: ["file"] }]
      } }]).mockResolvedValueOnce([binding]).mockResolvedValueOnce([{result:{contractVersionId:null,originalFileId:"contract-evidence",relationship:"upward"}}]);
      tx.projectAffiliateSettlementFact.findMany.mockResolvedValueOnce([{
        id: "legacy", periodLabel: "原结算", amountCents: 1000n, effectDirection: "increase",
        confirmedAt: new Date("2026-11-21T00:00:00.000Z"), evidenceFileId: "legacy-evidence"
      }]);
      const result = await svc.paymentBasis("project", role, "upward", "contract");

      expect(result.canReadSignedAttachments).toBe(canRead);
      expect(result.latestConfirmed).toMatchObject({ amountYuan: "-8.0000", attachmentFileIds: fileIds });
      expect(result.confirmedHistory[0]).toMatchObject({ attachmentFileIds: canRead ? ["legacy-evidence"] : [] });
      expect(result.contractAttachmentIds).toEqual(canRead ? ["contract-evidence"] : []);
      expect(tx.signedContractSettlement.findMany).not.toHaveBeenCalled();
    } finally {
      if (priorKey === undefined) delete process.env.SIGNED_SETTLEMENT_ATTACHMENT_WITNESS_KEY;
      else process.env.SIGNED_SETTLEMENT_ATTACHMENT_WITNESS_KEY = priorKey;
    }
  });
});

describe("受限岗位保存已签结算草稿", () => {
  const keySetting = "SIGNED_SETTLEMENT_DRAFT_WITNESS_KEY";
  const binding = { database: "isolated", role: "isolated_attachment_runtime", xid: "88", backend: "5", expires: "1795370000" };
  const input = { contractKind: "downstream" as const, contractId: "contract", number: "原纸质编号", amountYuan: "1.0001", fileIds: ["file"] };
  let oldKey: string | undefined;

  beforeEach(() => {
    oldKey = process.env[keySetting];
    process.env[keySetting] = "b".repeat(64);
  });
  afterEach(() => {
    if (oldKey === undefined) delete process.env[keySetting];
    else process.env[keySetting] = oldKey;
  });

  it("只使用绑定经办人、项目、草稿版本和附件的同事务入口", async () => {
    const { svc, tx, visibility } = fixture();
    const draft = { id: "settlement", contractKind: "downstream", contractId: "contract", state: "draft", amountYuan: "1.0001" };
    tx.$queryRaw.mockResolvedValueOnce([binding]).mockResolvedValueOnce([{ draft }]);
    await expect(svc.save("project", "staff", input, "settlement", 2)).resolves.toEqual(draft);
    expect(tx.$queryRaw).toHaveBeenNthCalledWith(2, expect.arrayContaining([expect.stringContaining("jg_save_signed_settlement_draft_v1")]),
      "project", "staff", "settlement", 2, "downstream", "contract", input.number, "1.0001", '["file"]',
      binding.expires, expect.stringMatching(/^[a-f0-9]{64}$/));
    expect(tx.signedContractSettlement.create).not.toHaveBeenCalled();
    expect(tx.signedContractSettlement.updateMany).not.toHaveBeenCalled();
    expect(tx.fileObject.findMany).not.toHaveBeenCalled();
    expect(visibility.effectiveRoleKeysByProjectInTransaction).not.toHaveBeenCalled();
  });

  it("提交只调用绑定原草稿与修订号的定向入口，并返回正式累计和本单预计累计", async () => {
    const { svc, tx } = fixture();
    const submitted = { id: "settlement", revision: 3, state: "pending_review", confirmedYuan: "10.0000", expectedYuan: "2.0000" };
    tx.$queryRaw.mockResolvedValueOnce([binding]).mockResolvedValueOnce([{ submitted }]);
    await expect(svc.submit("project", "settlement", "staff", 2)).resolves.toEqual(submitted);
    expect(tx.$queryRaw).toHaveBeenNthCalledWith(2, expect.arrayContaining([expect.stringContaining("jg_submit_signed_settlement_draft_v1")]),
      "project", "settlement", "staff", 2, binding.expires, expect.stringMatching(/^[a-f0-9]{64}$/));
    expect(tx.signedContractSettlement.updateMany).not.toHaveBeenCalled();
  });

  it("签发配置缺失时拒绝保存，并拒绝重复附件", async () => {
    const { svc, tx } = fixture();
    delete process.env[keySetting];
    await expect(svc.save("project", "staff", input)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(svc.save("project", "staff", { ...input, fileIds: ["file", "file"] })).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
});

describe("已签结算附件专用元数据读取", () => {
  const key = "a".repeat(64);
  const binding = { database: "isolated", role: "isolated_attachment_runtime", xid: "88", backend: "5", expires: "1795370000" };
  let previousKey: string | undefined;
  beforeEach(() => {
    previousKey = process.env.SIGNED_SETTLEMENT_ATTACHMENT_WITNESS_KEY;
    process.env.SIGNED_SETTLEMENT_ATTACHMENT_WITNESS_KEY = key;
  });
  afterEach(() => {
    if (previousKey === undefined) delete process.env.SIGNED_SETTLEMENT_ATTACHMENT_WITNESS_KEY;
    else process.env.SIGNED_SETTLEMENT_ATTACHMENT_WITNESS_KEY = previousKey;
  });

  it("在同事务使用经办人及项目、结算和原件组合签发附件读取见证", async () => {
    const { svc, tx } = fixture();
    const metadata = { fileId: "file", originalName: "原件.pdf", mimeType: "application/pdf" };
    tx.$queryRaw.mockResolvedValueOnce([binding]).mockResolvedValueOnce([metadata]);
    expect(await svc.attachmentMetadata("project", "settlement", "file", "staff")).toEqual(metadata);
    expect(tx.$queryRaw).toHaveBeenNthCalledWith(2, expect.arrayContaining([expect.stringContaining("jg_read_signed_settlement_attachment_metadata_v1")]),
      "project", "settlement", "file", "staff", binding.expires, expect.stringMatching(/^[a-f0-9]{64}$/));
  });

  it("普通角色没有匹配附件，以及应用见证未配置时拒绝读取", async () => {
    const { svc, tx } = fixture();
    tx.$queryRaw.mockResolvedValueOnce([binding]).mockResolvedValueOnce([]);
    await expect(svc.attachmentMetadata("project", "settlement", "file", "other")).rejects.toBeInstanceOf(ForbiddenException);
    delete process.env.SIGNED_SETTLEMENT_ATTACHMENT_WITNESS_KEY;
    await expect(svc.attachmentMetadata("project", "settlement", "file", "staff")).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  });
});

describe("受限岗位读取原结算工作台列表", () => {
  it("按项目和经办人签发只读见证，并沿用原列表响应", async () => {
    const { svc, tx, visibility } = fixture();
    const previousKey = process.env.SIGNED_SETTLEMENT_ATTACHMENT_WITNESS_KEY;
    process.env.SIGNED_SETTLEMENT_ATTACHMENT_WITNESS_KEY = "a".repeat(64);
    try {
      const binding = { database: "isolated", role: "runtime", xid: "88", backend: "5", expires: "1795370000" };
      const rows = [{ id: "visible-draft", state: "draft", canUpdate: true, canReview: false }];
      tx.$queryRaw.mockResolvedValueOnce([binding]).mockResolvedValueOnce([{ rows }]);
      await expect(svc.list("project", "staff")).resolves.toEqual(rows);
      expect(tx.$queryRaw).toHaveBeenNthCalledWith(2, expect.arrayContaining([expect.stringContaining("jg_list_signed_settlements_v1")]),
        "project", "staff", binding.expires, expect.stringMatching(/^[a-f0-9]{64}$/));
      expect(tx.signedContractSettlement.findMany).not.toHaveBeenCalled();
      expect(visibility.effectiveRoleKeysByProjectInTransaction).not.toHaveBeenCalled();
    } finally {
      if (previousKey === undefined) delete process.env.SIGNED_SETTLEMENT_ATTACHMENT_WITNESS_KEY;
      else process.env.SIGNED_SETTLEMENT_ATTACHMENT_WITNESS_KEY = previousKey;
    }
  });
});
