import {apiFetch} from "./api-fetch";
import {formatApiErrorMessage} from "./error-message";
export interface BankVerificationData{canPrepare:boolean;canReview:boolean;canReadEvidence:boolean;page:number;pageSize:number;total:number;companies:Array<{value:string;label:string}>;rows:Array<{id:string;companyName:string;accountLast4:string;bankReference:string;direction:string;amountCents:string;occurredAt:string;status:string;reason:string;evidenceFileId:string;canConfirm:boolean}>}
async function read<T>(path: string): Promise<T> {
  const response = await apiFetch(path);
  if (response.ok) return response.json() as Promise<T>;
  const value = await response.json().catch(() => null);
  throw new Error(formatApiErrorMessage(typeof value?.message === "string" ? value.message : "", response.status, "台账读取失败，请刷新后重试"));
}
async function request<T>(path:string,body?:unknown):Promise<T>{const response=await apiFetch(path,body?{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}:{});const value=await response.json();if(!response.ok)throw new Error(formatApiErrorMessage(value?.message,response.status,"银行核验失败"));return value as T;}
export function fetchBankVerifications(projectId:string,page=1,status="pending_confirm") { return read<BankVerificationData>(`/contract-bank-verifications?${new URLSearchParams({projectId,page:String(page),status})}`); }
export const prepareBankVerification=(body:{projectId:string;companyEntityId:string;accountNumber:string;bankReference:string;direction:string;amountCents:string;occurredAt:string;evidenceFileId:string;reason:string;idempotencyKey:string;confirmationPassword:string})=>request("/contract-bank-verifications",body);
export const decideBankVerification=(id:string,body:{decision:"confirm"|"return";holderEvidenceFileId?:string;accountNumber?:string;confirmationPassword:string})=>request(`/contract-bank-verifications/${encodeURIComponent(id)}/decision`,body);
