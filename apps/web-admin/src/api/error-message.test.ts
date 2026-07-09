import { describe, expect, it } from "vitest";
import { formatApiErrorMessage, formatUnknownApiError } from "./error-message";

describe("API error messages", () => {
  it("maps backend permission errors to Chinese business messages", () => {
    expect(formatApiErrorMessage("Missing required project role", 403, "提交失败")).toBe(
      "当前账号暂无该项目或当前节点的处理权限。"
    );
    expect(formatApiErrorMessage("Requires global role: contract_director", 403, "保存失败")).toBe(
      "当前账号暂无该功能所需岗位权限。"
    );
  });

  it("maps browser fetch failures to Chinese network messages", () => {
    expect(formatUnknownApiError(new TypeError("failed for fetch"), "网络请求失败")).toBe(
      "网络连接失败，请检查网络后重试。"
    );
    expect(formatUnknownApiError(new TypeError("Failed to fetch"), "网络请求失败")).toBe(
      "网络连接失败，请检查网络后重试。"
    );
  });

  it("does not expose unknown English backend messages", () => {
    expect(formatApiErrorMessage("Only the contract draft owner may edit", 403, "保存失败")).toBe(
      "只有当前合同草稿负责人可以编辑。"
    );
    expect(formatApiErrorMessage("Unexpected backend detail", 400, "提交失败")).toBe("提交失败：400");
  });
});
