import { BadRequestException } from "@nestjs/common";
import { validate } from "class-validator";
import { createApiValidationPipe } from "./api-validation";
import {
  IsCanonicalMoneyText,
  IsMaxUnicodeTextLength,
  IsOptionalNonBlankText,
  IsRequiredText
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

  @IsMaxUnicodeTextLength({ max: 3, message: "文字不能超过 3 个字" })
  limitedText!: string;
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
    limitedText: "三字内",
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

  it("accepts valid text and canonical money without changing their values", async () => {
    const value = {
      requiredText: "内 部空格",
      optionalText: "可 选文字",
      amount: "2100000000",
      limitedText: "😀😀😀"
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
          limitedText: "😀😀😀😀"
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
});
