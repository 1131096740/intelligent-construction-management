import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
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

  it("returns template detail with descending versions and complete schemas", async () => {
    const template = {
      id: "template-1",
      code: "TPL-001",
      name: "钢材采购合同模板",
      contractTypeKey: "material_purchase",
      status: "published",
      createdByUserId: "contract-staff-1",
      createdAt: new Date("2026-07-10T00:00:00.000Z"),
      updatedAt: new Date("2026-07-11T00:00:00.000Z")
    };
    const versions = [
      {
        id: "version-2",
        templateId: "template-1",
        versionNo: 2,
        status: "draft",
        fieldSchema: validSchema.fields,
        billSchema: validSchema.bills,
        clauseSchema: validSchema.clauses,
        attachmentSchema: validSchema.attachments,
        validationSchema: validSchema.validations,
        submittedByUserId: null,
        publishedByUserId: null,
        publishedAt: null,
        stoppedAt: null,
        revokedAt: null,
        changeSummary: "补充字段",
        createdAt: new Date("2026-07-11T00:00:00.000Z"),
        updatedAt: new Date("2026-07-11T00:00:00.000Z")
      },
      {
        id: "version-1",
        templateId: "template-1",
        versionNo: 1,
        status: "published",
        fieldSchema: [],
        billSchema: [],
        clauseSchema: [],
        attachmentSchema: [],
        validationSchema: [],
        submittedByUserId: "contract-staff-1",
        publishedByUserId: "contract-director-1",
        publishedAt: new Date("2026-07-10T08:00:00.000Z"),
        stoppedAt: null,
        revokedAt: null,
        changeSummary: "首次发布",
        createdAt: new Date("2026-07-10T00:00:00.000Z"),
        updatedAt: new Date("2026-07-10T08:00:00.000Z")
      }
    ];
    const prisma = {
      contractBusinessTemplate: { findUnique: jest.fn().mockResolvedValue(template) },
      contractBusinessTemplateVersion: { findMany: jest.fn().mockResolvedValue(versions) }
    } as unknown as PrismaService;
    const service = new ContractTemplateService(prisma, audit as never);

    await expect(service.getTemplate("template-1")).resolves.toEqual({
      template,
      versions: [
        expect.objectContaining({ id: "version-2", versionNo: 2, schema: validSchema }),
        expect.objectContaining({
          id: "version-1",
          versionNo: 1,
          schema: { fields: [], bills: [], clauses: [], attachments: [], validations: [] }
        })
      ]
    });
    expect(prisma.contractBusinessTemplateVersion.findMany).toHaveBeenCalledWith({
      where: { templateId: "template-1" },
      orderBy: { versionNo: "desc" }
    });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("returns a fixed not-found error for missing template detail", async () => {
    const prisma = {
      contractBusinessTemplate: { findUnique: jest.fn().mockResolvedValue(null) },
      contractBusinessTemplateVersion: { findMany: jest.fn() }
    } as unknown as PrismaService;
    const service = new ContractTemplateService(prisma, audit as never);

    await expect(service.getTemplate("missing-template")).rejects.toEqual(
      new NotFoundException("业务模板不存在")
    );
    expect(prisma.contractBusinessTemplateVersion.findMany).not.toHaveBeenCalled();
  });

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
    const newestPublishedSchema = {
      fields: [
        {
          key: "supplier_name",
          label: "供应商名称",
          type: "text",
          required: true,
          defaultValue: "不得下发",
          group: "主体信息",
          visibleWhen: { fieldKey: "kind", operator: "eq", value: "supplier" }
        }
      ],
      bills: [
        {
          key: "materials",
          name: "材料清单",
          amountRole: "included",
          pricingMode: "tax_inclusive",
          quantityScale: 3,
          unitPriceScale: 2,
          columns: [
            { key: "material_name", label: "材料名称", type: "text", required: true }
          ]
        }
      ],
      clauses: [
        {
          key: "payment",
          title: "付款约定",
          numberingMode: "automatic",
          required: true,
          standardClauseVersionId: "clause-version-secret",
          content: { text: "不得下发的条款正文" }
        }
      ],
      attachments: [
        { key: "quote", name: "报价单", required: true, mustBeValid: true }
      ],
      validations: [
        {
          key: "payment-check",
          level: "block",
          targetClauseKey: "payment",
          requiredPhrases: ["不得下发"],
          message: "请补齐付款约定"
        }
      ]
    };
    const tx = {
      contractBusinessTemplateVersion: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "version-2",
            templateId: "template-published",
            versionNo: 2,
            fieldSchema: newestPublishedSchema.fields,
            billSchema: newestPublishedSchema.bills,
            clauseSchema: newestPublishedSchema.clauses,
            attachmentSchema: newestPublishedSchema.attachments,
            validationSchema: newestPublishedSchema.validations
          },
          {
            id: "version-1",
            templateId: "template-published",
            versionNo: 1,
            fieldSchema: [{ key: "old", label: "旧版字段", type: "text" }],
            billSchema: [],
            clauseSchema: [],
            attachmentSchema: [],
            validationSchema: []
          }
        ])
      },
      contractBusinessTemplate: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "template-published",
            code: "TPL-PUB",
            name: "采购合同模板",
            contractTypeKey: "procurement",
            createdByUserId: "internal-user",
            createdAt: new Date("2026-07-01T00:00:00.000Z"),
            updatedAt: new Date("2026-07-02T00:00:00.000Z")
          }
        ])
      }
    };
    const prisma = {
      ...tx,
      $transaction: jest.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)
      )
    } as unknown as PrismaService;
    const service = new ContractTemplateService(prisma, audit as never);

    const result = await service.listPublished();

    // version lookup restricted to published status
    expect(
      tx.contractBusinessTemplateVersion.findMany
    ).toHaveBeenCalledWith({
      where: { status: "published" },
      select: {
        id: true,
        templateId: true,
        versionNo: true,
        fieldSchema: true,
        billSchema: true,
        clauseSchema: true,
        attachmentSchema: true,
        validationSchema: true
      },
      orderBy: { versionNo: "desc" }
    });
    // template query restricted to the published template ids only
    expect(tx.contractBusinessTemplate.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["template-published"] } },
      select: {
        id: true,
        code: true,
        name: true,
        contractTypeKey: true
      },
      orderBy: { createdAt: "asc" }
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead
    });
    expect(result.map((t: { id: string }) => t.id)).toEqual(["template-published"]);
    expect(result).toEqual([
      {
        id: "template-published",
        code: "TPL-PUB",
        name: "采购合同模板",
        contractTypeKey: "procurement",
        status: "published",
        versionId: "version-2",
        versionNo: 2,
        usagePreview: {
          fields: [
            {
              label: "供应商名称",
              type: "text",
              required: true,
              group: "主体信息",
              conditional: true
            }
          ],
          bills: [
            {
              name: "材料清单",
              amountRole: "included",
              pricingMode: "tax_inclusive",
              columns: [{ label: "材料名称", type: "text", required: true }]
            }
          ],
          clauses: [{ title: "付款约定", required: true }],
          attachments: [{ name: "报价单", required: true, mustBeValid: true }],
          validations: [{ level: "block", message: "请补齐付款约定" }]
        }
      }
    ]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("旧版字段");
    expect(serialized).not.toContain("不得下发");
    expect(serialized).not.toContain("clause-version-secret");
    expect(serialized).not.toContain("internal-user");
    expect(serialized).not.toContain("2026-07-01");
    expect(audit.record).not.toHaveBeenCalled();
    expect(result.map((t: { id: string }) => t.id)).not.toContain("template-draft");
    expect(result.map((t: { id: string }) => t.id)).not.toContain("template-stopped");
  });

  it("fails closed with one fixed error when a published schema is malformed", async () => {
    const tx = {
      contractBusinessTemplateVersion: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "version-broken",
            templateId: "template-broken",
            versionNo: 1,
            fieldSchema: { secret: "不得泄漏" },
            billSchema: [],
            clauseSchema: [],
            attachmentSchema: [],
            validationSchema: []
          }
        ])
      },
      contractBusinessTemplate: {
        findMany: jest.fn().mockResolvedValue([
          { id: "template-broken", name: "异常模板", contractTypeKey: "procurement" }
        ])
      }
    };
    const prisma = {
      ...tx,
      $transaction: jest.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)
      )
    } as unknown as PrismaService;
    const service = new ContractTemplateService(prisma, audit as never);

    await expect(service.listPublished()).rejects.toEqual(
      new BadRequestException("已发布业务模板结构异常，请联系合同部主管处理")
    );
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("listPublished returns empty when no template has a published version", async () => {
    const tx = {
      contractBusinessTemplateVersion: {
        findMany: jest.fn().mockResolvedValue([])
      },
      contractBusinessTemplate: {
        findMany: jest.fn()
      }
    };
    const prisma = {
      ...tx,
      $transaction: jest.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)
      )
    } as unknown as PrismaService;
    const service = new ContractTemplateService(prisma, audit as never);

    const result = await service.listPublished();

    expect(result).toEqual([]);
    expect(tx.contractBusinessTemplate.findMany).not.toHaveBeenCalled();
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
