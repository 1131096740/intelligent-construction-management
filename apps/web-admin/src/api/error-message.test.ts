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

  it("maps internal money units and coordination fields to a safe business fallback", () => {
    expect(formatApiErrorMessage("核销金额必须按分填写为正整数", 400, "保存失败")).toBe("保存失败：400");
    expect(formatApiErrorMessage("工资应付案件修订号无效", 409, "保存失败")).toBe("保存失败：409");
  });
});


describe("upload validation messages", () => {
  const message = "文件格式不支持，请上传 PDF、Word、Excel 或图片资料";
  it("keeps the fixed supported-format explanation", () => {
    expect(formatApiErrorMessage(message, 400, "上传失败")).toBe(message);
    expect(formatUnknownApiError(new Error(message), "上传失败")).toBe(message);
  });
  it("continues hiding unknown technical details appended to a format message", () => {
    expect(formatApiErrorMessage(`${message} internalObjectId=123`, 400, "上传失败")).toBe("上传失败：400");
  });
});


describe("multipart upload limits", () => {
  it("explains the actual multipart 413 response without raw framework English", () => {
    expect(formatApiErrorMessage("File too large", 413, "上传失败")).toBe("文件超过上传大小限制，请压缩或分拆后重新选择文件。");
  });
});
