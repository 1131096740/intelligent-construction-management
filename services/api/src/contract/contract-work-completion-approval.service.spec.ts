import { Prisma } from "@prisma/client";
import { signFundBalanceWitness } from "../fund-account/fund-balance-witness-signing";
import { ContractWorkCompletionApprovalService } from "./contract-work-completion-approval.service";

const witnessKey = "a".repeat(64);

function fixture(author = "author", financeRoleKeys = ["finance_staff"]) {
  const assignments = [
    { userId: "contract", roleKey: "contract_director" },
    { userId: "manager", roleKey: "project_manager" },
    ...financeRoleKeys.map(roleKey => ({ userId: "finance", roleKey }))
  ].map(row => ({ ...row, projectId: "project", userIsActive: true }));
  const draft = { id: "report", work: "试运行", amountYuan: new Prisma.Decimal("100.0123"),
    contractVersionId: "version", createdByUserId: author, status: "draft", approvalInstanceId: null as string | null };
  let round: Record<string, unknown> | null = null;
  let rejectionReason: string | null = null;
  const fact = jest.fn();
  const action = jest.fn();
  const submit = jest.fn();
  const costSnapshot = {
    businessCode: "HT-1", confirmedAt: "2026-11-22T01:02:03.000Z", ownershipAt: "2026-11-01T00:00:00.000Z",
    operatingLedgerEffectiveDate: "2026-11-01T00:00:00.000Z", confirmedByUserId: "manager",
    affiliate: { assignmentId: "assign", businessPartyVersionId: "enterprise", name: "测试施工企业" },
    debtorKind: "participating_company", debtorId: "company", creditorId: "vendor", finalActionId: "last",
    numericFacts: { protocolVersion: 2, amountState: "known", amountYuan: "100.0123" }
  };
  const ledger = { appendConfirmedSourceInTransaction: jest.fn().mockResolvedValue(undefined) };
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(0),
    $queryRaw: jest.fn().mockImplementation(async (query: { sql: string; values: unknown[] } | TemplateStringsArray, ...params: unknown[]) => {
      if (!("sql" in query)) {
        const sql = query.join("?");
        if (sql.includes("pg_current_xact_id")) {
          return [{ database: "synthetic", role: "runtime", xid: "123", backend: "42", expires: "1234567890" }];
        }
        if (sql.includes("public.jg_contract_work_completion_cost_sources_v1")) {
          expect(params).toEqual(["project", null, "report"]);
          return [{ id: "fact", projectId: "project", costSnapshot }];
        }
        if (sql.includes("public.jg_contract_work_completion_view_v1")) {
          const [version, actor, expiry, proof] = params as string[];
          expect(proof).toBe(signFundBalanceWitness(witnessKey, ["contract_work_completion_view_v1",
            "synthetic", "runtime", "123", "42", expiry, version, actor]));
          return [{ result: { projectId: "project", entries: [{ ...draft, amountYuan: draft.amountYuan.toFixed(4),
            exceedsContractAmount: true, applicantUserId: round?.applicantUserId, frozenNodes: round?.frozenNodes,
            rejectionReason }] } }];
        }
        const [operation, version, completion, actor, payload, expiry, proof] = params as (string | null)[];
        expect(sql).toContain("public.jg_contract_work_completion_approval_v1");
        expect(proof).toBe(signFundBalanceWitness(witnessKey, ["contract_work_completion_approval_v1",
          "synthetic", "runtime", "123", "42", expiry, operation, version, completion, actor, payload]));
        if (operation === "lock") return [{ result: { completion: { ...draft }, projectId: "project", round } }];
        const command = JSON.parse(payload!);
        if (operation === "submit") {
          submit();
          rejectionReason = null;
          round = { id: "round", businessType: "contract_work_completion", businessId: draft.id,
            flowType: "contract.work_completion.approve", applicantUserId: actor, frozenNodes: command.nodes, status: "in_progress" };
          Object.assign(draft, { approvalInstanceId: "round", status: "in_approval" });
        } else {
          action({ actorUserId: actor, ...command });
          const final = command.nodes.every((node: { approvedRoleKeys: string[] }) => node.approvedRoleKeys.length);
          draft.status = command.decision === "reject" ? "draft" : final ? "confirmed" : "in_approval";
          if (command.decision === "reject") rejectionReason = command.comment ?? null;
          round = { ...round, frozenNodes: command.nodes };
          if (draft.status === "confirmed") fact(draft.amountYuan);
        }
        return [{ result: { id: draft.id, approvalInstanceId: draft.approvalInstanceId, status: draft.status } }];
      }
      if (query?.sql.includes('FROM "ProjectMember"')) {
        const actor = query.values.find(value => ["outsider", "delegate", "finance", "manager", "contract"].includes(String(value)));
        return assignments.filter(row => actor === undefined || actor === row.userId);
      }
      return [];
    }),
    user: { findUnique: jest.fn().mockResolvedValue({ isActive: true }),
      findMany: jest.fn().mockImplementation(async ({ where }) =>
        where.id.in.map((id: string) => ({ id, isActive: true }))) },
    position: { findUnique: jest.fn().mockResolvedValue({ id: "director-role" }) },
    userPosition: { findFirst: jest.fn().mockResolvedValue(null) },
    projectMember: { findFirst: jest.fn().mockResolvedValue({ id: "member" }) },
    approvalDelegation: { groupBy: jest.fn().mockResolvedValue([]) }
  };
  const auth = { confirmPassword: jest.fn().mockResolvedValue(undefined) };
  const notifications = { queueDuty: jest.fn().mockResolvedValue(undefined),
    queueCorrection: jest.fn().mockResolvedValue(undefined) };
  const prisma = { $transaction: (fn: (db: typeof tx) => unknown) => fn(tx) };
  const service = new ContractWorkCompletionApprovalService(prisma as never, auth as never, ledger as never,
    notifications as never);
  return { service, tx, auth, fact, action, submit, ledger, notifications, prisma };
}

describe("其他合同履约的三个并联职责", () => {
  const originalKey = process.env.CONTRACT_WORK_COMPLETION_WITNESS_KEY;
  beforeEach(() => { process.env.CONTRACT_WORK_COMPLETION_WITNESS_KEY = witnessKey; });
  afterEach(() => {
    if (originalKey === undefined) delete process.env.CONTRACT_WORK_COMPLETION_WITNESS_KEY;
    else process.env.CONTRACT_WORK_COMPLETION_WITNESS_KEY = originalKey;
  });
  it("施工企业关系缺失或中断时返回可办理的原归属提示", async () => {
    const { service, tx } = fixture();
    for (const message of ["合同生效时缺少项目施工企业关系，请核对历史资料",
      "原合同施工企业在履约确认日期已变更，请先核对归属"]) {
      tx.$queryRaw.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("synthetic DB exception", {
        code: "P2010", clientVersion: "5.22.0", meta: { code: "23514", message }
      }));
      await expect(service.view("version", "author")).rejects.toMatchObject({ status: 409, message });
    }
  });

  it("履约详情只向原经办人和有权岗位展示待办，不返回冻结人员资料", async () => {
    const { service } = fixture();
    await expect(service.view("version", "manager")).resolves.toMatchObject({ entries: [] });
    await service.submit("version", "report", "author");
    const visible = await service.view("version", "manager");
    expect(visible.entries).toEqual([expect.objectContaining({
      amountYuan: "100.0123", exceedsContractAmount: true, canSubmit: false,
      duties: [{ index: 1, name: "项目经理", selfReview: false, canReview: true }]
    })]);
    expect(visible.entries[0]).not.toHaveProperty("frozenNodes");
    await expect(service.view("version", "outsider")).resolves.toMatchObject({ entries: [] });
  });

  it("任意顺序确认，三项齐全才写入一次四位履约事实", async () => {
    const { service, fact, submit, ledger, tx } = fixture();
    await expect(service.submit("version", "report", "author")).resolves.toMatchObject({ status: "in_approval", approvalInstanceId: "round" });
    await expect(service.submit("version", "report", "author")).resolves.toMatchObject({ approvalInstanceId: "round" });
    expect(submit).toHaveBeenCalledTimes(1);
    for (const [actor, dutyIndex] of [["finance", 2], ["contract", 0]] as const) {
      await expect(service.review("version", "report", actor, { approvalInstanceId: "round", dutyIndex, decision: "approve" }))
        .resolves.toMatchObject({ status: "in_approval" });
    }
    expect(fact).not.toHaveBeenCalled();
    expect(ledger.appendConfirmedSourceInTransaction).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    const confirm = { approvalInstanceId: "round", dutyIndex: 1, decision: "approve" } as const;
    await expect(service.review("version", "report", "manager", confirm)).resolves.toMatchObject({ status: "confirmed" });
    expect(fact).toHaveBeenCalledTimes(1);
    expect(fact.mock.calls[0][0].toFixed(4)).toBe("100.0123");
    expect(ledger.appendConfirmedSourceInTransaction).toHaveBeenCalledTimes(1);
    expect(ledger.appendConfirmedSourceInTransaction).toHaveBeenCalledWith(tx, expect.objectContaining({
      sourceType: "contract_work_completion", sourceBusinessId: "fact", amountYuan: "100.0123", amountCents: null,
      occurredAt: new Date("2026-11-22T01:02:03.000Z"),
      impacts: [expect.objectContaining({ impactKind: "confirmed_cost", amountYuan: "100.0123",
        subject: { kind: "participating_company", id: "company" }, costCategoryCode: "other_project_cost" })]
    }), "manager");
    expect(tx.$executeRaw.mock.calls[0]?.[0].join("")).toBe('SET CONSTRAINTS "ContractWorkCompletionFact_cost_posting" IMMEDIATE');
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeGreaterThan(ledger.appendConfirmedSourceInTransaction.mock.invocationCallOrder[0]);
    await expect(service.review("version", "report", "manager", confirm)).rejects.toMatchObject({ status: 409 });
    expect(fact).toHaveBeenCalledTimes(1);
  });

  it("财务同一人兼任两岗时按冻结顺序只确认一次，三项齐全才计一次成本", async () => {
    const { service, fact, action, ledger } = fixture("author", ["finance_staff", "finance_director"]);
    await service.submit("version", "report", "author");

    const visible = await service.view("version", "finance");
    expect(visible.entries).toEqual([expect.objectContaining({
      duties: [{ index: 2, name: "财务", selfReview: false, canReview: true }]
    })]);

    const financeApproval = { approvalInstanceId: "round", dutyIndex: 2, decision: "approve" } as const;
    await expect(service.review("version", "report", "finance", financeApproval)).resolves.toMatchObject({ status: "in_approval" });
    expect(action).toHaveBeenLastCalledWith(expect.objectContaining({
      approvedRoleKey: "finance_staff", representedUserId: "finance"
    }));
    await expect(service.review("version", "report", "finance", financeApproval)).rejects.toMatchObject({ status: 409 });
    expect(action).toHaveBeenCalledTimes(1);

    await service.review("version", "report", "contract", { approvalInstanceId: "round", dutyIndex: 0, decision: "approve" });
    await expect(service.review("version", "report", "manager", {
      approvalInstanceId: "round", dutyIndex: 1, decision: "approve"
    })).resolves.toMatchObject({ status: "confirmed" });
    expect(fact).toHaveBeenCalledTimes(1);
    expect(ledger.appendConfirmedSourceInTransaction).toHaveBeenCalledTimes(1);
  });

  it("末岗没有写入成本时，具名约束在成功返回前拒绝该事务", async () => {
    const { service, tx } = fixture();
    await service.submit("version", "report", "author");
    for (const [actor, dutyIndex] of [["finance", 2], ["contract", 0]] as const) {
      await service.review("version", "report", actor, { approvalInstanceId: "round", dutyIndex, decision: "approve" });
    }
    tx.$executeRaw.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("missing cost", {
      code: "P2010", clientVersion: "5.22.0", meta: { code: "23514" }
    }));
    await expect(service.review("version", "report", "manager", {
      approvalInstanceId: "round", dutyIndex: 1, decision: "approve"
    })).rejects.toMatchObject({ status: 409 });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("发起人须二次确认，正常委托留存原岗位身份", async () => {
    const { service, tx, auth, action, fact } = fixture("contract");
    await service.submit("version", "report", "contract");
    const approval = { approvalInstanceId: "round", dutyIndex: 0, decision: "approve" } as const;
    await expect(service.review("version", "report", "contract", approval)).rejects.toMatchObject({ status: 400 });
    await service.review("version", "report", "contract", {
      ...approval, selfReviewReason: "本次复核", confirmationPassword: "synthetic"
    });
    expect(auth.confirmPassword).toHaveBeenCalledTimes(1);
    tx.approvalDelegation.groupBy.mockResolvedValueOnce([{ fromUserId: "manager" }]);
    await service.review("version", "report", "delegate", { ...approval, dutyIndex: 1 });
    expect(action).toHaveBeenLastCalledWith(expect.objectContaining({
      actorUserId: "delegate", representedUserId: "manager", approvedRoleKey: "project_manager"
    }));
    expect(fact).not.toHaveBeenCalled();
  });

  it("三职责待办与驳回回制单的短信在业务事务内入队", async () => {
    const { service, tx, notifications } = fixture();
    await service.submit("version", "report", "author");
    expect(notifications.queueDuty).toHaveBeenCalledTimes(1);
    expect(notifications.queueDuty).toHaveBeenCalledWith(tx, "report", "round");
    const rejection = { approvalInstanceId: "round", dutyIndex: 1, decision: "reject", comment: "需核对" } as const;
    await service.review("version", "report", "manager", rejection);
    expect(notifications.queueCorrection).toHaveBeenCalledTimes(1);
    expect(notifications.queueCorrection).toHaveBeenCalledWith(tx, "report", "round");
  });

  it("业务写入失败时不入队，提交事务回滚也不留下待办短信", async () => {
    const { service, tx, notifications } = fixture();
    tx.$queryRaw.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("lock failed", {
      code: "P2010", clientVersion: "5.22.0", meta: { code: "23514" }
    }));
    await expect(service.submit("version", "report", "author")).rejects.toMatchObject({ status: 409 });
    expect(notifications.queueDuty).not.toHaveBeenCalled();
    expect(notifications.queueCorrection).not.toHaveBeenCalled();
    // 提交成功但事务在 COMMIT 时失败（可串行化冲突）：通知只随同一事务写入，不单独提交。
    const rollback = fixture();
    const transaction = async (fn: (db: typeof rollback.tx) => Promise<unknown>) => {
      await fn(rollback.tx);
      throw new Prisma.PrismaClientKnownRequestError("serialization failure", { code: "P2034", clientVersion: "5.22.0" });
    };
    const rebased = new ContractWorkCompletionApprovalService({ $transaction: transaction } as never,
      { confirmPassword: jest.fn() } as never, rollback.ledger as never, rollback.notifications as never);
    await expect(rebased.submit("version", "report", "author")).rejects.toMatchObject({ status: 409 });
    expect(rollback.notifications.queueDuty).toHaveBeenCalledWith(rollback.tx, "report", "round");
  });

  it.each(["40001", "40P01"])("事务竞争 %s 回滚后重试同一审批职责", async (sqlState) => {
    const { service, tx, action } = fixture();
    await service.submit("version", "report", "author");
    tx.$queryRaw.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("transaction aborted", {
      code: "P2010", clientVersion: "5.22.0", meta: { code: sqlState }
    }));
    await expect(service.review("version", "report", "manager", {
      approvalInstanceId: "round", dutyIndex: 1, decision: "approve"
    })).resolves.toMatchObject({ status: "in_approval" });
    expect(action).toHaveBeenCalledTimes(1);
    await expect(service.review("version", "report", "manager", {
      approvalInstanceId: "round", dutyIndex: 1, decision: "approve"
    })).rejects.toMatchObject({ status: 409 });
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("驳回后制单人看到原因并可修订，确认后不可再修订", async () => {
    const { service } = fixture();
    await service.submit("version", "report", "author");
    await service.review("version", "report", "manager", {
      approvalInstanceId: "round", dutyIndex: 1, decision: "reject", comment: "请核对工作量"
    });
    const returned = await service.view("version", "author");
    expect(returned.entries).toEqual([expect.objectContaining({
      status: "draft", canRevise: true, canSubmit: true, rejectionReason: "请核对工作量"
    })]);
  });

  it("任一职责驳回退回原草稿，项目外无法操作", async () => {
    const { service, fact } = fixture();
    await service.submit("version", "report", "author");
    const rejection = { approvalInstanceId: "round", dutyIndex: 1, decision: "reject", comment: "需核对" } as const;
    await expect(service.review("version", "report", "outsider", rejection)).rejects.toMatchObject({ status: 403 });
    await expect(service.review("version", "report", "manager", rejection)).resolves.toMatchObject({ status: "draft" });
    expect(fact).not.toHaveBeenCalled();
  });
});
