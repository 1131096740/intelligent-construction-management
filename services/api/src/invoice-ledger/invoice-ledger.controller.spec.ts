import "reflect-metadata";
import { BadRequestException, RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { REQUIRED_PROJECT_ACTION_KEY } from "../auth/decorators/require-project-role.decorator";
import { createApiValidationPipe } from "../validation/api-validation";
import type { CreateProcurementInvoiceDto } from "./dto/create-procurement-invoice.dto";
import { InvoiceLedgerController } from "./invoice-ledger.controller";

type RuntimeDto = new () => object;
type InvoiceLedgerMethod =
  | "createProcurementInvoice"
  | "createClearingAllocation"
  | "reverseAllocation"
  | "createNoInvoiceConfirmation"
  | "reviewNoInvoiceConfirmation"
  | "createInvoiceException"
  | "reviewInvoiceException";

function bodyMetatype(method: InvoiceLedgerMethod, index: number) {
  const paramTypes = Reflect.getMetadata(
    "design:paramtypes",
    InvoiceLedgerController.prototype,
    method
  ) as RuntimeDto[] | undefined;
  const metatype = paramTypes?.[index];
  if (!metatype) {
    throw new Error(`Missing runtime DTO for ${method}`);
  }
  return metatype;
}

async function validateBody(
  method: InvoiceLedgerMethod,
  index: number,
  value: unknown
) {
  return createApiValidationPipe().transform(value, {
    type: "body",
    metatype: bodyMetatype(method, index),
    data: undefined
  });
}

async function getValidationResponse(
  method: InvoiceLedgerMethod,
  index: number,
  value: unknown
): Promise<Record<string, unknown>> {
  try {
    await validateBody(method, index, value);
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (error as BadRequestException).getResponse() as Record<
      string,
      unknown
    >;
  }
  throw new Error("Expected invoice ledger validation to reject the request");
}

const validInvoice: CreateProcurementInvoiceDto = {
  invoiceType: "vat_special",
  owningCompanyEntityId: "company-entity-1",
  direction: "inbound",
  sellerTaxId: "91310000123456789A",
  buyerTaxId: "91310000987654321B",
  invoiceCode: "INV-CODE-001",
  invoiceNumber: "INV-NO-001",
  issueDate: "2026-07-17",
  sellerName: "甲供应商",
  buyerName: "乙建设公司",
  totalAmountCents: "13000",
  fileId: "invoice-file-1",
  lines: [
    {
      description: "水泥",
      vatRateOptionId: "vat-13",
      taxInclusiveAmountCents: "10000",
      allocations: [
        {
          procurementLineId: "procurement-line-1",
          paymentId: "payment-1",
          amountCents: "10000"
        }
      ]
    },
    {
      description: "运输费",
      vatRateOptionId: "vat-3",
      taxInclusiveAmountCents: "3000",
      allocations: [
        {
          procurementLineId: "procurement-line-2",
          amountCents: "3000"
        }
      ]
    }
  ]
};

describe("InvoiceLedgerController", () => {
  it("exposes the frozen and global-allocation POST routes", () => {
    const routes: Array<[InvoiceLedgerMethod, string]> = [
      [
        "createProcurementInvoice",
        "spot-procurements/:procurementId/invoices"
      ],
      ["createClearingAllocation", "invoice-clearing-allocations"],
      ["reverseAllocation", "invoice-allocations/:allocationId/reversal"],
      [
        "createNoInvoiceConfirmation",
        "spot-procurements/:procurementId/no-invoice-confirmations"
      ],
      [
        "reviewNoInvoiceConfirmation",
        "spot-procurements/:procurementId/no-invoice-confirmations/:confirmationId/review"
      ],
      [
        "createInvoiceException",
        "spot-procurements/:procurementId/invoice-exceptions"
      ],
      [
        "reviewInvoiceException",
        "spot-procurements/:procurementId/invoice-exceptions/:exceptionId/review"
      ]
    ];

    for (const [method, path] of routes) {
      expect(
        Reflect.getMetadata(
          METHOD_METADATA,
          InvoiceLedgerController.prototype[method]
        )
      ).toBe(RequestMethod.POST);
      expect(
        Reflect.getMetadata(
          PATH_METADATA,
          InvoiceLedgerController.prototype[method]
        )
      ).toBe(path);
    }
  });

  it("uses invoice management for writes and finance confirmation for reviews", () => {
    for (const method of [
      "createProcurementInvoice",
      "reverseAllocation",
      "createNoInvoiceConfirmation",
      "createInvoiceException"
    ] as const) {
      expect(
        Reflect.getMetadata(
          REQUIRED_PROJECT_ACTION_KEY,
          InvoiceLedgerController.prototype[method]
        )
      ).toBe("spot_procurement.invoice.manage");
    }

    expect(
      Reflect.getMetadata(
        REQUIRED_PROJECT_ACTION_KEY,
        InvoiceLedgerController.prototype.createClearingAllocation
      )
    ).toBe("clearing.confirm");

    for (const method of [
      "reviewNoInvoiceConfirmation",
      "reviewInvoiceException"
    ] as const) {
      expect(
        Reflect.getMetadata(
          REQUIRED_PROJECT_ACTION_KEY,
          InvoiceLedgerController.prototype[method]
        )
      ).toBe("spot_procurement.invoice_exception.confirm");
    }
  });

  it("forwards only the authenticated user id and route identifiers", async () => {
    const service = {
      createProcurementInvoice: jest.fn().mockResolvedValue({ id: "invoice-1" }),
      reverseAllocation: jest.fn().mockResolvedValue({ id: "allocation-1" }),
      createNoInvoiceConfirmation: jest.fn().mockResolvedValue({ id: "no-invoice-1" }),
      reviewNoInvoiceConfirmation: jest.fn().mockResolvedValue({ id: "no-invoice-1" }),
      createInvoiceException: jest.fn().mockResolvedValue({ id: "exception-1" }),
      reviewInvoiceException: jest.fn().mockResolvedValue({ id: "exception-1" })
    };
    const controller = new InvoiceLedgerController(service as never);
    const user = { id: "actor-1", positions: ["finance_director"] } as never;
    const reverseBody = { reason: "分摊录入错误", confirmReversal: true };
    const noInvoiceBody = {
      procurementLineId: "procurement-line-1",
      amountCents: "10000",
      reason: "商家无法开具发票",
      proofFileId: "proof-file-1"
    };
    const reviewBody = { operation: "confirm" as const, comment: "证明已复核" };
    const exceptionBody = {
      procurementLineId: "procurement-line-2",
      paymentId: "payment-1",
      invoiceLineId: "invoice-line-2",
      amountCents: "3000",
      reason: "实际发票税率与冻结条件不一致",
      proofFileId: "proof-file-2"
    };

    await controller.createProcurementInvoice(
      "procurement-1",
      user,
      validInvoice
    );
    await controller.reverseAllocation("allocation-1", user, reverseBody);
    await controller.createNoInvoiceConfirmation(
      "procurement-1",
      user,
      noInvoiceBody
    );
    await controller.reviewNoInvoiceConfirmation(
      "procurement-1",
      "no-invoice-1",
      user,
      reviewBody
    );
    await controller.createInvoiceException(
      "procurement-1",
      user,
      exceptionBody
    );
    await controller.reviewInvoiceException(
      "procurement-1",
      "exception-1",
      user,
      reviewBody
    );

    expect(service.createProcurementInvoice).toHaveBeenCalledWith(
      "procurement-1",
      "actor-1",
      validInvoice
    );
    expect(service.reverseAllocation).toHaveBeenCalledWith(
      "allocation-1",
      "actor-1",
      reverseBody
    );
    expect(service.createNoInvoiceConfirmation).toHaveBeenCalledWith(
      "procurement-1",
      "actor-1",
      noInvoiceBody
    );
    expect(service.reviewNoInvoiceConfirmation).toHaveBeenCalledWith(
      "procurement-1",
      "no-invoice-1",
      "actor-1",
      reviewBody
    );
    expect(service.createInvoiceException).toHaveBeenCalledWith(
      "procurement-1",
      "actor-1",
      exceptionBody
    );
    expect(service.reviewInvoiceException).toHaveBeenCalledWith(
      "procurement-1",
      "exception-1",
      "actor-1",
      reviewBody
    );
  });

  it("keeps nested invoice lines and allocations as runtime DTOs", async () => {
    expect(bodyMetatype("createProcurementInvoice", 2)).not.toBe(Object);

    await expect(
      validateBody("createProcurementInvoice", 2, validInvoice)
    ).resolves.toMatchObject(validInvoice);
  });

  it("rejects unsupported invoice types, missing identities and nested unknown fields", async () => {
    const response = await getValidationResponse(
      "createProcurementInvoice",
      2,
      {
        ...validInvoice,
        invoiceType: "electronic_receipt",
        invoiceCode: undefined,
        invoiceNumber: undefined,
        lines: [
          {
            ...validInvoice.lines[0],
            allocations: [
              {
                ...validInvoice.lines[0].allocations[0],
                internalNote: "must-not-pass"
              }
            ]
          }
        ]
      }
    );

    expect(response.errors).toEqual(
      expect.arrayContaining([
        "发票类型不正确",
        "请填写发票代码、发票号码或可识别票据编号",
        "lines[0].allocations[0].internalNote 不是允许提交的字段"
      ])
    );
  });

  it("requires no-invoice reasons and proof files while keeping money as cents text", async () => {
    const response = await getValidationResponse(
      "createNoInvoiceConfirmation",
      2,
      {
        procurementLineId: "procurement-line-1",
        amountCents: 10000,
        reason: " ",
        proofFileId: ""
      }
    );

    expect(response.errors).toEqual(
      expect.arrayContaining([
        "无票确认金额格式不正确",
        "无票原因不能为空白",
        "无票确认必须上传替代证明"
      ])
    );
  });

  it("accepts the three review operations and validates reversal confirmations", async () => {
    expect(bodyMetatype("reviewNoInvoiceConfirmation", 3)).not.toBe(Object);
    expect(bodyMetatype("reviewInvoiceException", 3)).not.toBe(Object);
    expect(bodyMetatype("reverseAllocation", 2)).not.toBe(Object);

    await expect(
      validateBody("reviewNoInvoiceConfirmation", 3, {
        operation: "return",
        comment: "请补充替代证明"
      })
    ).resolves.toMatchObject({ operation: "return" });
    await expect(
      validateBody("reviewInvoiceException", 3, {
        operation: "reverse",
        comment: "异常确认有误",
        confirmReversal: true
      })
    ).resolves.toMatchObject({
      operation: "reverse",
      confirmReversal: true
    });

    const invalidOperation = await getValidationResponse(
      "reviewInvoiceException",
      3,
      { operation: "approve" }
    );
    expect(invalidOperation.errors).toContain("票据异常复核操作不正确");

    const missingConfirmation = await getValidationResponse(
      "reverseAllocation",
      2,
      { reason: "分摊录入错误", confirmReversal: false }
    );
    expect(missingConfirmation.errors).toContain(
      "请明确确认解除本次发票分摊"
    );
  });
});
