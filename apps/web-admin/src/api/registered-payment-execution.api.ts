import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";
export interface RegisteredPaymentWorkItem { paymentId: string; code: string; projectId: string; paidAmountCents: string; remainingAmountCents: string; expectedPaymentUpdatedAt: string }
export interface RegisteredOriginalPaymentResult { executionId: string; resultKey: string; amountCents: string; paidAt: string; source: {type:string;id:string;version:number;fingerprint:string} }
export interface RegisteredContractHistoryConfirmation { treatment:"not_included"|"included"|"uncertain"; expectedFingerprint:string; reason:string; evidence:string }
export interface RegisteredContractHistoryBasis { required:boolean;fingerprint:string;records:Array<{id:string;contractId:string;contractVersionId:string;paymentTermsVersionId:string;updatedAt:string;confirmedAt:string;activatedAt:string|null;historicalPaidCents:string;historicalProxyPaidCents:string;historicalAdvancePaidCents:string}> }
export interface RegisteredPaymentOptions extends RegisteredPaymentWorkItem { contractHistoryBasis:RegisteredContractHistoryBasis; originalResults?: RegisteredOriginalPaymentResult[]; accounts: Array<{ scopeKey: string; name: string; eligible: boolean; reason: string | null; currentRegistrationId: string | null }> }
export class RegisteredPaymentApiError extends Error { constructor(message: string, readonly status: number, readonly code?: string, readonly resultStatus?: string) { super(message); } }
async function read<T>(response: Response, fallback = "付款登记办理失败，请保留填写后重试"): Promise<T> {
 if (response.ok) return response.json() as Promise<T>;
 let message = fallback;
 let code: string | undefined; let resultStatus: string | undefined;
 try { const body = await response.json() as { message?: unknown;code?:unknown;resultStatus?:unknown }; if (typeof body.message === "string") message = body.message; code = typeof body.code === "string" ? body.code : undefined; resultStatus = typeof body.resultStatus === "string" ? body.resultStatus : undefined; } catch { /* Retain business fallback. */ }
 throw new RegisteredPaymentApiError(formatApiErrorMessage(message,response.status,fallback),response.status,code,resultStatus);
}
export async function fetchRegisteredPaymentWorkItems() { return read<{items:RegisteredPaymentWorkItem[];total:number}>(await apiFetch("/payment-executions/work-items")); }
export async function fetchRegisteredPaymentOptions(paymentId: string) { return read<RegisteredPaymentOptions>(await apiFetch(`/payment-executions/${encodeURIComponent(paymentId)}/registration-options`),"实付登记资料读取失败，请保留填写后重试"); }
export interface RecordedPaymentItem { executionId: string; paymentId: string; code: string; projectId: string; amountCents: string; paidAt: string; registeredByName: string; actualPayerName?: string; voucherPending: boolean; resultKey: string }
export interface RegisteredPaymentCommand { contractHistoryConfirmation?:RegisteredContractHistoryConfirmation; idempotencyKey: string; expectedPaymentUpdatedAt: string; amountCents: string; paidAt: string; scopeKey: string; expectedRegistrationId: string; openingTreatment: "included" | "not_included"; openingReason: string; openingEvidence: string; sourceAllocations: Array<{sourceBatchId:string;amountCents:string}>; confirmationPassword: string }
export interface RegisteredPaymentResult { intercompany?: Array<{amountCents:string;voucherPending:boolean}>; status: "recorded" | "unconfirmed"; message?: string; execution?: { executionId: string; paymentId: string; amountCents: string; paidAt: string; voucherPending: boolean } }
export async function fetchRecordedPaymentItems() { return read<{items:RecordedPaymentItem[];total:number}>(await apiFetch("/payment-executions/recorded-items")); }
export async function recordRegisteredPayment(paymentId: string, input: RegisteredPaymentCommand) { return read<{id:string;amountCents:string}>(await apiFetch(`/payment-executions/${encodeURIComponent(paymentId)}/registrations`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(input)})); }
export async function fetchRegisteredPaymentResult(key: string) { return read<RegisteredPaymentResult>(await apiFetch(`/payment-executions/results/${encodeURIComponent(key)}`)); }
export async function uploadRegisteredPaymentVoucher(executionId: string, file: File, idempotencyKey: string) {
 const form = new FormData(); form.append("file",file,file.name); form.append("idempotencyKey",idempotencyKey);
 return read<{id:string}>(await apiFetch(`/payment-executions/${encodeURIComponent(executionId)}/voucher-file-uploads`,{method:"POST",body:form}),"电子凭证上传结果暂未确认，请保留所选文件后重试");
}
export async function attachRegisteredPaymentVoucher(executionId: string, fileId: string) { return read<{voucherPending:false}>(await apiFetch(`/payment-executions/${encodeURIComponent(executionId)}/voucher`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({fileId})}),"电子凭证关联结果暂未确认，请保留所选文件后重试"); }
export async function downloadRegisteredPaymentVoucher(executionId: string) {
 const ticket = await read<{downloadUrl:string;expiresAt:string;fileName:string}>(await apiFetch(`/payment-executions/${encodeURIComponent(executionId)}/voucher-ticket`));
 if (!/^\/files\/[^/?#]+\/download\?/.test(ticket.downloadUrl) || ticket.downloadUrl.includes("\\") || !Number.isFinite(Date.parse(ticket.expiresAt)) || Date.parse(ticket.expiresAt) <= Date.now()) throw new Error("付款凭证下载授权已失效，请重新点击下载");
 const response = await apiFetch(ticket.downloadUrl);
 if (!response.ok) await read<never>(response);
 const url = URL.createObjectURL(await response.blob());
 const anchor = document.createElement("a"); anchor.href = url; anchor.download = ticket.fileName; document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
}
