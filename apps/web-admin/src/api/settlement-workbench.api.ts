import type { SettlementSourceLinesReadModel } from "@jiangkong/shared-domain";
import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";

export async function fetchSettlementSourceLines(
  contractVersionId: string
): Promise<SettlementSourceLinesReadModel> {
  const response = await apiFetch(
    `/settlement-workbench/contract-versions/${encodeURIComponent(contractVersionId)}/source-lines`,
    { method: "GET" }
  );
  if (!response.ok) {
    let message = `加载合同清单失败：${response.status}`;
    try {
      const data = (await response.clone().json()) as { message?: unknown };
      if (typeof data.message === "string") {
        message = formatApiErrorMessage(data.message, response.status, "加载合同清单失败");
      }
    } catch {
      // 非 JSON 错误响应保留中文状态码兜底。
    }
    throw new Error(message);
  }
  return response.json() as Promise<SettlementSourceLinesReadModel>;
}
