import { describe, expect, it } from "vitest";
import {
  isContractFieldDefinition,
  validateContractTemplateSchema
} from "./contract-workbench";

describe("contract workbench schema", () => {
  it("accepts supported fields and rejects scripts", () => {
    expect(
      isContractFieldDefinition({
        key: "deliveryDate",
        label: "交货日期",
        type: "date",
        required: true
      })
    ).toBe(true);

    expect(
      isContractFieldDefinition({
        key: "unsafe",
        label: "脚本",
        type: "script"
      })
    ).toBe(false);
  });

  it("rejects duplicate field and bill keys", () => {
    expect(() =>
      validateContractTemplateSchema({
        fields: [
          { key: "name", label: "名称", type: "text" },
          { key: "name", label: "重复", type: "text" }
        ],
        bills: [],
        clauses: [],
        attachments: [],
        validations: []
      })
    ).toThrow("Duplicate field key: name");
  });

  it("rejects unsupported field type", () => {
    expect(
      isContractFieldDefinition({ key: "x", label: "X", type: "formula" })
    ).toBe(false);
    expect(
      isContractFieldDefinition({ key: "x", label: "X", type: "script" })
    ).toBe(false);
    expect(
      isContractFieldDefinition({ key: "x", label: "X", type: "text" })
    ).toBe(true);
  });

  it("rejects input without required properties", () => {
    expect(isContractFieldDefinition(null)).toBe(false);
    expect(isContractFieldDefinition(undefined)).toBe(false);
    expect(isContractFieldDefinition({})).toBe(false);
    expect(isContractFieldDefinition({ key: "x", label: "X" })).toBe(false);
    expect(isContractFieldDefinition({ key: "x", type: "text" })).toBe(false);
    expect(isContractFieldDefinition({ label: "X", type: "text" })).toBe(false);
  });

  it("rejects duplicate bill keys", () => {
    expect(() =>
      validateContractTemplateSchema({
        fields: [],
        bills: [
          {
            key: "bill1",
            name: "清单1",
            amountRole: "included",
            pricingMode: "tax_inclusive",
            quantityScale: 2,
            unitPriceScale: 2,
            columns: []
          },
          {
            key: "bill1",
            name: "重复清单",
            amountRole: "reference",
            pricingMode: "tax_exclusive",
            quantityScale: 2,
            unitPriceScale: 2,
            columns: []
          }
        ],
        clauses: [],
        attachments: [],
        validations: []
      })
    ).toThrow("Duplicate bill key: bill1");
  });

  it("rejects duplicate clause keys", () => {
    expect(() =>
      validateContractTemplateSchema({
        fields: [],
        bills: [],
        clauses: [
          { key: "clause1", title: "条款1", numberingMode: "automatic", content: "" },
          { key: "clause1", title: "重复条款", numberingMode: "fixed", content: "" }
        ],
        attachments: [],
        validations: []
      })
    ).toThrow("Duplicate clause key: clause1");
  });

  it("rejects duplicate attachment keys", () => {
    expect(() =>
      validateContractTemplateSchema({
        fields: [],
        bills: [],
        clauses: [],
        attachments: [
          { key: "att1", name: "附件1", required: true },
          { key: "att1", name: "重复附件", required: false }
        ],
        validations: []
      })
    ).toThrow("Duplicate attachment key: att1");
  });

  it("rejects duplicate validation keys", () => {
    expect(() =>
      validateContractTemplateSchema({
        fields: [],
        bills: [],
        clauses: [],
        attachments: [],
        validations: [
          {
            key: "val1",
            level: "block",
            targetClauseKey: "clause1",
            requiredPhrases: [],
            message: "msg1"
          },
          {
            key: "val1",
            level: "warning",
            targetClauseKey: "clause2",
            requiredPhrases: [],
            message: "msg2"
          }
        ]
      })
    ).toThrow("Duplicate validation key: val1");
  });

  it("rejects quantity scale out of range 0-6", () => {
    const makeSchema = (quantityScale: number) => ({
      fields: [],
      bills: [
        {
          key: "bill1",
          name: "清单1",
          amountRole: "included" as const,
          pricingMode: "tax_inclusive" as const,
          quantityScale,
          unitPriceScale: 2,
          columns: []
        }
      ],
      clauses: [],
      attachments: [],
      validations: []
    });

    expect(() => validateContractTemplateSchema(makeSchema(-1))).toThrow(
      "quantityScale must be between 0 and 6"
    );
    expect(() => validateContractTemplateSchema(makeSchema(7))).toThrow(
      "quantityScale must be between 0 and 6"
    );
    // valid range boundaries
    expect(() => validateContractTemplateSchema(makeSchema(0))).not.toThrow();
    expect(() => validateContractTemplateSchema(makeSchema(6))).not.toThrow();
  });

  it("rejects unit price scale out of range 2-6", () => {
    const makeSchema = (unitPriceScale: number) => ({
      fields: [],
      bills: [
        {
          key: "bill1",
          name: "清单1",
          amountRole: "included" as const,
          pricingMode: "tax_inclusive" as const,
          quantityScale: 2,
          unitPriceScale,
          columns: []
        }
      ],
      clauses: [],
      attachments: [],
      validations: []
    });

    expect(() => validateContractTemplateSchema(makeSchema(1))).toThrow(
      "unitPriceScale must be between 2 and 6"
    );
    expect(() => validateContractTemplateSchema(makeSchema(7))).toThrow(
      "unitPriceScale must be between 2 and 6"
    );
    // valid range boundaries
    expect(() => validateContractTemplateSchema(makeSchema(2))).not.toThrow();
    expect(() => validateContractTemplateSchema(makeSchema(6))).not.toThrow();
  });

  it("accepts a valid complete schema", () => {
    expect(() =>
      validateContractTemplateSchema({
        fields: [
          { key: "contractName", label: "合同名称", type: "text", required: true },
          { key: "amount", label: "合同金额", type: "money" },
          { key: "signDate", label: "签订日期", type: "date" }
        ],
        bills: [
          {
            key: "mainBill",
            name: "主清单",
            amountRole: "included",
            pricingMode: "tax_inclusive",
            quantityScale: 3,
            unitPriceScale: 2,
            columns: [
              { key: "itemName", label: "项目名称", type: "text", required: true },
              { key: "unit", label: "单位", type: "text" }
            ]
          }
        ],
        clauses: [
          {
            key: "paymentTerms",
            title: "付款条款",
            numberingMode: "automatic",
            required: true,
            content: "付款条款内容"
          }
        ],
        attachments: [
          { key: "signedContract", name: "签署合同", required: true, mustBeValid: true }
        ],
        validations: [
          {
            key: "paymentCheck",
            level: "block",
            targetClauseKey: "paymentTerms",
            requiredPhrases: ["付款"],
            message: "付款条款缺少必要内容"
          }
        ]
      })
    ).not.toThrow();
  });
});
