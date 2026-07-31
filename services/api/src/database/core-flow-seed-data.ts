const CONTRACT_TAX_RATE_OPTIONS = [
  { label: "1%", value: "1" },
  { label: "3%", value: "3" },
  { label: "6%", value: "6" },
  { label: "9%", value: "9" },
  { label: "13%", value: "13" }
] as const;

const CONTRACT_INVOICE_TYPE_OPTIONS = [
  { label: "增值税专用发票", value: "增值税专用发票" },
  { label: "增值税普通发票", value: "增值税普通发票" }
] as const;

const TRIAL_PROJECT_NAME =
  "昆明市2023年城市防洪排涝治理工程一-西山区新运粮河分洪工程设计施工总承包合同";

const taxRateField = (order: number) =>
  ({
    key: "taxRatePercent",
    label: "税率(%)",
    type: "single_select",
    required: true,
    group: "tax",
    order,
    options: CONTRACT_TAX_RATE_OPTIONS
  }) as const;

const invoiceTypeField = (order: number) =>
  ({
    key: "invoiceType",
    label: "发票类型",
    type: "single_select",
    required: true,
    group: "tax",
    order,
    options: CONTRACT_INVOICE_TYPE_OPTIONS
  }) as const;

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
    name: TRIAL_PROJECT_NAME
  },
  companyEntity: {
    id: "seed-company-entity-jgzg",
    name: "建工智管建设有限公司",
    unifiedSocialCreditCode: "91350211M000100Y46",
    registeredAddress: "云南省昆明市西山区",
    dataStatus: "complete",
    currentVersionNo: 1,
    isActive: true
  },
  companyEntityVersion: {
    id: "seed-company-entity-version-jgzg-v1",
    companyEntityId: "seed-company-entity-jgzg",
    versionNo: 1,
    name: "建工智管建设有限公司",
    unifiedSocialCreditCode: "91350211M000100Y46",
    registeredAddress: "云南省昆明市西山区",
    isActive: true,
    action: "create"
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
    effectiveAt: new Date("2026-05-01T00:00:00.000Z"),
    signingSubjectType: "our_company",
    companyEntityIdSnapshot: "seed-company-entity-jgzg",
    companyEntityVersionId: "seed-company-entity-version-jgzg-v1",
    companyEntityNameSnapshot: "建工智管建设有限公司",
    companyEntityCreditCodeSnapshot: "91350211M000100Y46",
    companyEntityRegisteredAddressSnapshot: "云南省昆明市西山区"
  },
  ownerContractFile: {
    id: "seed-file-owner-contract-yz-2026-001",
    bucket: "private-archive",
    objectKey: "seed/owner-contracts/YZ-2026-001.pdf",
    originalName: "YZ-2026-001-业主主合同.pdf",
    mimeType: "application/pdf",
    sizeBytes: 128000
  },
  upstreamSettlementFile: {
    id: "seed-file-upstream-settlement-sd-2026-001",
    bucket: "private-archive",
    objectKey: "seed/upstream-settlements/SD-2026-001.pdf",
    originalName: "SD-2026-001-对上审定凭证.pdf",
    mimeType: "application/pdf",
    sizeBytes: 128000
  },
  projectReceiptFile: {
    id: "seed-file-project-receipt-sk-2026-001",
    bucket: "private-archive",
    objectKey: "seed/project-receipts/SK-2026-001.pdf",
    originalName: "SK-2026-001-项目收款凭证.pdf",
    mimeType: "application/pdf",
    sizeBytes: 128000
  },
  ownerContract: {
    id: "seed-owner-contract-yz-2026-001",
    ownerName: "建设单位",
    contractName: TRIAL_PROJECT_NAME,
    contractCode: "YZ-2026-001",
    signedAt: new Date("2026-04-20T00:00:00.000Z"),
    amountCents: 500000000,
    taxRateBps: 900,
    pricingMethod: "fixed_total",
    paymentTermsSummary: "按月进度和业主审定节点支付。",
    retentionSummary: "按合同金额3%预留质保金。",
    documentVersion: 1,
    status: "effective",
    confirmedAt: new Date("2026-04-21T00:00:00.000Z")
  },
  upstreamSettlement: {
    id: "seed-upstream-settlement-sd-2026-001",
    settledAt: new Date("2026-05-31T00:00:00.000Z"),
    reportedAmountCents: 420000000,
    approvedAmountCents: 400000000,
    approvingPartyName: "建设单位",
    periodLabel: "2026-05",
    isFinal: false,
    documentVersion: 1,
    status: "legacy_recorded",
    description: "项目一期对上进度审定，覆盖种子结算与核心闭环验证。"
  },
  projectReceipt: {
    id: "seed-project-receipt-sk-2026-001",
    receivedAt: new Date("2026-06-01T00:00:00.000Z"),
    amountCents: 80000000,
    payerName: "建设单位",
    sourceType: "general_contractor_payment",
    description: "项目一期启动收款，覆盖种子付款与核心闭环验证。"
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
      stageType: "progress",
      basis: "current_settlement",
      ratioBps: 8000,
      triggerAnchor: "settlement_effective",
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
      stageType: "retention",
      basis: "current_settlement",
      ratioBps: 2000,
      triggerAnchor: "final_settlement_effective",
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
    status: "partially_paid",
    amountCents: 32000000,
    payableAmountCents: 25600000,
    paidAmountCents: 12800000,
    isFinal: false
  },
  paymentRequest: {
    id: "seed-payment-request-fk-2026-006",
    code: "FK-2026-006",
    status: "partially_paid",
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
    idempotencyKey: "b1111111-1111-4111-8111-111111111111",
    amountCents: 12800000,
    paidAt: new Date("2026-06-05T00:00:00.000Z"),
    paymentSubjectType: "our_company",
    companyEntityIdSnapshot: "seed-company-entity-jgzg",
    companyEntityNameSnapshot: "建工智管建设有限公司",
    companyEntityCreditCodeSnapshot: "91350211M000100Y46"
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
      { key: "projectName", label: "项目名称", type: "text", required: true, group: "basic", order: 5 },
      { key: "deliveryLocation", label: "交货地点", type: "text", required: true, group: "delivery", order: 10 },
      { key: "qualityStandard", label: "质量标准", type: "long_text", required: true, group: "quality", order: 30 },
      taxRateField(40),
      invoiceTypeField(45),
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
        quantityScale: 2,
        unitPriceScale: 2,
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
        objectKey: "seed/templates/material-purchase-real-v1.docx",
        originalName: "material-purchase-real-v1.docx",
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
            temporaryCode: "样张-材料-001",
            amountUppercase: "人民币壹拾贰万捌仟元整"
          },
          field: {
            projectName: TRIAL_PROJECT_NAME,
            deliveryLocation: "项目现场",
            taxRatePercent: "13",
            invoiceType: "增值税专用发票"
          },
          party: {
            owner: { name: "建工智管建设有限公司" },
            counterparty: { name: "示例供应商" }
          },
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
                quantity: "10.00",
                unitPrice: "4200.00",
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
          "field.projectName",
          "field.deliveryLocation",
          "party.owner.name",
          "party.counterparty.name"
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
      { key: "rentalStartDate", label: "租赁开始日期", type: "date", required: false, group: "period", order: 10 },
      { key: "rentalEndDate", label: "租赁结束日期", type: "date", required: false, group: "period", order: 20 },
      { key: "useLocation", label: "使用项目及地点", type: "text", required: true, group: "project", order: 30 },
      { key: "settlementCycle", label: "对账结算周期", type: "text", required: true, defaultValue: "上月16日至本月15日", group: "settlement", order: 40 },
      { key: "paymentRatioPercent", label: "当期付款比例(%)", type: "number", required: true, defaultValue: 80, group: "payment", order: 50 },
      taxRateField(60),
      invoiceTypeField(70)
    ],
    bills: [
      {
        key: "equipmentRentals",
        name: "工程机械设备租赁明细表",
        amountRole: "included",
        pricingMode: "tax_inclusive",
        quantityScale: 2,
        unitPriceScale: 2,
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
        objectKey: "seed/templates/equipment-rental-real-v1.docx",
        originalName: "equipment-rental-real-v1.docx",
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
          contract: { name: "机械租赁合同样张", temporaryCode: "样张-机械-001", amountUppercase: "人民币壹万元整" },
          field: {
            useLocation: "项目现场",
            taxRatePercent: "1",
            invoiceType: "增值税专用发票"
          },
          party: {
            owner: { name: "建工智管建设有限公司" },
            counterparty: { name: "示例租赁公司" }
          },
          clause: { payment: { text: "甲方依据双方确认的对账结算凭证和合规发票支付租赁费用。" } },
          bill: {
            equipmentRentals: [
              {
                itemName: "挖掘机",
                specification: "神钢350",
                unit: "台/小时",
                quantity: "1.00",
                unitPrice: "430.00",
                taxRatePercent: "1",
                taxInclusiveAmount: "430.00"
              }
            ]
          }
        }
      },
      inspectionReport: {
        placeholders: ["bill.equipmentRentals", "clause.payment.text", "contract.amountUppercase", "contract.name", "contract.temporaryCode", "document.watermark", "field.useLocation", "party.owner.name", "party.counterparty.name"],
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
      { key: "projectName", label: "项目名称", type: "text", required: true, defaultValue: TRIAL_PROJECT_NAME, group: "basic", order: 5 },
      { key: "workScope", label: "劳务分包作业范围及内容", type: "long_text", required: true, group: "scope", order: 10 },
      { key: "workLocation", label: "劳务分包作业地点", type: "text", required: true, group: "scope", order: 20 },
      { key: "plannedStartDate", label: "计划开工日期", type: "date", required: false, group: "period", order: 30 },
      { key: "plannedEndDate", label: "计划完工日期", type: "date", required: false, group: "period", order: 40 },
      { key: "settlementCycle", label: "结算周期", type: "text", required: true, defaultValue: "按月结算", group: "settlement", order: 50 },
      { key: "progressPaymentRatioPercent", label: "进度款支付比例(%)", type: "number", required: true, defaultValue: 80, group: "payment", order: 60 },
      taxRateField(70),
      invoiceTypeField(80)
    ],
    bills: [
      {
        key: "laborItems",
        name: "劳务分包价格清单",
        amountRole: "included",
        pricingMode: "tax_inclusive",
        quantityScale: 2,
        unitPriceScale: 2,
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
      },
      {
        key: "safety",
        title: "安全生产管理协议",
        numberingMode: "automatic",
        required: true,
        content: {
          text: "乙方应遵守甲方项目安全生产管理制度，落实班组安全教育、现场防护、特种作业持证和事故报告义务。"
        }
      },
      {
        key: "wageCommitment",
        title: "农民工工资兑现承诺书",
        numberingMode: "automatic",
        required: true,
        content: {
          text: "乙方承诺按实名制管理要求及时足额发放农民工工资，接受甲方对工资支付资料的核验。"
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
        objectKey: "seed/templates/labor-subcontract-real-v1.docx",
        originalName: "labor-subcontract-real-v1.docx",
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
          contract: { name: "劳务分包合同样张", temporaryCode: "样张-劳务-001", amountUppercase: "人民币壹万元整" },
          field: {
            projectName: TRIAL_PROJECT_NAME,
            workScope: "主体结构劳务作业",
            workLocation: "项目现场",
            plannedStartDate: "2026-07-01",
            plannedEndDate: "2026-09-30",
            settlementCycle: "按月结算",
            progressPaymentRatioPercent: 80,
            taxRatePercent: "3",
            invoiceType: "增值税普通发票"
          },
          clause: {
            payment: { text: "甲方结合总分包合同和发包人付款情况支付劳务工程款。" },
            safety: { text: "乙方应遵守甲方项目安全生产管理制度。" },
            wageCommitment: { text: "乙方承诺及时足额发放农民工工资。" }
          },
          bill: { laborItems: [{ itemName: "劳务作业", unit: "项", quantity: "1.00", unitPrice: "10000.00", taxInclusiveAmount: "10000.00" }] }
        }
      },
      inspectionReport: {
        placeholders: [
          "bill.laborItems",
          "clause.payment.text",
          "clause.safety.text",
          "clause.wageCommitment.text",
          "contract.amountUppercase",
          "contract.name",
          "contract.temporaryCode",
          "document.watermark",
          "field.projectName",
          "field.plannedEndDate",
          "field.plannedStartDate",
          "field.progressPaymentRatioPercent",
          "field.settlementCycle",
          "field.workLocation",
          "field.workScope"
        ],
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
  },
  genericContractWorkbench: {
    publishedAt: new Date("2026-06-01T00:00:00.000Z"),
    template: {
      id: "seed-template-generic-contract",
      code: "generic_contract",
      name: "通用合同模板",
      contractTypeKey: "generic_contract",
      status: "published"
    },
    version: {
      id: "seed-template-generic-contract-v1",
      versionNo: 1,
      status: "published",
      changeSummary: "初始化无专用模板合同的通用模板 v1"
    },
    fields: [
      { key: "projectName", label: "项目名称", type: "text", required: true, group: "basic", order: 10 },
      { key: "counterpartyName", label: "相对方名称", type: "text", required: true, group: "basic", order: 20 },
      { key: "businessSummary", label: "业务摘要", type: "long_text", required: true, group: "basic", order: 30 },
      { key: "settlementCycle", label: "结算周期", type: "text", required: true, defaultValue: "按双方确认结算", group: "settlement", order: 40 },
      { key: "paymentRatioPercent", label: "付款比例(%)", type: "number", required: true, defaultValue: 80, group: "payment", order: 50 },
      taxRateField(60),
      invoiceTypeField(70)
    ],
    bills: [
      {
        key: "genericItems",
        name: "合同清单",
        amountRole: "included",
        pricingMode: "tax_inclusive",
        quantityScale: 2,
        unitPriceScale: 2,
        columns: [
          { key: "itemName", label: "项目名称", type: "text", required: true },
          { key: "specification", label: "规格/说明", type: "text" },
          { key: "unit", label: "单位", type: "text", required: true },
          { key: "quantity", label: "数量", type: "number", required: true },
          { key: "unitPrice", label: "含税单价", type: "number", required: true },
          { key: "taxInclusiveAmount", label: "含税金额", type: "number", required: true },
          { key: "remark", label: "备注", type: "text" }
        ]
      }
    ],
    clauses: [
      {
        key: "payment",
        title: "付款及结算",
        numberingMode: "automatic",
        required: true,
        standardClauseVersionId: "seed-standard-clause-generic-payment-v1",
        content: {
          text: "甲方依据双方确认的结算资料和合规发票付款，具体比例、周期及条件以本合同约定为准。"
        }
      },
      {
        key: "specialAgreement",
        title: "特别约定",
        numberingMode: "automatic",
        required: false,
        content: { text: "" }
      }
    ],
    attachments: [],
    validations: [],
    standardPaymentClause: {
      id: "seed-standard-clause-generic-payment",
      code: "STD-PAYMENT-GENERIC-001",
      category: "payment",
      name: "通用合同标准付款条款",
      versionId: "seed-standard-clause-generic-payment-v1",
      versionNo: 1,
      title: "通用合同付款条款",
      status: "published",
      content: {
        text: "甲方依据双方确认的结算资料和合规发票付款，具体比例、周期及条件以本合同约定为准。"
      }
    },
    layout: {
      id: "seed-layout-generic-contract",
      name: "通用合同 Word 版式",
      versionId: "seed-layout-generic-contract-v1",
      versionNo: 1,
      status: "published",
      docxFile: {
        id: "seed-file-layout-generic-contract-v1-docx",
        bucket: "private-local",
        objectKey: "seed/templates/generic-contract-v1.docx",
        originalName: "generic-contract-v1.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      },
      previewPdfFile: {
        id: "seed-file-layout-generic-contract-v1-preview-pdf",
        bucket: "private-local",
        objectKey: "seed/templates/generic-contract-v1-preview.pdf",
        originalName: "generic-contract-v1-preview.pdf",
        mimeType: "application/pdf"
      },
      previewJob: {
        id: "seed-layout-preview-generic-contract-v1",
        status: "succeeded",
        completedAt: new Date("2026-06-01T00:05:00.000Z"),
        sampleData: {
          contract: { name: "通用合同样张", temporaryCode: "样张-通用-001", amountUppercase: "人民币壹万元整" },
          field: {
            projectName: TRIAL_PROJECT_NAME,
            counterpartyName: "通用合同相对方",
            businessSummary: "双方约定的业务内容",
            settlementCycle: "按月结算",
            paymentRatioPercent: 80,
            taxRatePercent: "6",
            invoiceType: "增值税普通发票"
          },
          clause: {
            payment: { text: "甲方依据双方确认的结算资料和合规发票付款。" },
            specialAgreement: { text: "" }
          },
          bill: {
            genericItems: [
              {
                itemName: "服务项目",
                specification: "按现场要求",
                unit: "项",
                quantity: "1.00",
                unitPrice: "10000.00",
                taxInclusiveAmount: "10000.00"
              }
            ]
          }
        }
      },
      inspectionReport: {
        placeholders: [
          "bill.genericItems",
          "clause.payment.text",
          "clause.specialAgreement.text",
          "contract.amountUppercase",
          "contract.name",
          "contract.temporaryCode",
          "document.watermark",
          "field.businessSummary",
          "field.counterpartyName",
          "field.paymentRatioPercent",
          "field.projectName",
          "field.settlementCycle"
        ],
        unknownPlaceholders: [],
        missingRequiredPlaceholders: [],
        hasBillLoop: true,
        blockingErrors: [],
        warnings: []
      }
    },
    numberingRule: {
      id: "seed-contract-number-rule-generic-contract",
      name: "通用合同编号规则",
      pattern: "HT-{project}-{year}-{type}-{sequence}",
      contractTypeKey: "generic_contract",
      nextSequence: 1,
      sequenceWidth: 3,
      isActive: true
    }
  }
} as const;
