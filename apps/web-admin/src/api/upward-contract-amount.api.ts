import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";
export interface UpwardAmountData {canReview:boolean;canPrepare:boolean;contracts:Array<{id:string;label:string;amountNature:string;amountCents:string|null}>;revisions:Array<{id:string;contractId:string;amountNature:string;amountCents:string|null;effectiveAt:string;confirmedAt?:string|null;reason:string;status:string;canConfirm:boolean}>}
async function read<T>(path: string): Promise<T> {
  const response = await apiFetch(path);
  if (response.ok) return response.json() as Promise<T>;
  const value = await response.json().catch(() => null);
  throw new Error(formatApiErrorMessage(typeof value?.message === "string" ? value.message : "", response.status, "台账读取失败，请刷新后重试"));
}
async function request<T>(path:string,body?:unknown):Promise<T>{const response=await apiFetch(path,body?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}:{});const data=await response.json();if(!response.ok)throw new Error(formatApiErrorMessage(data?.message,response.status,"对上合同金额修订失败"));return data as T;}
export function fetchUpwardAmounts(projectId:string) { return read<UpwardAmountData>(`/upward-contract-amount-revisions?${new URLSearchParams({projectId})}`); }
export const prepareUpwardAmount=(body:{projectId:string;contractId:string;supersedesId?:string;amountNature:string;amountCents?:string;effectiveAt:string;reason:string;evidenceFileId:string;confirmationPassword:string;idempotencyKey:string})=>request("/upward-contract-amount-revisions",body);
export const decideUpwardAmount=(id:string,decision:string,confirmationPassword:string)=>request(`/upward-contract-amount-revisions/${encodeURIComponent(id)}/decision`,{decision,confirmationPassword});
