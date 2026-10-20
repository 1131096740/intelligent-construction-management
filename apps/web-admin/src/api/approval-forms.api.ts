import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";

export interface ApprovalDocumentItem {
  id: string;
  businessType: string;
  businessId: string;
  title: string;
  code: string;
  approvedAt: string;
  available: boolean;
  unavailableReason: string | null;
}

export async function listApprovalDocuments(cursor?: string): Promise<{ items: ApprovalDocumentItem[]; nextCursor: string | null }> {
  const response = await apiFetch(`/approval-forms${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
  if (!response.ok) throw new Error(formatApiErrorMessage("审批单清单读取失败，请重试", response.status, "审批单清单读取失败"));
  return response.json();
}

export async function approvalDocumentCapability(businessType: string, businessId: string): Promise<{ available: boolean }> {
  const response = await apiFetch(`/approval-forms/${encodeURIComponent(businessType)}/${encodeURIComponent(businessId)}/capability`);
  if (!response.ok) throw new Error("审批单下载权限读取失败，请刷新后重试");
  return response.json();
}
