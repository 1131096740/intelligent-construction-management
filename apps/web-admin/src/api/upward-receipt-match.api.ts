import {apiFetch} from "./api-fetch";
import {formatApiErrorMessage} from "./error-message";
export interface ReceiptMatchData {canPrepare:boolean;canReview:boolean;receipts:Array<{id:string;label:string;amountCents:string;matchedCents:string;occurredAt:string}>;settlements:Array<{id:string;label:string}>;matches:Array<{id:string;receiptFactId:string;settlementLedgerId:string;originalId:string|null;amountCents:string;occurredAt:string;reason:string;status:string;canConfirm:boolean}>}
async function read<T>(path: string): Promise<T> {
  const response = await apiFetch(path);
  if (response.ok) return response.json() as Promise<T>;
  const value = await response.json().catch(() => null);
  throw new Error(formatApiErrorMessage(typeof value?.message === "string" ? value.message : "", response.status, "台账读取失败，请刷新后重试"));
}
async function request<T>(path:string,body?:unknown):Promise<T>{const response=await apiFetch(path,body?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}:{});const data=await response.json();if(!response.ok)throw new Error(formatApiErrorMessage(data?.message,response.status,"到账核销失败"));return data as T;}
export function fetchReceiptMatches(projectId:string) { return read<ReceiptMatchData>(`/upward-receipt-matches?${new URLSearchParams({projectId})}`); }
export const prepareReceiptMatch=(body:{projectId:string;receiptFactId:string;settlementLedgerId:string;originalId?:string;amountCents:string;occurredAt:string;reason:string;confirmationPassword:string;idempotencyKey:string})=>request("/upward-receipt-matches",body);
export const decideReceiptMatch=(id:string,decision:string,confirmationPassword:string)=>request(`/upward-receipt-matches/${encodeURIComponent(id)}/decision`,{decision,confirmationPassword});
