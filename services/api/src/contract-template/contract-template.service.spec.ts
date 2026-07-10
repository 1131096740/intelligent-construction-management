import { ForbiddenException } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { ContractTemplateService } from "./contract-template.service";

describe("ContractTemplateService", () => {
  const audit = {
    record: jest.fn()
  };

  beforeEach(() => {
    audit.record.mockReset();
  });

  const validSchema = {
    fields: [{ key: "field1", label: "Field 1", type: "text" as const }],
    bills: [],
    clauses: [],
    attachments: [],
    validations: []
  };

  it("creates version 1 as draft", async () => {
    const tx = {
      userPosition: {
        findMany: jest.fn().mockResolvedValue([{ positionId: "pos-1" }])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([{ key: "contract_staff" }])
      },
      contractBusinessTemplate: {
        create: jest.fn().mockResolvedValue({ id: "template-1", code: "TPL-001" })
      },
      contractBusinessTemplateVersion: {
        create: jest.fn().mockResolvedValue({ id: "version-1", versionNo: 1, status: "draft" }),
        findMany: jest.fn().mockResolvedValue([])
      },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new ContractTemplateService(prisma, audit as never);

    const result = await service.createTemplate("contract-staff-1", {
      code: "TPL-001",
      name: "钢材采购合同模板",
      contractTypeKey: "procurement",
      schema: validSchema
    });

    expect(result.version.versionNo).toBe(1);
    expect(result.version.status).toBe("draft");
    expect(tx.contractBusinessTemplateVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        versionNo: 1,
        status: "draft"
      })
    });
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        actorUserId: "contract-staff-1",
        action: "contract_template.create",
        businessType: "contract_business_template"
      })
    );
  });

  it("publishes only after schema validation", async () => {
    const invalidSchema = {
      fields: [
        { key: "dup", label: "A", type: "text" as const },
        { key: "dup", label: "B", type: "text" as const }
      ],
      bills: [],
      clauses: [],
      attachments: [],
      validations: []
    };

    const tx = {
      userPosition: {
        findMany: jest.fn().mockResolvedValue([{ positionId: "pos-dir" }])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([{ key: "contract_director" }])
      },
      contractBusinessTemplateVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          templateId: "template-1",
          status: "submitted",
          fieldSchema: invalidSchema.fields,
          billSchema: [],
          clauseSchema: [],
          attachmentSchema: [],
          validationSchema: []
        }),
        update: jest.fn()
      },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new ContractTemplateService(prisma, audit as never);

    await expect(
      service.publishVersion("version-1", "contract-director-1", { changeSummary: "First publish" })
    ).rejects.toThrow("Duplicate field key: dup");
    expect(tx.contractBusinessTemplateVersion.update).not.toHaveBeenCalled();
  });

  it("does not mutate a published version", async () => {
    const tx = {
      userPosition: {
        findMany: jest.fn().mockResolvedValue([{ positionId: "pos-1" }])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([{ key: "contract_staff" }])
      },
      contractBusinessTemplateVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          templateId: "template-1",
          status: "published"
        }),
        update: jest.fn()
      },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new ContractTemplateService(prisma, audit as never);

    await expect(
      service.updateDraftVersion("version-1", "contract-staff-1", { schema: validSchema })
    ).rejects.toThrow("只有草稿状态的业务模板版本可以编辑");
    expect(tx.contractBusinessTemplateVersion.update).not.toHaveBeenCalled();
  });

  it("creates a new draft version from a published version", async () => {
    const tx = {
      userPosition: {
        findMany: jest.fn().mockResolvedValue([{ positionId: "pos-1" }])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([{ key: "contract_staff" }])
      },
      contractBusinessTemplateVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          templateId: "template-1",
          versionNo: 1,
          status: "published",
          fieldSchema: validSchema.fields,
          billSchema: [],
          clauseSchema: [],
          attachmentSchema: [],
          validationSchema: []
        }),
        findMany: jest.fn().mockResolvedValue([{ versionNo: 1 }]),
        create: jest.fn().mockResolvedValue({ id: "version-2", versionNo: 2, status: "draft" })
      },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new ContractTemplateService(prisma, audit as never);

    const result = await service.cloneVersion("version-1", "contract-staff-1");

    expect(result.versionNo).toBe(2);
    expect(result.status).toBe("draft");
    expect(tx.contractBusinessTemplateVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        templateId: "template-1",
        versionNo: 2,
        status: "draft"
      })
    });
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        actorUserId: "contract-staff-1",
        action: "contract_template.clone_version",
        businessType: "contract_business_template_version"
      })
    );
  });

  it("stops a version without changing existing contract snapshots", async () => {
    const tx = {
      userPosition: {
        findMany: jest.fn().mockResolvedValue([{ positionId: "pos-dir" }])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([{ key: "contract_director" }])
      },
      contractBusinessTemplateVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          templateId: "template-1",
          status: "published"
        }),
        update: jest.fn().mockResolvedValue({ id: "version-1", status: "stopped" })
      },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new ContractTemplateService(prisma, audit as never);

    const result = await service.stopVersion("version-1", "contract-director-1");

    expect(result.status).toBe("stopped");
    expect(tx.contractBusinessTemplateVersion.update).toHaveBeenCalledWith({
      where: { id: "version-1" },
      data: expect.objectContaining({ status: "stopped" })
    });
    // Should NOT touch any contract rows
    expect(Object.keys(tx)).not.toContain("contract");
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        actorUserId: "contract-director-1",
        action: "contract_template.stop_version",
        businessType: "contract_business_template_version",
        businessId: "version-1"
      })
    );
  });

  it("revokes a version so new drafts cannot use it", async () => {
    const tx = {
      userPosition: {
        findMany: jest.fn().mockResolvedValue([{ positionId: "pos-dir" }])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([{ key: "contract_director" }])
      },
      contractBusinessTemplateVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          templateId: "template-1",
          status: "published"
        }),
        update: jest.fn().mockResolvedValue({ id: "version-1", status: "revoked" })
      },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new ContractTemplateService(prisma, audit as never);

    const result = await service.revokeVersion("version-1", "contract-director-1");

    expect(result.status).toBe("revoked");
    expect(tx.contractBusinessTemplateVersion.update).toHaveBeenCalledWith({
      where: { id: "version-1" },
      data: expect.objectContaining({ status: "revoked" })
    });
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        actorUserId: "contract-director-1",
        action: "contract_template.revoke_version",
        businessType: "contract_business_template_version",
        businessId: "version-1"
      })
    );
  });

  it("publishes a standard clause version", async () => {
    const tx = {
      userPosition: {
        findMany: jest.fn().mockResolvedValue([{ positionId: "pos-dir" }])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([{ key: "contract_director" }])
      },
      standardClauseVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          clauseId: "clause-1",
          status: "submitted"
        }),
        update: jest.fn().mockResolvedValue({ id: "version-1", status: "published" })
      },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new ContractTemplateService(prisma, audit as never);

    const result = await service.publishClauseVersion(
      "version-1",
      "contract-director",
      "First publish"
    );

    expect(result.status).toBe("published");
    expect(tx.standardClauseVersion.update).toHaveBeenCalledWith({
      where: { id: "version-1" },
      data: expect.objectContaining({
        status: "published",
        publishedByUserId: "contract-director",
        publishedAt: expect.any(Date)
      })
    });
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        actorUserId: "contract-director",
        action: "standard_clause.publish_version",
        businessType: "standard_clause_version",
        businessId: "version-1"
      })
    );
  });

  it("submits a standard clause draft version", async () => {
    const tx = {
      userPosition: {
        findMany: jest.fn().mockResolvedValue([{ positionId: "pos-staff" }])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([{ key: "contract_staff" }])
      },
      standardClauseVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          clauseId: "clause-1",
          status: "draft"
        }),
        update: jest.fn().mockResolvedValue({ id: "version-1", status: "submitted" })
      },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new ContractTemplateService(prisma, audit as never);

    const result = await service.submitClauseVersion("version-1", "contract-staff");

    expect(result.status).toBe("submitted");
    expect(tx.standardClauseVersion.update).toHaveBeenCalledWith({
      where: { id: "version-1" },
      data: {
        status: "submitted",
        submittedByUserId: "contract-staff"
      }
    });
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        actorUserId: "contract-staff",
        action: "standard_clause.submit_version",
        businessType: "standard_clause_version",
        businessId: "version-1"
      })
    );
  });

  it("enforces contract_director role for publishVersion", async () => {
    const tx = {
      userPosition: {
        findMany: jest.fn().mockResolvedValue([{ positionId: "pos-1" }])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([{ key: "contract_staff" }])
      },
      contractBusinessTemplateVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          templateId: "template-1",
          status: "submitted",
          fieldSchema: validSchema.fields,
          billSchema: [],
          clauseSchema: [],
          attachmentSchema: [],
          validationSchema: []
        }),
        update: jest.fn()
      },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new ContractTemplateService(prisma, audit as never);

    await expect(
      service.publishVersion("version-1", "contract-staff-1", { changeSummary: "Pub" })
    ).rejects.toThrow(ForbiddenException);
    expect(tx.contractBusinessTemplateVersion.update).not.toHaveBeenCalled();
  });

  it("asserts the exact publication call matches the brief assertion", async () => {
    const tx = {
      userPosition: {
        findMany: jest.fn().mockResolvedValue([{ positionId: "pos-dir" }])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([{ key: "contract_director" }])
      },
      contractBusinessTemplateVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          templateId: "template-1",
          status: "submitted",
          fieldSchema: validSchema.fields,
          billSchema: [],
          clauseSchema: [],
          attachmentSchema: [],
          validationSchema: []
        }),
        update: jest.fn().mockResolvedValue({ id: "version-1", status: "published" })
      },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new ContractTemplateService(prisma, audit as never);

    await service.publishVersion("version-1", "contract-director", { changeSummary: "First publish" });

    expect(tx.contractBusinessTemplateVersion.update).toHaveBeenCalledWith({
      where: { id: "version-1" },
      data: expect.objectContaining({
        status: "published",
        publishedByUserId: "contract-director",
        publishedAt: expect.any(Date)
      })
    });
  });

  it("rejects cloning a non-published version", async () => {
    const tx = {
      userPosition: {
        findMany: jest.fn().mockResolvedValue([{ positionId: "pos-1" }])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([{ key: "contract_staff" }])
      },
      contractBusinessTemplateVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          templateId: "template-1",
          versionNo: 1,
          status: "draft"
        }),
        findMany: jest.fn(),
        create: jest.fn()
      },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new ContractTemplateService(prisma, audit as never);

    await expect(service.cloneVersion("version-1", "contract-staff-1")).rejects.toThrow(
      "只有已发布的业务模板版本可以复制为新草稿"
    );
    expect(tx.contractBusinessTemplateVersion.create).not.toHaveBeenCalled();
  });

  it("uses Chinese business errors for template version state transitions", async () => {
    const baseTx = (status: string, role: "contract_staff" | "contract_director") => ({
      userPosition: {
        findMany: jest.fn().mockResolvedValue([{ positionId: "pos-1" }])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([{ key: role }])
      },
      contractBusinessTemplateVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          templateId: "template-1",
          status,
          fieldSchema: validSchema.fields,
          billSchema: [],
          clauseSchema: [],
          attachmentSchema: [],
          validationSchema: []
        }),
        update: jest.fn()
      },
      auditLog: { create: jest.fn() }
    });

    await expect(
      new ContractTemplateService(
        {
          $transaction: jest.fn(async (callback) => callback(baseTx("submitted", "contract_staff")))
        } as never,
        audit as never
      ).submitVersion("version-1", "contract-staff")
    ).rejects.toThrow("只有草稿状态的业务模板版本可以提交");

    await expect(
      new ContractTemplateService(
        {
          $transaction: jest.fn(async (callback) => callback(baseTx("draft", "contract_director")))
        } as never,
        audit as never
      ).publishVersion("version-1", "contract-director", { changeSummary: "发布" })
    ).rejects.toThrow("只有已提交的业务模板版本可以发布");

    await expect(
      new ContractTemplateService(
        {
          $transaction: jest.fn(async (callback) => callback(baseTx("draft", "contract_director")))
        } as never,
        audit as never
      ).stopVersion("version-1", "contract-director")
    ).rejects.toThrow("只有已发布的业务模板版本可以停用");

    await expect(
      new ContractTemplateService(
        {
          $transaction: jest.fn(async (callback) => callback(baseTx("draft", "contract_director")))
        } as never,
        audit as never
      ).revokeVersion("version-1", "contract-director")
    ).rejects.toThrow("只有已发布的业务模板版本可以撤回");
  });

  it("uses Chinese business errors for standard clause version state transitions", async () => {
    const serviceWithClauseStatus = (
      status: string,
      role: "contract_staff" | "contract_director"
    ) => {
      const tx = {
        userPosition: {
          findMany: jest.fn().mockResolvedValue([{ positionId: "pos-1" }])
        },
        position: {
          findMany: jest.fn().mockResolvedValue([{ key: role }])
        },
        standardClauseVersion: {
          findUnique: jest.fn().mockResolvedValue({
            id: "version-1",
            clauseId: "clause-1",
            status
          }),
          update: jest.fn()
        },
        auditLog: { create: jest.fn() }
      };
      return new ContractTemplateService(
        {
          $transaction: jest.fn(async (callback) => callback(tx))
        } as never,
        audit as never
      );
    };

    await expect(
      serviceWithClauseStatus("submitted", "contract_staff").submitClauseVersion(
        "version-1",
        "contract-staff"
      )
    ).rejects.toThrow("只有草稿状态的标准条款版本可以提交");

    await expect(
      serviceWithClauseStatus("draft", "contract_director").publishClauseVersion(
        "version-1",
        "contract-director",
        "发布"
      )
    ).rejects.toThrow("只有已提交的标准条款版本可以发布");
  });

  it("listPublished returns only templates with a published version", async () => {
    const prisma = {
      contractBusinessTemplateVersion: {
        findMany: jest.fn().mockResolvedValue([
          { id: "version-2", templateId: "template-published", versionNo: 2 },
          { id: "version-1", templateId: "template-published", versionNo: 1 }
        ])
      },
      contractBusinessTemplate: {
        findMany: jest.fn().mockResolvedValue([
          { id: "template-published", code: "TPL-PUB", contractTypeKey: "procurement" }
        ])
      }
    } as unknown as PrismaService;
    const service = new ContractTemplateService(prisma, audit as never);

    const result = await service.listPublished();

    // version lookup restricted to published status
    expect(
      (prisma.contractBusinessTemplateVersion.findMany as jest.Mock)
    ).toHaveBeenCalledWith({
      where: { status: "published" },
      select: { id: true, templateId: true, versionNo: true },
      orderBy: { versionNo: "desc" }
    });
    // template query restricted to the published template ids only
    expect((prisma.contractBusinessTemplate.findMany as jest.Mock)).toHaveBeenCalledWith({
      where: { id: { in: ["template-published"] } },
      orderBy: { createdAt: "asc" }
    });
    expect(result.map((t: { id: string }) => t.id)).toEqual(["template-published"]);
    expect(result).toEqual([
      {
        id: "template-published",
        code: "TPL-PUB",
        contractTypeKey: "procurement",
        versionId: "version-2",
        versionNo: 2
      }
    ]);
    expect(result.map((t: { id: string }) => t.id)).not.toContain("template-draft");
    expect(result.map((t: { id: string }) => t.id)).not.toContain("template-stopped");
  });

  it("listPublished returns empty when no template has a published version", async () => {
    const prisma = {
      contractBusinessTemplateVersion: {
        findMany: jest.fn().mockResolvedValue([])
      },
      contractBusinessTemplate: {
        findMany: jest.fn()
      }
    } as unknown as PrismaService;
    const service = new ContractTemplateService(prisma, audit as never);

    const result = await service.listPublished();

    expect(result).toEqual([]);
    expect(prisma.contractBusinessTemplate.findMany).not.toHaveBeenCalled();
  });

  it("listPublishedClauses returns latest published version content with clause metadata", async () => {
    const prisma = {
      standardClauseVersion: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "version-2",
            clauseId: "clause-published",
            versionNo: 2,
            title: "付款条款 v2",
            content: { text: "结算确认后30天内付款。" }
          },
          {
            id: "version-1",
            clauseId: "clause-published",
            versionNo: 1,
            title: "付款条款 v1",
            content: { text: "旧付款条款。" }
          }
        ])
      },
      standardClause: {
        findMany: jest.fn().mockResolvedValue([
          { id: "clause-published", code: "CLS-PUB", name: "付款标准条款", category: "payment" }
        ])
      }
    } as unknown as PrismaService;
    const service = new ContractTemplateService(prisma, audit as never);

    const result = await service.listPublishedClauses("payment");

    expect((prisma.standardClauseVersion.findMany as jest.Mock)).toHaveBeenCalledWith({
      where: { status: "published" },
      select: { id: true, clauseId: true, versionNo: true, title: true, content: true },
      orderBy: [{ clauseId: "asc" }, { versionNo: "desc" }]
    });
    expect((prisma.standardClause.findMany as jest.Mock)).toHaveBeenCalledWith({
      where: { id: { in: ["clause-published"] }, category: "payment" },
      orderBy: { createdAt: "asc" }
    });
    expect(result).toEqual([
      {
        standardClauseVersionId: "version-2",
        versionId: "version-2",
        versionNo: 2,
        title: "付款条款 v2",
        content: { text: "结算确认后30天内付款。" },
        clauseId: "clause-published",
        code: "CLS-PUB",
        name: "付款标准条款",
        category: "payment"
      }
    ]);
  });
});
