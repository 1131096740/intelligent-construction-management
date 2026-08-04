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

  const governedBill = {
    key: "main_bill",
    name: "主清单",
    amountRole: "included" as const,
    pricingMode: "tax_inclusive" as const,
    quantityScale: 2,
    unitPriceScale: 2,
    columns: [
      { key: "itemName", label: "项目名称", type: "text" as const, required: true }
    ]
  };

  const zeroTaxRateField = {
    key: "taxRatePercent",
    label: "税率(%)",
    type: "single_select" as const,
    required: true,
    options: [
      { label: "0%", value: "0" },
      { label: "13%", value: "13" }
    ]
  };

  it("returns template detail with descending versions and complete schemas", async () => {
    const template = {
      id: "template-1",
      code: "TPL-001",
      businessCode: "合同模板-钢材采购-V1",
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
    const tx = {
      userPosition: { findMany: jest.fn().mockResolvedValue([{ positionId: "position-1" }]) },
      position: { findMany: jest.fn().mockResolvedValue([{ key: "contract_staff" }]) },
      contractBusinessTemplate: { findUnique: jest.fn().mockResolvedValue(template) },
      contractBusinessTemplateVersion: { findMany: jest.fn().mockResolvedValue(versions) },
      contractScenarioTemplateMapping: { findFirst: jest.fn().mockResolvedValue(null) },
      contractVersion: { findFirst: jest.fn().mockResolvedValue(null) }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
    } as unknown as PrismaService;
    const service = new ContractTemplateService(prisma, audit as never);

    await expect(service.getTemplate("template-1", "staff-1")).resolves.toEqual({
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
    expect(tx.contractBusinessTemplateVersion.findMany).toHaveBeenCalledWith({
      where: { templateId: "template-1", status: { not: "discarded" } },
      orderBy: { versionNo: "desc" }
    });
    expect(audit.record).not.toHaveBeenCalled();
    const result = await service.getTemplate("template-1", "staff-1");
    expect(result.versions[0]?.availableActions).toContainEqual(
      expect.objectContaining({ key: "discard_version", enabled: true })
    );
    expect(result.versions[0]?.availableActions).toContainEqual(
      expect.objectContaining({
        key: "risk_stop",
        enabled: false,
        disabledReason: expect.stringContaining("只有已发布的业务模板版本可以风险停用")
      })
    );
    expect(result.versions[1]?.availableActions).toContainEqual(
      expect.objectContaining({ key: "discard_version", enabled: false })
    );
    expect(result.versions[1]?.availableActions).toContainEqual(
      expect.objectContaining({
        key: "risk_stop",
        enabled: false,
        disabledReason: "只有合同主管可以风险停用已发布模板版本"
      })
    );
  });

  it("only enables the server risk-stop action for a director and an unmapped published version", async () => {
    const version = {
      id: "version-1",
      templateId: "template-1",
      versionNo: 1,
      status: "published",
      fieldSchema: [],
      billSchema: [],
      clauseSchema: [],
      attachmentSchema: [],
      validationSchema: [],
      submittedByUserId: "staff-1",
      publishedByUserId: "director-1",
      publishedAt: new Date("2026-07-10T08:00:00.000Z"),
      stoppedAt: null,
      revokedAt: null,
      changeSummary: "首次发布",
      createdAt: new Date("2026-07-10T00:00:00.000Z"),
      updatedAt: new Date("2026-07-10T08:00:00.000Z")
    };
    const tx = {
      userPosition: { findMany: jest.fn().mockResolvedValue([{ positionId: "position-1" }]) },
      position: { findMany: jest.fn().mockResolvedValue([{ key: "contract_director" }]) },
      contractBusinessTemplate: {
        findUnique: jest.fn().mockResolvedValue({
          id: "template-1",
          code: "TPL-001",
          name: "采购合同模板",
          contractTypeKey: "material_purchase",
          status: "published"
        })
      },
      contractBusinessTemplateVersion: { findMany: jest.fn().mockResolvedValue([version]) },
      contractScenarioTemplateMapping: { findFirst: jest.fn().mockResolvedValue(null) },
      contractVersion: { findFirst: jest.fn().mockResolvedValue(null) }
    };
    const service = new ContractTemplateService(
      { $transaction: jest.fn(async (callback) => callback(tx)) } as never,
      audit as never
    );

    const result = await service.getTemplate("template-1", "director-1");

    expect(result.versions[0]?.availableActions).toContainEqual(
      expect.objectContaining({
        key: "risk_stop",
        label: "风险停用",
        kind: "danger",
        enabled: true,
        disabledReason: null
      })
    );
  });

  it("disables the server risk-stop action while an active scenario mapping exists", async () => {
    const version = {
      id: "version-1",
      templateId: "template-1",
      versionNo: 1,
      status: "published",
      fieldSchema: [],
      billSchema: [],
      clauseSchema: [],
      attachmentSchema: [],
      validationSchema: [],
      submittedByUserId: "staff-1",
      publishedByUserId: "director-1",
      publishedAt: new Date("2026-07-10T08:00:00.000Z"),
      stoppedAt: null,
      revokedAt: null,
      changeSummary: "首次发布",
      createdAt: new Date("2026-07-10T00:00:00.000Z"),
      updatedAt: new Date("2026-07-10T08:00:00.000Z")
    };
    const tx = {
      userPosition: { findMany: jest.fn().mockResolvedValue([{ positionId: "position-1" }]) },
      position: { findMany: jest.fn().mockResolvedValue([{ key: "contract_director" }]) },
      contractBusinessTemplate: {
        findUnique: jest.fn().mockResolvedValue({
          id: "template-1",
          code: "TPL-001",
          name: "采购合同模板",
          contractTypeKey: "material_purchase",
          status: "published"
        })
      },
      contractBusinessTemplateVersion: { findMany: jest.fn().mockResolvedValue([version]) },
      contractScenarioTemplateMapping: {
        findFirst: jest.fn().mockResolvedValue({ id: "mapping-1", active: true })
      },
      contractVersion: { findFirst: jest.fn().mockResolvedValue(null) }
    };
    const service = new ContractTemplateService(
      { $transaction: jest.fn(async (callback) => callback(tx)) } as never,
      audit as never
    );

    const result = await service.getTemplate("template-1", "director-1");

    expect(result.versions[0]?.availableActions).toContainEqual(
      expect.objectContaining({
        key: "risk_stop",
        enabled: false,
        disabledReason: "该模板版本仍有启用的业务场景映射，请先停用映射"
      })
    );
    expect(tx.contractScenarioTemplateMapping.findFirst).toHaveBeenCalledWith({
      where: { businessTemplateVersionId: "version-1", active: true },
      select: { id: true }
    });
  });

  it("returns a fixed not-found error for missing template detail", async () => {
    const tx = {
      userPosition: { findMany: jest.fn().mockResolvedValue([{ positionId: "position-1" }]) },
      position: { findMany: jest.fn().mockResolvedValue([{ key: "contract_staff" }]) },
      contractBusinessTemplate: { findUnique: jest.fn().mockResolvedValue(null) },
      contractBusinessTemplateVersion: { findMany: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
    } as unknown as PrismaService;
    const service = new ContractTemplateService(prisma, audit as never);

    await expect(service.getTemplate("missing-template", "staff-1")).rejects.toEqual(
      new NotFoundException("业务模板不存在")
    );
    expect(tx.contractBusinessTemplateVersion.findMany).not.toHaveBeenCalled();
  });

  it("keeps legacy published precision and zero-percent options readable without rewriting them", async () => {
    const legacySchema = {
      fields: [zeroTaxRateField],
      bills: [{ ...governedBill, quantityScale: 3 }],
      clauses: [],
      attachments: [],
      validations: []
    };
    const template = {
      id: "template-legacy",
      status: "published"
    };
    const version = {
      id: "version-legacy",
      templateId: "template-legacy",
      versionNo: 1,
      status: "published",
      fieldSchema: legacySchema.fields,
      billSchema: legacySchema.bills,
      clauseSchema: [],
      attachmentSchema: [],
      validationSchema: [],
      submittedByUserId: "contract-staff-1",
      publishedByUserId: "contract-director-1",
      publishedAt: new Date("2026-07-01T00:00:00.000Z"),
      stoppedAt: null,
      revokedAt: null,
      changeSummary: "历史模板",
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      updatedAt: new Date("2026-07-01T00:00:00.000Z")
    };
    const tx = {
        contractBusinessTemplate: {
          findUnique: jest.fn().mockResolvedValue(template)
        },
        contractBusinessTemplateVersion: {
          findMany: jest.fn().mockResolvedValue([version])
        },
        contractScenarioTemplateMapping: { findFirst: jest.fn().mockResolvedValue(null) },
        contractVersion: { findFirst: jest.fn().mockResolvedValue(null) },
        userPosition: { findMany: jest.fn().mockResolvedValue([{ positionId: "position-1" }]) },
        position: { findMany: jest.fn().mockResolvedValue([{ key: "contract_staff" }]) }
      };
    const service = new ContractTemplateService(
      { $transaction: jest.fn(async (callback) => callback(tx)) } as never,
      audit as never
    );

    await expect(service.getTemplate("template-legacy", "staff-1")).resolves.toMatchObject({
      versions: [
        {
          id: "version-legacy",
          schema: legacySchema
        }
      ]
    });
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
      businessCode: "合同模板-钢材采购-V1",
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
    expect(tx.contractBusinessTemplate.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        code: "TPL-001",
        businessCode: "合同模板-钢材采购-V1"
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

  it("allows a contract director to create a template draft", async () => {
    const tx = {
      userPosition: { findMany: jest.fn().mockResolvedValue([{ positionId: "pos-dir" }]) },
      position: { findMany: jest.fn().mockResolvedValue([{ key: "contract_director" }]) },
      contractBusinessTemplate: {
        create: jest.fn().mockResolvedValue({ id: "template-1", code: "TPL-001" })
      },
      contractBusinessTemplateVersion: {
        create: jest.fn().mockResolvedValue({ id: "version-1", versionNo: 1, status: "draft" })
      }
    };
    const service = new ContractTemplateService(
      { $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)) } as never,
      audit as never
    );

    await expect(service.createTemplate("contract-director-1", {
      code: "TPL-001",
      businessCode: "合同模板-钢材采购-V1",
      name: "钢材采购合同模板",
      contractTypeKey: "procurement",
      schema: validSchema
    })).resolves.toEqual(expect.objectContaining({
      template: expect.objectContaining({ id: "template-1" })
    }));
  });

  it("rejects saving a new template whose quantity precision is not exactly two", async () => {
    const tx = {
      userPosition: {
        findMany: jest.fn().mockResolvedValue([{ positionId: "pos-staff" }])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([{ key: "contract_staff" }])
      },
      contractBusinessTemplate: { create: jest.fn() },
      contractBusinessTemplateVersion: { create: jest.fn() }
    };
    const service = new ContractTemplateService(
      {
        $transaction: jest.fn(async (callback) => callback(tx))
      } as never,
      audit as never
    );

    await expect(
      service.createTemplate("contract-staff-1", {
        code: "TPL-PRECISION",
        businessCode: "合同模板-精度治理-V1",
        name: "精度治理模板",
        contractTypeKey: "material_purchase",
        schema: {
          ...validSchema,
          bills: [{ ...governedBill, quantityScale: 3 }]
        }
      })
    ).rejects.toThrow("新模板清单数量精度必须为 2 位小数");
    expect(tx.contractBusinessTemplate.create).not.toHaveBeenCalled();
    expect(tx.contractBusinessTemplateVersion.create).not.toHaveBeenCalled();
  });

  it("rejects saving a draft that configures a zero-percent tax-rate option", async () => {
    const tx = {
      userPosition: {
        findMany: jest.fn().mockResolvedValue([{ positionId: "pos-staff" }])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([{ key: "contract_staff" }])
      },
      contractBusinessTemplateVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          status: "draft"
        }),
        update: jest.fn()
      }
    };
    const service = new ContractTemplateService(
      {
        $transaction: jest.fn(async (callback) => callback(tx))
      } as never,
      audit as never
    );

    await expect(
      service.updateDraftVersion("version-1", "contract-staff-1", {
        schema: {
          ...validSchema,
          fields: [zeroTaxRateField],
          bills: [governedBill]
        }
      })
    ).rejects.toThrow("新模板税率配置不能包含 0%");
    expect(tx.contractBusinessTemplateVersion.update).not.toHaveBeenCalled();
  });

  it("rechecks new-template precision before submission", async () => {
    const tx = {
      userPosition: {
        findMany: jest.fn().mockResolvedValue([{ positionId: "pos-staff" }])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([{ key: "contract_staff" }])
      },
      contractBusinessTemplateVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          status: "draft",
          fieldSchema: validSchema.fields,
          billSchema: [{ ...governedBill, quantityScale: 3 }],
          clauseSchema: [],
          attachmentSchema: [],
          validationSchema: []
        }),
        update: jest.fn()
      }
    };
    const service = new ContractTemplateService(
      {
        $transaction: jest.fn(async (callback) => callback(tx))
      } as never,
      audit as never
    );

    await expect(
      service.submitVersion("version-1", "contract-staff-1")
    ).rejects.toThrow("新模板清单数量精度必须为 2 位小数");
    expect(tx.contractBusinessTemplateVersion.update).not.toHaveBeenCalled();
  });

  it("rechecks zero-percent tax configuration before publication", async () => {
    const tx = {
      userPosition: {
        findMany: jest.fn().mockResolvedValue([{ positionId: "pos-director" }])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([{ key: "contract_director" }])
      },
      contractBusinessTemplateVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          status: "submitted",
          fieldSchema: [zeroTaxRateField],
          billSchema: [governedBill],
          clauseSchema: [],
          attachmentSchema: [],
          validationSchema: []
        }),
        update: jest.fn()
      }
    };
    const service = new ContractTemplateService(
      {
        $transaction: jest.fn(async (callback) => callback(tx))
      } as never,
      audit as never
    );

    await expect(
      service.publishVersion("version-1", "contract-director-1", {
        changeSummary: "发布"
      })
    ).rejects.toThrow("新模板税率配置不能包含 0%");
    expect(tx.contractBusinessTemplateVersion.update).not.toHaveBeenCalled();
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

  it("normalizes a cloned legacy template into a governed new draft without mutating the source", async () => {
    const legacyFields = [zeroTaxRateField];
    const legacyBills = [{ ...governedBill, quantityScale: 3 }];
    const tx = {
      userPosition: {
        findMany: jest.fn().mockResolvedValue([{ positionId: "pos-1" }])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([{ key: "contract_staff" }])
      },
      contractBusinessTemplateVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-legacy",
          templateId: "template-1",
          versionNo: 1,
          status: "published",
          fieldSchema: legacyFields,
          billSchema: legacyBills,
          clauseSchema: [],
          attachmentSchema: [],
          validationSchema: []
        }),
        findMany: jest.fn().mockResolvedValue([{ versionNo: 1 }]),
        create: jest.fn().mockResolvedValue({
          id: "version-2",
          versionNo: 2,
          status: "draft"
        })
      }
    };
    const service = new ContractTemplateService(
      {
        $transaction: jest.fn(async (callback) => callback(tx))
      } as never,
      audit as never
    );

    await service.cloneVersion("version-legacy", "contract-staff-1");

    expect(tx.contractBusinessTemplateVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        fieldSchema: [
          expect.objectContaining({
            key: "taxRatePercent",
            options: [{ label: "13%", value: "13" }]
          })
        ],
        billSchema: [
          expect.objectContaining({
            key: "main_bill",
            quantityScale: 2,
            unitPriceScale: 2
          })
        ]
      })
    });
    expect(legacyFields[0].options).toEqual([
      { label: "0%", value: "0" },
      { label: "13%", value: "13" }
    ]);
    expect(legacyBills[0].quantityScale).toBe(3);
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
      contractScenarioTemplateMapping: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([{ id: "template-1" }])
        .mockResolvedValueOnce([{
          id: "version-1",
          templateId: "template-1",
          status: "published"
        }]),
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
    expect(tx.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(
      tx.contractScenarioTemplateMapping.findFirst.mock.invocationCallOrder[0]
    );
    expect(tx.contractScenarioTemplateMapping.findFirst.mock.invocationCallOrder[0]).toBeLessThan(
      tx.contractBusinessTemplateVersion.update.mock.invocationCallOrder[0]
    );
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
    );
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

  it("refuses to stop a template version while an active scenario mapping references it", async () => {
    const tx = {
      userPosition: { findMany: jest.fn().mockResolvedValue([{ positionId: "pos-dir" }]) },
      position: { findMany: jest.fn().mockResolvedValue([{ key: "contract_director" }]) },
      contractBusinessTemplateVersion: {
        findUnique: jest.fn().mockResolvedValue({ templateId: "template-1" }),
        update: jest.fn()
      },
      contractScenarioTemplateMapping: {
        findFirst: jest.fn().mockResolvedValue({ id: "mapping-1" })
      },
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([{ id: "template-1" }])
        .mockResolvedValueOnce([{
          id: "version-1",
          templateId: "template-1",
          status: "published"
        }])
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx))
    } as unknown as PrismaService;
    const service = new ContractTemplateService(prisma, audit as never);

    await expect(service.stopVersion("version-1", "contract-director-1")).rejects.toThrow(
      "请先停用映射"
    );
    expect(tx.contractBusinessTemplateVersion.update).not.toHaveBeenCalled();
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
      contractScenarioTemplateMapping: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([{ id: "template-1" }])
        .mockResolvedValueOnce([{
          id: "version-1",
          templateId: "template-1",
          status: "published"
        }]),
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
    expect(tx.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(
      tx.contractBusinessTemplateVersion.update.mock.invocationCallOrder[0]
    );
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
    );
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

  it("rejects revoking a version while an active scenario mapping still points to it", async () => {
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
        update: jest.fn()
      },
      contractScenarioTemplateMapping: {
        findFirst: jest.fn().mockResolvedValue({ id: "mapping-1" })
      },
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([{ id: "template-1" }])
        .mockResolvedValueOnce([{
          id: "version-1",
          templateId: "template-1",
          status: "published"
        }])
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new ContractTemplateService(prisma, audit as never);

    await expect(
      service.revokeVersion("version-1", "contract-director-1")
    ).rejects.toThrow("请先停用映射");
    expect(tx.contractBusinessTemplateVersion.update).not.toHaveBeenCalled();
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
      contractScenarioTemplateMapping: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([{ id: "template-1" }])
        .mockResolvedValueOnce([{
          id: "version-1",
          templateId: "template-1",
          status
        }]),
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
            businessCode: "合同模板-采购-V1",
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
        businessCode: true,
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
        businessCode: "合同模板-采购-V1",
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

  it("discards an unreferenced pristine business template draft exactly once", async () => {
    const tx = {
      userPosition: { findMany: jest.fn().mockResolvedValue([{ positionId: "position-1" }]) },
      position: { findMany: jest.fn().mockResolvedValue([{ key: "contract_staff" }]) },
      contractBusinessTemplate: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      contractBusinessTemplateVersion: {
        findUnique: jest.fn().mockResolvedValue({ templateId: "template-1" }),
        findMany: jest.fn().mockResolvedValue([{ id: "version-1" }]),
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contractScenarioTemplateMapping: { findFirst: jest.fn().mockResolvedValue(null) },
      contractVersion: { findFirst: jest.fn().mockResolvedValue(null) },
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ id: "template-1", status: "draft" }])
        .mockResolvedValueOnce([{
          id: "version-1",
          templateId: "template-1",
          status: "draft",
          submittedByUserId: null,
          publishedAt: null,
          stoppedAt: null,
          revokedAt: null,
          discardedAt: null,
          updatedAt: new Date("2026-07-20T00:00:00.000Z")
        }])
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
    } as unknown as PrismaService;
    const service = new ContractTemplateService(prisma, audit as never);

    await expect(service.discardVersion(
      "version-1",
      "staff-1",
      "误建草稿",
      "2026-07-20T00:00:00.000Z"
    )).resolves.toMatchObject({
      id: "version-1",
      status: "discarded"
    });
    expect(tx.contractBusinessTemplateVersion.updateMany).toHaveBeenCalledWith({
      where: {
        id: "version-1",
        status: "draft",
        updatedAt: new Date("2026-07-20T00:00:00.000Z"),
        discardedAt: null
      },
      data: expect.objectContaining({ status: "discarded", discardReason: "误建草稿" })
    });
    expect(audit.record).toHaveBeenCalledTimes(1);
  });

  it("rejects stale business template discard before reference or state writes", async () => {
    const tx = {
      userPosition: { findMany: jest.fn().mockResolvedValue([{ positionId: "position-1" }]) },
      position: { findMany: jest.fn().mockResolvedValue([{ key: "contract_staff" }]) },
      contractBusinessTemplateVersion: {
        findUnique: jest.fn().mockResolvedValue({ templateId: "template-1" }),
        updateMany: jest.fn()
      },
      contractScenarioTemplateMapping: { findFirst: jest.fn() },
      contractVersion: { findFirst: jest.fn() },
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ id: "template-1", status: "draft" }])
        .mockResolvedValueOnce([{
          id: "version-1",
          templateId: "template-1",
          status: "draft",
          submittedByUserId: null,
          publishedAt: null,
          stoppedAt: null,
          revokedAt: null,
          discardedAt: null,
          updatedAt: new Date("2026-07-20T00:00:01.000Z")
        }])
    };
    const service = new ContractTemplateService(
      { $transaction: jest.fn(async (callback) => callback(tx)) } as never,
      audit as never
    );

    await expect(service.discardVersion(
      "version-1",
      "staff-1",
      "误建草稿",
      "2026-07-20T00:00:00.000Z"
    )).rejects.toMatchObject({ status: 409 });
    expect(tx.contractScenarioTemplateMapping.findFirst).not.toHaveBeenCalled();
    expect(tx.contractVersion.findFirst).not.toHaveBeenCalled();
    expect(tx.contractBusinessTemplateVersion.updateMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("returns an already discarded business template version idempotently before CAS", async () => {
    const discardedAt = new Date("2026-07-20T00:00:02.000Z");
    const tx = {
      userPosition: { findMany: jest.fn().mockResolvedValue([{ positionId: "position-1" }]) },
      position: { findMany: jest.fn().mockResolvedValue([{ key: "contract_staff" }]) },
      contractBusinessTemplateVersion: {
        findUnique: jest.fn().mockResolvedValue({ templateId: "template-1" }),
        updateMany: jest.fn()
      },
      contractScenarioTemplateMapping: { findFirst: jest.fn() },
      contractVersion: { findFirst: jest.fn() },
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ id: "template-1", status: "discarded" }])
        .mockResolvedValueOnce([{
          id: "version-1",
          templateId: "template-1",
          status: "discarded",
          discardedAt,
          updatedAt: discardedAt
        }])
    };
    const service = new ContractTemplateService(
      { $transaction: jest.fn(async (callback) => callback(tx)) } as never,
      audit as never
    );

    await expect(service.discardVersion(
      "version-1",
      "staff-1",
      "重复请求",
      "2026-07-19T00:00:00.000Z"
    )).resolves.toEqual({ id: "version-1", status: "discarded", discardedAt });
    expect(tx.contractScenarioTemplateMapping.findFirst).not.toHaveBeenCalled();
    expect(tx.contractBusinessTemplateVersion.updateMany).not.toHaveBeenCalled();
  });

  it("fails closed when a standard clause draft is referenced in governed JSON", async () => {
    const tx = {
      userPosition: { findMany: jest.fn().mockResolvedValue([{ positionId: "position-1" }]) },
      position: { findMany: jest.fn().mockResolvedValue([{ key: "contract_director" }]) },
      standardClauseVersion: { updateMany: jest.fn() },
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{
          id: "clause-version-1",
          clauseId: "clause-1",
          status: "draft",
          submittedByUserId: null,
          publishedAt: null,
          discardedAt: null,
          updatedAt: new Date("2026-07-20T00:00:00.000Z")
        }])
        .mockResolvedValueOnce([{ referenced: true }])
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
    } as unknown as PrismaService;
    const service = new ContractTemplateService(prisma, audit as never);

    await expect(
      service.discardClauseVersion(
        "clause-version-1",
        "director-1",
        "废弃",
        "2026-07-20T00:00:00.000Z"
      )
    ).rejects.toThrow("该标准条款版本已被模板或合同快照引用，不能废弃");
    expect(tx.standardClauseVersion.updateMany).not.toHaveBeenCalled();
  });

  it("rejects stale standard clause discard before its JSON reference query", async () => {
    const tx = {
      userPosition: { findMany: jest.fn().mockResolvedValue([{ positionId: "position-1" }]) },
      position: { findMany: jest.fn().mockResolvedValue([{ key: "contract_director" }]) },
      standardClauseVersion: { updateMany: jest.fn() },
      $queryRaw: jest.fn().mockResolvedValueOnce([{
        id: "clause-version-1",
        clauseId: "clause-1",
        status: "draft",
        submittedByUserId: null,
        publishedAt: null,
        discardedAt: null,
        updatedAt: new Date("2026-07-20T00:00:01.000Z")
      }])
    };
    const service = new ContractTemplateService(
      { $transaction: jest.fn(async (callback) => callback(tx)) } as never,
      audit as never
    );

    await expect(service.discardClauseVersion(
      "clause-version-1",
      "director-1",
      "废弃",
      "2026-07-20T00:00:00.000Z"
    )).rejects.toMatchObject({ status: 409 });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.standardClauseVersion.updateMany).not.toHaveBeenCalled();
  });
});
