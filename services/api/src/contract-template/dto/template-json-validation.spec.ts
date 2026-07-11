import { BadRequestException } from "@nestjs/common";
import { createApiValidationPipe } from "../../validation/api-validation";
import { CreateStandardClauseDto } from "./contract-template.dto";
import { isJsonSafeValue } from "./template-json-validation";

const bodyMetadata = {
  type: "body" as const,
  metatype: CreateStandardClauseDto,
  data: undefined
};

function clauseBody(content: unknown) {
  return {
    code: "CLAUSE-JSON",
    category: "payment",
    name: "JSON 安全条款",
    title: "付款条款",
    content
  };
}

async function getBadRequest(content: unknown) {
  try {
    await createApiValidationPipe().transform(clauseBody(content), bodyMetadata);
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (error as BadRequestException).getResponse() as Record<string, unknown>;
  }
  throw new Error("Expected unsafe template JSON to be rejected");
}

describe("template JSON-safe arrays", () => {
  it("keeps ordinary nested JSON arrays, null and dynamic keys", async () => {
    const content = {
      dynamicKey: [null, "text", 1, true, { nestedDynamicKey: ["A", "B"] }]
    };

    expect(isJsonSafeValue(content)).toBe(true);
    await expect(createApiValidationPipe().transform(clauseBody(content), bodyMetadata)).resolves.toMatchObject({
      content
    });
  });

  it("rejects symbol, custom prototype, non-enumerable, sparse and extra-key arrays", async () => {
    const symbolArray = [] as unknown as unknown[] & { [key: symbol]: unknown };
    symbolArray[Symbol("secret")] = "TOP-SECRET";

    const customPrototype = Object.create(Array.prototype) as object;
    const customPrototypeArray: unknown[] = ["safe"];
    Object.setPrototypeOf(customPrototypeArray, customPrototype);

    const nonEnumerableArray: unknown[] = ["safe"];
    Object.defineProperty(nonEnumerableArray, "hidden", {
      value: () => "TOP-SECRET",
      enumerable: false
    });

    const sparseArray = new Array(2) as unknown[];
    sparseArray[1] = "safe";

    const extraKeyArray = ["safe"] as unknown[] & { extra?: unknown };
    extraKeyArray.extra = "TOP-SECRET";

    for (const value of [
      symbolArray,
      customPrototypeArray,
      nonEnumerableArray,
      sparseArray,
      extraKeyArray
    ]) {
      expect(isJsonSafeValue(value)).toBe(false);
      const response = await getBadRequest(value);
      expect(response.errors).toEqual(["提交内容包含不可保存的 JSON 数据"]);
      expect(JSON.stringify(response)).not.toContain("TOP-SECRET");
    }
  });

  it("rejects array accessors without invoking their getter", async () => {
    let getterCalls = 0;
    const accessorArray: unknown[] = [];
    Object.defineProperty(accessorArray, "0", {
      get() {
        getterCalls += 1;
        return "TOP-SECRET";
      },
      enumerable: true,
      configurable: true
    });
    accessorArray.length = 1;

    expect(isJsonSafeValue(accessorArray)).toBe(false);
    const response = await getBadRequest(accessorArray);

    expect(getterCalls).toBe(0);
    expect(response.errors).toEqual(["提交内容包含不可保存的 JSON 数据"]);
    expect(JSON.stringify(response)).not.toContain("TOP-SECRET");
  });

  it("catches throwing array descriptor proxies without leaking their error", async () => {
    const proxy = new Proxy(["safe"], {
      ownKeys() {
        throw new Error("TOP-SECRET");
      }
    });

    expect(isJsonSafeValue(proxy)).toBe(false);
    const response = await getBadRequest(proxy);

    expect(response.errors).toEqual(["提交内容包含不可保存的 JSON 数据"]);
    expect(JSON.stringify(response)).not.toContain("TOP-SECRET");
  });

  it("keeps concurrent validations isolated", async () => {
    const valid = { rows: [[null, { dynamic: true }]] };
    const invalid = new Array(2) as unknown[];
    invalid[1] = "safe";

    const results = await Promise.all(
      Array.from({ length: 40 }, async (_, index) =>
        index % 2 === 0 ? isJsonSafeValue(valid) : isJsonSafeValue(invalid)
      )
    );

    expect(results).toEqual(Array.from({ length: 40 }, (_, index) => index % 2 === 0));
  });
});
