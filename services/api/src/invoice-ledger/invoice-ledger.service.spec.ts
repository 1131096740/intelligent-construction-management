import { Prisma } from "@prisma/client";
import type { RoleKey } from "@jiangkong/shared-domain";
import type { CreateInvoiceExceptionConfirmationDto } from "./dto/create-invoice-exception-confirmation.dto";
import type { CreateNoInvoiceConfirmationDto } from "./dto/create-no-invoice-confirmation.dto";
import type { CreateProcurementInvoiceDto } from "./dto/create-procurement-invoice.dto";
import { InvoiceLedgerService } from "./invoice-ledger.service";

const ACTORS = {
  handler: "handler-1",
  otherHandler: "handler-2",
  materialDirector: "material-director-1",
  financeStaff: "finance-staff-1",
  globalFinanceStaff: "global-finance-staff-1",
  financeDirector: "finance-director-1"
} as const;

type LineSeed = {
  id: string;
  invoiceMode: "invoice" | "no_invoice";
  invoiceType?: "vat_general" | "vat_special";
  vatRateOptionId?: string;
  vatRateValue?: string;
  vatRateLabel?: string;
  unitPrice?: string;
  actualCostCents: bigint;
};

type PaymentSeed = {
  id: string;
  settledCents: bigint;
  paymentType?: string | null;
  invalidatedAt?: Date | null;
};

type TestInvoiceRecord = {
  id: string;
  projectId: string | null;
  identityKey: string;
  invoiceType: string;
  invoiceCode: string | null;
  invoiceNumber: string | null;
  externalIdentifier: string | null;
  issueDate: Date;
  sellerName: string;
  buyerName: string;
  totalAmountCents: bigint;
  allocatableAmountCents: bigint;
  allocatedAmountCents: bigint;
  status: string;
  fileId: string;
  uploadedByUserId: string;
  sourceBusinessType: string;
  sourceBusinessId: string;
  sourceProcurementId: string | null;
  commandIdempotencyKey?: string | null;
  commandFingerprint?: string | null;
  createdAt: Date;
};

type TestInvoiceLine = {
  id: string;
  projectId: string;
  invoiceRecordId: string;
  lineNo: number;
  description: string | null;
  vatRateOptionId: string;
  vatRateValueSnapshot: Prisma.Decimal;
  vatRateLabelSnapshot: string;
  taxInclusiveAmountCents: bigint;
  allocatedAmountCents: bigint;
};

type TestAllocation = {
  id: string;
  projectId: string;
  invoiceLineId: string;
  receiptId: string;
  receiptRevisionNo: number;
  procurementId: string;
  procurementVersionId: string;
  procurementLineId: string;
  paymentId: string | null;
  amountCents: bigint;
  createdByUserId: string;
  invalidatedAt: Date | null;
  invalidatedByUserId: string | null;
  invalidationReason: string | null;
  createdAt?: Date;
};

type TestConfirmation = {
  id: string;
  projectId: string;
  receiptId: string;
  receiptRevisionNo: number;
  procurementId: string;
  procurementVersionId: string;
  procurementLineId: string;
  paymentId: string | null;
  invoiceLineId?: string | null;
  amountCents: bigint;
  reason: string;
  proofFileId: string;
  status: string;
  submittedByUserId: string;
  submittedAt: Date;
  reviewedByUserId: string | null;
  reviewedAt: Date | null;
  reviewComment: string | null;
  reversedAt: Date | null;
  reversedByUserId: string | null;
  reversalReason: string | null;
  expectedInvoiceType?: string;
  expectedVatRateOptionId?: string;
  expectedVatRateValueSnapshot?: Prisma.Decimal;
  expectedVatRateLabelSnapshot?: string;
  expectedUnitPriceSnapshot?: Prisma.Decimal;
};

const DEFAULT_LINES: LineSeed[] = [
  {
    id: "procurement-line-13",
    invoiceMode: "invoice",
    invoiceType: "vat_special",
    vatRateOptionId: "vat-13",
    vatRateValue: "13",
    vatRateLabel: "13%",
    unitPrice: "60",
    actualCostCents: 6_000n
  }
];

function sqlText(query: unknown) {
  return (
    query as { strings?: readonly string[] }
  ).strings?.join("?") ?? String(query);
}

function sqlValues(query: unknown) {
  return (query as { values?: readonly unknown[] }).values ?? [];
}

function matchesExpected(actual: unknown, expected: unknown) {
  if (
    expected &&
    typeof expected === "object" &&
    "in" in expected
  ) {
    const values = (expected as { in?: readonly unknown[] }).in;
    return Array.isArray(values) && values.includes(actual);
  }
  return actual === expected;
}

const FILTER_KEYS = [
  "id",
  "invoiceRecordId",
  "invoiceLineId",
  "sourceBusinessType",
  "sourceProcurementId",
  "procurementId",
  "procurementVersionId",
  "receiptId",
  "receiptRevisionNo",
  "procurementLineId",
  "paymentId",
  "invalidatedAt",
  "status"
] as const;

function filterRows<T extends object>(
  rows: readonly T[],
  where: Record<string, unknown> | undefined
) {
  if (!where) return [...rows];
  return rows.filter((row) => {
    const values = row as unknown as Record<string, unknown>;
    return FILTER_KEYS.every((key) =>
      where[key] === undefined
        ? true
        : matchesExpected(values[key], where[key])
    );
  });
}

function createInvoiceInput(
  overrides: Partial<CreateProcurementInvoiceDto> = {}
): CreateProcurementInvoiceDto {
  const totalAmountCents = overrides.totalAmountCents ?? "6000";
  return {
    invoiceType: "vat_special",
    owningCompanyEntityId: "company-entity-1",
    direction: "inbound",
    sellerTaxId: "91310000123456789A",
    buyerTaxId: "91310000987654321B",
    invoiceCode: "  inv-code-1 ",
    invoiceNumber: " inv-number-1 ",
    issueDate: "2026-07-17",
    sellerName: " 供应商甲 ",
    buyerName: " 建设单位乙 ",
    totalAmountCents,
    taxExclusiveAmountCents: overrides.taxExclusiveAmountCents ?? totalAmountCents,
    taxAmountCents: overrides.taxAmountCents ?? "0",
    fileId: "invoice-file-1",
    lines: [
      {
        description: " 水泥 ",
        vatRateOptionId: "vat-13",
        taxInclusiveAmountCents: "6000",
        allocations: [
          {
            procurementLineId: "procurement-line-13",
            paymentId: "payment-1",
            amountCents: "6000"
          }
        ]
      }
    ],
    ...overrides
  };
}

function createGlobalInvoiceInput(overrides: Record<string, unknown> = {}) {
  return {
    invoiceType: "vat_special" as const,
    owningCompanyEntityId: "company-entity-1",
    direction: "inbound" as const,
    sellerTaxId: "91310000123456789A",
    buyerTaxId: "91310000987654321B",
    invoiceCode: "GLOBAL-INV-CODE-1",
    invoiceNumber: "GLOBAL-INV-NO-1",
    issueDate: "2026-07-17",
    sellerName: "供应商甲",
    buyerName: "建设单位乙",
    totalAmountCents: "6000",
    taxExclusiveAmountCents: "5309",
    taxAmountCents: "691",
    fileId: "global-invoice-file-1",
    idempotencyKey: "global-invoice-key-1",
    ...overrides
  };
}

function createNoInvoiceInput(
  overrides: Partial<CreateNoInvoiceConfirmationDto> = {}
): CreateNoInvoiceConfirmationDto {
  return {
    procurementLineId: "procurement-line-no-invoice",
    paymentId: "payment-1",
    amountCents: "3000",
    reason: " 商家按冻结条件不开具发票 ",
    proofFileId: "proof-file-1",
    ...overrides
  };
}

function createExceptionInput(
  overrides: Partial<CreateInvoiceExceptionConfirmationDto> = {}
): CreateInvoiceExceptionConfirmationDto {
  return {
    procurementLineId: "procurement-line-13",
    paymentId: "payment-1",
    amountCents: "6000",
    reason: " 实付后供应商无法提供符合条件的发票 ",
    proofFileId: "proof-file-1",
    ...overrides
  };
}

function createHarness(options?: {
  lines?: LineSeed[];
  payments?: PaymentSeed[];
  procurementStatus?: string;
  globalRoles?: Partial<Record<string, RoleKey[]>>;
  projectRoles?: Partial<Record<string, RoleKey[]>>;
  activeUsers?: Partial<Record<string, boolean>>;
  fileOwners?: Record<string, string>;
}) {
  const lineSeeds = options?.lines ?? DEFAULT_LINES;
  const paymentSeeds = options?.payments ?? [
    { id: "payment-1", settledCents: 6_000n }
  ];
  const actualCostCents = lineSeeds.reduce(
    (sum, line) => sum + line.actualCostCents,
    0n
  );
  const procurement = {
    id: "procurement-1",
    projectId: "project-1",
    code: "LXCG-2026-0001",
    handlerUserId: ACTORS.handler,
    currentVersionId: "version-1",
    status: options?.procurementStatus ?? "approved_in_progress",
    actualCostCents
  };
  const version = {
    id: "version-1",
    procurementId: procurement.id,
    status: "approved",
    handlerUserId: ACTORS.handler
  };
  const receipt = {
    id: "receipt-1",
    projectId: procurement.projectId,
    procurementId: procurement.id,
    procurementVersionId: version.id,
    status: "reviewed",
    currentRevisionNo: 1,
    actualCostCents
  };
  const revision = {
    id: "receipt-revision-1",
    receiptId: receipt.id,
    revisionNo: 1,
    procurementId: procurement.id,
    procurementVersionId: version.id,
    actualCostCents
  };
  const review = {
    id: "receipt-review-1",
    receiptId: receipt.id,
    receiptRevisionNo: 1,
    procurementId: procurement.id,
    procurementVersionId: version.id,
    sequenceNo: 1,
    decision: "approved"
  };
  const procurementLines = lineSeeds.map((line) => ({
    id: line.id,
    versionId: version.id,
    invoiceMode: line.invoiceMode,
    invoiceType: line.invoiceType ?? null,
    vatRateOptionId: line.vatRateOptionId ?? null,
    vatRateValueSnapshot: line.vatRateValue
      ? new Prisma.Decimal(line.vatRateValue)
      : null,
    vatRateLabelSnapshot: line.vatRateLabel ?? null,
    unitPrice: new Prisma.Decimal(line.unitPrice ?? "1")
  }));
  const receiptLines = lineSeeds.map((line, index) => ({
    id: `receipt-line-${index + 1}`,
    receiptId: receipt.id,
    receiptRevisionNo: receipt.currentRevisionNo,
    procurementId: procurement.id,
    procurementVersionId: version.id,
    procurementLineId: line.id,
    actualCostCents: line.actualCostCents
  }));
  const payments = paymentSeeds.map((payment) => ({
    id: payment.id,
    projectId: procurement.projectId,
    procurementId: procurement.id,
    procurementVersionId: version.id,
    paymentType: payment.paymentType ?? null,
    invalidatedAt: payment.invalidatedAt ?? null
  }));
  const paymentExecutions = paymentSeeds
    .filter((payment) => payment.settledCents > 0n)
    .map((payment) => ({
      paymentId: payment.id,
      amountCents: payment.settledCents
    }));
  const invoiceRecords: TestInvoiceRecord[] = [];
  const invoiceLines: TestInvoiceLine[] = [];
  const allocations: TestAllocation[] = [];
  const redAllocationReferences: Array<Record<string, unknown>> = [];
  const noInvoices: TestConfirmation[] = [];
  const exceptions: TestConfirmation[] = [];
  const lifecycleEvents: Array<Record<string, unknown>> = [];
  let invoiceSequence = 0;
  let invoiceLineSequence = 0;
  let allocationSequence = 0;
  let confirmationSequence = 0;
  const globalRoles: Record<string, RoleKey[]> = {
    [ACTORS.financeDirector]: ["finance_director"],
    ...options?.globalRoles
  };
  const projectRoles: Record<string, RoleKey[]> = {
    [ACTORS.handler]: ["material_staff"],
    [ACTORS.otherHandler]: ["material_staff"],
    ...options?.projectRoles
  };
  const activeUsers: Record<string, boolean> = {
    [ACTORS.handler]: true,
    [ACTORS.otherHandler]: true,
    [ACTORS.materialDirector]: true,
    [ACTORS.financeStaff]: true,
    [ACTORS.globalFinanceStaff]: true,
    [ACTORS.financeDirector]: true,
    ...options?.activeUsers
  };
  const fileOwners: Record<string, string> = {
    "invoice-file-1": ACTORS.handler,
    "invoice-file-2": ACTORS.handler,
    "proof-file-1": ACTORS.handler,
    "proof-file-2": ACTORS.handler,
    ...options?.fileOwners
  };

  const sqlRows = (query: unknown) => {
    const text = sqlText(query);
    const values = sqlValues(query);
    if (text.includes('FROM "InvoiceRecord"')) {
      const identityKey = values[0];
      const record = invoiceRecords.find(
        (candidate) => candidate.identityKey === identityKey
      );
      return record ? [{ id: record.id }] : [];
    }
    if (text.includes('FROM "InvoiceAllocation"')) {
      const allocation = allocations.find(
        (candidate) => candidate.id === values[0]
      );
      return allocation ? [{ ...allocation }] : [];
    }
    if (text.includes('FROM "NoInvoiceConfirmation"')) {
      const confirmation = noInvoices.find(
        (candidate) => candidate.id === values[0]
      );
      return confirmation ? [{ ...confirmation }] : [];
    }
    if (text.includes('FROM "InvoiceExceptionConfirmation"')) {
      const confirmation = exceptions.find(
        (candidate) => candidate.id === values[0]
      );
      return confirmation ? [{ ...confirmation }] : [];
    }
    if (text.includes('FROM "SpotProcurementPaymentExecution"')) {
      return paymentExecutions.map((row) => ({ ...row }));
    }
    if (text.includes('FROM "SupplierBalanceReservation"')) {
      return [];
    }
    if (text.includes('FROM "SpotProcurementPayment"')) {
      return payments.map((row) => ({ ...row }));
    }
    if (text.includes('FROM "SpotProcurementReceiptRevision"')) {
      return [{ ...revision }];
    }
    if (text.includes('FROM "SpotProcurementReceiptReview"')) {
      return [{ ...review }];
    }
    if (text.includes('FROM "SpotProcurementReceiptLine"')) {
      return receiptLines.map((row) => ({ ...row }));
    }
    if (text.includes('FROM "SpotProcurementReceipt"')) {
      return [{ ...receipt }];
    }
    if (text.includes('FROM "SpotProcurementVersion"')) {
      return [{ ...version }];
    }
    if (text.includes('FROM "SpotProcurementLine"')) {
      return procurementLines.map((row) => ({ ...row }));
    }
    if (text.includes('FROM "SpotProcurement"')) {
      return [{ ...procurement }];
    }
    throw new Error(`unexpected SQL in invoice ledger test: ${text}`);
  };

  const invoiceAllocationModel = {
    findFirst: jest.fn().mockImplementation(
      ({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(filterRows(allocations, where)[0] ?? null)
    ),
    findMany: jest.fn().mockImplementation(
      ({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(filterRows(allocations, where))
    ),
    create: jest.fn().mockImplementation(
      ({ data }: { data: Omit<TestAllocation, "id" | "invalidatedAt" | "invalidatedByUserId" | "invalidationReason"> }) => {
        const allocation: TestAllocation = {
          id: `allocation-${++allocationSequence}`,
          ...data,
          invalidatedAt: null,
          invalidatedByUserId: null,
          invalidationReason: null,
          createdAt: new Date("2026-07-17T08:00:00.000Z")
        };
        allocations.push(allocation);
        return Promise.resolve({ ...allocation });
      }
    ),
    updateMany: jest.fn().mockImplementation(
      ({ where, data }: { where: Record<string, unknown>; data: Partial<TestAllocation> }) => {
        const rows = filterRows(allocations, where);
        rows.forEach((row) => Object.assign(row, data));
        return Promise.resolve({ count: rows.length });
      }
    ),
    findUnique: jest.fn().mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve(
          allocations.find((row) => row.id === where.id) ?? null
        )
    )
  };

  function createConfirmationModel(
    rows: TestConfirmation[],
    kind: "no_invoice" | "exception"
  ) {
    return {
      findFirst: jest.fn().mockImplementation(
        ({ where }: { where: Record<string, unknown> }) =>
          Promise.resolve(filterRows(rows, where)[0] ?? null)
      ),
      findMany: jest.fn().mockImplementation(
        ({ where }: { where: Record<string, unknown> }) =>
          Promise.resolve(filterRows(rows, where))
      ),
      create: jest.fn().mockImplementation(
        ({ data }: { data: Record<string, unknown> }) => {
          const confirmation: TestConfirmation = {
            ...(data as unknown as Omit<
              TestConfirmation,
              | "id"
              | "submittedAt"
              | "status"
              | "reviewedByUserId"
              | "reviewedAt"
              | "reviewComment"
              | "reversedAt"
              | "reversedByUserId"
              | "reversalReason"
            >),
            id: `${kind}-confirmation-${++confirmationSequence}`,
            submittedAt: new Date("2026-07-17T08:00:00.000Z"),
            status: "pending_review",
            reviewedByUserId: null,
            reviewedAt: null,
            reviewComment: null,
            reversedAt: null,
            reversedByUserId: null,
            reversalReason: null
          };
          rows.push(confirmation);
          return Promise.resolve({ ...confirmation });
        }
      ),
      updateMany: jest.fn().mockImplementation(
        ({ where, data }: { where: Record<string, unknown>; data: Partial<TestConfirmation> }) => {
          const matches = filterRows(rows, where);
          matches.forEach((row) => Object.assign(row, data));
          return Promise.resolve({ count: matches.length });
        }
      )
    };
  }

  const noInvoiceModel = createConfirmationModel(
    noInvoices,
    "no_invoice"
  );
  const exceptionModel = createConfirmationModel(
    exceptions,
    "exception"
  );

  const invoiceRecordModel = {
    create: jest.fn().mockImplementation(
      ({ data }: { data: Omit<TestInvoiceRecord, "id" | "allocatedAmountCents" | "status" | "createdAt"> }) => {
        const record: TestInvoiceRecord = {
          id: `invoice-${++invoiceSequence}`,
          ...data,
          allocatedAmountCents: 0n,
          status: "active",
          createdAt: new Date("2026-07-17T08:00:00.000Z")
        };
        invoiceRecords.push(record);
        return Promise.resolve({ ...record });
      }
    ),
    findUnique: jest.fn().mockImplementation(
      ({ where }: { where: { id?: string; commandIdempotencyKey?: string } }) =>
        Promise.resolve(
          invoiceRecords.find((row) => row.id === where.id || row.commandIdempotencyKey === where.commandIdempotencyKey) ?? null
        )
    ),
    findMany: jest.fn().mockImplementation(
      ({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(filterRows(invoiceRecords, where))
    ),
    update: jest.fn().mockImplementation(
      ({ where, data }: { where: { id: string }; data: Partial<TestInvoiceRecord> }) => {
        const record = invoiceRecords.find((row) => row.id === where.id);
        if (!record) throw new Error("missing invoice record in test");
        Object.assign(record, data);
        return Promise.resolve({ ...record });
      }
    )
  };

  const invoiceLineModel = {
    create: jest.fn().mockImplementation(
      ({ data }: { data: Omit<TestInvoiceLine, "id" | "allocatedAmountCents"> }) => {
        const line: TestInvoiceLine = {
          id: `invoice-line-${++invoiceLineSequence}`,
          ...data,
          allocatedAmountCents: 0n
        };
        invoiceLines.push(line);
        return Promise.resolve({ ...line });
      }
    ),
    findMany: jest.fn().mockImplementation(
      ({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(filterRows(invoiceLines, where))
    ),
    findUnique: jest.fn().mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve(
          invoiceLines.find((row) => row.id === where.id) ?? null
        )
    ),
    update: jest.fn().mockImplementation(
      ({ where, data }: { where: { id: string }; data: Partial<TestInvoiceLine> }) => {
        const line = invoiceLines.find((row) => row.id === where.id);
        if (!line) throw new Error("missing invoice line in test");
        Object.assign(line, data);
        return Promise.resolve({ ...line });
      }
    )
  };

  const roleByPositionId = new Map<string, RoleKey>();
  const positionRows = (
    actorUserId: string,
    scope: "global" | "project",
    roles: readonly RoleKey[]
  ) =>
    roles.map((role, index) => {
      const positionId = `position:${scope}:${actorUserId}:${index}`;
      roleByPositionId.set(positionId, role);
      return { positionId };
    });
  const tx = {
    $queryRaw: jest.fn().mockImplementation(sqlRows),
    vatRateOption: {
      findMany: jest.fn().mockImplementation(
        ({ where }: { where: { id: { in: string[] } } }) =>
          Promise.resolve(
            where.id.in.flatMap((id) =>
              id === "vat-13"
                ? [{ id, rateValue: new Prisma.Decimal("13"), label: "13%" }]
                : id === "vat-3"
                  ? [{ id, rateValue: new Prisma.Decimal("3"), label: "3%" }]
                  : []
            )
          )
      )
    },
    invoiceRecord: invoiceRecordModel,
    invoiceLine: invoiceLineModel,
    invoiceAllocation: invoiceAllocationModel,
    noInvoiceConfirmation: noInvoiceModel,
    invoiceExceptionConfirmation: exceptionModel,
    invoiceLifecycleEvent: {
      findUnique: jest.fn().mockImplementation(({ where }: { where: { idempotencyKey: string } }) => Promise.resolve(lifecycleEvents.find((event) => event.idempotencyKey === where.idempotencyKey) ?? null)),
      findFirst: jest.fn().mockImplementation(({ where }: { where: { invoiceRecordId: string; kind: { in: string[] } } }) => Promise.resolve(lifecycleEvents.find((event) => event.invoiceRecordId === where.invoiceRecordId && where.kind.in.includes(event.kind as string)) ?? null)),
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => { const event = { id: `invoice-lifecycle-${lifecycleEvents.length + 1}`, ...data }; lifecycleEvents.push(event); return Promise.resolve(event); })
    },
    invoiceRedAllocationReference: {
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `invoice-red-reference-${redAllocationReferences.length + 1}`, ...data };
        redAllocationReferences.push(row);
        return Promise.resolve(row);
      })
    },
    user: {
      findUnique: jest.fn().mockImplementation(
        ({ where }: { where: { id: string } }) =>
          Promise.resolve(
            activeUsers[where.id] === undefined
              ? null
              : { id: where.id, isActive: activeUsers[where.id] }
          )
      )
    },
    userPosition: {
      findMany: jest.fn().mockImplementation(
        ({
          where
        }: {
          where: { userId: string; projectId: string | null };
        }) =>
          Promise.resolve(
            where.projectId === null
              ? positionRows(
                  where.userId,
                  "global",
                  globalRoles[where.userId] ?? []
                )
              : where.projectId === procurement.projectId
                ? positionRows(
                    where.userId,
                    "project",
                    projectRoles[where.userId] ?? []
                  )
                : []
          )
      )
    },
    projectMember: {
      findMany: jest.fn().mockResolvedValue([])
    },
    position: {
      findMany: jest.fn().mockImplementation(
        ({ where }: { where: { id: { in: string[] } } }) =>
          Promise.resolve(
            where.id.in.flatMap((id) => {
              const role = roleByPositionId.get(id);
              return role ? [{ id, key: role }] : [];
            })
          )
      )
    },
    spotProcurement: {
      findMany: jest.fn().mockImplementation(
        ({ where }: { where: { id: { in: string[] } } }) =>
          Promise.resolve(
            where.id.in.includes(procurement.id)
              ? [{
                  id: procurement.id,
                  currentVersionId: procurement.currentVersionId,
                  actualCostCents: procurement.actualCostCents
                }]
              : []
          )
      ),
      findUnique: jest.fn().mockResolvedValue({
        id: procurement.id,
        currentVersionId: procurement.currentVersionId
      })
    },
    spotProcurementReceipt: {
      findMany: jest.fn().mockResolvedValue([{ ...receipt }]),
      findUnique: jest.fn().mockResolvedValue({ ...receipt })
    },
    spotProcurementPayment: {
      findMany: jest.fn().mockImplementation(
        ({ where }: { where: { id: { in: string[] } } }) =>
          Promise.resolve(
            payments
              .filter((payment) => where.id.in.includes(payment.id))
              .map((payment) => ({
                id: payment.id,
                procurementId: payment.procurementId,
                procurementVersionId:
                  payment.procurementVersionId
              }))
          )
      ),
      findUnique: jest.fn().mockImplementation(
        ({ where }: { where: { id: string } }) =>
          Promise.resolve(
            payments.find((payment) => payment.id === where.id) ??
              null
          )
      )
    }
  };
  const prisma = {
    ...tx,
    $transaction: jest.fn().mockImplementation(
      (operation: (client: typeof tx) => Promise<unknown>) =>
        operation(tx)
    )
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const files = {
    assertCanDownloadFileById: jest.fn().mockResolvedValue(undefined),
    assertFileHasNoBusinessBinding: jest.fn().mockImplementation(
      (_client: unknown, fileId: string) =>
        Promise.resolve({
          id: fileId,
          uploadedByUserId: fileOwners[fileId] ?? ACTORS.handler
        })
    )
  };
  const pilot = { assertEnabled: jest.fn() };
  const closure = {
    recalculateAndClose: jest.fn().mockResolvedValue({ closed: false })
  };
  const service = new InvoiceLedgerService(
    prisma as never,
    audit as never,
    files as never,
    pilot as never,
    closure as never
  );

  return {
    service,
    prisma,
    tx,
    audit,
    files,
    procurement,
    receipt,
    version,
    invoiceRecords,
    invoiceLines,
    allocations,
    noInvoices,
    exceptions,
    lifecycleEvents,
    redAllocationReferences
  };
}

describe("InvoiceLedgerService invoice facts and allocations", () => {
  it("rejects structured invoice writes for the real payment form before any file or allocation write", async () => {
    const harness = createHarness({
      payments: [
        {
          id: "payment-1",
          settledCents: 6_000n,
          paymentType: "company_direct"
        }
      ]
    });

    await expect(
      harness.service.createProcurementInvoice(
        "procurement-1",
        ACTORS.handler,
        createInvoiceInput()
      )
    ).rejects.toThrow(
      "零星采购真实表单不支持结构化票据、无票确认或票据异常，请改为追加付款级发票附件"
    );
    expect(harness.invoiceRecords).toHaveLength(0);
    expect(harness.allocations).toHaveLength(0);
    expect(harness.files.assertFileHasNoBusinessBinding).not.toHaveBeenCalled();
  });

  it.each([
    [
      "unsupported type",
      createInvoiceInput({ invoiceType: "receipt" as never }),
      "发票类型只能为增值税普通发票或专用发票"
    ],
    [
      "incomplete identity",
      createInvoiceInput({
        invoiceNumber: undefined,
        externalIdentifier: undefined
      }),
      "发票代码和号码必须同时填写；否则请填写可识别票据编号"
    ],
    [
      "invalid date",
      createInvoiceInput({ issueDate: "2026-02-30" }),
      "开票日期必须按 YYYY-MM-DD 填写且日期有效"
    ],
    [
      "zero amount",
      createInvoiceInput({ totalAmountCents: "0" }),
      "发票价税合计金额必须按分填写为大于 0 的整数"
    ],
    [
      "inconsistent tax components",
      createInvoiceInput({ taxAmountCents: "690" }),
      "发票不含税金额与税额之和必须等于价税合计金额"
    ],
    [
      "identity containing a control delimiter",
      createInvoiceInput({ invoiceCode: "INV\u001fCODE" }),
      "发票代码不能包含控制字符或不可见格式字符"
    ],
    [
      "identity expanded past the limit by NFKC",
      createInvoiceInput({ invoiceCode: "ﬃ".repeat(100) }),
      "发票代码不能超过 100 个字符"
    ]
  ])("rejects %s before persisting invoice facts", async (_name, input, message) => {
    const harness = createHarness();

    await expect(
      harness.service.createProcurementInvoice(
        "procurement-1",
        ACTORS.handler,
        input
      )
    ).rejects.toThrow(message);

    expect(harness.invoiceRecords).toHaveLength(0);
  });

  it("counts astral identity characters as Unicode code points", async () => {
    const invoiceCode = "😀".repeat(100);
    const harness = createHarness();

    const result = await harness.service.createProcurementInvoice(
      "procurement-1",
      ACTORS.handler,
      createInvoiceInput({ invoiceCode })
    );

    expect(result.invoice.invoiceCode).toBe(invoiceCode);
  });

  it("accepts the DTO-supported 200-character external invoice identifier", async () => {
    const harness = createHarness({
      payments: [{ id: "payment-1", settledCents: 6_000n }]
    });
    const externalIdentifier = "外".repeat(200);

    const result = await harness.service.createProcurementInvoice(
      "procurement-1",
      ACTORS.handler,
      createInvoiceInput({
        invoiceCode: undefined,
        invoiceNumber: undefined,
        externalIdentifier
      })
    );

    expect(result.invoice.externalIdentifier).toBe(externalIdentifier);
  });

  it("uses a normalized 20-digit digital-invoice number as the global identity without losing its raw leading zeros", async () => {
    const harness = createHarness();
    const digitalInvoiceNumber = "00000000000000000001";

    const first = await harness.service.createProcurementInvoice(
      "procurement-1",
      ACTORS.handler,
      createInvoiceInput({
        invoiceCode: undefined,
        invoiceNumber: `  ${digitalInvoiceNumber}  `,
        externalIdentifier: undefined,
        invoiceIdentityKind: "digital" as never
      } as never)
    );
    const replay = await harness.service.createProcurementInvoice(
      "procurement-1",
      ACTORS.handler,
      createInvoiceInput({
        invoiceCode: undefined,
        invoiceNumber: digitalInvoiceNumber,
        externalIdentifier: undefined,
        invoiceIdentityKind: "digital" as never
      } as never)
    );

    expect(first.invoice.invoiceNumber).toBe(digitalInvoiceNumber);
    expect(replay.created).toBe(false);
    expect(harness.invoiceRecords).toHaveLength(1);
  });

  it("fails closed before writes when the invoice header has no owning company entity", async () => {
    const harness = createHarness();

    await expect(
      harness.service.createProcurementInvoice(
        "procurement-1",
        ACTORS.handler,
        createInvoiceInput({ owningCompanyEntityId: undefined } as never)
      )
    ).rejects.toThrow("请选择发票归属的我方公司主体");
    expect(harness.invoiceRecords).toHaveLength(0);
    expect(harness.allocations).toHaveLength(0);
  });

  it("creates a multi-rate invoice and allocates each line against current receipt cost", async () => {
    const harness = createHarness({
      lines: [
        DEFAULT_LINES[0],
        {
          id: "procurement-line-3",
          invoiceMode: "invoice",
          invoiceType: "vat_special",
          vatRateOptionId: "vat-3",
          vatRateValue: "3",
          vatRateLabel: "3%",
          actualCostCents: 3_000n
        }
      ],
      payments: [{ id: "payment-1", settledCents: 9_000n }]
    });
    const operatingSources = {
      appendConfirmedSourceIfEnabledInTransaction: jest
        .fn()
        .mockResolvedValue(null)
    };
    Object.assign(
      harness.service as unknown as { operatingSources: typeof operatingSources },
      { operatingSources }
    );
    const input = createInvoiceInput({
      totalAmountCents: "9000",
      lines: [
        {
          description: "水泥",
          vatRateOptionId: "vat-13",
          taxInclusiveAmountCents: "6000",
          allocations: [
            {
              procurementLineId: "procurement-line-13",
              paymentId: "payment-1",
              amountCents: "6000"
            }
          ]
        },
        {
          description: "运输费",
          vatRateOptionId: "vat-3",
          taxInclusiveAmountCents: "3000",
          allocations: [
            {
              procurementLineId: "procurement-line-3",
              paymentId: "payment-1",
              amountCents: "3000"
            }
          ]
        }
      ]
    });

    const result = await harness.service.createProcurementInvoice(
      "procurement-1",
      ACTORS.handler,
      input
    );

    expect(
      operatingSources.appendConfirmedSourceIfEnabledInTransaction
    ).toHaveBeenCalledWith(
      harness.tx,
      {
        projectId: "project-1",
        sourceType: "spot_procurement_invoice_record",
        sourceBusinessId: result.invoice.id
      },
      ACTORS.handler
    );

    expect(result).toMatchObject({
      created: true,
      invoice: {
        invoiceCode: "INV-CODE-1",
        invoiceNumber: "INV-NUMBER-1",
        totalAmountCents: "9000",
        allocatedAmountCents: "9000",
        lines: [
          {
            vatRateValue: "13",
            taxInclusiveAmountCents: "6000",
            allocatedAmountCents: "6000"
          },
          {
            vatRateValue: "3",
            taxInclusiveAmountCents: "3000",
            allocatedAmountCents: "3000"
          }
        ]
      }
    });
    expect(result.allocations).toHaveLength(2);
    expect(harness.allocations.map((row) => row.amountCents)).toEqual([
      6_000n,
      3_000n
    ]);
  });

  it("rejects normal coverage above the current procurement-line actual cost", async () => {
    const harness = createHarness({
      lines: [{ ...DEFAULT_LINES[0], actualCostCents: 4_000n }],
      payments: [{ id: "payment-1", settledCents: 10_000n }]
    });

    await expect(
      harness.service.createProcurementInvoice(
        "procurement-1",
        ACTORS.handler,
        createInvoiceInput({
          totalAmountCents: "5000",
          lines: [
            {
              vatRateOptionId: "vat-13",
              taxInclusiveAmountCents: "5000",
              allocations: [
                {
                  procurementLineId: "procurement-line-13",
                  paymentId: "payment-1",
                  amountCents: "5000"
                }
              ]
            }
          ]
        })
      )
    ).rejects.toThrow("票据金额超过该采购明细的当前实际成本");
  });

  it("caps payment attribution at that payment's actual settlement without using other payments", async () => {
    const harness = createHarness({
      lines: [{ ...DEFAULT_LINES[0], actualCostCents: 10_000n }],
      payments: [
        { id: "payment-1", settledCents: 4_000n },
        { id: "payment-2", settledCents: 6_000n }
      ]
    });

    await expect(
      harness.service.createProcurementInvoice(
        "procurement-1",
        ACTORS.handler,
        createInvoiceInput({
          totalAmountCents: "5000",
          lines: [
            {
              vatRateOptionId: "vat-13",
              taxInclusiveAmountCents: "5000",
              allocations: [
                {
                  procurementLineId: "procurement-line-13",
                  paymentId: "payment-1",
                  amountCents: "5000"
                }
              ]
            }
          ]
        })
      )
    ).rejects.toThrow("票据金额超过所选付款单的实际结算金额");
  });

  it("allows full procurement coverage after any real settlement when no payment attribution is requested", async () => {
    const harness = createHarness({
      lines: [{ ...DEFAULT_LINES[0], actualCostCents: 6_000n }],
      payments: [{ id: "payment-1", settledCents: 1_000n }]
    });

    const result = await harness.service.createProcurementInvoice(
      "procurement-1",
      ACTORS.handler,
      createInvoiceInput({
        lines: [
          {
            vatRateOptionId: "vat-13",
            taxInclusiveAmountCents: "6000",
            allocations: [
              {
                procurementLineId: "procurement-line-13",
                amountCents: "6000"
              }
            ]
          }
        ]
      })
    );

    expect(result.allocations).toEqual([
      expect.objectContaining({
        procurementLineId: "procurement-line-13",
        paymentId: null,
        amountCents: "6000"
      })
    ]);
  });

  it("rejects a requested line allocation total above the invoice-line amount", async () => {
    const harness = createHarness({
      lines: [
        { ...DEFAULT_LINES[0], actualCostCents: 3_000n },
        {
          ...DEFAULT_LINES[0],
          id: "procurement-line-second",
          actualCostCents: 3_000n
        }
      ],
      payments: [{ id: "payment-1", settledCents: 6_000n }]
    });

    await expect(
      harness.service.createProcurementInvoice(
        "procurement-1",
        ACTORS.handler,
        createInvoiceInput({
          totalAmountCents: "4000",
          lines: [
            {
              vatRateOptionId: "vat-13",
              taxInclusiveAmountCents: "4000",
              allocations: [
                {
                  procurementLineId: "procurement-line-13",
                  amountCents: "2500"
                },
                {
                  procurementLineId: "procurement-line-second",
                  amountCents: "2000"
                }
              ]
            }
          ]
        })
      )
    ).rejects.toThrow("第 1 条发票明细分摊金额超过价税合计");

    expect(harness.tx.invoiceAllocation.create).not.toHaveBeenCalled();
  });

  it("enforces the invoice-line limit cumulatively across incremental allocations", async () => {
    const harness = createHarness({
      lines: [
        { ...DEFAULT_LINES[0], actualCostCents: 4_000n },
        {
          ...DEFAULT_LINES[0],
          id: "procurement-line-second",
          actualCostCents: 4_000n
        }
      ],
      payments: [{ id: "payment-1", settledCents: 8_000n }]
    });
    const allocationInput = (
      procurementLineId: string,
      amountCents: string
    ) =>
      createInvoiceInput({
        totalAmountCents: "6000",
        lines: [
          {
            description: " 水泥 ",
            vatRateOptionId: "vat-13",
            taxInclusiveAmountCents: "6000",
            allocations: [
              {
                procurementLineId,
                paymentId: "payment-1",
                amountCents
              }
            ]
          }
        ]
      });
    await harness.service.createProcurementInvoice(
      "procurement-1",
      ACTORS.handler,
      allocationInput("procurement-line-13", "4000")
    );

    await expect(
      harness.service.createProcurementInvoice(
        "procurement-1",
        ACTORS.handler,
        allocationInput("procurement-line-second", "3000")
      )
    ).rejects.toThrow("累计分摊或异常金额超过发票明细价税合计");

    expect(harness.tx.invoiceAllocation.create).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["vat_general" as const, "vat-13", "实际发票类型与采购审批冻结条件不一致"],
    ["vat_special" as const, "vat-3", "实际税率与采购审批冻结条件不一致"]
  ])("returns an exception candidate for %s/%s mismatch without creating normal coverage", async (invoiceType, vatRateOptionId, reason) => {
    const harness = createHarness();
    const result = await harness.service.createProcurementInvoice(
      "procurement-1",
      ACTORS.handler,
      createInvoiceInput({
        invoiceType,
        lines: [
          {
            vatRateOptionId,
            taxInclusiveAmountCents: "6000",
            allocations: [
              {
                procurementLineId: "procurement-line-13",
                paymentId: "payment-1",
                amountCents: "6000"
              }
            ]
          }
        ]
      })
    );

    expect(result.exceptionCandidates).toEqual([
      expect.objectContaining({
        procurementLineId: "procurement-line-13",
        paymentId: "payment-1",
        amountCents: "6000",
        reason
      })
    ]);
    expect(result.allocations).toEqual([]);
    expect(harness.tx.invoiceAllocation.create).not.toHaveBeenCalled();
    expect(result.invoice.allocatedAmountCents).toBe("0");
  });

  it("replays an identical invoice and allocation without a second business write", async () => {
    const harness = createHarness();
    const input = createInvoiceInput();

    const first = await harness.service.createProcurementInvoice(
      "procurement-1",
      ACTORS.handler,
      input
    );
    const replay = await harness.service.createProcurementInvoice(
      "procurement-1",
      ACTORS.handler,
      input
    );

    expect(first.created).toBe(true);
    expect(replay.created).toBe(false);
    expect(replay.allocations).toEqual([
      expect.objectContaining({ existing: true, amountCents: "6000" })
    ]);
    expect(harness.tx.invoiceRecord.create).toHaveBeenCalledTimes(1);
    expect(harness.tx.invoiceAllocation.create).toHaveBeenCalledTimes(1);
    expect(
      harness.files.assertFileHasNoBusinessBinding
    ).toHaveBeenCalledTimes(1);
  });

  it("hard-rejects reuse of a canonical invoice identity by another owning company", async () => {
    const harness = createHarness();
    await harness.service.createProcurementInvoice(
      "procurement-1",
      ACTORS.handler,
      createInvoiceInput()
    );

    await expect(
      harness.service.createProcurementInvoice(
        "procurement-1",
        ACTORS.handler,
        createInvoiceInput({ owningCompanyEntityId: "company-entity-2" })
      )
    ).rejects.toThrow("该发票身份已用于不同的发票事实");
    expect(harness.invoiceRecords).toHaveLength(1);
  });

  it("creates a global invoice without a project coordinate and replays only its identical idempotency request", async () => {
    const harness = createHarness({
      fileOwners: { "global-invoice-file-1": ACTORS.globalFinanceStaff },
      globalRoles: { [ACTORS.globalFinanceStaff]: ["finance_staff"], [ACTORS.financeDirector]: ["finance_director"] }
    });
    const input = createGlobalInvoiceInput();
    await expect(harness.service.createGlobalInvoice(ACTORS.globalFinanceStaff, input)).resolves.toMatchObject({ replayed: false });
    await expect(harness.service.createGlobalInvoice(ACTORS.globalFinanceStaff, input)).resolves.toMatchObject({ replayed: true });
    expect(harness.invoiceRecords[0]).toMatchObject({ projectId: null, sourceProcurementId: null, sourceBusinessType: "global_clearing_invoice" });
    await expect(harness.service.createGlobalInvoice(ACTORS.globalFinanceStaff, createGlobalInvoiceInput({ sellerName: "供应商乙" }))).rejects.toThrow("幂等键已用于不同的全局发票请求");
  });

  it("uses voucher type, issuer tax id, and leading-zero external identifier as an other controlled voucher identity", async () => {
    const harness = createHarness({
      fileOwners: {
        "global-invoice-file-1": ACTORS.globalFinanceStaff,
        "global-invoice-file-2": ACTORS.globalFinanceStaff
      },
      globalRoles: { [ACTORS.globalFinanceStaff]: ["finance_staff"] }
    });
    const other = createGlobalInvoiceInput({
      invoiceType: "other",
      invoiceIdentityKind: "other",
      invoiceCode: undefined,
      invoiceNumber: undefined,
      externalIdentifier: "000123",
      voucherType: "bank_receipt"
    });
    const first = await harness.service.createGlobalInvoice(ACTORS.globalFinanceStaff, other);
    expect(harness.invoiceRecords.find((row) => row.id === first.id)).toMatchObject({
      identityKind: "other",
      voucherType: "bank_receipt",
      externalIdentifier: "000123"
    });
    await expect(harness.service.createGlobalInvoice(ACTORS.globalFinanceStaff, {
      ...other,
      fileId: "global-invoice-file-2",
      idempotencyKey: "global-invoice-key-other-2",
      voucherType: "cash_receipt"
    })).resolves.toMatchObject({ replayed: false });
    await expect(harness.service.createGlobalInvoice(ACTORS.globalFinanceStaff, {
      ...other,
      fileId: "global-invoice-file-2",
      idempotencyKey: "global-invoice-key-other-3"
    })).rejects.toThrow("该发票身份已用于不同的发票事实");
  });

  it("rejects global invoice creation by a project-only finance role", async () => {
    const harness = createHarness({
      globalRoles: { [ACTORS.financeStaff]: [] },
      projectRoles: { [ACTORS.financeStaff]: ["finance_staff"] },
      fileOwners: { "global-invoice-file-1": ACTORS.financeStaff }
    });
    await expect(harness.service.createGlobalInvoice(ACTORS.financeStaff, createGlobalInvoiceInput())).rejects.toThrow("只有全局财务人员可以登记全局发票");
  });

  it("voids a global invoice only by appending a replay-safe lifecycle fact", async () => {
    const harness = createHarness({
      fileOwners: { "global-invoice-file-1": ACTORS.globalFinanceStaff },
      globalRoles: { [ACTORS.globalFinanceStaff]: ["finance_staff"] }
    });
    const created = await harness.service.createGlobalInvoice(ACTORS.globalFinanceStaff, createGlobalInvoiceInput());
    const command = { reasonCode: "invoice_voided", idempotencyKey: "global-void-key-1" };
    await expect(harness.service.voidGlobalInvoice(created.id, ACTORS.financeDirector, command)).resolves.toMatchObject({ replayed: false });
    await expect(harness.service.voidGlobalInvoice(created.id, ACTORS.financeDirector, command)).resolves.toMatchObject({ replayed: true });
    expect(harness.lifecycleEvents).toHaveLength(1);
    expect(harness.lifecycleEvents[0]).toMatchObject({ invoiceRecordId: created.id, kind: "void" });
    await expect(harness.service.voidGlobalInvoice(created.id, ACTORS.financeDirector, { ...command, reasonCode: "another_reason" })).rejects.toThrow("幂等键已用于不同的发票作废请求");
  });

  it("creates a red global invoice only from precise active blue allocations and records its immutable references", async () => {
    const harness = createHarness({
      fileOwners: {
        "global-invoice-file-1": ACTORS.globalFinanceStaff,
        "global-invoice-file-2": ACTORS.financeDirector
      },
      globalRoles: { [ACTORS.globalFinanceStaff]: ["finance_staff"], [ACTORS.financeDirector]: ["finance_director"] }
    });
    const blue = await harness.service.createGlobalInvoice(ACTORS.globalFinanceStaff, createGlobalInvoiceInput());
    const clearingAllocations: Array<Record<string, unknown>> = [{ id: "blue-clearing-allocation-1", invoiceRecordId: blue.id, reversesAllocationId: null, amountCents: 6000n }];
    Object.assign(harness.tx, {
      invoiceClearingAllocation: {
        findUnique: jest.fn().mockImplementation(({ where }: { where: { id: string } }) => Promise.resolve(clearingAllocations.find((row) => row.id === where.id) ?? null)),
        findMany: jest.fn().mockResolvedValue([])
      }
    });
    const input = {
      ...createGlobalInvoiceInput({ invoiceCode: "GLOBAL-RED-CODE-1", invoiceNumber: "GLOBAL-RED-NO-1", fileId: "global-invoice-file-2", idempotencyKey: "global-red-key-1" }),
      blueInvoiceRecordId: blue.id,
      reasonCode: "sales_return",
      blueAllocationReferences: [{ blueInvoiceAllocationId: "blue-clearing-allocation-1", amountCents: "6000" }]
    };
    await expect(harness.service.createRedGlobalInvoice(ACTORS.financeDirector, input)).resolves.toMatchObject({ replayed: false });
    await expect(harness.service.createRedGlobalInvoice(ACTORS.financeDirector, input)).resolves.toMatchObject({ replayed: true });
    expect(harness.lifecycleEvents).toEqual([expect.objectContaining({ invoiceRecordId: blue.id, kind: "red" })]);
    expect(harness.redAllocationReferences).toEqual([expect.objectContaining({ blueInvoiceAllocationId: "blue-clearing-allocation-1", amountCents: 6000n })]);
    await expect(harness.service.createRedGlobalInvoice(ACTORS.financeDirector, { ...input, reasonCode: "other_reason" })).rejects.toThrow("幂等键已用于不同的红字发票请求");
  });

  it("reissues a global invoice as a linked new fact and preserves company and direction", async () => {
    const harness = createHarness({
      fileOwners: {
        "global-invoice-file-1": ACTORS.globalFinanceStaff,
        "global-invoice-file-3": ACTORS.financeDirector
      },
      globalRoles: { [ACTORS.globalFinanceStaff]: ["finance_staff"], [ACTORS.financeDirector]: ["finance_director"] }
    });
    const original = await harness.service.createGlobalInvoice(ACTORS.globalFinanceStaff, createGlobalInvoiceInput());
    const input = {
      ...createGlobalInvoiceInput({ invoiceCode: "GLOBAL-REISSUE-CODE-1", invoiceNumber: "GLOBAL-REISSUE-NO-1", fileId: "global-invoice-file-3", idempotencyKey: "global-reissue-key-1" }),
      originalInvoiceRecordId: original.id,
      reasonCode: "issued_with_wrong_name"
    };
    await expect(harness.service.createReissueGlobalInvoice(ACTORS.financeDirector, input)).resolves.toMatchObject({ replayed: false });
    await expect(harness.service.createReissueGlobalInvoice(ACTORS.financeDirector, input)).resolves.toMatchObject({ replayed: true });
    expect(harness.lifecycleEvents).toEqual([expect.objectContaining({ invoiceRecordId: original.id, kind: "reissue" })]);
    await expect(harness.service.createReissueGlobalInvoice(ACTORS.financeDirector, { ...input, direction: "outbound" })).rejects.toThrow("幂等键已用于不同的发票重开请求");
  });

  it("allocates a global invoice only to a confirmed clearing version, replays its idempotency key, and caps total evidence", async () => {
    const harness = createHarness({
      fileOwners: { "global-invoice-file-1": ACTORS.globalFinanceStaff },
      globalRoles: { [ACTORS.globalFinanceStaff]: ["finance_staff"] }
    });
    const invoice = await harness.service.createGlobalInvoice(ACTORS.globalFinanceStaff, createGlobalInvoiceInput());
    const rows: Array<Record<string, unknown>> = [];
    const projectParticipatingCompany = { findFirst: jest.fn().mockResolvedValue({ id: "project-company-1" }) };
    Object.assign(harness.tx, {
      clearingCase: { findUnique: jest.fn().mockResolvedValue({ id: "case-1", projectId: "project-1" }) },
      clearingEventVersion: { findUnique: jest.fn().mockResolvedValue({ id: "version-1", clearingCaseId: "case-1", amountCents: 6000n, evidenceLevel: "B", attestation: { id: "attestation-1" }, confirmation: { id: "confirmation-1" } }) },
      projectParticipatingCompany,
      invoiceClearingAllocation: {
        findUnique: jest.fn().mockImplementation(({ where }: { where: { idempotencyKey?: string; id?: string } }) => Promise.resolve(rows.find((row) => row.idempotencyKey === where.idempotencyKey || row.id === where.id) ?? null)),
        findMany: jest.fn().mockImplementation(() => Promise.resolve(rows)),
        aggregate: jest.fn().mockImplementation(({ where }: { where: { reversesAllocationId?: string | null } }) => Promise.resolve({ _sum: { amountCents: rows.filter((row) => row.reversesAllocationId === where.reversesAllocationId).reduce((sum, row) => sum + (row.amountCents as bigint), 0n) } })),
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => { const row = { id: `clearing-allocation-${rows.length + 1}`, reversesAllocationId: null, ...data }; rows.push(row); return Promise.resolve(row); })
      }
    });
    const input = { invoiceRecordId: invoice.id, clearingCaseId: "case-1", clearingEventVersionId: "version-1", amountCents: "6000", idempotencyKey: "allocation-key-1" };
    await expect(harness.service.createClearingAllocation(ACTORS.financeDirector, input)).resolves.toMatchObject({ replayed: false });
    await expect(harness.service.createClearingAllocation(ACTORS.financeDirector, input)).resolves.toMatchObject({ replayed: true });
    await expect(harness.service.createClearingAllocation(ACTORS.financeDirector, { ...input, amountCents: "1", structuredReasonCode: "partial_reconciliation", idempotencyKey: "allocation-key-2" })).rejects.toThrow("有效发票清算分配累计超过票面含税额");
    await expect(harness.service.reverseClearingAllocation("clearing-allocation-1", ACTORS.financeDirector, { amountCents: "4000", structuredReasonCode: "allocation_correction", idempotencyKey: "allocation-reversal-1" })).resolves.toMatchObject({ replayed: false });
    await expect(harness.service.reverseClearingAllocation("clearing-allocation-1", ACTORS.financeDirector, { amountCents: "4000", structuredReasonCode: "allocation_correction", idempotencyKey: "allocation-reversal-1" })).resolves.toMatchObject({ replayed: true });
    await expect(harness.service.reverseClearingAllocation("clearing-allocation-1", ACTORS.financeDirector, { amountCents: "2001", structuredReasonCode: "allocation_correction", idempotencyKey: "allocation-reversal-over-cap" })).rejects.toThrow("反向分配金额超过原清算发票分配的剩余有效金额");
    await expect(harness.service.createClearingAllocation(ACTORS.financeDirector, { ...input, amountCents: "4000", structuredReasonCode: "partial_reconciliation", idempotencyKey: "allocation-key-replacement" })).resolves.toMatchObject({ replayed: false });
    expect(projectParticipatingCompany.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ projectId: "project-1", companyEntityId: "company-entity-1" })
    }));
  });

  it("requires a structured reason and B-level dual-confirmed version for a clearing amount difference", async () => {
    const harness = createHarness({
      fileOwners: { "global-invoice-file-1": ACTORS.globalFinanceStaff },
      globalRoles: { [ACTORS.globalFinanceStaff]: ["finance_staff"] }
    });
    const invoice = await harness.service.createGlobalInvoice(ACTORS.globalFinanceStaff, createGlobalInvoiceInput());
    Object.assign(harness.tx, {
      clearingCase: { findUnique: jest.fn().mockResolvedValue({ id: "case-1", projectId: "project-1" }) },
      clearingEventVersion: { findUnique: jest.fn().mockResolvedValue({ id: "version-1", clearingCaseId: "case-1", amountCents: 7000n, evidenceLevel: "A", attestation: null, confirmation: { id: "confirmation-1" } }) },
      invoiceClearingAllocation: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) }
    });
    await expect(harness.service.createClearingAllocation(ACTORS.financeDirector, {
      invoiceRecordId: invoice.id,
      clearingCaseId: "case-1",
      clearingEventVersionId: "version-1",
      amountCents: "6000",
      idempotencyKey: "allocation-difference-key-1"
    })).rejects.toThrow("清算额差异必须填写结构化原因并引用已完成 B 级双人确认的清算版本");
  });

  it("fails closed when the invoice owning company is not effective for the clearing project", async () => {
    const harness = createHarness({
      fileOwners: { "global-invoice-file-1": ACTORS.globalFinanceStaff },
      globalRoles: { [ACTORS.globalFinanceStaff]: ["finance_staff"] }
    });
    const invoice = await harness.service.createGlobalInvoice(ACTORS.globalFinanceStaff, createGlobalInvoiceInput());
    Object.assign(harness.tx, {
      clearingCase: { findUnique: jest.fn().mockResolvedValue({ id: "case-1", projectId: "project-1" }) },
      clearingEventVersion: { findUnique: jest.fn().mockResolvedValue({ id: "version-1", clearingCaseId: "case-1", amountCents: 1n, evidenceLevel: "A", attestation: null, confirmation: { id: "confirmation-1" } }) },
      projectParticipatingCompany: { findFirst: jest.fn().mockResolvedValue(null) },
      invoiceClearingAllocation: { findUnique: jest.fn().mockResolvedValue(null) }
    });
    await expect(harness.service.createClearingAllocation(ACTORS.financeDirector, {
      invoiceRecordId: invoice.id, clearingCaseId: "case-1", clearingEventVersionId: "version-1", amountCents: "1", idempotencyKey: "allocation-key-company-mismatch"
    })).rejects.toThrow("发票归属我方主体未在清算项目有效参与公司范围内");
  });

  it("rejects project-bound invoices and voided global evidence from new clearing allocations", async () => {
    const harness = createHarness();
    const projectInvoice = await harness.service.createProcurementInvoice("procurement-1", ACTORS.handler, createInvoiceInput());
    Object.assign(harness.tx, {
      clearingCase: { findUnique: jest.fn().mockResolvedValue({ id: "case-1", projectId: "project-1" }) },
      clearingEventVersion: { findUnique: jest.fn().mockResolvedValue({ id: "version-1", clearingCaseId: "case-1", amountCents: 6000n, evidenceLevel: "B", attestation: { id: "attestation-1" }, confirmation: { id: "confirmation-1" } }) },
      invoiceClearingAllocation: { findUnique: jest.fn().mockResolvedValue(null) }
    });
    await expect(harness.service.createClearingAllocation(ACTORS.financeDirector, {
      invoiceRecordId: projectInvoice.invoice.id, clearingCaseId: "case-1", clearingEventVersionId: "version-1", amountCents: "6000", idempotencyKey: "allocation-project-invoice"
    })).rejects.toThrow("清分分配只能使用全局蓝字或重开发票");

    const globalHarness = createHarness({
      fileOwners: { "global-invoice-file-1": ACTORS.globalFinanceStaff },
      globalRoles: { [ACTORS.globalFinanceStaff]: ["finance_staff"] }
    });
    const global = await globalHarness.service.createGlobalInvoice(ACTORS.globalFinanceStaff, createGlobalInvoiceInput());
    await globalHarness.service.voidGlobalInvoice(global.id, ACTORS.financeDirector, { reasonCode: "invoice_voided", idempotencyKey: "void-before-allocation" });
    Object.assign(globalHarness.tx, {
      clearingCase: { findUnique: jest.fn().mockResolvedValue({ id: "case-1", projectId: "project-1" }) },
      clearingEventVersion: { findUnique: jest.fn().mockResolvedValue({ id: "version-1", clearingCaseId: "case-1", amountCents: 6000n, evidenceLevel: "B", attestation: { id: "attestation-1" }, confirmation: { id: "confirmation-1" } }) },
      invoiceClearingAllocation: { findUnique: jest.fn().mockResolvedValue(null) }
    });
    await expect(globalHarness.service.createClearingAllocation(ACTORS.financeDirector, {
      invoiceRecordId: global.id, clearingCaseId: "case-1", clearingEventVersionId: "version-1", amountCents: "6000", idempotencyKey: "allocation-voided-invoice"
    })).rejects.toThrow("该发票证据已进入待修复状态，不能新增清分分配");
  });

  it("restricts ordinary material staff to the current handler and finance staff to the current project", async () => {
    const nonHandlerMaterial = createHarness();
    await expect(
      nonHandlerMaterial.service.createProcurementInvoice(
        "procurement-1",
        ACTORS.otherHandler,
        createInvoiceInput()
      )
    ).rejects.toThrow("当前账号无权登记零星采购发票");
    expect(nonHandlerMaterial.invoiceRecords).toHaveLength(0);
    expect(nonHandlerMaterial.audit.record).not.toHaveBeenCalled();

    const globalFinanceStaff = createHarness({
      globalRoles: {
        [ACTORS.globalFinanceStaff]: ["finance_staff"]
      }
    });
    await expect(
      globalFinanceStaff.service.createProcurementInvoice(
        "procurement-1",
        ACTORS.globalFinanceStaff,
        createInvoiceInput()
      )
    ).rejects.toThrow("当前账号无权登记零星采购发票");
    expect(globalFinanceStaff.invoiceRecords).toHaveLength(0);
    expect(globalFinanceStaff.audit.record).not.toHaveBeenCalled();
  });

  it.each([
    [
      "global material director",
      ACTORS.materialDirector,
      { [ACTORS.materialDirector]: ["material_director"] as RoleKey[] },
      {}
    ],
    [
      "project material director",
      ACTORS.materialDirector,
      {},
      { [ACTORS.materialDirector]: ["material_director"] as RoleKey[] }
    ],
    [
      "project finance staff",
      ACTORS.financeStaff,
      {},
      { [ACTORS.financeStaff]: ["finance_staff"] as RoleKey[] }
    ],
    [
      "global finance director",
      ACTORS.financeDirector,
      { [ACTORS.financeDirector]: ["finance_director"] as RoleKey[] },
      {}
    ],
    [
      "project finance director",
      ACTORS.financeDirector,
      { [ACTORS.financeDirector]: [] as RoleKey[] },
      { [ACTORS.financeDirector]: ["finance_director"] as RoleKey[] }
    ]
  ])(
    "allows %s to register a procurement invoice",
    async (_label, actorUserId, globalRoles, projectRoles) => {
      const harness = createHarness({
        globalRoles,
        projectRoles,
        fileOwners: { "invoice-file-1": actorUserId }
      });

      const result = await harness.service.createProcurementInvoice(
        "procurement-1",
        actorUserId,
        createInvoiceInput()
      );

      expect(result.created).toBe(true);
      expect(harness.invoiceRecords[0]?.uploadedByUserId).toBe(
        actorUserId
      );
    }
  );

  it.each([
    [
      "current handler",
      ACTORS.handler,
      {},
      { [ACTORS.handler]: ["material_staff"] as RoleKey[] }
    ],
    [
      "material director",
      ACTORS.materialDirector,
      { [ACTORS.materialDirector]: ["material_director"] as RoleKey[] },
      {}
    ],
    [
      "project finance staff",
      ACTORS.financeStaff,
      {},
      { [ACTORS.financeStaff]: ["finance_staff"] as RoleKey[] }
    ],
    [
      "finance director",
      ACTORS.financeDirector,
      { [ACTORS.financeDirector]: ["finance_director"] as RoleKey[] },
      {}
    ]
  ])(
    "rejects inactive %s before any invoice write or audit",
    async (_label, actorUserId, globalRoles, projectRoles) => {
      const harness = createHarness({
        globalRoles,
        projectRoles,
        activeUsers: { [actorUserId]: false },
        fileOwners: { "invoice-file-1": actorUserId }
      });

      await expect(
        harness.service.createProcurementInvoice(
          "procurement-1",
          actorUserId,
          createInvoiceInput()
        )
      ).rejects.toThrow("当前账号不存在或已停用");
      expect(harness.invoiceRecords).toHaveLength(0);
      expect(harness.allocations).toHaveLength(0);
      expect(harness.audit.record).not.toHaveBeenCalled();
    }
  );

  it("lets only an active finance director reverse an allocation and recomputes invoice caches", async () => {
    const harness = createHarness();
    const created = await harness.service.createProcurementInvoice(
      "procurement-1",
      ACTORS.handler,
      createInvoiceInput()
    );
    const allocationId = created.allocations[0]!.id;

    await expect(
      harness.service.reverseAllocation(
        allocationId,
        ACTORS.handler,
        {
          reason: "登记错误",
          confirmReversal: true
        }
      )
    ).rejects.toThrow("只有财务主管可以复核或冲销票据事实");

    const reversed = await harness.service.reverseAllocation(
      allocationId,
      ACTORS.financeDirector,
      {
        reason: "登记错误",
        confirmReversal: true
      }
    );
    const replay = await harness.service.reverseAllocation(
      allocationId,
      ACTORS.financeDirector,
      {
        reason: "登记错误",
        confirmReversal: true
      }
    );

    expect(reversed).toMatchObject({
      allocationId,
      status: "reversed",
      reversedByUserId: ACTORS.financeDirector,
      reason: "登记错误"
    });
    expect(replay).toEqual(reversed);
    expect(harness.allocations[0]).toMatchObject({
      invalidatedByUserId: ACTORS.financeDirector,
      invalidationReason: "登记错误"
    });
    expect(harness.invoiceLines[0]?.allocatedAmountCents).toBe(0n);
    expect(harness.invoiceRecords[0]?.allocatedAmountCents).toBe(0n);

    const replacement =
      await harness.service.createProcurementInvoice(
        "procurement-1",
        ACTORS.handler,
        createInvoiceInput({
          invoiceCode: "INV-CODE-2",
          invoiceNumber: "INV-NUMBER-2",
          fileId: "invoice-file-2"
        })
      );
    expect(replacement.allocations).toEqual([
      expect.objectContaining({
        procurementLineId: "procurement-line-13",
        amountCents: "6000"
      })
    ]);
  });
});

describe("InvoiceLedgerService no-invoice and exception confirmations", () => {
  it("lets only the current handler submit proof-backed no-invoice coverage for a frozen no-invoice line and replays it", async () => {
    const harness = createHarness({
      lines: [
        {
          id: "procurement-line-no-invoice",
          invoiceMode: "no_invoice",
          actualCostCents: 3_000n
        }
      ],
      payments: [{ id: "payment-1", settledCents: 3_000n }]
    });
    const input = createNoInvoiceInput();

    const first = await harness.service.createNoInvoiceConfirmation(
      "procurement-1",
      ACTORS.handler,
      input
    );
    const replay = await harness.service.createNoInvoiceConfirmation(
      "procurement-1",
      ACTORS.handler,
      input
    );

    expect(first).toEqual(replay);
    expect(first).toMatchObject({
      procurementLineId: "procurement-line-no-invoice",
      paymentId: "payment-1",
      amountCents: "3000",
      reason: "商家按冻结条件不开具发票",
      proofFileId: "proof-file-1",
      status: "pending_review",
      submittedByUserId: ACTORS.handler
    });
    expect(harness.tx.noInvoiceConfirmation.create).toHaveBeenCalledTimes(1);
    expect(
      harness.files.assertFileHasNoBusinessBinding
    ).toHaveBeenCalledWith(harness.tx, "proof-file-1");
  });

  it("rejects no-invoice submission from anyone other than the current handler", async () => {
    const harness = createHarness({
      lines: [
        {
          id: "procurement-line-no-invoice",
          invoiceMode: "no_invoice",
          actualCostCents: 3_000n
        }
      ],
      payments: [{ id: "payment-1", settledCents: 3_000n }]
    });

    await expect(
      harness.service.createNoInvoiceConfirmation(
        "procurement-1",
        ACTORS.otherHandler,
        createNoInvoiceInput()
      )
    ).rejects.toThrow("只有当前采购经办人可以发起无票或票据异常确认");
  });

  it("rejects an inactive current handler for both no-invoice and exception submissions", async () => {
    const noInvoiceHarness = createHarness({
      lines: [
        {
          id: "procurement-line-no-invoice",
          invoiceMode: "no_invoice",
          actualCostCents: 3_000n
        }
      ],
      payments: [{ id: "payment-1", settledCents: 3_000n }],
      activeUsers: { [ACTORS.handler]: false }
    });
    await expect(
      noInvoiceHarness.service.createNoInvoiceConfirmation(
        "procurement-1",
        ACTORS.handler,
        createNoInvoiceInput()
      )
    ).rejects.toThrow("当前账号不存在或已停用");
    expect(noInvoiceHarness.noInvoices).toHaveLength(0);
    expect(noInvoiceHarness.audit.record).not.toHaveBeenCalled();

    const exceptionHarness = createHarness({
      activeUsers: { [ACTORS.handler]: false }
    });
    await expect(
      exceptionHarness.service.createInvoiceException(
        "procurement-1",
        ACTORS.handler,
        createExceptionInput()
      )
    ).rejects.toThrow("当前账号不存在或已停用");
    expect(exceptionHarness.exceptions).toHaveLength(0);
    expect(exceptionHarness.audit.record).not.toHaveBeenCalled();
  });

  it.each([
    [
      createNoInvoiceInput({ amountCents: "0" }),
      "票据确认金额必须按分填写为大于 0 的整数"
    ],
    [
      createNoInvoiceInput({ proofFileId: " " }),
      "请上传替代证明"
    ]
  ])("requires positive no-invoice amounts and a replacement proof", async (input, message) => {
    const harness = createHarness({
      lines: [
        {
          id: "procurement-line-no-invoice",
          invoiceMode: "no_invoice",
          actualCostCents: 3_000n
        }
      ],
      payments: [{ id: "payment-1", settledCents: 3_000n }]
    });

    await expect(
      harness.service.createNoInvoiceConfirmation(
        "procurement-1",
        ACTORS.handler,
        input
      )
    ).rejects.toThrow(message);
  });

  it("does not let a frozen invoice line bypass the exception process through ordinary no-invoice confirmation", async () => {
    const harness = createHarness();

    await expect(
      harness.service.createNoInvoiceConfirmation(
        "procurement-1",
        ACTORS.handler,
        createNoInvoiceInput({
          procurementLineId: "procurement-line-13",
          amountCents: "6000"
        })
      )
    ).rejects.toThrow(
      "原冻结有票材料不能直接申请无票；未实付请新建版本，已实付请走票据异常"
    );
  });

  it("lets the current handler submit an exception only for a frozen invoice line after settlement", async () => {
    const harness = createHarness();

    const result = await harness.service.createInvoiceException(
      "procurement-1",
      ACTORS.handler,
      createExceptionInput()
    );

    expect(result).toMatchObject({
      procurementLineId: "procurement-line-13",
      paymentId: "payment-1",
      amountCents: "6000",
      proofFileId: "proof-file-1",
      status: "pending_review"
    });
    expect(harness.exceptions[0]).toMatchObject({
      expectedInvoiceType: "vat_special",
      expectedVatRateOptionId: "vat-13",
      amountCents: 6_000n,
      submittedByUserId: ACTORS.handler
    });
  });

  it("rejects exception submission for a frozen no-invoice line or a different handler", async () => {
    const noInvoiceHarness = createHarness({
      lines: [
        {
          id: "procurement-line-no-invoice",
          invoiceMode: "no_invoice",
          actualCostCents: 3_000n
        }
      ],
      payments: [{ id: "payment-1", settledCents: 3_000n }]
    });
    await expect(
      noInvoiceHarness.service.createInvoiceException(
        "procurement-1",
        ACTORS.handler,
        createExceptionInput({
          procurementLineId: "procurement-line-no-invoice",
          amountCents: "3000"
        })
      )
    ).rejects.toThrow("只有原冻结有票材料才能发起票据异常");

    const handlerHarness = createHarness();
    await expect(
      handlerHarness.service.createInvoiceException(
        "procurement-1",
        ACTORS.otherHandler,
        createExceptionInput()
      )
    ).rejects.toThrow("只有当前采购经办人可以发起无票或票据异常确认");
  });

  it("allows only a finance director to confirm a pending no-invoice fact", async () => {
    const harness = createHarness({
      lines: [
        {
          id: "procurement-line-no-invoice",
          invoiceMode: "no_invoice",
          actualCostCents: 3_000n
        }
      ],
      payments: [{ id: "payment-1", settledCents: 3_000n }]
    });
    const pending = await harness.service.createNoInvoiceConfirmation(
      "procurement-1",
      ACTORS.handler,
      createNoInvoiceInput()
    );

    await expect(
      harness.service.reviewNoInvoiceConfirmation(
        "procurement-1",
        pending.id,
        ACTORS.handler,
        { operation: "confirm", comment: "复核通过" }
      )
    ).rejects.toThrow("只有财务主管可以复核或冲销票据事实");

    const result = await harness.service.reviewNoInvoiceConfirmation(
      "procurement-1",
      pending.id,
      ACTORS.financeDirector,
      { operation: "confirm", comment: "复核通过" }
    );
    expect(result).toMatchObject({
      confirmationId: pending.id,
      operation: "confirm",
      status: "confirmed",
      reviewedByUserId: ACTORS.financeDirector
    });
  });

  it("rejects an inactive finance director before reviewing a pending ticket fact", async () => {
    const harness = createHarness({
      lines: [
        {
          id: "procurement-line-no-invoice",
          invoiceMode: "no_invoice",
          actualCostCents: 3_000n
        }
      ],
      payments: [{ id: "payment-1", settledCents: 3_000n }],
      activeUsers: { [ACTORS.financeDirector]: false }
    });
    const pending = await harness.service.createNoInvoiceConfirmation(
      "procurement-1",
      ACTORS.handler,
      createNoInvoiceInput()
    );
    const auditCountBeforeReview =
      harness.audit.record.mock.calls.length;

    await expect(
      harness.service.reviewNoInvoiceConfirmation(
        "procurement-1",
        pending.id,
        ACTORS.financeDirector,
        { operation: "confirm", comment: "复核通过" }
      )
    ).rejects.toThrow("当前账号不存在或已停用");
    expect(harness.noInvoices[0]?.status).toBe("pending_review");
    expect(harness.audit.record).toHaveBeenCalledTimes(
      auditCountBeforeReview
    );
  });

  it.each([
    ["confirm" as const, "confirmed"],
    ["return" as const, "returned"]
  ])("lets a finance director %s a pending invoice exception", async (operation, expectedStatus) => {
    const harness = createHarness();
    const pending = await harness.service.createInvoiceException(
      "procurement-1",
      ACTORS.handler,
      createExceptionInput()
    );

    const result = await harness.service.reviewInvoiceException(
      "procurement-1",
      pending.id,
      ACTORS.financeDirector,
      {
        operation,
        comment: operation === "return" ? "请补充证明" : "确认异常"
      }
    );

    expect(result).toMatchObject({
      confirmationId: pending.id,
      operation,
      status: expectedStatus,
      reviewedByUserId: ACTORS.financeDirector
    });
  });

  it("lets a finance director reverse a confirmed exception with explicit confirmation and history", async () => {
    const harness = createHarness();
    const pending = await harness.service.createInvoiceException(
      "procurement-1",
      ACTORS.handler,
      createExceptionInput()
    );
    await harness.service.reviewInvoiceException(
      "procurement-1",
      pending.id,
      ACTORS.financeDirector,
      { operation: "confirm", comment: "确认异常" }
    );

    const result = await harness.service.reviewInvoiceException(
      "procurement-1",
      pending.id,
      ACTORS.financeDirector,
      {
        operation: "reverse",
        comment: "原确认事实有误",
        confirmReversal: true
      }
    );

    expect(result).toMatchObject({
      confirmationId: pending.id,
      operation: "reverse",
      status: "reversed",
      reviewedByUserId: ACTORS.financeDirector,
      comment: "原确认事实有误"
    });
    expect(harness.exceptions[0]).toMatchObject({
      status: "reversed",
      reviewedByUserId: ACTORS.financeDirector,
      reversalReason: "原确认事实有误",
      reversedByUserId: ACTORS.financeDirector
    });

    const replacement =
      await harness.service.createInvoiceException(
        "procurement-1",
        ACTORS.handler,
        createExceptionInput({ proofFileId: "proof-file-2" })
      );
    expect(replacement).toMatchObject({
      status: "pending_review",
      amountCents: "6000",
      proofFileId: "proof-file-2"
    });
  });

  it("releases no-invoice capacity after return so the handler can submit corrected proof", async () => {
    const harness = createHarness({
      lines: [
        {
          id: "procurement-line-no-invoice",
          invoiceMode: "no_invoice",
          actualCostCents: 3_000n
        }
      ],
      payments: [{ id: "payment-1", settledCents: 3_000n }]
    });
    const pending = await harness.service.createNoInvoiceConfirmation(
      "procurement-1",
      ACTORS.handler,
      createNoInvoiceInput()
    );
    await harness.service.reviewNoInvoiceConfirmation(
      "procurement-1",
      pending.id,
      ACTORS.financeDirector,
      { operation: "return", comment: "请补充更清晰证明" }
    );

    const replacement =
      await harness.service.createNoInvoiceConfirmation(
        "procurement-1",
        ACTORS.handler,
        createNoInvoiceInput({ proofFileId: "proof-file-2" })
      );
    expect(replacement).toMatchObject({
      status: "pending_review",
      amountCents: "3000",
      proofFileId: "proof-file-2"
    });
  });
});

describe("InvoiceLedgerService locking", () => {
  it("requires a real company payment or executed supplier balance before any ticket write", async () => {
    const invoiceHarness = createHarness({
      payments: [{ id: "payment-1", settledCents: 0n }]
    });
    await expect(
      invoiceHarness.service.createProcurementInvoice(
        "procurement-1",
        ACTORS.handler,
        createInvoiceInput()
      )
    ).rejects.toThrow(
      "尚未发生公司实际付款或供应商余额抵扣，不能登记票据；请先变更采购条件"
    );
    await expect(
      invoiceHarness.service.createInvoiceException(
        "procurement-1",
        ACTORS.handler,
        createExceptionInput()
      )
    ).rejects.toThrow(
      "尚未发生公司实际付款或供应商余额抵扣，不能登记票据；请先变更采购条件"
    );

    const noInvoiceHarness = createHarness({
      lines: [
        {
          id: "procurement-line-no-invoice",
          invoiceMode: "no_invoice",
          actualCostCents: 3_000n
        }
      ],
      payments: [{ id: "payment-1", settledCents: 0n }]
    });
    await expect(
      noInvoiceHarness.service.createNoInvoiceConfirmation(
        "procurement-1",
        ACTORS.handler,
        createNoInvoiceInput()
      )
    ).rejects.toThrow(
      "尚未发生公司实际付款或供应商余额抵扣，不能登记票据；请先变更采购条件"
    );
  });

  it("rejects all ticket corrections after procurement closure", async () => {
    const harness = createHarness({ procurementStatus: "closed" });

    await expect(
      harness.service.createProcurementInvoice(
        "procurement-1",
        ACTORS.handler,
        createInvoiceInput()
      )
    ).rejects.toThrow("零星采购已办结，不能更正票据");

    expect(harness.tx.invoiceRecord.create).not.toHaveBeenCalled();
  });
});

describe("InvoiceLedgerService coverage read models", () => {
  it("exposes actionable allocation and confirmation identifiers with review history in procurement and payment details", async () => {
    const harness = createHarness({
      lines: [
        { ...DEFAULT_LINES[0], actualCostCents: 3_000n },
        {
          id: "procurement-line-no-invoice",
          invoiceMode: "no_invoice",
          actualCostCents: 3_000n
        }
      ],
      payments: [{ id: "payment-1", settledCents: 6_000n }]
    });
    const invoice = await harness.service.createProcurementInvoice(
      "procurement-1",
      ACTORS.handler,
      createInvoiceInput({
        totalAmountCents: "3000",
        lines: [
          {
            vatRateOptionId: "vat-13",
            taxInclusiveAmountCents: "3000",
            allocations: [
              {
                procurementLineId: "procurement-line-13",
                paymentId: "payment-1",
                amountCents: "3000"
              }
            ]
          }
        ]
      })
    );
    const pending = await harness.service.createNoInvoiceConfirmation(
      "procurement-1",
      ACTORS.handler,
      createNoInvoiceInput()
    );

    const procurementDetail =
      await harness.service.detailForProcurement("procurement-1");
    const paymentDetail =
      await harness.service.detailForPayment("payment-1");

    expect(procurementDetail).toMatchObject({
      available: true,
      invoices: [
        {
          id: invoice.invoice.id,
          fileId: "invoice-file-1",
          lines: [
            {
              id: invoice.invoice.lines[0]!.id,
              activeAllocatedAmountCents: "3000",
              remainingAmountCents: "0"
            }
          ]
        }
      ],
      allocations: [
        {
          id: invoice.allocations[0]!.id,
          status: "active",
          paymentId: "payment-1"
        }
      ],
      noInvoiceConfirmations: [
        {
          id: pending.id,
          reason: "商家按冻结条件不开具发票",
          proofFileId: "proof-file-1",
          status: "pending_review"
        }
      ]
    });
    expect(paymentDetail).toMatchObject({
      paymentId: "payment-1",
      paymentCurrent: true,
      allocations: [{ id: invoice.allocations[0]!.id }],
      noInvoiceConfirmations: [{ id: pending.id }]
    });

    const actionableId =
      procurementDetail.noInvoiceConfirmations[0]!.id;
    await harness.service.reviewNoInvoiceConfirmation(
      "procurement-1",
      actionableId,
      ACTORS.financeDirector,
      { operation: "confirm", comment: "另一名财务主管复核通过" }
    );
    const reviewed =
      await harness.service.detailForProcurement("procurement-1");
    expect(reviewed.noInvoiceConfirmations[0]).toMatchObject({
      id: actionableId,
      status: "confirmed",
      review: {
        reviewedByUserId: ACTORS.financeDirector,
        comment: "另一名财务主管复核通过"
      }
    });
  });

  it("keeps payment attribution descriptive and does not add it to procurement coverage again", async () => {
    const harness = createHarness();
    await harness.service.createProcurementInvoice(
      "procurement-1",
      ACTORS.handler,
      createInvoiceInput()
    );

    const procurementCoverage =
      await harness.service.coverageForProcurementIds([
        "procurement-1"
      ]);
    const paymentCoverage =
      await harness.service.coverageForPaymentIds(["payment-1"]);

    expect(procurementCoverage.get("procurement-1")).toEqual({
      available: true,
      status: "fully_covered",
      label: "票据已全额覆盖",
      actualCostCents: "6000",
      normalInvoiceCents: "6000",
      confirmedNoInvoiceCents: "0",
      confirmedExceptionCents: "0",
      effectiveCoveredCents: "6000",
      remainingCents: "0",
      pendingCount: 0
    });
    expect(paymentCoverage.get("payment-1")).toMatchObject({
      effectiveCoveredCents: "6000",
      remainingCents: "0",
      paymentAttribution: {
        normalInvoiceCents: "6000",
        confirmedNoInvoiceCents: "0",
        confirmedExceptionCents: "0",
        attributedCents: "6000",
        pendingCount: 0,
        countsTowardProcurementCoverageAgain: false
      }
    });
  });

  it("fails closed when a payment id is attached to ticket facts from another procurement coordinate", async () => {
    const harness = createHarness();
    harness.allocations.push({
      id: "allocation-cross-procurement",
      projectId: "project-1",
      invoiceLineId: "invoice-line-cross",
      receiptId: "receipt-other",
      receiptRevisionNo: 1,
      procurementId: "procurement-other",
      procurementVersionId: "version-other",
      procurementLineId: "line-other",
      paymentId: "payment-1",
      amountCents: 1_000n,
      createdByUserId: ACTORS.handler,
      invalidatedAt: null,
      invalidatedByUserId: null,
      invalidationReason: null
    });

    const result =
      await harness.service.coverageForPaymentIds(["payment-1"]);

    expect(result.get("payment-1")).toMatchObject({
      status: "inconsistent",
      label: "付款票据归属坐标异常，需核对",
      paymentAttribution: {
        normalInvoiceCents: "0",
        attributedCents: "0",
        inconsistent: true,
        countsTowardProcurementCoverageAgain: false
      }
    });
  });

  it("aggregates only effective coverage while exposing pending confirmation count", async () => {
    const harness = createHarness({
      lines: [
        { ...DEFAULT_LINES[0], actualCostCents: 2_000n },
        {
          id: "procurement-line-no-invoice",
          invoiceMode: "no_invoice",
          actualCostCents: 2_000n
        },
        {
          ...DEFAULT_LINES[0],
          id: "procurement-line-exception",
          actualCostCents: 2_000n
        },
        {
          id: "procurement-line-pending",
          invoiceMode: "no_invoice",
          actualCostCents: 1_000n
        }
      ],
      payments: [{ id: "payment-1", settledCents: 7_000n }]
    });
    const coordinates = {
      projectId: "project-1",
      receiptId: "receipt-1",
      receiptRevisionNo: 1,
      procurementId: "procurement-1",
      procurementVersionId: "version-1"
    };
    harness.allocations.push({
      id: "allocation-read-1",
      ...coordinates,
      invoiceLineId: "invoice-line-read-1",
      procurementLineId: "procurement-line-13",
      paymentId: null,
      amountCents: 2_000n,
      createdByUserId: ACTORS.handler,
      invalidatedAt: null,
      invalidatedByUserId: null,
      invalidationReason: null
    });
    const confirmationBase = {
      ...coordinates,
      paymentId: null,
      reason: "证明原因",
      submittedByUserId: ACTORS.handler,
      submittedAt: new Date("2026-07-17T08:00:00.000Z"),
      reviewedByUserId: ACTORS.financeDirector,
      reviewedAt: new Date("2026-07-17T09:00:00.000Z"),
      reviewComment: "确认",
      reversedAt: null,
      reversedByUserId: null,
      reversalReason: null
    };
    harness.noInvoices.push(
      {
        id: "no-invoice-read-confirmed",
        ...confirmationBase,
        procurementLineId: "procurement-line-no-invoice",
        amountCents: 2_000n,
        proofFileId: "proof-file-confirmed",
        status: "confirmed"
      },
      {
        id: "no-invoice-read-pending",
        ...confirmationBase,
        procurementLineId: "procurement-line-pending",
        amountCents: 1_000n,
        proofFileId: "proof-file-pending",
        status: "pending_review",
        reviewedByUserId: null,
        reviewedAt: null,
        reviewComment: null
      }
    );
    harness.exceptions.push({
      id: "exception-read-confirmed",
      ...confirmationBase,
      procurementLineId: "procurement-line-exception",
      amountCents: 2_000n,
      proofFileId: "proof-file-exception",
      status: "confirmed"
    });

    const result = await harness.service.coverageForProcurementIds([
      "procurement-1"
    ]);

    expect(result.get("procurement-1")).toEqual({
      available: true,
      status: "pending_review",
      label: "1 项票据待复核",
      actualCostCents: "7000",
      normalInvoiceCents: "2000",
      confirmedNoInvoiceCents: "2000",
      confirmedExceptionCents: "2000",
      effectiveCoveredCents: "6000",
      remainingCents: "1000",
      pendingCount: 1
    });
  });

  it("marks stale active allocation coordinates inconsistent instead of counting them", async () => {
    const harness = createHarness();
    harness.allocations.push({
      id: "allocation-stale",
      projectId: "project-1",
      invoiceLineId: "invoice-line-stale",
      receiptId: "receipt-1",
      receiptRevisionNo: 0,
      procurementId: "procurement-1",
      procurementVersionId: "version-1",
      procurementLineId: "procurement-line-13",
      paymentId: null,
      amountCents: 1_000n,
      createdByUserId: ACTORS.handler,
      invalidatedAt: null,
      invalidatedByUserId: null,
      invalidationReason: null
    });

    const result = await harness.service.coverageForProcurementIds([
      "procurement-1"
    ]);

    expect(result.get("procurement-1")).toMatchObject({
      available: true,
      status: "inconsistent",
      normalInvoiceCents: "0",
      effectiveCoveredCents: "0",
      remainingCents: "6000"
    });
  });
});
