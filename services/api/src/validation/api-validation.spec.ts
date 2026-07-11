import { BadRequestException } from "@nestjs/common";
import { Type } from "class-transformer";
import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsString,
  ValidateNested
} from "class-validator";
import { createApiValidationPipe } from "./api-validation";

class ValidRequestDto {
  @IsString({ message: "名称必须是文字" })
  name!: string;

  @IsString({ message: "金额必须是字符串" })
  amount!: string;
}

class NumericRequestDto {
  @IsNumber({}, { message: "数量必须是数字" })
  quantity!: number;
}

class CompleteRequestDto {
  @IsString({ message: "名称不能为空" })
  name!: string;

  @IsInt({ message: "数量必须是整数" })
  quantity!: number;
}

class NestedItemDto {
  @IsString({ message: "明细名称必须是文字" })
  name!: string;
}

class NestedRequestDto {
  @IsArray({ message: "明细必须是数组" })
  @ValidateNested({ each: true })
  @Type(() => NestedItemDto)
  items!: NestedItemDto[];
}

class UnknownRequestDto {}

class DuplicateMessageDto {
  @IsString({ message: "名称不能为空" })
  @IsNotEmpty({ message: "名称不能为空" })
  name!: string;
}

class ExpandedPlaceholderDto {
  @IsNumber({}, { message: "字段不正确，提交值为 $value" })
  secretField!: number;

  @IsNumber({}, { message: "字段不正确，目标类型为 $target" })
  classNameField!: number;
}

class FunctionMessageDto {
  @IsNumber({}, { message: () => "动态字段不正确" })
  dynamicField!: number;
}

const bodyMetadata = (metatype: new () => object) => ({
  type: "body" as const,
  metatype,
  data: undefined
});

async function getBadRequest(
  value: unknown,
  metatype: new () => object
): Promise<Record<string, unknown>> {
  try {
    await createApiValidationPipe().transform(value, bodyMetadata(metatype));
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (error as BadRequestException).getResponse() as Record<string, unknown>;
  }
  throw new Error("Expected validation to reject the request");
}

describe("createApiValidationPipe", () => {
  it("transforms a valid class DTO without changing a money string", async () => {
    const result = await createApiValidationPipe().transform(
      { name: "钢材", amount: "2100000000" },
      bodyMetadata(ValidRequestDto)
    );

    expect(result).toBeInstanceOf(ValidRequestDto);
    expect(result).toEqual({ name: "钢材", amount: "2100000000" });
    expect(typeof (result as ValidRequestDto).amount).toBe("string");
  });

  it("does not implicitly convert numbers and numeric strings", async () => {
    const stringFieldError = await getBadRequest(
      { name: "钢材", amount: 2100 },
      ValidRequestDto
    );
    const numberFieldError = await getBadRequest(
      { quantity: "2100" },
      NumericRequestDto
    );

    expect(stringFieldError.errors).toContain("金额必须是字符串");
    expect(numberFieldError.errors).toContain("数量必须是数字");
  });

  it("returns every custom Chinese message for missing or invalid fields", async () => {
    const response = await getBadRequest({}, CompleteRequestDto);

    expect(response).toEqual({
      message: "提交内容格式不正确，请检查后重试",
      errors: expect.arrayContaining(["名称不能为空", "数量必须是整数"])
    });
    expect(response.errors).toHaveLength(2);
  });

  it("rejects unknown fields without exposing validator keys or submitted values", async () => {
    const response = await getBadRequest(
      { name: "钢材", amount: "100", internalSecret: "do-not-leak" },
      ValidRequestDto
    );
    const serialized = JSON.stringify(response);

    expect(response.errors).toEqual(["internalSecret 不是允许提交的字段"]);
    expect(serialized).not.toContain("whitelistValidation");
    expect(serialized).not.toContain("do-not-leak");
  });

  it.each([
    { value: [] as unknown, label: "array" },
    { value: "text" as unknown, label: "string" },
    { value: 42 as unknown, label: "number" },
    { value: null as unknown, label: "null" }
  ])("rejects a non-object body: $value ($label)", async ({ value }) => {
    const response = await getBadRequest(value, ValidRequestDto);

    expect(response.errors).toEqual(["提交内容必须是对象"]);
  });

  it("maps an unknown DTO body to a fixed Chinese error", async () => {
    const response = await getBadRequest({}, UnknownRequestDto);

    expect(response.errors).toEqual(["提交内容必须是对象"]);
  });

  it("recursively flattens nested DTO errors and keeps Chinese messages", async () => {
    const response = await getBadRequest(
      { items: [{ name: 123 }] },
      NestedRequestDto
    );

    expect(response.errors).toEqual(["明细名称必须是文字"]);
  });

  it("preserves and deduplicates custom Chinese messages", async () => {
    const response = await getBadRequest({ name: null }, DuplicateMessageDto);

    expect(response.errors).toEqual(["名称不能为空"]);
  });

  it("removes class-validator expanded values and target class names", async () => {
    const response = await getBadRequest(
      { secretField: "TOP-SECRET", classNameField: "invalid" },
      ExpandedPlaceholderDto
    );
    const serialized = JSON.stringify(response);

    expect(response.errors).toEqual([
      "secretField 填写不正确",
      "classNameField 填写不正确"
    ]);
    for (const forbidden of [
      "TOP-SECRET",
      "ExpandedPlaceholderDto",
      "value",
      "target",
      "isNumber",
      "constraint",
      "stack"
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("does not trust validation message functions", async () => {
    const response = await getBadRequest({ dynamicField: "invalid" }, FunctionMessageDto);

    expect(response.errors).toEqual(["dynamicField 填写不正确"]);
  });

  it("does not expose validation internals in the response", async () => {
    const response = await getBadRequest(
      { name: 123, amount: null },
      ValidRequestDto
    );
    const serialized = JSON.stringify(response);

    expect((response.errors as string[]).every((message) => /[\u4e00-\u9fff]/u.test(message))).toBe(
      true
    );
    for (const forbidden of [
      "target",
      "value",
      "constructor",
      "ValidRequestDto",
      "isString",
      "stack"
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
