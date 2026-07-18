import { BadRequestException } from "@nestjs/common";
import { createApiValidationPipe } from "../validation/api-validation";
import {
  CreateSpotProcurementDto,
  SpotProcurementLineDto
} from "./dto/create-spot-procurement.dto";
import { UpdateSpotProcurementDraftDto } from "./dto/update-spot-procurement-draft.dto";
import {
  calculateSpotProcurementDraft,
  calculateSpotProcurementLine
} from "./spot-procurement-money";

const validDraft = {
  applicationDepartment: "工程部",
  applicationName: "杨帅",
  requestedArrivalAt: "2026-07-20T00:00:00.000Z",
  reason: "现场临时补充钢筋",
  note: "当天送达",
  lines: [
    {
      materialName: "HRB400E 钢筋",
      specification: "Φ12",
      unit: "吨",
      quantity: "12.500000",
      note: "首批进场"
    }
  ],
  attachments: [
    {
      fileId: "file-quote-1",
      category: "merchant_quote" as const
    }
  ]
};

const bodyMetadata = (metatype: new () => object) => ({
  type: "body" as const,
  metatype,
  data: undefined
});

async function validateBody(value: unknown, metatype: new () => object) {
  return createApiValidationPipe().transform(value, bodyMetadata(metatype));
}

async function getValidationResponse(
  value: unknown,
  metatype: new () => object
): Promise<Record<string, unknown>> {
  try {
    await validateBody(value, metatype);
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (error as BadRequestException).getResponse() as Record<string, unknown>;
  }
  throw new Error("Expected spot procurement validation to reject the request");
}

describe("spot procurement exact money", () => {
  it("calculates quantity times the applicable unit price without Number coercion", () => {
    expect(
      calculateSpotProcurementLine({
        quantity: "12.500000",
        unitPrice: "3.28"
      })
    ).toEqual({ amountCents: 4100n });
  });

  it("uses ROUND_HALF_UP when the exact yuan amount lands on half a cent", () => {
    expect(
      calculateSpotProcurementLine({
        quantity: "1",
        unitPrice: "0.005"
      })
    ).toEqual({ amountCents: 1n });
  });

  it("keeps enough Decimal precision to decide rounding at the BIGINT boundary", () => {
    expect(
      calculateSpotProcurementLine({
        quantity: "1",
        unitPrice: "92233720368547758.074999"
      })
    ).toEqual({ amountCents: 9_223_372_036_854_775_807n });
  });

  it.each([
    ["quantity number", { quantity: 1, unitPrice: "1" }],
    ["unit price number", { quantity: "1", unitPrice: 1 }],
    ["quantity exponent", { quantity: "1e2", unitPrice: "1" }],
    ["unit price exponent", { quantity: "1", unitPrice: "1e2" }],
    ["leading quantity zero", { quantity: "01", unitPrice: "1" }],
    ["leading unit price zero", { quantity: "1", unitPrice: "01" }],
    ["quantity whitespace", { quantity: " 1", unitPrice: "1" }],
    ["unit price newline", { quantity: "1", unitPrice: "1\n" }],
    ["blank quantity", { quantity: "", unitPrice: "1" }],
    ["blank unit price", { quantity: "1", unitPrice: "" }],
    ["zero quantity", { quantity: "0.000000", unitPrice: "1" }],
    ["negative quantity", { quantity: "-1", unitPrice: "1" }],
    ["negative unit price", { quantity: "1", unitPrice: "-1" }],
    ["quantity over scale", { quantity: "1.0000001", unitPrice: "1" }],
    ["unit price over scale", { quantity: "1", unitPrice: "1.0000001" }],
    [
      "quantity over Decimal(24,6)",
      { quantity: "1000000000000000000", unitPrice: "0" }
    ],
    [
      "unit price over Decimal(24,6)",
      { quantity: "0.000001", unitPrice: "1000000000000000000" }
    ]
  ])("rejects non-canonical or unstorable %s", (_label, input) => {
    expect(() => calculateSpotProcurementLine(input as never)).toThrow();
  });

  it("accepts six decimal places and a zero unit price", () => {
    expect(
      calculateSpotProcurementLine({
        quantity: "0.000001",
        unitPrice: "0.000000"
      })
    ).toEqual({ amountCents: 0n });
  });

  it("enforces invoice and no-invoice cross-field rules before totaling", () => {
    const invoiceBase = {
      quantity: "1",
      unitPrice: "10",
      invoiceMode: "invoice" as const,
      invoiceType: "vat_general" as const,
      vatRateOptionId: "vat-rate-1"
    };

    expect(() =>
      calculateSpotProcurementDraft({
        lines: [{ ...invoiceBase, invoiceType: undefined }]
      })
    ).toThrow("有票明细");
    expect(() =>
      calculateSpotProcurementDraft({
        lines: [{ ...invoiceBase, vatRateOptionId: undefined }]
      })
    ).toThrow("有票明细");
    expect(() =>
      calculateSpotProcurementDraft({
        lines: [{ ...invoiceBase, invoiceType: null }]
      })
    ).toThrow("有票明细");
    expect(() =>
      calculateSpotProcurementDraft({
        lines: [{ ...invoiceBase, vatRateOptionId: null }]
      })
    ).toThrow("有票明细");
    expect(() =>
      calculateSpotProcurementDraft({
        lines: [{ ...invoiceBase, unitPrice: undefined }]
      })
    ).toThrow("单价");
    expect(() =>
      calculateSpotProcurementDraft({
        lines: [
          {
            quantity: "1",
            unitPrice: "10",
            invoiceMode: "no_invoice",
            invoiceType: "vat_special"
          }
        ]
      })
    ).toThrow("无票明细");
    expect(() =>
      calculateSpotProcurementDraft({
        lines: [
          {
            quantity: "1",
            unitPrice: "10",
            invoiceMode: "no_invoice",
            vatRateOptionId: "vat-rate-1"
          }
        ]
      })
    ).toThrow("无票明细");
    expect(() =>
      calculateSpotProcurementDraft({
        lines: [
          {
            quantity: "1",
            unitPrice: "10",
            invoiceMode: "no_invoice",
            invoiceType: null
          }
        ]
      })
    ).toThrow("无票明细");
    expect(() =>
      calculateSpotProcurementDraft({
        lines: [
          {
            quantity: "1",
            unitPrice: "10",
            invoiceMode: "no_invoice",
            vatRateOptionId: null
          }
        ]
      })
    ).toThrow("无票明细");
  });

  it("rejects null, undefined, sparse and non-object draft lines with a controlled error", () => {
    const sparseLines = new Array(1);
    const invalidLines = [
      [null],
      [undefined],
      sparseLines,
      ["not-an-object"],
      [[]]
    ];

    for (const lines of invalidLines) {
      expect(() =>
        calculateSpotProcurementDraft({ lines } as never)
      ).toThrow(BadRequestException);
      expect(() =>
        calculateSpotProcurementDraft({ lines } as never)
      ).toThrow("采购明细必须是对象");
    }
  });

  it("rejects a non-object draft calculation root with a controlled error", () => {
    for (const input of [null, undefined, [], "not-an-object"]) {
      expect(() => calculateSpotProcurementDraft(input as never)).toThrow(
        BadRequestException
      );
      expect(() => calculateSpotProcurementDraft(input as never)).toThrow(
        "采购草稿必须是对象"
      );
    }
  });

  it("uses the no-invoice unit price and recalculates client display amounts", () => {
    const result = calculateSpotProcurementDraft({
      lines: [
        {
          quantity: "2.5",
          unitPrice: "4",
          invoiceMode: "no_invoice",
          amountCents: "1"
        },
        {
          quantity: "1",
          unitPrice: "0.01",
          invoiceMode: "no_invoice",
          amountCents: "999999"
        }
      ],
      totalAmountCents: "2"
    });

    expect(result.lines.map((line) => line.amountCents)).toEqual([1000n, 1n]);
    expect(result.totalAmountCents).toBe(1001n);
  });

  it("returns only recalculated trusted line amounts", () => {
    const result = calculateSpotProcurementDraft({
      lines: [
        {
          quantity: "2.5",
          unitPrice: "4",
          invoiceMode: "no_invoice",
          amountCents: "1",
          internalSecret: "do-not-return"
        }
      ],
      totalAmountCents: "2"
    } as never);

    expect(result).toEqual({
      lines: [{ amountCents: 1000n }],
      totalAmountCents: 1000n
    });
    expect(result.lines[0]).not.toHaveProperty("internalSecret");
  });

  it("rejects empty drafts, line overflow and incremental total overflow", () => {
    expect(() => calculateSpotProcurementDraft({ lines: [] })).toThrow(
      "至少填写一条采购明细"
    );
    expect(() =>
      calculateSpotProcurementLine({
        quantity: "1",
        unitPrice: "92233720368547758.08"
      })
    ).toThrow("超出系统可保存范围");
    expect(() =>
      calculateSpotProcurementDraft({
        lines: [
          {
            quantity: "1",
            unitPrice: "92233720368547758.07",
            invoiceMode: "no_invoice"
          },
          {
            quantity: "1",
            unitPrice: "0.01",
            invoiceMode: "no_invoice"
          }
        ]
      })
    ).toThrow("采购金额合计超出系统可保存范围");
  });
});

describe("spot procurement runtime DTO validation", () => {
  it("transforms a complete A4 application body without supplier or money facts", async () => {
    const result = await validateBody(
      {
        projectId: "project-1",
        code: "LXCG-2026-001",
        ...validDraft
      },
      CreateSpotProcurementDto
    );

    expect(result).toBeInstanceOf(CreateSpotProcurementDto);
    expect((result as CreateSpotProcurementDto).lines[0]).toBeInstanceOf(
      SpotProcurementLineDto
    );
    expect(result).not.toHaveProperty("supplierName");
    expect(result).not.toHaveProperty("totalAmountCents");
  });

  it("lets draft updates reuse draft content without accepting project or code", async () => {
    await expect(
      validateBody(validDraft, UpdateSpotProcurementDraftDto)
    ).resolves.toBeInstanceOf(UpdateSpotProcurementDraftDto);

    const projectResponse = await getValidationResponse(
      { ...validDraft, projectId: "project-2" },
      UpdateSpotProcurementDraftDto
    );
    const codeResponse = await getValidationResponse(
      { ...validDraft, code: "LXCG-CHANGED" },
      UpdateSpotProcurementDraftDto
    );

    expect(projectResponse.errors).toContain("projectId 不是允许提交的字段");
    expect(codeResponse.errors).toContain("code 不是允许提交的字段");
  });

  it("rejects unknown top-level and nested fields", async () => {
    const topLevel = await getValidationResponse(
      {
        projectId: "project-1",
        code: "LXCG-2026-001",
        ...validDraft,
        internalSecret: "do-not-accept"
      },
      CreateSpotProcurementDto
    );
    const nested = await getValidationResponse(
      {
        projectId: "project-1",
        code: "LXCG-2026-001",
        ...validDraft,
        lines: [{ ...validDraft.lines[0], internalSecret: "do-not-accept" }]
      },
      CreateSpotProcurementDto
    );

    expect(topLevel.errors).toContain("internalSecret 不是允许提交的字段");
    expect(nested.errors).toContain("lines[0].internalSecret 不是允许提交的字段");
  });

  it("rejects a nested line that is not an object", async () => {
    const response = await getValidationResponse(
      {
        projectId: "project-1",
        code: "LXCG-2026-001",
        ...validDraft,
        lines: ["not-an-object"]
      },
      CreateSpotProcurementDto
    );

    expect(response.errors).toContain("lines[0] 填写不正确");
  });

  it("rejects supplier, price, amount, and invoice facts from an A4 application", async () => {
    const response = await getValidationResponse(
      {
        projectId: "project-1",
        code: "LXCG-2026-001",
        ...validDraft,
        lines: [
          {
            ...validDraft.lines[0],
            unitPrice: "3.28",
            invoiceType: "vat_general"
          }
        ],
        supplierName: "不应在采购申请填写的商户",
        totalAmountCents: "4100"
      },
      CreateSpotProcurementDto
    );

    expect(response.errors).toContain("supplierName 不是允许提交的字段");
    expect(response.errors).toContain("totalAmountCents 不是允许提交的字段");
    expect(response.errors).toContain("lines[0].unitPrice 不是允许提交的字段");
    expect(response.errors).toContain("lines[0].invoiceType 不是允许提交的字段");
  });
});
