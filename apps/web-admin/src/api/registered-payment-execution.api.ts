import { chinaDateOnly } from "@jiangkong/shared-domain";
import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";
export interface RegisteredPaymentWorkItem { paymentId: string; code: string; projectId: string; paidAmountCents: string; remainingAmountCents: string; expectedPaymentUpdatedAt: string }
export interface RegisteredOriginalPaymentResult { executionId: string; resultKey: string; amountCents: string; paidAt: string; source: {type:string;id:string;version:number;fingerprint:string} }
export interface RegisteredContractHistoryConfirmation { treatment:"not_included"|"included"|"uncertain"; expectedFingerprint:string; reason:string; evidence:string }
export interface RegisteredContractHistoryBasis { required:boolean;fingerprint:string;records:Array<{id:string;contractId:string;contractVersionId:string;paymentTermsVersionId:string;updatedAt:string;confirmedAt:string;activatedAt:string|null;historicalPaidCents:string;historicalProxyPaidCents:string;historicalAdvancePaidCents:string}> }
export interface RegisteredPaymentOptions extends RegisteredPaymentWorkItem { canRegisterPayment: boolean; contractHistoryBasis:RegisteredContractHistoryBasis; originalResults?: RegisteredOriginalPaymentResult[]; accounts: Array<{ scopeKey: string; name: string; eligible: boolean; reason: string | null; currentRegistrationId: string | null; projectAdvanceSourceBatchIds?: string[] }> }
export class RegisteredPaymentApiError extends Error { constructor(message: string, readonly status: number, readonly code?: string, readonly resultStatus?: string, readonly definitiveFailure = false, readonly differenceCents?: string) { super(message); } }
async function read<T>(response: Response, fallback = "付款登记办理失败，请保留填写后重试"): Promise<T> {
 if (response.ok) return response.json() as Promise<T>;
 let message = fallback;
 let code: string | undefined; let resultStatus: string | undefined; let definitiveFailure = false; let differenceCents: string | undefined;
 try {
  const body = await response.json() as { message?: unknown;code?:unknown;resultStatus?:unknown;differenceCents?:unknown } | null;
  if (body && typeof body.message === "string") {
   message = body.message;
   code = typeof body.code === "string" ? body.code : undefined;
   resultStatus = typeof body.resultStatus === "string" ? body.resultStatus : undefined;
   if (response.status === 409 && code === "REGISTERED_PROJECT_ADVANCE_CONFIRMATION_REQUIRED" &&
       typeof body.differenceCents === "string" && /^[1-9][0-9]*$/u.test(body.differenceCents)) differenceCents = body.differenceCents;
   definitiveFailure = differenceCents !== undefined || (code !== "PAYMENT_RESULT_UNCONFIRMED" && resultStatus !== "unconfirmed" && (response.status === 400 || (response.status === 409 && message === "付款申请已变化，请刷新后重试")));
  }
 } catch { /* An unreadable body cannot establish the original outcome. */ }
 throw new RegisteredPaymentApiError(formatApiErrorMessage(message,response.status,fallback),response.status,code,resultStatus,definitiveFailure,differenceCents);
}
export async function fetchRegisteredPaymentWorkItems() { return read<{items:RegisteredPaymentWorkItem[];total:number}>(await apiFetch("/payment-executions/work-items")); }
export async function fetchRegisteredPaymentOptions(paymentId: string) { return read<RegisteredPaymentOptions>(await apiFetch(`/payment-executions/${encodeURIComponent(paymentId)}/registration-options`, { headers: { "X-Registered-Project-Advance": "1" } }),"实付登记资料读取失败，请保留填写后重试"); }
export interface RecordedPaymentItem { executionId: string; paymentId: string; code: string; projectId: string; amountCents: string; paidAt: string; registeredByName: string; actualPayerName?: string; voucherPending: boolean; canSupplementVoucher: boolean; resultKey: string }
export interface RegisteredProjectAdvanceConfirmation {
 amountCents: string;
 reason: string;
 evidence: string;
 sourceAllocations: Array<{sourceBatchId:string;amountCents:string}>;
}
export interface RegisteredPaymentCommand { confirmedProjectAdvance?: RegisteredProjectAdvanceConfirmation; contractHistoryConfirmation?:RegisteredContractHistoryConfirmation; idempotencyKey: string; expectedPaymentUpdatedAt: string; amountCents: string; paidAt: string; scopeKey: string; expectedRegistrationId: string; openingTreatment: "included" | "not_included"; openingReason: string; openingEvidence: string; sourceAllocations: Array<{sourceBatchId:string;amountCents:string}>; confirmationPassword: string }
export interface RegisteredPaymentResult { canSupplementVoucher?: boolean; intercompany?: Array<{amountCents:string;voucherPending:boolean}>; status: "recorded" | "unconfirmed"; message?: string; execution?: { executionId: string; paymentId: string; amountCents: string; paidAt: string; voucherPending: boolean } }
export async function fetchRecordedPaymentItems() { return read<{items:RecordedPaymentItem[];total:number}>(await apiFetch("/payment-executions/recorded-items")); }
export async function recordRegisteredPayment(paymentId: string, input: RegisteredPaymentCommand) {
 const result = await read<unknown>(await apiFetch(`/payment-executions/${encodeURIComponent(paymentId)}/registrations`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(input)}));
 const body = result && typeof result === "object" ? result as Record<string,unknown> : null;
 let matchesDate = false;
 try { matchesDate = typeof body?.paidAt === "string" && chinaDateOnly(body.paidAt) === chinaDateOnly(input.paidAt); } catch { /* Preserve the original key when the response date is invalid. */ }
 if (!body || typeof body.id !== "string" || !body.id.trim() || body.idempotencyKey !== input.idempotencyKey || body.paymentRequestId !== paymentId || body.amountCents !== input.amountCents || !matchesDate) throw new Error("付款登记结果暂未确认，请查询本次结果。");
 return body as {id:string;idempotencyKey:string;paymentRequestId:string;amountCents:string;paidAt:string};
}
export async function fetchRegisteredPaymentResult(key: string) { return read<RegisteredPaymentResult>(await apiFetch(`/payment-executions/results/${encodeURIComponent(key)}`)); }
export async function verifyRegisteredPaymentRecovery(paymentId:string, input:Omit<RegisteredPaymentCommand,"confirmationPassword">) {
 return read<{status:"matched";executionId:string}|{status:"unconfirmed"}>(await apiFetch(`/payment-executions/${encodeURIComponent(paymentId)}/recovery-proof`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(input)}));
}
async function uploadRegisteredPaymentVoucher(executionId: string, file: File, idempotencyKey: string) {
 const form = new FormData(); form.append("file",file,file.name); form.append("idempotencyKey",idempotencyKey);
 return read<{id:string}>(await apiFetch(`/payment-executions/${encodeURIComponent(executionId)}/voucher-file-uploads`,{method:"POST",body:form}),"电子凭证上传结果暂未确认，请保留所选文件后重试");
}
async function attachRegisteredPaymentVoucher(executionId: string, fileId: string) { return read<{voucherPending:false}>(await apiFetch(`/payment-executions/${encodeURIComponent(executionId)}/voucher`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({fileId})}),"电子凭证关联结果暂未确认，请保留所选文件后重试"); }
// This coordinator keeps upload progress before attachment starts. Original
// API errors propagate unchanged so unknown outcomes retain their retry input.
export async function supplementRegisteredPaymentVoucher(executionId:string,file:File,uploadKey:string,uploadedFileId:string|null,onUploaded:(fileId:string)=>void) {
 const fileId = uploadedFileId || (await uploadRegisteredPaymentVoucher(executionId,file,uploadKey)).id;
 onUploaded(fileId);
 return attachRegisteredPaymentVoucher(executionId,fileId);
}
export async function downloadRegisteredPaymentVoucher(executionId: string) {
 const ticket = await read<{downloadUrl:string;expiresAt:string;fileName:string}>(await apiFetch(`/payment-executions/${encodeURIComponent(executionId)}/voucher-ticket`));
 if (!/^\/files\/[^/?#]+\/download\?/.test(ticket.downloadUrl) || ticket.downloadUrl.includes("\\") || !Number.isFinite(Date.parse(ticket.expiresAt)) || Date.parse(ticket.expiresAt) <= Date.now()) throw new Error("付款凭证下载授权已失效，请重新点击下载");
 const response = await apiFetch(ticket.downloadUrl);
 if (!response.ok) await read<never>(response);
 const url = URL.createObjectURL(await response.blob());
 const anchor = document.createElement("a"); anchor.href = url; anchor.download = ticket.fileName; document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
}
