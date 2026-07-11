import { BadRequestException } from "@nestjs/common";
import { createApiValidationPipe } from "../../validation/api-validation";
import { PrecheckContractTakeoverImportDto } from "./precheck-contract-takeover-import.dto";

const bodyMetadata = {
  type: "body" as const,
  metatype: PrecheckContractTakeoverImportDto,
  data: undefined
};

async function getImportRowsValidationResponse(value: unknown) {
  try {
    await createApiValidationPipe().transform(value, bodyMetadata);
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (error as BadRequestException).getResponse() as Record<string, unknown>;
  }
  throw new Error("Expected import rows validation to reject the request");
}

describe("PrecheckContractTakeoverImportDto open rows", () => {
  it("preserves dynamic Excel business columns without stripping or declaring them", async () => {
    const value = {
      rows: [
        {
          rowNo: 7,
          code: "HT-LS-007",
          excelDynamicBusinessColumn: "原始动态列",
          evidenceChecklist: ["合同扫描件", "付款凭证"]
        }
      ]
    };
    const result = await createApiValidationPipe().transform(value, bodyMetadata);

    expect(result).toBeInstanceOf(PrecheckContractTakeoverImportDto);
    expect(result).toEqual(value);
  });

  it.each([1, 200])("accepts %i plain-object import rows", async (count) => {
    const rows = Array.from({ length: count }, (_, index) => ({
      rowNo: index + 1,
      dynamicColumn: `value-${index + 1}`
    }));

    await expect(createApiValidationPipe().transform({ rows }, bodyMetadata)).resolves.toEqual({
      rows
    });
  });

  it("preserves a null-prototype row and its dynamic columns", async () => {
    const row = Object.assign(Object.create(null) as Record<string, unknown>, {
      rowNo: 1,
      dynamicExcelColumn: "原始值"
    });
    const result = (await createApiValidationPipe().transform(
      { rows: [row] },
      bodyMetadata
    )) as PrecheckContractTakeoverImportDto;

    expect(result.rows[0]).toBe(row);
    expect(result.rows[0]).toEqual(row);
  });

  it.each([
    [Object.assign(Object.create({ inherited: "unsafe" }) as object, { rowNo: 1 })],
    [new (class ImportRow { rowNo = 1; })()]
  ])("rejects a custom-prototype source row with one fixed error", async (row) => {
    const response = await getImportRowsValidationResponse({ rows: [row] });

    expect(response.errors).toEqual(["每行历史合同导入数据必须是对象"]);
  });

  it("rejects a throwing row Proxy without exposing its error", async () => {
    const row = new Proxy(
      { rowNo: 1 },
      {
        getPrototypeOf() {
          throw new Error("TOP-SECRET");
        }
      }
    );
    const response = await getImportRowsValidationResponse({ rows: [row] });

    expect(response.errors).toEqual(["每行历史合同导入数据必须是对象"]);
    expect(JSON.stringify(response)).not.toContain("TOP-SECRET");
  });

  it.each([
    [undefined, "历史合同导入行必须是数组"],
    [null, "历史合同导入行必须是数组"],
    [{}, "历史合同导入行必须是数组"],
    ["rows", "历史合同导入行必须是数组"],
    [[], "单次历史合同导入必须保留 1 到 200 行数据"],
    [Array.from({ length: 201 }, () => ({})), "单次历史合同导入必须保留 1 到 200 行数据"],
    [[123], "每行历史合同导入数据必须是对象"],
    [[["nested-array"]], "每行历史合同导入数据必须是对象"],
    [[null], "每行历史合同导入数据必须是对象"]
  ])("returns one precise open-row error for %p", async (rows, message) => {
    const response = await getImportRowsValidationResponse({ rows });

    expect(response.errors).toEqual([message]);
  });
});
