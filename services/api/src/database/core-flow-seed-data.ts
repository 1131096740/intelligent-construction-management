export const coreFlowSeedData = {
  users: {
    contractStaff: {
      id: "seed-user-contract-staff",
      name: "合同部 李工",
      phone: "13800000001"
    },
    cashier: {
      id: "seed-user-cashier",
      name: "财务出纳 王会计",
      phone: "13800000002"
    }
  },
  project: {
    id: "seed-project-jgxm-001",
    code: "JGXM-001",
    name: "建设项目一期"
  },
  contract: {
    id: "seed-contract-ht-2026-001",
    code: "HT-2026-001",
    name: "钢材采购合同",
    counterparty: "钢材供应商"
  },
  contractVersion: {
    id: "seed-contract-version-ht-2026-001-v1",
    versionNo: 1,
    changeType: "original",
    status: "effective",
    amountCents: 128000000,
    effectiveAt: new Date("2026-05-01T00:00:00.000Z")
  },
  paymentTermsVersion: {
    id: "seed-payment-terms-ht-2026-001-v1",
    versionNo: 1,
    status: "effective",
    originalText: "当期结算款按已生效结算单金额的80%支付，结算归档确认生效后30天内付款；20%作为质保金，质保期满365天后支付。"
  },
  paymentStages: [
    {
      id: "seed-payment-stage-current-settlement",
      name: "当期结算款",
      basis: "current_settlement",
      ratioBps: 8000,
      triggerEvent: "结算归档确认生效",
      dueDays: 30,
      requiresInvoice: true,
      allowsEarlyPayment: false,
      allowsInstallments: true,
      originalText: "结算归档确认生效后30天内支付当期结算款80%。"
    },
    {
      id: "seed-payment-stage-retention",
      name: "质保金",
      basis: "current_settlement",
      ratioBps: 2000,
      triggerEvent: "质保期满",
      dueDays: 365,
      requiresInvoice: false,
      allowsEarlyPayment: false,
      allowsInstallments: false,
      retentionBps: 2000,
      originalText: "20%作为质保金，质保期满365天后支付。"
    }
  ],
  settlement: {
    id: "seed-settlement-js-2026-018",
    code: "JS-2026-018",
    periodLabel: "2026-05",
    status: "effective",
    amountCents: 32000000,
    payableAmountCents: 25600000,
    paidAmountCents: 12800000
  },
  paymentRequest: {
    id: "seed-payment-request-fk-2026-006",
    code: "FK-2026-006",
    status: "approved_pending_payment",
    requestedAmountCents: 25600000,
    approvedAmountCents: 25600000,
    paidAmountCents: 12800000,
    dueDate: new Date("2026-06-15T00:00:00.000Z")
  },
  voucherFile: {
    id: "seed-file-payment-voucher-fk-2026-006",
    bucket: "private-archive",
    objectKey: "seed/payment-vouchers/FK-2026-006.pdf",
    originalName: "FK-2026-006-付款凭证.pdf",
    mimeType: "application/pdf",
    sizeBytes: 128000
  },
  paymentExecution: {
    id: "seed-payment-execution-fk-2026-006-001",
    amountCents: 12800000,
    paidAt: new Date("2026-06-05T00:00:00.000Z")
  },
  materialPurchaseWorkbench: {
    publishedAt: new Date("2026-06-01T00:00:00.000Z"),
    template: {
      id: "seed-template-material-purchase",
      code: "material_purchase",
      name: "材料采购合同模板",
      contractTypeKey: "material_purchase",
      status: "published"
    },
    version: {
      id: "seed-template-material-purchase-v1",
      versionNo: 1,
      status: "published",
      changeSummary: "初始化材料采购合同模板 v1"
    },
    fields: [
      { key: "deliveryLocation", label: "交货地点", type: "text", required: true, group: "delivery", order: 10 },
      { key: "deliveryDeadline", label: "交货期限", type: "date", required: true, group: "delivery", order: 20 },
      { key: "qualityStandard", label: "质量标准", type: "long_text", required: true, group: "quality", order: 30 },
      { key: "taxRatePercent", label: "税率(%)", type: "number", required: true, group: "tax", order: 40 },
      {
        key: "settlementMethod",
        label: "结算方式",
        type: "single_select",
        required: true,
        group: "settlement",
        order: 50,
        options: [
          { label: "按月结算", value: "monthly" },
          { label: "到货验收后结算", value: "after_acceptance" }
        ]
      }
    ],
    bills: [
      {
        key: "materials",
        name: "材料价格清单",
        amountRole: "included",
        pricingMode: "tax_inclusive",
        quantityScale: 3,
        unitPriceScale: 4,
        columns: [
          { key: "itemName", label: "材料名称", type: "text", required: true },
          { key: "specification", label: "规格型号", type: "text", required: true },
          { key: "unit", label: "单位", type: "text", required: true },
          { key: "quantity", label: "数量", type: "number", required: true },
          { key: "unitPrice", label: "含税单价", type: "number", required: true },
          { key: "taxRatePercent", label: "税率(%)", type: "number", required: true },
          { key: "taxInclusiveAmount", label: "含税金额", type: "number", required: true }
        ]
      },
      {
        key: "transportFees",
        name: "运费清单",
        amountRole: "included",
        pricingMode: "tax_inclusive",
        quantityScale: 2,
        unitPriceScale: 2,
        columns: [
          { key: "route", label: "运输路线", type: "text", required: true },
          { key: "vehicleType", label: "车型", type: "text" },
          { key: "quantity", label: "车次/数量", type: "number", required: true },
          { key: "unitPrice", label: "含税单价", type: "number", required: true },
          { key: "taxInclusiveAmount", label: "含税金额", type: "number", required: true }
        ]
      }
    ],
    clauses: [
      {
        key: "payment",
        title: "付款及结算",
        numberingMode: "automatic",
        required: true,
        standardClauseVersionId: "seed-standard-clause-payment-v1",
        content: {
          text: "甲方依据已生效结算单和合规发票付款，结算归档确认后30日内支付当期应付款的80%，余款按合同约定支付。"
        }
      }
    ],
    attachments: [
      { key: "supplier_quote", name: "供应商报价单", required: false, mustBeValid: true }
    ],
    validations: [
      {
        key: "payment_basis_required",
        level: "block",
        targetClauseKey: "payment",
        requiredPhrases: ["已生效结算单", "合规发票"],
        message: "付款条款必须写明付款依据为已生效结算单和合规发票。"
      }
    ],
    standardPaymentClause: {
      id: "seed-standard-clause-payment",
      code: "STD-PAYMENT-MATERIAL-001",
      category: "payment",
      name: "材料采购标准付款条款",
      versionId: "seed-standard-clause-payment-v1",
      versionNo: 1,
      title: "材料采购付款条款",
      status: "published",
      content: {
        text: "甲方依据已生效结算单和合规发票付款，结算归档确认后30日内支付当期应付款的80%，余款按合同约定支付。"
      }
    },
    layout: {
      id: "seed-layout-material-purchase",
      name: "材料采购合同朴素 A4 版式",
      versionId: "seed-layout-material-purchase-v1",
      versionNo: 1,
      status: "published",
      docxFile: {
        id: "seed-file-layout-material-purchase-v1-docx",
        bucket: "private-local",
        objectKey: "seed/templates/material-purchase-v1.docx",
        originalName: "material-purchase-v1.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      },
      previewPdfFile: {
        id: "seed-file-layout-material-purchase-v1-preview-pdf",
        bucket: "private-local",
        objectKey: "seed/templates/material-purchase-v1-preview.pdf",
        originalName: "material-purchase-v1-preview.pdf",
        mimeType: "application/pdf"
      },
      previewJob: {
        id: "seed-layout-preview-material-purchase-v1",
        status: "succeeded",
        completedAt: new Date("2026-06-01T00:05:00.000Z"),
        sampleData: {
          contract: {
            name: "材料采购合同样张",
            temporaryCode: "TMP-MAT-001",
            amountUppercase: "人民币壹拾贰万捌仟元整"
          },
          field: { deliveryLocation: "项目现场" },
          clause: {
            payment: {
              text: "甲方依据已生效结算单和合规发票付款，结算归档确认后30日内支付当期应付款的80%，余款按合同约定支付。"
            }
          },
          bill: {
            materials: [
              {
                itemName: "钢筋",
                specification: "HRB400E 直径18",
                unit: "吨",
                quantity: "10.000",
                unitPrice: "4200.0000",
                taxRatePercent: "13",
                taxInclusiveAmount: "42000.00"
              }
            ]
          }
        }
      },
      inspectionReport: {
        placeholders: [
          "bill.materials",
          "clause.payment.text",
          "contract.amountUppercase",
          "contract.name",
          "contract.temporaryCode",
          "document.watermark",
          "field.deliveryLocation"
        ],
        unknownPlaceholders: [],
        missingRequiredPlaceholders: [],
        hasBillLoop: true,
        blockingErrors: [],
        warnings: []
      }
    },
    numberingRule: {
      id: "seed-contract-number-rule-material-purchase",
      name: "材料采购合同编号规则",
      pattern: "HT-{project}-{year}-{type}-{sequence}",
      contractTypeKey: "material_purchase",
      nextSequence: 1,
      sequenceWidth: 3,
      isActive: true
    }
  },
  equipmentRentalWorkbench: {
    publishedAt: new Date("2026-06-01T00:00:00.000Z"),
    template: {
      id: "seed-template-equipment-rental",
      code: "equipment_rental",
      name: "工程机械设备租赁合同模板",
      contractTypeKey: "equipment_rental",
      status: "published"
    },
    version: {
      id: "seed-template-equipment-rental-v1",
      versionNo: 1,
      status: "published",
      changeSummary: "初始化工程机械设备租赁合同模板 v1"
    },
    fields: [
      { key: "rentalStartDate", label: "租赁开始日期", type: "date", required: true, group: "period", order: 10 },
      { key: "rentalEndDate", label: "租赁结束日期", type: "date", required: true, group: "period", order: 20 },
      { key: "useLocation", label: "使用项目及地点", type: "text", required: true, group: "project", order: 30 },
      { key: "settlementCycle", label: "对账结算周期", type: "text", required: true, defaultValue: "上月16日至本月15日", group: "settlement", order: 40 },
      { key: "paymentRatioPercent", label: "当期付款比例(%)", type: "number", required: true, defaultValue: 80, group: "payment", order: 50 }
    ],
    bills: [
      {
        key: "equipmentRentals",
        name: "工程机械设备租赁明细表",
        amountRole: "included",
        pricingMode: "tax_inclusive",
        quantityScale: 3,
        unitPriceScale: 4,
        columns: [
          { key: "itemName", label: "机械设备名称或费用名称", type: "text", required: true },
          { key: "specification", label: "规格型号", type: "text" },
          { key: "quantity", label: "暂估数量", type: "number", required: true },
          { key: "unit", label: "计价单位", type: "text", required: true },
          { key: "fuelIncluded", label: "是否含燃油", type: "boolean", required: true },
          { key: "operatorIncluded", label: "是否带操作人员", type: "boolean", required: true },
          { key: "unitPrice", label: "含税租金单价", type: "number", required: true },
          { key: "taxRatePercent", label: "税率(%)", type: "number", required: true },
          { key: "taxInclusiveAmount", label: "价税合计租金", type: "number", required: true },
          { key: "remark", label: "备注", type: "text" }
        ]
      }
    ],
    clauses: [
      {
        key: "payment",
        title: "租金及支付",
        numberingMode: "automatic",
        required: true,
        standardClauseVersionId: "seed-standard-clause-equipment-payment-v1",
        content: {
          text: "甲方依据双方确认的对账结算凭证和合规发票支付租赁费用，当期结算金额按合同约定比例支付，剩余款项按设备安全退场等条件支付。"
        }
      }
    ],
    attachments: [
      { key: "equipment_certificate", name: "设备合格证明或运营证照", required: false, mustBeValid: true }
    ],
    validations: [],
    standardPaymentClause: {
      id: "seed-standard-clause-equipment-payment",
      code: "STD-PAYMENT-EQUIPMENT-001",
      category: "payment",
      name: "机械租赁标准付款条款",
      versionId: "seed-standard-clause-equipment-payment-v1",
      versionNo: 1,
      title: "机械租赁付款条款",
      status: "published",
      content: {
        text: "甲方依据双方确认的对账结算凭证和合规发票支付租赁费用，当期结算金额按合同约定比例支付，剩余款项按设备安全退场等条件支付。"
      }
    },
    layout: {
      id: "seed-layout-equipment-rental",
      name: "工程机械设备租赁合同朴素 A4 版式",
      versionId: "seed-layout-equipment-rental-v1",
      versionNo: 1,
      status: "published",
      docxFile: {
        id: "seed-file-layout-equipment-rental-v1-docx",
        bucket: "private-local",
        objectKey: "seed/templates/equipment-rental-v1.docx",
        originalName: "equipment-rental-v1.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      },
      previewPdfFile: {
        id: "seed-file-layout-equipment-rental-v1-preview-pdf",
        bucket: "private-local",
        objectKey: "seed/templates/equipment-rental-v1-preview.pdf",
        originalName: "equipment-rental-v1-preview.pdf",
        mimeType: "application/pdf"
      },
      previewJob: {
        id: "seed-layout-preview-equipment-rental-v1",
        status: "succeeded",
        completedAt: new Date("2026-06-01T00:05:00.000Z"),
        sampleData: {
          contract: { name: "机械租赁合同样张", temporaryCode: "TMP-EQP-001", amountUppercase: "人民币壹万元整" },
          field: { useLocation: "项目现场" },
          clause: { payment: { text: "甲方依据双方确认的对账结算凭证和合规发票支付租赁费用。" } },
          bill: {
            equipmentRentals: [
              {
                itemName: "挖掘机",
                specification: "神钢350",
                unit: "台/小时",
                quantity: "1.000",
                unitPrice: "430.0000",
                taxRatePercent: "1",
                taxInclusiveAmount: "430.00"
              }
            ]
          }
        }
      },
      inspectionReport: {
        placeholders: ["bill.equipmentRentals", "clause.payment.text", "contract.amountUppercase", "contract.name", "contract.temporaryCode", "document.watermark", "field.useLocation"],
        unknownPlaceholders: [],
        missingRequiredPlaceholders: [],
        hasBillLoop: true,
        blockingErrors: [],
        warnings: []
      }
    },
    numberingRule: {
      id: "seed-contract-number-rule-equipment-rental",
      name: "工程机械设备租赁合同编号规则",
      pattern: "HT-{project}-{year}-{type}-{sequence}",
      contractTypeKey: "equipment_rental",
      nextSequence: 1,
      sequenceWidth: 3,
      isActive: true
    }
  },
  laborSubcontractWorkbench: {
    publishedAt: new Date("2026-06-01T00:00:00.000Z"),
    template: {
      id: "seed-template-labor-subcontract",
      code: "labor_subcontract",
      name: "劳务分包合同模板",
      contractTypeKey: "labor_subcontract",
      status: "published"
    },
    version: {
      id: "seed-template-labor-subcontract-v1",
      versionNo: 1,
      status: "published",
      changeSummary: "初始化劳务分包合同模板 v1"
    },
    fields: [
      { key: "workScope", label: "劳务分包作业范围及内容", type: "long_text", required: true, group: "scope", order: 10 },
      { key: "workLocation", label: "劳务分包作业地点", type: "text", required: true, group: "scope", order: 20 },
      { key: "pricingMethod", label: "计价方式", type: "single_select", required: true, group: "pricing", order: 30, options: [{ label: "固定单价", value: "fixed_unit_price" }, { label: "固定总价", value: "fixed_total" }] },
      { key: "taxRatePercent", label: "税率(%)", type: "number", required: true, defaultValue: 3, group: "tax", order: 40 },
      { key: "progressPaymentRatioPercent", label: "进度款支付比例(%)", type: "number", required: true, defaultValue: 80, group: "payment", order: 50 },
      { key: "retentionRatioPercent", label: "质保金比例(%)", type: "number", required: true, defaultValue: 5, group: "payment", order: 60 }
    ],
    bills: [
      {
        key: "laborItems",
        name: "劳务分包价格清单",
        amountRole: "included",
        pricingMode: "tax_inclusive",
        quantityScale: 3,
        unitPriceScale: 4,
        columns: [
          { key: "itemName", label: "项目名称", type: "text", required: true },
          { key: "unit", label: "单位", type: "text", required: true },
          { key: "quantity", label: "工程量", type: "number", required: true },
          { key: "unitPrice", label: "含税单价", type: "number", required: true },
          { key: "taxInclusiveAmount", label: "合计", type: "number", required: true },
          { key: "remark", label: "备注", type: "text" }
        ]
      }
    ],
    clauses: [
      {
        key: "payment",
        title: "付款方式",
        numberingMode: "automatic",
        required: true,
        standardClauseVersionId: "seed-standard-clause-labor-payment-v1",
        content: {
          text: "甲方结合总分包合同和发包人付款情况，按每月审核确认的合格工程进度款约定比例支付，剩余款项按竣工验收、外部结算和质保期条件支付。"
        }
      }
    ],
    attachments: [
      { key: "safety_agreement", name: "安全生产管理协议", required: true, mustBeValid: false },
      { key: "wage_commitment", name: "民工工资兑现承诺书", required: true, mustBeValid: false }
    ],
    validations: [],
    standardPaymentClause: {
      id: "seed-standard-clause-labor-payment",
      code: "STD-PAYMENT-LABOR-001",
      category: "payment",
      name: "劳务分包标准付款条款",
      versionId: "seed-standard-clause-labor-payment-v1",
      versionNo: 1,
      title: "劳务分包付款条款",
      status: "published",
      content: {
        text: "甲方结合总分包合同和发包人付款情况，按每月审核确认的合格工程进度款约定比例支付，剩余款项按竣工验收、外部结算和质保期条件支付。"
      }
    },
    layout: {
      id: "seed-layout-labor-subcontract",
      name: "劳务分包合同朴素 A4 版式",
      versionId: "seed-layout-labor-subcontract-v1",
      versionNo: 1,
      status: "published",
      docxFile: {
        id: "seed-file-layout-labor-subcontract-v1-docx",
        bucket: "private-local",
        objectKey: "seed/templates/labor-subcontract-v1.docx",
        originalName: "labor-subcontract-v1.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      },
      previewPdfFile: {
        id: "seed-file-layout-labor-subcontract-v1-preview-pdf",
        bucket: "private-local",
        objectKey: "seed/templates/labor-subcontract-v1-preview.pdf",
        originalName: "labor-subcontract-v1-preview.pdf",
        mimeType: "application/pdf"
      },
      previewJob: {
        id: "seed-layout-preview-labor-subcontract-v1",
        status: "succeeded",
        completedAt: new Date("2026-06-01T00:05:00.000Z"),
        sampleData: {
          contract: { name: "劳务分包合同样张", temporaryCode: "TMP-LAB-001", amountUppercase: "人民币壹万元整" },
          field: { workLocation: "项目现场" },
          clause: { payment: { text: "甲方结合总分包合同和发包人付款情况支付劳务工程款。" } },
          bill: { laborItems: [{ itemName: "劳务作业", unit: "项", quantity: "1.000", unitPrice: "10000.0000", taxInclusiveAmount: "10000.00" }] }
        }
      },
      inspectionReport: {
        placeholders: ["bill.laborItems", "clause.payment.text", "contract.amountUppercase", "contract.name", "contract.temporaryCode", "document.watermark", "field.workLocation"],
        unknownPlaceholders: [],
        missingRequiredPlaceholders: [],
        hasBillLoop: true,
        blockingErrors: [],
        warnings: []
      }
    },
    numberingRule: {
      id: "seed-contract-number-rule-labor-subcontract",
      name: "劳务分包合同编号规则",
      pattern: "HT-{project}-{year}-{type}-{sequence}",
      contractTypeKey: "labor_subcontract",
      nextSequence: 1,
      sequenceWidth: 3,
      isActive: true
    }
  }
} as const;
