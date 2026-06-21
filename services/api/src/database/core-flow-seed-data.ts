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
  }
} as const;
