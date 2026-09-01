import { Prisma } from "@prisma/client";

import { ClearingService } from "./clearing.service";

const COMMAND_ID = "11111111-1111-4111-8111-111111111111";

function serviceWith<TTx extends Record<string, unknown> = Record<string, never>>(input?: {
  roles?: string[];
  roleScopesByUser?: Record<string, string[]>;
  prisma?: Record<string, unknown>;
  tx?: TTx;
  ledgerResult?: { id: string; impactIds: string[] };
  authorities?: { resolveCaseSelection: jest.Mock };
}) {
  const tx = input?.tx ?? ({} as TTx);
  const prisma = {
    ...(input?.prisma ?? {}),
    $transaction: jest.fn(async (work: (client: unknown) => Promise<unknown>, options: unknown) => {
      expect(options).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return work(tx);
    })
  };
  const roleResolver = {
    resolveActiveRoleScopes: jest.fn().mockImplementation((userId: string) =>
      Promise.resolve(
        input?.roleScopesByUser?.[userId] ?? input?.roles ?? ["finance_director"]
      )
    )
  };
  const ledger = {
    appendConfirmedSourceInTransaction: jest.fn().mockResolvedValue(
      input?.ledgerResult ?? { id: "fact-1", impactIds: ["impact-1", "impact-2"] }
    )
  };
  const audit = { record: jest.fn().mockResolvedValue({ id: "audit-1" }) };
  return {
    service: new ClearingService(prisma as never, roleResolver as never, ledger as never, audit as never, input?.authorities as never),
    prisma,
    roleResolver,
    ledger,
    audit,
    tx
  };
}

describe("ClearingService", () => {
  it("requires #214 controlled categories to use a server authority selectionRef", async () => {
    const { service } = serviceWith();

    await expect(service.createCase("finance-1", {
      idempotencyKey: COMMAND_ID,
      expectedRevision: 0,
      category: "deposit"
    })).rejects.toThrow("#214 清算必须使用服务端 authority selectionRef");
  });

  it("derives #214 case coordinates and cap from the authority service", async () => {
    const txClient = {
      clearingCommandReceipt: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "receipt-1" })
      },
      projectAffiliateAssignment: { findFirst: jest.fn().mockResolvedValue({ id: "assignment-1" }) },
      clearingCase: { create: jest.fn().mockImplementation(({ data }) => ({ ...data, revision: 1 })) },
      auditLog: { create: jest.fn().mockResolvedValue({ id: "audit-1" }) }
    };
    const authorities = {
      resolveCaseSelection: jest.fn().mockResolvedValue({
        projectId: "project-authoritative",
        constructionEnterpriseAssignmentId: "assignment-authoritative",
        category: "deposit",
        governedSubjectKey: "construction_enterprise_guarantee/project-authoritative/assignment-authoritative/obl-1",
        authoritativeGrossCapCents: 50000n,
        currencyCode: "CNY",
        authorityVersionId: "authority-1",
        authoritySnapshotRef: "acv_public-snapshot",
        sourceDiscriminator: "construction_enterprise_guarantee",
        coverageKind: "ROLE_SUMMARY",
        periodStart: null
      })
    };
    const { service, tx } = serviceWith({ tx: txClient, authorities });

    await service.createCase("finance-1", {
      idempotencyKey: COMMAND_ID,
      expectedRevision: 0,
      category: "deposit",
      authoritySelectionRef: "fac1.short-lived"
    });

    expect(authorities.resolveCaseSelection).toHaveBeenCalledWith("finance-1", expect.objectContaining({ selectionRef: "fac1.short-lived" }), "deposit", undefined);
    expect(authorities.resolveCaseSelection).toHaveBeenLastCalledWith(
      "finance-1",
      expect.objectContaining({ selectionRef: "fac1.short-lived" }),
      "deposit",
      tx
    );
    expect(tx.clearingCase.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "project-authoritative",
        constructionEnterpriseAssignmentId: "assignment-authoritative",
        governedSubjectKey: "construction_enterprise_guarantee/project-authoritative/assignment-authoritative/obl-1",
        authoritativeGrossCapCents: 50000n,
        authorityVersionId: "authority-1",
        sourceDiscriminator: "construction_enterprise_guarantee"
      })
    });
  });

  it("derives #214 event amount, evidence level and snapshot on the server", async () => {
    const txClient = {
      clearingCommandReceipt: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "receipt-1" })
      },
      $queryRaw: jest.fn().mockResolvedValue([{ id: "case-1" }]),
      clearingCase: {
        findUnique: jest.fn().mockResolvedValue({
          id: "case-1",
          projectId: "project-1",
          constructionEnterpriseAssignmentId: "assignment-1",
          revision: 1,
          authoritativeGrossCapCents: 12345n,
          sourceDiscriminator: "construction_enterprise_assigned_wage",
          authoritySnapshotRef: "acv-snapshot",
          coverageKind: "PERSON"
        }),
        update: jest.fn().mockResolvedValue({ revision: 2 })
      },
      clearingEvent: { create: jest.fn().mockImplementation(({ data }) => data) },
      clearingEventVersion: { create: jest.fn().mockImplementation(({ data }) => data) },
      auditLog: { create: jest.fn().mockResolvedValue({ id: "audit-1" }) }
    };
    const { service, tx } = serviceWith({ tx: txClient });

    await service.createEvent("finance-1", "case-1", {
      idempotencyKey: COMMAND_ID,
      expectedRevision: 1,
      kind: "withheld",
      businessReason: "按已确认权威工资来源生成暂扣"
    });

    expect(tx.clearingEventVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amountCents: 12345n,
        evidenceLevel: "A",
        payableRef: null,
        payloadSnapshot: {
          sourceDiscriminator: "construction_enterprise_assigned_wage",
          authoritySnapshotRef: "acv-snapshot",
          businessReason: "按已确认权威工资来源生成暂扣"
        }
      })
    });
  });

  it("rejects client JSON and payable references for #214 events before writing", async () => {
    const tx = {
      clearingCommandReceipt: { findUnique: jest.fn().mockResolvedValue(null) },
      $queryRaw: jest.fn().mockResolvedValue([{ id: "case-1" }]),
      clearingCase: {
        findUnique: jest.fn().mockResolvedValue({
          id: "case-1",
          revision: 1,
          authoritativeGrossCapCents: 12345n,
          sourceDiscriminator: "construction_enterprise_guarantee",
          authoritySnapshotRef: "acv-snapshot",
          coverageKind: "ROLE_SUMMARY"
        })
      }
    };
    const { service } = serviceWith({ tx });

    await expect(service.createEvent("finance-1", "case-1", {
      idempotencyKey: COMMAND_ID,
      expectedRevision: 1,
      kind: "withheld",
      amountCents: "100",
      payableRef: "payable-must-not-be-accepted",
      payload: { authoritativeGrossCapCents: 100 },
      businessReason: "测试"
    })).rejects.toThrow("#214 不接受客户端应付或付款引用");
  });

  it("requires revision zero when creating a new case", async () => {
    const { service } = serviceWith();

    await expect(
      service.createCase("finance-1", {
        idempotencyKey: COMMAND_ID,
        expectedRevision: 1,
        projectId: "project-1",
        constructionEnterpriseAssignmentId: "assignment-1",
        category: "management_fee",
        governedSubjectKey: "管理费-2026",
        authoritativeGrossCapCents: "100000"
      })
    ).rejects.toThrow("新建清算事项的 expectedRevision 必须为 0");
  });

  it("rejects cent amounts that cannot fit the PostgreSQL bigint contract", async () => {
    const { service } = serviceWith();

    await expect(
      service.createCase("finance-1", {
        idempotencyKey: COMMAND_ID,
        expectedRevision: 0,
        projectId: "project-1",
        constructionEnterpriseAssignmentId: "assignment-1",
        category: "management_fee",
        governedSubjectKey: "管理费-2026",
        authoritativeGrossCapCents: "9223372036854775808"
      })
    ).rejects.toThrow("金额超过数据库整数分上限");
  });

  it("does not coerce JSON numbers into the integer-cent string contract", async () => {
    const { service } = serviceWith();

    await expect(
      service.createCase("finance-1", {
        idempotencyKey: COMMAND_ID,
        expectedRevision: 0,
        projectId: "project-1",
        constructionEnterpriseAssignmentId: "assignment-1",
        category: "management_fee",
        governedSubjectKey: "管理费-2026",
        authoritativeGrossCapCents: 100 as never
      })
    ).rejects.toThrow("金额必须是正整数分字符串");
  });

  it("creates a natural-key case and its replay receipt in one serializable transaction", async () => {
    const tx = {
      clearingCommandReceipt: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "receipt-1" })
      },
      projectAffiliateAssignment: {
        findFirst: jest.fn().mockResolvedValue({ id: "assignment-1" })
      },
      clearingCase: {
        create: jest.fn().mockImplementation(({ data }) => ({ ...data, revision: 1 }))
      },
      auditLog: { create: jest.fn().mockResolvedValue({ id: "audit-1" }) }
    };
    const { service, prisma, roleResolver } = serviceWith({ tx });

    const result = await service.createCase("finance-1", {
      idempotencyKey: COMMAND_ID,
      expectedRevision: 0,
      projectId: "project-1",
      constructionEnterpriseAssignmentId: "assignment-1",
      category: "management_fee",
      governedSubjectKey: "管理费-2026",
      authoritativeGrossCapCents: "100000"
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(roleResolver.resolveActiveRoleScopes).toHaveBeenCalledTimes(2);
    expect(tx.clearingCase.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "project-1",
        constructionEnterpriseAssignmentId: "assignment-1",
        authoritativeGrossCapCents: 100000n
      })
    });
    expect(tx.clearingCommandReceipt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        idempotencyKey: COMMAND_ID,
        action: "clearing.case.create",
        expectedRevision: 0
      })
    });
    expect(result).toEqual(expect.objectContaining({ projectId: "project-1", revision: 1 }));
  });

  it("accepts only an exact scoped one-hop delegation and records both actors", async () => {
    const tx = {
      clearingCommandReceipt: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "receipt-1" })
      },
      projectAffiliateAssignment: {
        findFirst: jest.fn().mockResolvedValue({ id: "assignment-1" })
      },
      clearingCase: {
        create: jest.fn().mockImplementation(({ data }) => ({ ...data, revision: 1 }))
      },
      auditLog: { create: jest.fn().mockResolvedValue({ id: "audit-1" }) }
    };
    const approvalDelegation = {
      findMany: jest.fn().mockResolvedValue([{ fromUserId: "director-1" }])
    };
    const { service } = serviceWith({
      tx,
      prisma: {
        approvalDelegation,
        user: {
          findMany: jest.fn().mockResolvedValue([
            { id: "delegate-1", isActive: true },
            { id: "director-1", isActive: true }
          ])
        }
      },
      roleScopesByUser: {
        "delegate-1": [],
        "director-1": ["finance_director"]
      }
    });

    await service.createCase("delegate-1", {
      idempotencyKey: COMMAND_ID,
      expectedRevision: 0,
      delegatorUserId: "director-1",
      projectId: "project-1",
      constructionEnterpriseAssignmentId: "assignment-1",
      category: "management_fee",
      governedSubjectKey: "管理费-2026",
      authoritativeGrossCapCents: "100000"
    });

    expect(approvalDelegation.findMany).toHaveBeenCalledWith({
      where: {
        toUserId: "delegate-1",
        actionKey: "clearing.prepare",
        resourceType: "clearing_project",
        resourceId: "project-1",
        enabled: true,
        startsAt: { lte: expect.any(Date) },
        endsAt: { gte: expect.any(Date) }
      },
      select: { fromUserId: true }
    });
    expect(tx.clearingCommandReceipt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "delegate-1",
        delegatorUserId: "director-1"
      })
    });
  });

  it("fails closed when the submitted handler and confirmer actor sets overlap", async () => {
    const tx = {
      clearingCommandReceipt: { findUnique: jest.fn().mockResolvedValue(null) },
      $queryRaw: jest.fn().mockResolvedValue([{ id: "event-1" }]),
      clearingEvent: {
        findUnique: jest.fn().mockResolvedValue({
          id: "event-1",
          clearingCaseId: "case-1",
          kind: "final_confirmed",
          workflowStatus: "submitted",
          revision: 2,
          currentVersionNo: 2
        })
      },
      clearingEventVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-2",
          clearingEventId: "event-1",
          clearingCaseId: "case-1",
          versionNo: 2,
          workflowStatus: "submitted",
          amountCents: 100n,
          actorSetSnapshot: ["director-1"]
        })
      }
    };
    const { service } = serviceWith({ tx });

    await expect(
      service.confirmEvent("director-1", "event-1", {
        idempotencyKey: COMMAND_ID,
        expectedRevision: 2,
        allocations: [
          { sourceKind: "authority_cap", amountCents: "100" }
        ]
      })
    ).rejects.toThrow("职责分离冲突");
  });

  it("fails closed when B-level evidence has no independent named attest", async () => {
    const tx = {
      clearingCommandReceipt: { findUnique: jest.fn().mockResolvedValue(null) },
      $queryRaw: jest.fn().mockResolvedValue([{ id: "event-1" }]),
      clearingEvent: {
        findUnique: jest.fn().mockResolvedValue({
          id: "event-1",
          clearingCaseId: "case-1",
          kind: "final_confirmed",
          workflowStatus: "submitted",
          revision: 2,
          currentVersionNo: 2
        })
      },
      clearingEventVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-2",
          clearingEventId: "event-1",
          clearingCaseId: "case-1",
          versionNo: 2,
          workflowStatus: "submitted",
          amountCents: 100n,
          evidenceLevel: "B",
          actorSetSnapshot: ["staff-1"]
        })
      },
      clearingEvidenceAttestation: {
        findUnique: jest.fn().mockResolvedValue(null)
      }
    };
    const { service } = serviceWith({ tx });

    await expect(
      service.confirmEvent("director-1", "event-1", {
        idempotencyKey: COMMAND_ID,
        expectedRevision: 2,
        allocations: [
          { sourceKind: "authority_cap", amountCents: "100" }
        ]
      })
    ).rejects.toThrow("B级证据缺少独立实名 attest");
  });

  it("records one named B-level attest and advances the event revision atomically", async () => {
    const tx = {
      clearingCommandReceipt: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "receipt-1" })
      },
      $queryRaw: jest.fn().mockResolvedValue([{ id: "event-1" }]),
      clearingEvent: {
        findUnique: jest.fn().mockResolvedValue({
          id: "event-1",
          clearingCaseId: "case-1",
          kind: "final_confirmed",
          workflowStatus: "submitted",
          revision: 2,
          currentVersionNo: 2
        }),
        update: jest.fn().mockResolvedValue({ revision: 3 })
      },
      clearingEventVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-2",
          clearingEventId: "event-1",
          clearingCaseId: "case-1",
          versionNo: 2,
          workflowStatus: "submitted",
          amountCents: 100n,
          evidenceLevel: "B",
          actorSetSnapshot: ["staff-1"]
        })
      },
      clearingEvidenceAttestation: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "attestation-1" })
      },
      clearingCase: { update: jest.fn().mockResolvedValue({ revision: 5 }) }
    };
    const { service, audit } = serviceWith({
      tx,
      roleScopesByUser: { "finance-2": ["finance_staff"] }
    });

    await expect(service.attestEvent("finance-2", "event-1", {
      idempotencyKey: COMMAND_ID,
      expectedRevision: 2
    })).resolves.toEqual({
      id: "event-1",
      versionId: "version-2",
      revision: 3,
      workflowStatus: "submitted",
      attested: true
    });
    expect(tx.clearingEvidenceAttestation.create).toHaveBeenCalledWith({
      data: {
        eventVersionId: "version-2",
        attestedByUserId: "finance-2",
        attesterActorSetSnapshot: ["finance-2"]
      }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({
      actorUserId: "finance-2",
      action: "clearing.event.attest"
    }));
  });

  it("rejects B-level confirmation by an attestation actor", async () => {
    const tx = {
      clearingCommandReceipt: { findUnique: jest.fn().mockResolvedValue(null) },
      $queryRaw: jest.fn().mockResolvedValue([{ id: "event-1" }]),
      clearingEvent: {
        findUnique: jest.fn().mockResolvedValue({
          id: "event-1",
          clearingCaseId: "case-1",
          kind: "final_confirmed",
          workflowStatus: "submitted",
          revision: 2,
          currentVersionNo: 2
        })
      },
      clearingEventVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-2",
          clearingEventId: "event-1",
          clearingCaseId: "case-1",
          versionNo: 2,
          workflowStatus: "submitted",
          amountCents: 100n,
          evidenceLevel: "B",
          actorSetSnapshot: ["staff-1"]
        })
      },
      clearingEvidenceAttestation: {
        findUnique: jest.fn().mockResolvedValue({
          attesterActorSetSnapshot: ["director-1"]
        })
      }
    };
    const { service } = serviceWith({ tx });

    await expect(service.confirmEvent("director-1", "event-1", {
      idempotencyKey: COMMAND_ID,
      expectedRevision: 2,
      allocations: [{ sourceKind: "authority_cap", amountCents: "100" }]
    })).rejects.toThrow("职责分离冲突");
  });

  it("copies the frozen B-level attest to an atomically paired withheld event", async () => {
    const attestedAt = new Date("2026-08-26T10:00:00.000Z");
    const tx = {
      clearingCommandReceipt: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "receipt-1" })
      },
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([{ id: "event-1" }])
        .mockResolvedValueOnce([{ id: "case-1" }])
        .mockResolvedValueOnce([{ remaining: 0n }])
        .mockResolvedValueOnce([{ total: 0n }])
        .mockResolvedValueOnce([{ total: 0n }]),
      clearingEvent: {
        findUnique: jest.fn().mockResolvedValue({
          id: "event-1",
          clearingCaseId: "case-1",
          kind: "pending_reconciliation",
          workflowStatus: "submitted",
          revision: 2,
          currentVersionNo: 1
        }),
        create: jest.fn().mockImplementation(({ data }) => ({
          id: "paired-event-1",
          ...data
        })),
        update: jest.fn().mockResolvedValue({ revision: 3 })
      },
      clearingEventVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          clearingEventId: "event-1",
          clearingCaseId: "case-1",
          versionNo: 1,
          workflowStatus: "submitted",
          amountCents: 100n,
          evidenceLevel: "B",
          payloadSnapshot: { note: "待核对" },
          actorSetSnapshot: ["staff-1"],
          fingerprint: "pending-fingerprint",
          createdByUserId: "staff-1"
        }),
        create: jest.fn().mockImplementation(({ data }) => ({
          id: "paired-version-1",
          ...data
        }))
      },
      clearingEvidenceAttestation: {
        findUnique: jest.fn().mockResolvedValue({
          id: "attestation-1",
          eventVersionId: "version-1",
          attestedByUserId: "finance-2",
          attesterActorSetSnapshot: ["finance-2"],
          attestedAt
        }),
        create: jest.fn().mockResolvedValue({ id: "paired-attestation-1" })
      },
      clearingCase: {
        findUnique: jest.fn().mockResolvedValue({
          id: "case-1",
          projectId: "project-1",
          constructionEnterpriseAssignmentId: "assignment-1",
          category: "management_fee",
          governedSubjectKey: "管理费-2026",
          authoritativeGrossCapCents: 1000n,
          revision: 4
        }),
        update: jest.fn().mockResolvedValue({ revision: 5 })
      },
      clearingConfirmation: {
        create: jest.fn().mockResolvedValue({ id: "confirmation-1" })
      },
      clearingAllocation: {
        create: jest.fn()
      },
      project: {
        findUnique: jest.fn().mockResolvedValue({
          operatingLedgerEffectiveDate: new Date("2026-01-01T00:00:00.000Z")
        })
      },
      projectAffiliateAssignment: {
        findFirst: jest.fn().mockResolvedValue({
          id: "assignment-1",
          businessPartyId: "party-1",
          businessPartyVersionId: "party-version-1",
          affiliateNameSnapshot: "施工企业",
          affiliateCreditCodeSnapshot: "91310000TEST"
        })
      },
      clearingImpactLink: {
        create: jest.fn().mockResolvedValue({ id: "impact-link-1" })
      }
    };
    const { service } = serviceWith({
      tx,
      ledgerResult: { id: "fact-1", impactIds: ["impact-1"] }
    });

    await expect(service.confirmEvent("director-1", "event-1", {
      idempotencyKey: COMMAND_ID,
      expectedRevision: 2,
      allocations: [],
      pairedWithheldAmountCents: "100"
    })).resolves.toEqual({
      id: "event-1",
      versionId: "version-1",
      revision: 3,
      workflowStatus: "confirmed"
    });
    expect(tx.clearingEvidenceAttestation.create).toHaveBeenCalledWith({
      data: {
        eventVersionId: "paired-version-1",
        attestedByUserId: "finance-2",
        attesterActorSetSnapshot: ["finance-2"],
        attestedAt
      }
    });
    expect(tx.clearingConfirmation.create).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed allocation entries at the request boundary", async () => {
    const { service } = serviceWith();

    await expect(
      service.confirmEvent("director-1", "event-1", {
        idempotencyKey: COMMAND_ID,
        expectedRevision: 2,
        allocations: [null as never]
      })
    ).rejects.toThrow("清算分配格式不正确");
  });

  it("requires the explicit reopen action before a returned event can be revised or submitted", async () => {
    const returnedEvent = {
      id: "event-1",
      clearingCaseId: "case-1",
      kind: "estimated",
      workflowStatus: "returned",
      revision: 2,
      currentVersionNo: 2
    };
    const tx = {
      clearingCommandReceipt: { findUnique: jest.fn().mockResolvedValue(null) },
      $queryRaw: jest.fn().mockResolvedValue([{ id: "event-1" }]),
      clearingEvent: { findUnique: jest.fn().mockResolvedValue(returnedEvent) }
    };
    const { service } = serviceWith({ tx });

    await expect(
      service.submitEvent("finance-1", "event-1", {
        idempotencyKey: COMMAND_ID,
        expectedRevision: 2
      })
    ).rejects.toThrow("只有草稿事件可以提交");
    await expect(
      service.reviseEvent("finance-1", "event-1", {
        idempotencyKey: "22222222-2222-4222-8222-222222222222",
        expectedRevision: 2,
        kind: "estimated",
        amountCents: "100",
        evidenceLevel: "A",
        payload: {}
      })
    ).rejects.toThrow("只有草稿事件可以修订");
  });

  it("confirms with explicit allocation and atomically links the OperatingLedger impacts", async () => {
    const sqlResults = [
      [{ id: "event-1" }],
      [{ id: "case-1" }],
      [{ total: 0n }],
      [{ total: 0n }]
    ];
    const tx = {
      clearingCommandReceipt: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "receipt-1" })
      },
      $queryRaw: jest.fn().mockImplementation(() => Promise.resolve(sqlResults.shift())),
      clearingEvent: {
        findUnique: jest.fn().mockResolvedValue({
          id: "event-1",
          clearingCaseId: "case-1",
          kind: "final_confirmed",
          workflowStatus: "submitted",
          revision: 2,
          currentVersionNo: 2
        }),
        update: jest.fn().mockResolvedValue({ revision: 3 })
      },
      clearingEventVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-2",
          clearingEventId: "event-1",
          clearingCaseId: "case-1",
          versionNo: 2,
          workflowStatus: "submitted",
          amountCents: 100n,
          currencyCode: "CNY",
          evidenceLevel: "A",
          payloadSnapshot: { note: "frozen" },
          actorSetSnapshot: ["staff-1"],
          fingerprint: "submitted-fingerprint",
          createdByUserId: "staff-1"
        })
      },
      clearingCase: {
        findUnique: jest.fn().mockResolvedValue({
          id: "case-1",
          projectId: "project-1",
          constructionEnterpriseAssignmentId: "assignment-1",
          category: "management_fee",
          governedSubjectKey: "管理费-2026",
          authoritativeGrossCapCents: 1000n,
          revision: 4
        }),
        update: jest.fn().mockResolvedValue({ revision: 5 })
      },
      clearingConfirmation: { create: jest.fn().mockResolvedValue({ id: "confirmation-1" }) },
      clearingAllocation: { create: jest.fn().mockResolvedValue({ id: "allocation-1" }) },
      project: {
        findUnique: jest.fn().mockResolvedValue({ operatingLedgerEffectiveDate: new Date("2026-01-01") })
      },
      projectAffiliateAssignment: {
        findFirst: jest.fn().mockResolvedValue({
          id: "assignment-1",
          businessPartyId: "party-1",
          businessPartyVersionId: "party-version-1",
          affiliateNameSnapshot: "施工企业甲",
          affiliateCreditCodeSnapshot: null
        })
      },
      clearingImpactLink: { create: jest.fn().mockResolvedValue({ id: "link-1" }) },
      auditLog: { create: jest.fn().mockResolvedValue({ id: "audit-1" }) }
    };
    const { service, ledger } = serviceWith({ tx });

    const result = await service.confirmEvent("director-1", "event-1", {
      idempotencyKey: COMMAND_ID,
      expectedRevision: 2,
      allocations: [{ sourceKind: "authority_cap", amountCents: "100" }]
    });

    expect(ledger.appendConfirmedSourceInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        sourceType: "clearing_event_version",
        sourceBusinessId: "version-2",
        factKind: "construction_enterprise_deduction",
        amountCents: 100n,
        impacts: expect.arrayContaining([
          expect.objectContaining({ impactKind: "confirmed_cost", direction: "increase" }),
          expect.objectContaining({ impactKind: "construction_enterprise_funds_decrease", direction: "decrease" })
        ])
      }),
      "director-1",
      "original"
    );
    expect(tx.clearingImpactLink.create).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      id: "event-1",
      versionId: "version-2",
      revision: 3,
      workflowStatus: "confirmed"
    });
  });

  it("links every returned impact to the exact original impact", async () => {
    const tx = {
      clearingCommandReceipt: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "receipt-1" })
      },
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([{ id: "return-event" }])
        .mockResolvedValueOnce([{ id: "case-1" }])
        .mockResolvedValueOnce([{ total: 0n }])
        .mockResolvedValueOnce([{ total: 0n }]),
      clearingEvent: {
        findUnique: jest.fn().mockResolvedValue({
          id: "return-event",
          clearingCaseId: "case-1",
          kind: "returned",
          workflowStatus: "submitted",
          revision: 2,
          currentVersionNo: 2
        }),
        update: jest.fn().mockResolvedValue({ revision: 3 })
      },
      clearingEventVersion: {
        findUnique: jest.fn().mockImplementation(({ where }) => {
          if (where.id === "source-version") {
            return {
              id: "source-version",
              clearingCaseId: "case-1",
              amountCents: 100n,
              clearingEvent: { kind: "final_confirmed" },
              confirmation: { id: "source-confirmation" }
            };
          }
          return {
            id: "return-version",
            clearingEventId: "return-event",
            clearingCaseId: "case-1",
            versionNo: 2,
            workflowStatus: "submitted",
            amountCents: 100n,
            currencyCode: "CNY",
            evidenceLevel: "A",
            payloadSnapshot: { note: "return" },
            actorSetSnapshot: ["staff-1"],
            fingerprint: "return-fingerprint",
            createdByUserId: "staff-1"
          };
        })
      },
      clearingCase: {
        findUnique: jest.fn().mockResolvedValue({
          id: "case-1",
          projectId: "project-1",
          constructionEnterpriseAssignmentId: "assignment-1",
          category: "management_fee",
          governedSubjectKey: "管理费-2026",
          authoritativeGrossCapCents: 1000n,
          revision: 4
        }),
        update: jest.fn().mockResolvedValue({ revision: 5 })
      },
      clearingConfirmation: { create: jest.fn().mockResolvedValue({ id: "confirmation-1" }) },
      clearingAllocation: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amountCents: 0n } }),
        create: jest.fn().mockResolvedValue({ id: "allocation-1" })
      },
      clearingImpactLink: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "source-cost-link",
            operatingFactId: "source-fact",
            sourceImpactKey: "original:confirmed-cost"
          },
          {
            id: "source-funds-link",
            operatingFactId: "source-fact",
            sourceImpactKey: "original:construction-enterprise-funds-decrease"
          }
        ]),
        create: jest.fn().mockResolvedValue({ id: "return-link" })
      },
      project: {
        findUnique: jest.fn().mockResolvedValue({ operatingLedgerEffectiveDate: new Date("2026-01-01") })
      },
      projectAffiliateAssignment: {
        findFirst: jest.fn().mockResolvedValue({
          id: "assignment-1",
          businessPartyId: "party-1",
          businessPartyVersionId: "party-version-1",
          affiliateNameSnapshot: "施工企业甲",
          affiliateCreditCodeSnapshot: null
        })
      },
      auditLog: { create: jest.fn().mockResolvedValue({ id: "audit-1" }) }
    };
    const { service } = serviceWith({
      tx,
      ledgerResult: { id: "return-fact", impactIds: ["return-cost", "return-funds"] }
    });

    await service.confirmEvent("director-1", "return-event", {
      idempotencyKey: COMMAND_ID,
      expectedRevision: 2,
      allocations: [
        {
          sourceEventVersionId: "source-version",
          sourceKind: "final_confirmed",
          amountCents: "100"
        }
      ]
    });

    expect(tx.clearingImpactLink.findMany).toHaveBeenCalledWith({
      where: { eventVersionId: "source-version" },
      orderBy: { sourceImpactKey: "asc" }
    });
    expect(tx.clearingImpactLink.create).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        operatingImpactId: "return-cost",
        reversesImpactId: "source-cost-link"
      })
    });
    expect(tx.clearingImpactLink.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        operatingImpactId: "return-funds",
        reversesImpactId: "source-funds-link"
      })
    });
  });
});
