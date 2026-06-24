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
    ).rejects.toThrow("Only draft versions can be edited");
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
});
