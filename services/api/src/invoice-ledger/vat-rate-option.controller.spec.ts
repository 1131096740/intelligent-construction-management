import "reflect-metadata";
import { BadRequestException, RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REQUIRED_POSITIONS_KEY } from "../auth/decorators/require-positions.decorator";
import { createApiValidationPipe } from "../validation/api-validation";
import { VatRateOptionController } from "./vat-rate-option.controller";

type RuntimeDto = new () => object;

function bodyMetatype(method: "create" | "update", index: number) {
  const paramTypes = Reflect.getMetadata(
    "design:paramtypes",
    VatRateOptionController.prototype,
    method
  ) as RuntimeDto[] | undefined;
  const metatype = paramTypes?.[index];
  if (!metatype) {
    throw new Error(`Missing runtime DTO for ${method}`);
  }
  return metatype;
}

async function validateBody(
  method: "create" | "update",
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
  method: "create" | "update",
  index: number,
  value: unknown
): Promise<Record<string, unknown>> {
  try {
    await validateBody(method, index, value);
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (error as BadRequestException).getResponse() as Record<string, unknown>;
  }
  throw new Error("Expected VAT rate option validation to reject the request");
}

describe("VatRateOptionController", () => {
  it("uses the exact GET/POST/PATCH route surface without DELETE", () => {
    expect(Reflect.getMetadata(PATH_METADATA, VatRateOptionController)).toBe(
      "vat-rate-options"
    );
    expect(
      Reflect.getMetadata(
        METHOD_METADATA,
        VatRateOptionController.prototype.listEnabled
      )
    ).toBe(RequestMethod.GET);
    expect(
      Reflect.getMetadata(METHOD_METADATA, VatRateOptionController.prototype.create)
    ).toBe(RequestMethod.POST);
    expect(
      Reflect.getMetadata(METHOD_METADATA, VatRateOptionController.prototype.update)
    ).toBe(RequestMethod.PATCH);
    expect(
      Reflect.getMetadata(PATH_METADATA, VatRateOptionController.prototype.update)
    ).toBe(":optionId");

    const controllerSource = readFileSync(
      join(__dirname, "vat-rate-option.controller.ts"),
      "utf8"
    );
    expect(controllerSource).not.toMatch(/\bDelete\b/u);
    expect("remove" in VatRateOptionController.prototype).toBe(false);
    expect("delete" in VatRateOptionController.prototype).toBe(false);
  });

  it("guards only POST and PATCH with the global finance director position", () => {
    expect(
      Reflect.getMetadata(
        REQUIRED_POSITIONS_KEY,
        VatRateOptionController.prototype.listEnabled
      )
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(
        REQUIRED_POSITIONS_KEY,
        VatRateOptionController.prototype.create
      )
    ).toEqual(["finance_director"]);
    expect(
      Reflect.getMetadata(
        REQUIRED_POSITIONS_KEY,
        VatRateOptionController.prototype.update
      )
    ).toEqual(["finance_director"]);
  });

  it("delegates authenticated write actors to the service", async () => {
    const service = {
      listEnabled: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: "vat-rate-13" }),
      update: jest.fn().mockResolvedValue({ id: "vat-rate-13" })
    };
    const controller = new VatRateOptionController(service as never);

    await controller.listEnabled();
    await controller.create(
      { rateValue: "13", label: "13% 增值税", sortOrder: 10 },
      { id: "finance-director-1" } as never
    );
    await controller.update(
      "vat-rate-13",
      { enabled: false },
      { id: "finance-director-1" } as never
    );

    expect(service.listEnabled).toHaveBeenCalledWith();
    expect(service.create).toHaveBeenCalledWith("finance-director-1", {
      rateValue: "13",
      label: "13% 增值税",
      sortOrder: 10
    });
    expect(service.update).toHaveBeenCalledWith(
      "vat-rate-13",
      "finance-director-1",
      { enabled: false }
    );
  });

  it("exposes runtime DTOs and accepts canonical percentage strings", async () => {
    expect(bodyMetatype("create", 0)).not.toBe(Object);
    expect(bodyMetatype("update", 1)).not.toBe(Object);

    await expect(
      validateBody("create", 0, {
        rateValue: "13.000000",
        label: "13% 增值税",
        sortOrder: 10
      })
    ).resolves.toEqual({
      rateValue: "13.000000",
      label: "13% 增值税",
      sortOrder: 10
    });
    await expect(
      validateBody("update", 1, {
        rateValue: "0",
        label: "免税",
        enabled: false,
        sortOrder: 20
      })
    ).resolves.toEqual({
      rateValue: "0",
      label: "免税",
      enabled: false,
      sortOrder: 20
    });
  });

  it.each([
    [{ rateValue: 13, label: "13%", sortOrder: 1 }, "税率必须是普通十进制字符串"],
    [{ rateValue: "1e1", label: "13%", sortOrder: 1 }, "税率必须是普通十进制字符串"],
    [{ rateValue: "13 percent", label: "13%", sortOrder: 1 }, "税率必须是普通十进制字符串"],
    [{ rateValue: "13.0000001", label: "13%", sortOrder: 1 }, "税率最多保留 6 位小数"],
    [{ rateValue: "101", label: "超范围", sortOrder: 1 }, "税率必须在 0 到 100 之间"],
    [{ rateValue: "100.000001", label: "超范围", sortOrder: 1 }, "税率必须在 0 到 100 之间"],
    [{ rateValue: "13", label: "  ", sortOrder: 1 }, "税率标签不能为空白"],
    [{ rateValue: "13", label: "\u0085\uFEFF", sortOrder: 1 }, "税率标签不能为空白"],
    [{ rateValue: "13", label: "13%", sortOrder: 0 }, "税率排序必须是正整数"]
  ])("rejects invalid create DTO input %j", async (input, message) => {
    const response = await getValidationResponse("create", 0, input);

    expect(response.errors).toContain(message);
  });

  it("rejects unknown fields but leaves empty-update rejection to the service boundary", async () => {
    const response = await getValidationResponse("update", 1, {
      enabled: false,
      internalSecret: "do-not-accept"
    });

    expect(response.errors).toContain("internalSecret 不是允许提交的字段");
    await expect(validateBody("update", 1, {})).resolves.toEqual({});
  });
});
