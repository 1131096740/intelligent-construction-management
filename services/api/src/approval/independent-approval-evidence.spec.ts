import { invalidateIndependentApproval, recordIndependentApproval } from "./independent-approval-evidence";
import { finalApprovalEvidence } from "./approval-evidence";

function database() {
  let instance: Record<string, unknown> | null = null;
  const actions: Array<Record<string, unknown>> = [];
  const names: Record<string, string> = { applicant: "申请人甲", finance: "财务甲", contract: "合同乙" };
  let signatureVersion = "signature-v1";
  const tx = {
    $queryRaw: jest.fn(async (query) => {
      const sql = query.strings.join("?");
      if (sql.includes('FROM "User"')) return [{ id: query.values[0], isActive: true, name: names[query.values[0]] }];
      if (sql.includes('FROM "HandwrittenSignatureVersion"')) return [{ id: signatureVersion, fileId: signatureVersion, contentSha256: "a".repeat(64) }];
      return [{ id: signatureVersion, storageStatus: "active", contentSha256: "a".repeat(64) }];
    }),
    user: { findUnique: jest.fn(async ({ where }) => ({ name: names[where.id] })) },
    approvalInstance: {
      findFirst: jest.fn(async () => instance),
      create: jest.fn(async ({ data }) => (instance = { id: "instance-1", ...data })),
      update: jest.fn(async ({ data }) => (instance = { ...instance, ...data }))
    },
    approvalActionLog: { create: jest.fn(async ({ data }) => {
      const action = { id: `action-${actions.length + 1}`, ...data };
      actions.push(action); return action;
    }) }
  };
  return { tx, actions, names, getInstance: () => instance!, setSignature: (version: string) => { signatureVersion = version; } };
}

const nodes = [
  { name: "财务主管", mode: "any" as const, roleKeys: ["finance_director"] },
  { name: "合同部主管", mode: "any" as const, roleKeys: ["contract_director"] }
];
const base = {
  businessType: "contract_tax_fact_revision", businessId: "revision-1", applicantUserId: "applicant",
  actorUserId: "finance", roleKey: "finance_director", nodeName: "财务主管", nodes,
  signedAt: new Date("2026-10-20T01:00:00Z"),
  form: { title: "历史税务事实审批单", code: "税务修订1", projectId: "project-1", companyName: "建设公司", summary: [{ label: "税率", value: "13%" }] }
};

describe("independent approvals record actual signatures", () => {
  it("only finishes after both real stages and preserves each historical identity and signature version", async () => {
    const db = database();
    await recordIndependentApproval(db.tx as never, base);
    expect(db.getInstance().status).toBe("in_progress");
    expect(() => finalApprovalEvidence("in_progress", nodes, db.actions as never)).toThrow("最终审批通过");
    db.names.finance = "财务后来改名";
    db.setSignature("signature-v2");
    await recordIndependentApproval(db.tx as never, { ...base, actorUserId: "contract", roleKey: "contract_director", nodeName: "合同部主管", stageIndex: 1, signedAt: new Date("2026-10-20T02:00:00Z") });
    expect(db.getInstance().status).toBe("approved");
    const effective = finalApprovalEvidence("approved", nodes, db.actions as never);
    expect(effective).toHaveLength(2);
    expect(db.actions[0]).toMatchObject({ actorUserId: "finance", signatureVersionIdSnapshot: "signature-v1", metadata: { approverName: "财务甲" }, createdAt: base.signedAt });
    expect(db.actions[1]).toMatchObject({ actorUserId: "contract", signatureVersionIdSnapshot: "signature-v2", metadata: { approverName: "合同乙" } });
  });

  it("does not invent a missing first stage for a historical in-flight approval", async () => {
    const db = database();
    await expect(recordIndependentApproval(db.tx as never, { ...base, actorUserId: "contract", roleKey: "contract_director", stageIndex: 1 }))
      .rejects.toThrow("前序审批签名证据缺失");
    expect(db.tx.approvalInstance.create).not.toHaveBeenCalled();
    expect(db.actions).toEqual([]);
  });

  it("keeps distinct signed actions when an applicant directly holds both approval roles", async () => {
    const db = database();
    await recordIndependentApproval(db.tx as never, { ...base, actorUserId: "applicant" });
    await recordIndependentApproval(db.tx as never, { ...base, actorUserId: "applicant", roleKey: "contract_director", nodeName: "合同部主管", stageIndex: 1 });
    expect(finalApprovalEvidence("approved", nodes, db.actions as never)).toHaveLength(2);
    await expect(recordIndependentApproval(db.tx as never, base)).rejects.toThrow("审批签名证据已变化");
    expect(db.tx.approvalInstance.create).toHaveBeenCalledTimes(1);
    expect(db.actions).toHaveLength(2);
  });
});

describe("source approval invalidation", () => {
  it.each(["spot_procurement_receipt", "no_invoice_confirmation", "invoice_exception_confirmation"])("keeps signed history but blocks formal output after %s is reversed", async businessType => {
    const db = database();
    await recordIndependentApproval(db.tx as never, { ...base, businessType, nodes: [nodes[0]] });
    const signed = { ...db.actions[0] };
    await invalidateIndependentApproval(db.tx as never, { businessType, businessId: base.businessId,
      actorUserId: "finance", reason: "更正原业务事实", invalidatedAt: new Date("2026-10-21T00:00:00Z") });
    expect(db.getInstance().status).toBe("terminated");
    expect(db.actions[0]).toEqual(signed);
    expect(db.actions[1]).toMatchObject({ action: "void", actorUserId: "finance" });
    expect(() => finalApprovalEvidence(db.getInstance().status as string, [nodes[0]], db.actions as never)).toThrow();
  });
  it("does not manufacture evidence when historical facts have no instance", async () => {
    const db = database();
    await invalidateIndependentApproval(db.tx as never, { businessType: "spot_procurement_receipt", businessId: "legacy",
      actorUserId: "finance", reason: "撤销", invalidatedAt: new Date() });
    expect(db.tx.approvalInstance.create).not.toHaveBeenCalled();
    expect(db.actions).toEqual([]);
  });
});
