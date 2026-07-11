import { BadRequestException } from "@nestjs/common";
import { validate } from "class-validator";
import { createApiValidationPipe } from "./api-validation";
import {
  IsCanonicalMoneyText,
  IsCanonicalSignedMoneyText,
  IsIntegerInRange,
  IsMaxUnicodeTextLength,
  IsOptionalNonEmptyArray,
  IsOptionalNonBlankText,
  IsOptionalArray,
  IsRequiredText,
  IsStrictDateOnly
} from "./static-field-validation";

class StaticFieldValidationDto {
  @IsRequiredText({
    requiredMessage: "请填写必填文字",
    typeMessage: "必填文字必须是文字",
    blankMessage: "必填文字不能为空白"
  })
  requiredText!: string;

  @IsOptionalNonBlankText({
    typeMessage: "可选文字必须是文字",
    blankMessage: "可选文字不能为空白"
  })
  optionalText?: string;

  @IsCanonicalMoneyText({
    typeMessage: "金额格式不正确",
    formatMessage: "金额必须按分填写为 0 或更大的整数"
  })
  amount!: string;

  @IsCanonicalSignedMoneyText({
    typeMessage: "有符号金额格式不正确",
    formatMessage: "有符号金额必须按分填写为整数",
    rangeMessage: "有符号金额超出系统可保存范围"
  })
  signedAmount!: string;

  @IsMaxUnicodeTextLength({ max: 3, message: "文字不能超过 3 个字" })
  limitedText!: string;

  @IsStrictDateOnly({ message: "日期必须按 YYYY-MM-DD 填写" })
  dateOnly!: string;

  @IsIntegerInRange({
    min: 0,
    max: 10_000,
    typeMessage: "比例必须是安全整数",
    rangeMessage: "比例必须在 0 到 10000 之间"
  })
  ratioBps!: number;

  @IsOptionalNonEmptyArray({
    typeMessage: "列表必须是数组",
    emptyMessage: "列表至少填写一条"
  })
  items?: unknown[];

  @IsOptionalArray({ typeMessage: "可选列表必须是数组" })
  optionalItems?: unknown[];
}

const bodyMetadata = {
  type: "body" as const,
  metatype: StaticFieldValidationDto,
  data: undefined
};

async function fieldMessages(property: keyof StaticFieldValidationDto, value: unknown) {
  const dto = new StaticFieldValidationDto();
  Object.assign(dto, {
    requiredText: "必填",
    amount: "0",
    signedAmount: "0",
    limitedText: "三字内",
    dateOnly: "2026-07-11",
    ratioBps: 0,
    [property]: value
  });
  const errors = await validate(dto);
  return Object.values(errors.find((error) => error.property === property)?.constraints ?? {});
}

describe("static field validation decorators", () => {
  it.each([
    [undefined, "请填写必填文字"],
    [null, "请填写必填文字"],
    ["", "请填写必填文字"],
    ["   ", "必填文字不能为空白"],
    [123, "必填文字必须是文字"],
    [{ secret: "TOP-SECRET" }, "必填文字必须是文字"]
  ])("returns exactly one required-text error for %p", async (value, message) => {
    await expect(fieldMessages("requiredText", value)).resolves.toEqual([message]);
  });

  it.each([
    [undefined, []],
    [null, ["可选文字必须是文字"]],
    [123, ["可选文字必须是文字"]],
    [{ secret: "TOP-SECRET" }, ["可选文字必须是文字"]],
    ["", ["可选文字不能为空白"]],
    ["   ", ["可选文字不能为空白"]]
  ])("returns at most one optional-text error for %p", async (value, messages) => {
    await expect(fieldMessages("optionalText", value)).resolves.toEqual(messages);
  });

  it.each([
    [undefined, "金额格式不正确"],
    [null, "金额格式不正确"],
    [123, "金额格式不正确"],
    [{ secret: "TOP-SECRET" }, "金额格式不正确"],
    ["", "金额必须按分填写为 0 或更大的整数"],
    ["01", "金额必须按分填写为 0 或更大的整数"],
    ["1.0", "金额必须按分填写为 0 或更大的整数"]
  ])("returns exactly one canonical-money error for %p", async (value, message) => {
    await expect(fieldMessages("amount", value)).resolves.toEqual([message]);
  });

  it.each([
    ["9223372036854775807", []],
    ["9223372036854775808", ["金额超出系统可保存范围"]]
  ])("enforces the PostgreSQL BIGINT money range for %s", async (value, messages) => {
    await expect(fieldMessages("amount", value)).resolves.toEqual(messages);
  });

  it.each([
    ["-9223372036854775808", []],
    ["9223372036854775807", []],
    ["-9223372036854775809", ["有符号金额超出系统可保存范围"]],
    ["9223372036854775808", ["有符号金额超出系统可保存范围"]],
    ["-0", ["有符号金额必须按分填写为整数"]],
    [1, ["有符号金额格式不正确"]]
  ])("validates one canonical signed-money boundary for %p", async (value, messages) => {
    await expect(fieldMessages("signedAmount", value)).resolves.toEqual(messages);
  });

  it.each([
    [undefined, ["比例必须是安全整数"]],
    [null, ["比例必须是安全整数"]],
    ["1", ["比例必须是安全整数"]],
    [1.5, ["比例必须是安全整数"]],
    [Number.MAX_SAFE_INTEGER + 1, ["比例必须是安全整数"]],
    [1e100, ["比例必须是安全整数"]],
    [-1, ["比例必须在 0 到 10000 之间"]],
    [10_001, ["比例必须在 0 到 10000 之间"]],
    [10_000, []]
  ])("returns one precise integer-range error for %p", async (value, messages) => {
    await expect(fieldMessages("ratioBps", value)).resolves.toEqual(messages);
  });

  it.each([
    [undefined, []],
    [null, ["列表必须是数组"]],
    [{}, ["列表必须是数组"]],
    [[], ["列表至少填写一条"]],
    [[{}], []]
  ])("returns one precise optional-array error for %p", async (value, messages) => {
    await expect(fieldMessages("items", value)).resolves.toEqual(messages);
  });

  it.each([
    [undefined, []],
    [[], []],
    [[{}], []],
    [null, ["可选列表必须是数组"]],
    [{}, ["可选列表必须是数组"]]
  ])("keeps an optional array empty-compatible for %p", async (value, messages) => {
    await expect(fieldMessages("optionalItems", value)).resolves.toEqual(messages);
  });

  it("accepts valid text and canonical money without changing their values", async () => {
    const value = {
      requiredText: "内 部空格",
      optionalText: "可 选文字",
      amount: "2100000000",
      signedAmount: "-2100000000",
      limitedText: "😀😀😀",
      ratioBps: 0
    };
    const result = await createApiValidationPipe().transform(value, bodyMetadata);

    expect(result).toEqual(value);
    expect((result as StaticFieldValidationDto).amount).toBe("2100000000");
    expect(typeof (result as StaticFieldValidationDto).amount).toBe("string");
  });

  it("counts Unicode code points and never exposes submitted content", async () => {
    try {
      await createApiValidationPipe().transform(
        {
          requiredText: { secret: "TOP-SECRET" },
          amount: "0",
          signedAmount: "0",
          limitedText: "😀😀😀😀",
          ratioBps: 0
        },
        bodyMetadata
      );
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const response = (error as BadRequestException).getResponse();
      expect(response).toEqual({
        message: "提交内容格式不正确，请检查后重试",
        errors: ["必填文字必须是文字", "文字不能超过 3 个字"]
      });
      expect(JSON.stringify(response)).not.toContain("TOP-SECRET");
      return;
    }
    throw new Error("Expected static validation to reject the request");
  });

  it.each(["2026-02-30", "2026-07-11T00:00:00.000Z", " 2026-07-11"])(
    "rejects a non-date-only value: %s",
    async (value) => {
      await expect(fieldMessages("dateOnly", value)).resolves.toEqual([
        "日期必须按 YYYY-MM-DD 填写"
      ]);
    }
  );

  it.each(["2024-02-29", "2026-07-11"])("accepts a valid date-only value: %s", async (value) => {
    await expect(fieldMessages("dateOnly", value)).resolves.toEqual([]);
  });
});
