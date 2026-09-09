import { Prisma } from "@prisma/client";

import { fingerprintClearingReconciliationEventVersion } from "./clearing-domain";
import { ClearingService } from "./clearing.service";

const COMMAND_ID = "11111111-1111-4111-8111-111111111111";

function serviceWith<TTx extends Record<string, unknown> = Record<string, never>>(input?: {
  roles?: string[];
  roleScopesByUser?: Record<string, string[]>;
  transactionRoleScopesByUser?: Record<string, string[]>;
  prisma?: Record<string, unknown>;
  tx?: TTx;
  ledgerResult?: { id: string; impactIds: string[] };
  authorities?: { resolveCaseSelection: jest.Mock };
  selectionRefs?: { matches: jest.Mock };
}) {
  const tx = input?.tx ?? ({} as TTx);
  const originalQueryRaw = (tx as { $queryRaw?: jest.Mock }).$queryRaw;
  if (originalQueryRaw) {
    (tx as unknown as { $queryRaw: jest.Mock }).$queryRaw = jest.fn().mockImplementation(
      (query: { strings?: readonly string[] }) =>
        query.strings?.join("").includes("pol275_confirmation_authorization_lock")
          ? Promise.resolve([{ lockedUsers: 0n, lockedPositions: 0n, lockedDelegations: 0n }])
          : originalQueryRaw(query)
    );
  }
  const prisma = {
    clearingEvent: {
      findUnique: jest.fn().mockResolvedValue({ kind: "coverage_added" })
    },
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
    ),
    resolveActiveRoleScopesInTransaction: jest.fn().mockImplementation((_tx: unknown, userId: string) =>
      Promise.resolve(
        input?.transactionRoleScopesByUser?.[userId] ??
          input?.roleScopesByUser?.[userId] ??
          input?.roles ??
          ["finance_director"]
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
    service: new ClearingService(
      prisma as never,
      roleResolver as never,
      ledger as never,
      audit as never,
      input?.authorities as never,
      input?.selectionRefs as never
    ),
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
        endsAt: { gt: expect.any(Date) }
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

  it("rolls back confirmation and records a separate reason-only deny audit when authority drifts", async () => {
    const tx = {
      clearingCommandReceipt: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn()
      },
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([{ id: "event-1" }])
        .mockResolvedValueOnce([{ id: "case-1" }]),
      clearingEvent: {
        findUnique: jest.fn().mockResolvedValue({
          id: "event-1",
          clearingCaseId: "case-1",
          kind: "final_confirmed",
          workflowStatus: "submitted",
          revision: 2,
          currentVersionNo: 1
        }),
        update: jest.fn()
      },
      clearingEventVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          clearingEventId: "event-1",
          clearingCaseId: "case-1",
          versionNo: 1,
          workflowStatus: "submitted",
          amountCents: 100n,
          evidenceLevel: "A",
          payloadSnapshot: {},
          actorSetSnapshot: ["staff-1"],
          fingerprint: "a".repeat(64),
          createdByUserId: "staff-1"
        })
      },
      clearingCase: {
        findUnique: jest.fn().mockResolvedValue({ id: "case-1", revision: 4 }),
        update: jest.fn()
      }
    };
    const { service, prisma, audit } = serviceWith({
      tx,
      roleScopesByUser: { "director-1": ["finance_director"] },
      transactionRoleScopesByUser: { "director-1": ["employee"] }
    });

    await expect(service.confirmEvent("director-1", "event-1", {
      idempotencyKey: COMMAND_ID,
      expectedRevision: 2,
      allocations: [{ sourceKind: "authority_cap", amountCents: "100" }]
    })).rejects.toThrow("权限或委托已变化");

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(tx.clearingEvent.update).not.toHaveBeenCalled();
    expect(tx.clearingCommandReceipt.create).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({
      actorUserId: "director-1",
      action: "clearing.event.confirm.denied",
      businessType: "clearing_event",
      businessId: "event-1",
      metadata: expect.objectContaining({
        reasonCode: "clearing_confirm_authorization_drift",
        requiredAction: "clearing.confirm",
        resourceFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/)
      })
    }));
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

  it.each(["coverage_added", "continued_withheld", "technical_reversal"] as const)(
    "requires V1 intent when preparing or revising the new reconciliation kind %s",
    async (kind) => {
      const { service, prisma } = serviceWith();
      const input = {
        idempotencyKey: COMMAND_ID,
        expectedRevision: 1,
        kind,
        amountCents: "1",
        evidenceLevel: "B" as const
      };

      await expect(service.createEvent("finance-1", "case-1", input))
        .rejects.toThrow("必须使用 V1 核对意图");
      await expect(service.reviseEvent("finance-1", "event-1", input))
        .rejects.toThrow("必须使用 V1 核对意图");
      expect(prisma.$transaction).not.toHaveBeenCalled();
    }
  );

  it("fails closed when a pre-existing new reconciliation event is submitted or confirmed without V1", async () => {
    const draftTx = {
      clearingCommandReceipt: { findUnique: jest.fn().mockResolvedValue(null) },
      $queryRaw: jest.fn().mockResolvedValue([{ id: "event-1" }]),
      clearingEvent: {
        findUnique: jest.fn().mockResolvedValue({
          id: "event-1",
          clearingCaseId: "case-1",
          kind: "coverage_added",
          workflowStatus: "draft",
          revision: 1,
          currentVersionNo: 1
        })
      },
      clearingEventVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          workflowStatus: "draft",
          payloadSnapshot: {},
          fingerprint: "a".repeat(64)
        })
      }
    };
    const { service: draftService } = serviceWith({ tx: draftTx });
    await expect(draftService.submitEvent("finance-1", "event-1", {
      idempotencyKey: COMMAND_ID,
      expectedRevision: 1
    })).rejects.toThrow("缺少 V1 核对意图");

    const submittedTx = {
      clearingCommandReceipt: { findUnique: jest.fn().mockResolvedValue(null) },
      $queryRaw: jest.fn().mockResolvedValue([{ id: "event-1" }]),
      clearingEvent: {
        findUnique: jest.fn().mockResolvedValue({
          id: "event-1",
          clearingCaseId: "case-1",
          kind: "coverage_added",
          workflowStatus: "submitted",
          revision: 2,
          currentVersionNo: 2
        })
      },
      clearingEventVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-2",
          workflowStatus: "submitted",
          payloadSnapshot: {},
          fingerprint: "b".repeat(64)
        })
      }
    };
    const { service: submittedService } = serviceWith({ tx: submittedTx });
    await expect(submittedService.confirmEvent("director-1", "event-1", {
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
      expectedRevision: 2,
      allocations: []
    })).rejects.toThrow("缺少 V1 核对意图");
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

  it("resolves an Event-confirmed exact-Confirmation source and links every returned impact", async () => {
    const sourceVersion = {
      id: "source-version",
      clearingCaseId: "case-1",
      workflowStatus: "submitted",
      amountCents: 100n,
      clearingEvent: { kind: "final_confirmed", workflowStatus: "confirmed" },
      confirmation: { id: "source-confirmation" }
    };
    const tx = {
      clearingCommandReceipt: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "receipt-1" })
      },
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([{ id: "return-event" }])
        .mockResolvedValueOnce([{ id: "case-1" }])
        .mockResolvedValueOnce([{ total: 0n }])
        .mockResolvedValueOnce([{ incompatible: false }])
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
        findMany: jest.fn().mockResolvedValue([sourceVersion]),
        findUnique: jest.fn().mockImplementation(({ where }) => {
          if (where.id === "source-version") return sourceVersion;
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
          revision: 4,
          sourceDiscriminator: "construction_enterprise_guarantee",
          authoritySnapshotRef: "authority-fingerprint"
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
      auditLog: { create: jest.fn().mockResolvedValue({ id: "audit-1" }) },
      $executeRaw: jest.fn().mockResolvedValue(1)
    };
    const selectionRefs = { matches: jest.fn().mockReturnValue(true) };
    const { service } = serviceWith({
      tx,
      ledgerResult: { id: "return-fact", impactIds: ["return-cost", "return-funds"] },
      selectionRefs
    });

    await service.confirmEvent("director-1", "return-event", {
      idempotencyKey: COMMAND_ID,
      expectedRevision: 2,
      allocations: [
        {
          sourceSelectionRef: "fac1.source-selection",
          sourceKind: "final_confirmed",
          amountCents: "100"
        }
      ]
    });

    expect(tx.clearingEventVersion.findMany).toHaveBeenCalledWith({
      where: {
        clearingCaseId: "case-1",
        confirmation: { isNot: null },
        clearingEvent: { workflowStatus: "confirmed" }
      },
      include: { clearingEvent: true, confirmation: true }
    });
    expect(selectionRefs.matches).toHaveBeenCalledWith(
      "fac1.source-selection",
      expect.objectContaining({ selectedKey: "source-version", revision: 4 })
    );
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

  it("binds a V1 confirmation to the exact submitted version and invokes the controlled writer", async () => {
    const intent = {
      schema: "clearing_reconciliation_intent/V1",
      operation: "add_coverage",
      plannedIds: {
        newItemId: null,
        revisionId: null,
        coverageIds: ["coverage-1"],
        resolutionIds: [],
        resolutionLineIds: [],
        definitionReversalId: null,
        clearingAllocationIds: []
      },
      plannedPairedWithheld: null,
      itemDefinition: null,
      coverages: [{ reconciliationRevisionId: "revision-1" }],
      resolutions: [],
      definitionReversal: null,
      eventAllocations: []
    };
    const rawResults = [
      [{ id: "event-1" }],
      [{ id: "case-1" }],
      [{ lockedUsers: 1n, lockedPositions: 1n, lockedDelegations: 0n }],
      [{ itemId: "item-1", revisionNo: 1 }],
      [{ reversed: false, hasLaterEffective: false }],
      [{ total: 0n }],
      [{ relation_set_hash: "seal-hash" }]
    ];
    const tx = {
      clearingCommandReceipt: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "receipt-1" })
      },
      $queryRaw: jest.fn().mockImplementation(() => Promise.resolve(rawResults.shift())),
      clearingEvent: {
        findUnique: jest.fn().mockResolvedValue({
          id: "event-1",
          clearingCaseId: "case-1",
          kind: "coverage_added",
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
          amountCents: 1n,
          currencyCode: "CNY",
          evidenceLevel: "A",
          payloadSnapshot: { reconciliationIntent: intent },
          actorSetSnapshot: ["staff-1"],
          fingerprint: "a".repeat(64),
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
          revision: 7
        }),
        update: jest.fn().mockResolvedValue({ revision: 8 })
      },
      clearingConfirmation: { create: jest.fn().mockResolvedValue({ id: "confirmation-1" }) },
      auditLog: { create: jest.fn().mockResolvedValue({ id: "audit-1" }) }
    };
    const { service } = serviceWith({ tx });

    await expect(service.confirmEvent("director-1", "event-1", {
      idempotencyKey: COMMAND_ID,
      expectedRevision: 2,
      expectedCaseRevision: 7,
      eventVersionId: "version-2",
      expectedFingerprint: "a".repeat(64),
      confirmed: true
    })).resolves.toEqual({
      id: "event-1",
      versionId: "version-2",
      revision: 3,
      workflowStatus: "confirmed"
    });

    expect(tx.$queryRaw).toHaveBeenCalledTimes(7);
    expect(tx.clearingConfirmation.create).toHaveBeenCalledTimes(1);
  });

  it("rejects relationship overrides at the V1 confirmation boundary", async () => {
    const { service, prisma } = serviceWith();

    await expect(service.confirmEvent("director-1", "event-1", {
      idempotencyKey: COMMAND_ID,
      expectedRevision: 2,
      expectedCaseRevision: 7,
      eventVersionId: "version-2",
      expectedFingerprint: "a".repeat(64),
      confirmed: true,
      allocations: []
    })).rejects.toThrow("V1 确认不接受关系或分配覆盖字段");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("refuses to submit a V1 draft through a different event version fingerprint", async () => {
    const tx = {
      clearingCommandReceipt: { findUnique: jest.fn().mockResolvedValue(null) },
      $queryRaw: jest.fn().mockResolvedValue([{ id: "event-1" }]),
      clearingEvent: {
        findUnique: jest.fn().mockResolvedValue({
          id: "event-1",
          clearingCaseId: "case-1",
          kind: "pending_reconciliation",
          workflowStatus: "draft",
          revision: 1,
          currentVersionNo: 1
        })
      },
      clearingEventVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          workflowStatus: "draft",
          payloadSnapshot: {
            reconciliationIntent: { schema: "clearing_reconciliation_intent/V1" }
          },
          fingerprint: "a".repeat(64)
        })
      }
    };
    const { service } = serviceWith({ tx });

    await expect(service.submitEvent("finance-1", "event-1", {
      idempotencyKey: COMMAND_ID,
      expectedRevision: 1,
      eventVersionId: "version-1",
      expectedFingerprint: "b".repeat(64)
    })).rejects.toThrow("exact eventVersionId + fingerprint");
  });

  it("refuses to attest a V1 submission through a stale event version", async () => {
    const tx = {
      clearingCommandReceipt: { findUnique: jest.fn().mockResolvedValue(null) },
      $queryRaw: jest.fn().mockResolvedValue([{ id: "event-1" }]),
      clearingEvent: {
        findUnique: jest.fn().mockResolvedValue({
          id: "event-1",
          clearingCaseId: "case-1",
          kind: "pending_reconciliation",
          workflowStatus: "submitted",
          revision: 2,
          currentVersionNo: 2
        })
      },
      clearingEventVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-2",
          workflowStatus: "submitted",
          evidenceLevel: "B",
          payloadSnapshot: {
            reconciliationIntent: { schema: "clearing_reconciliation_intent/V1" }
          },
          fingerprint: "a".repeat(64)
        })
      }
    };
    const { service } = serviceWith({ tx });

    await expect(service.attestEvent("finance-1", "event-1", {
      idempotencyKey: COMMAND_ID,
      expectedRevision: 2,
      eventVersionId: "version-1",
      expectedFingerprint: "a".repeat(64)
    })).rejects.toThrow("exact eventVersionId + fingerprint");
  });

  it("freezes an independent pending item with server planned IDs during prepare", async () => {
    const tx = {
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
          category: "management_fee",
          governedSubjectKey: "管理费-2026",
          authoritativeGrossCapCents: 1000n,
          currencyCode: "CNY",
          revision: 1,
          sourceDiscriminator: null,
          authorityVersionId: null,
          authoritySnapshotRef: null
        }),
        update: jest.fn().mockResolvedValue({ revision: 2 })
      },
      clearingEvent: { create: jest.fn().mockImplementation(({ data }) => data) },
      clearingEventVersion: { create: jest.fn().mockImplementation(({ data }) => data) },
      auditLog: { create: jest.fn().mockResolvedValue({ id: "audit-1" }) }
    };
    const { service } = serviceWith({ tx });

    await service.createEvent("finance-1", "case-1", {
      idempotencyKey: COMMAND_ID,
      expectedRevision: 1,
      kind: "pending_reconciliation",
      amountCents: "100",
      evidenceLevel: "B",
      reconciliationIntent: {
        operation: "open_item",
        itemDefinition: { mode: "independent", amountCents: "100" },
        coverages: []
      }
    });

    const data = tx.clearingEventVersion.create.mock.calls[0]![0].data;
    expect(data.fingerprint).toBe(fingerprintClearingReconciliationEventVersion({
      clearingCaseId: "case-1",
      eventKind: "pending_reconciliation",
      amountCents: "100",
      currencyCode: "CNY",
      previousVersionId: null,
      actorSetSnapshot: data.actorSetSnapshot,
      reconciliationIntent: data.payloadSnapshot.reconciliationIntent
    }));
    expect(data.payloadSnapshot).toEqual({
      reconciliationIntent: expect.objectContaining({
        schema: "clearing_reconciliation_intent/V1",
        operation: "open_item",
        itemDefinition: expect.objectContaining({
          mode: "independent",
          amountCents: "100",
          itemId: expect.any(String),
          revisionId: expect.any(String),
          revisionNo: 1
        }),
        plannedIds: expect.objectContaining({
          newItemId: expect.any(String),
          revisionId: expect.any(String)
        }),
        coverages: expect.arrayContaining([
          expect.objectContaining({
            lineNo: 1,
            amountCents: "100",
            withheldEventVersionFingerprint: expect.stringMatching(
              /^[0-9a-f]{64}$/
            )
          })
        ]),
        resolutions: [],
        eventAllocations: []
      })
    });
  });

  it("binds a submitted V1 event version to the draft fingerprint lineage and merged actors", async () => {
    const intent = {
      schema: "clearing_reconciliation_intent/V1",
      operation: "open_item",
      plannedIds: {},
      itemDefinition: null,
      coverages: [],
      resolutions: [],
      definitionReversal: null,
      eventAllocations: []
    };
    const draftFingerprint = "a".repeat(64);
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
          kind: "pending_reconciliation",
          workflowStatus: "draft",
          revision: 1,
          currentVersionNo: 1
        }),
        update: jest.fn().mockResolvedValue({ revision: 2 })
      },
      clearingEventVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          clearingEventId: "event-1",
          clearingCaseId: "case-1",
          versionNo: 1,
          workflowStatus: "draft",
          amountCents: 100n,
          currencyCode: "CNY",
          payableRef: null,
          evidenceLevel: "B",
          payloadSnapshot: { reconciliationIntent: intent },
          actorSetSnapshot: ["creator-1"],
          fingerprint: draftFingerprint,
          createdByUserId: "creator-1"
        }),
        create: jest.fn().mockImplementation(({ data }) => data)
      },
      clearingCase: { update: jest.fn().mockResolvedValue({ revision: 3 }) },
      auditLog: { create: jest.fn().mockResolvedValue({ id: "audit-1" }) }
    };
    const { service } = serviceWith({ tx });

    await service.submitEvent("finance-1", "event-1", {
      idempotencyKey: COMMAND_ID,
      expectedRevision: 1,
      eventVersionId: "version-1",
      expectedFingerprint: draftFingerprint
    });

    const submitted = tx.clearingEventVersion.create.mock.calls[0]![0].data;
    expect(submitted.previousVersionId).toBe("version-1");
    expect(submitted.actorSetSnapshot).toEqual(["creator-1", "finance-1"]);
    expect(submitted.fingerprint).toBe(fingerprintClearingReconciliationEventVersion({
      clearingCaseId: "case-1",
      eventKind: "pending_reconciliation",
      amountCents: "100",
      currencyCode: "CNY",
      previousVersionId: "version-1",
      actorSetSnapshot: submitted.actorSetSnapshot,
      reconciliationIntent: intent
    }));
    expect(submitted.fingerprint).not.toBe(draftFingerprint);
  });

  it("binds a revised V1 event version to the previous version and merged actors", async () => {
    const currentIntent = {
      schema: "clearing_reconciliation_intent/V1",
      operation: "open_item",
      plannedIds: {},
      itemDefinition: null,
      coverages: [],
      resolutions: [],
      definitionReversal: null,
      eventAllocations: []
    };
    const tx = {
      clearingCommandReceipt: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "receipt-1" })
      },
      $queryRaw: jest.fn().mockResolvedValue([{ id: "event-1" }, { id: "case-1" }]),
      clearingEvent: {
        findUnique: jest.fn().mockResolvedValue({
          id: "event-1",
          clearingCaseId: "case-1",
          kind: "pending_reconciliation",
          workflowStatus: "draft",
          revision: 1,
          currentVersionNo: 1
        }),
        update: jest.fn().mockResolvedValue({ revision: 2 })
      },
      clearingEventVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          workflowStatus: "draft",
          amountCents: 100n,
          currencyCode: "CNY",
          evidenceLevel: "B",
          payloadSnapshot: { reconciliationIntent: currentIntent },
          actorSetSnapshot: ["creator-1"],
          fingerprint: "a".repeat(64)
        }),
        create: jest.fn().mockImplementation(({ data }) => data)
      },
      clearingCase: {
        findUnique: jest.fn().mockResolvedValue({
          id: "case-1",
          projectId: "project-1",
          constructionEnterpriseAssignmentId: "assignment-1",
          category: "management_fee",
          governedSubjectKey: "管理费-2026",
          authoritativeGrossCapCents: 1000n,
          currencyCode: "CNY",
          revision: 2,
          sourceDiscriminator: null,
          authorityVersionId: null,
          authoritySnapshotRef: null
        }),
        update: jest.fn().mockResolvedValue({ revision: 3 })
      },
      auditLog: { create: jest.fn().mockResolvedValue({ id: "audit-1" }) }
    };
    const { service } = serviceWith({ tx });

    await service.reviseEvent("finance-1", "event-1", {
      idempotencyKey: COMMAND_ID,
      expectedRevision: 1,
      kind: "pending_reconciliation",
      amountCents: "120",
      evidenceLevel: "B",
      reconciliationIntent: {
        operation: "open_item",
        itemDefinition: { mode: "independent", amountCents: "120" },
        coverages: []
      }
    });

    const revised = tx.clearingEventVersion.create.mock.calls[0]![0].data;
    expect(revised.previousVersionId).toBe("version-1");
    expect(revised.actorSetSnapshot).toEqual(["creator-1", "finance-1"]);
    expect(revised.fingerprint).toBe(fingerprintClearingReconciliationEventVersion({
      clearingCaseId: "case-1",
      eventKind: "pending_reconciliation",
      amountCents: "120",
      currencyCode: "CNY",
      previousVersionId: "version-1",
      actorSetSnapshot: revised.actorSetSnapshot,
      reconciliationIntent: revised.payloadSnapshot.reconciliationIntent
    }));
  });

  it("resolves a short-lived withheld selection into a stable coverage snapshot during prepare", async () => {
    const tx = {
      clearingCommandReceipt: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "receipt-1" })
      },
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([{ id: "case-1" }])
        .mockResolvedValueOnce([{ remaining: 100n }])
        .mockResolvedValueOnce([{ openAmountCents: 100n, activeCoverageCents: 0n }])
        .mockResolvedValueOnce([{ id: "case-1" }])
        .mockResolvedValueOnce([{ remaining: 100n }])
        .mockResolvedValueOnce([{ openAmountCents: 100n, activeCoverageCents: 80n }]),
      clearingCase: {
        findUnique: jest.fn().mockResolvedValue({
          id: "case-1",
          projectId: "project-1",
          constructionEnterpriseAssignmentId: "assignment-1",
          category: "management_fee",
          governedSubjectKey: "管理费",
          authoritativeGrossCapCents: 1000n,
          currencyCode: "CNY",
          revision: 4,
          sourceDiscriminator: null,
          authorityVersionId: "authority-1",
          authoritySnapshotRef: "authority-fingerprint"
        }),
        update: jest.fn().mockResolvedValue({ revision: 5 })
      },
      clearingReconciliationRevision: {
        findUnique: jest.fn().mockResolvedValue({
          id: "revision-1",
          itemId: "item-1",
          clearingCaseId: "case-1",
          revisionNo: 1
        }),
        findFirst: jest.fn().mockResolvedValue(null)
      },
      clearingReconciliationDefinitionReversal: {
        findUnique: jest.fn().mockResolvedValue(null)
      },
      clearingEvent: { create: jest.fn().mockImplementation(({ data }) => data) },
      clearingEventVersion: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "withheld-version-1",
            clearingCaseId: "case-1",
            amountCents: 100n,
            fingerprint: "c".repeat(64),
            clearingEvent: { kind: "withheld", workflowStatus: "confirmed" },
            confirmation: { eventVersionId: "withheld-version-1" }
          }
        ]),
        create: jest.fn().mockImplementation(({ data }) => data)
      },
      auditLog: { create: jest.fn().mockResolvedValue({ id: "audit-1" }) }
    };
    const selectionRefs = { matches: jest.fn().mockReturnValue(true) };
    const { service } = serviceWith({ tx, selectionRefs });

    await service.createEvent("finance-1", "case-1", {
      idempotencyKey: COMMAND_ID,
      expectedRevision: 4,
      kind: "coverage_added",
      amountCents: "40",
      evidenceLevel: "B",
      businessReason: "补充绑定已确认暂扣",
      reconciliationIntent: {
        operation: "add_coverage",
        targetRevisionId: "revision-1",
        coverages: [
          { sourceSelectionRef: "fac1.short-lived", amountCents: "40" }
        ]
      }
    });

    const payload = tx.clearingEventVersion.create.mock.calls[0]![0].data.payloadSnapshot;
    expect(JSON.stringify(payload)).not.toContain("fac1.short-lived");
    expect(payload.reconciliationIntent.coverages).toEqual([
      expect.objectContaining({
        lineNo: 1,
        reconciliationRevisionId: "revision-1",
        withheldEventVersionId: "withheld-version-1",
        withheldEventVersionFingerprint: "c".repeat(64),
        amountCents: "40"
      })
    ]);

    await expect(service.createEvent("finance-1", "case-1", {
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
      expectedRevision: 4,
      kind: "coverage_added",
      amountCents: "30",
      evidenceLevel: "B",
      reconciliationIntent: {
        operation: "add_coverage",
        targetRevisionId: "revision-1",
        coverages: [
          { sourceSelectionRef: "fac1.short-lived", amountCents: "30" }
        ]
      }
    })).rejects.toThrow("超过目标 revision 当前未解决金额");
    expect(tx.clearingEvent.create).toHaveBeenCalledTimes(1);
  });

  it("freezes a resolution line and its one-to-one economic allocation during prepare", async () => {
    const tx = {
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
          category: "management_fee",
          governedSubjectKey: "管理费",
          authoritativeGrossCapCents: 1000n,
          currencyCode: "CNY",
          revision: 4,
          sourceDiscriminator: null,
          authorityVersionId: "authority-1",
          authoritySnapshotRef: "authority-fingerprint"
        }),
        update: jest.fn().mockResolvedValue({ revision: 5 })
      },
      clearingReconciliationRevision: {
        findUnique: jest.fn().mockResolvedValue({
          id: "revision-1",
          itemId: "item-1",
          clearingCaseId: "case-1",
          revisionNo: 1
        }),
        findFirst: jest.fn().mockResolvedValue(null)
      },
      clearingReconciliationDefinitionReversal: {
        findUnique: jest.fn().mockResolvedValue(null)
      },
      clearingReconciliationCoverage: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "coverage-1",
            reconciliationRevisionId: "revision-1",
            itemId: "item-1",
            clearingCaseId: "case-1",
            withheldEventVersionId: "withheld-version-1",
            amountCents: 100n,
            withheldEventVersion: { fingerprint: "c".repeat(64) }
          }
        ])
      },
      clearingEvent: { create: jest.fn().mockImplementation(({ data }) => data) },
      clearingEventVersion: { create: jest.fn().mockImplementation(({ data }) => data) },
      auditLog: { create: jest.fn().mockResolvedValue({ id: "audit-1" }) }
    };
    const selectionRefs = { matches: jest.fn().mockReturnValue(true) };
    const { service } = serviceWith({ tx, selectionRefs });

    await service.createEvent("finance-1", "case-1", {
      idempotencyKey: COMMAND_ID,
      expectedRevision: 4,
      kind: "final_confirmed",
      amountCents: "40",
      evidenceLevel: "B",
      reconciliationIntent: {
        operation: "resolve",
        resolutions: [{
          reconciliationRevisionId: "revision-1",
          amountCents: "40",
          lines: [{
            sourceKind: "withheld_coverage",
            sourceSelectionRef: "fac1.coverage",
            amountCents: "40"
          }]
        }],
        ordinaryAllocations: []
      }
    });

    const intent = tx.clearingEventVersion.create.mock.calls[0]![0]
      .data.payloadSnapshot.reconciliationIntent;
    expect(JSON.stringify(intent)).not.toContain("fac1.coverage");
    expect(intent.resolutions[0].lines[0]).toEqual(expect.objectContaining({
      sourceKind: "withheld_coverage",
      coverageId: "coverage-1",
      plannedClearingAllocationId: expect.any(String),
      frozenSource: {
        kind: "withheld_coverage",
        coverageId: "coverage-1",
        withheldEventVersionId: "withheld-version-1",
        withheldEventVersionFingerprint: "c".repeat(64)
      }
    }));
    expect(intent.eventAllocations).toEqual([
      expect.objectContaining({
        allocationNo: 1,
        purpose: "reconciliation_line",
        allocationSourceKind: "withheld",
        sourceEventVersionId: "withheld-version-1",
        amountCents: "40"
      })
    ]);
  });
});
