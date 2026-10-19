import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";
export interface ProxyEntry {id:string;entryKind:"payment"|"refund"|"repayment";status:string;amountCents:string;occurredAt:string;reason:string;canConfirm:boolean;frozenSource:{allocations?:Array<{sourceRef:string;amountCents:string;reference:string}>;reference:string;contractRelationship:"inside"|"outside";debtor:{kind?:string;name:string};actualPayer:{kind?:string;name:string};counterparty:string}}
export interface ProxyData {canPrepare:boolean;canReview:boolean;observations:Array<{value:string;label:string}>;requests:Array<{id:string;label:string;sourceRef:string;remainingCents:string}>;sources:Array<{value:string;label:string}>;payers:Array<{value:string;label:string}>;entries:ProxyEntry[]}
async function read<T>(path: string): Promise<T> {
  const response = await apiFetch(path);
  if (response.ok) return response.json() as Promise<T>;
  const value = await response.json().catch(() => null);
  throw new Error(formatApiErrorMessage(typeof value?.message === "string" ? value.message : "", response.status, "台账读取失败，请刷新后重试"));
}
async function request<T>(path:string,body?:unknown):Promise<T>{const response=await apiFetch(path,body?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}:{});const payload=await response.json().catch(()=>null);if(!response.ok)throw new Error(formatApiErrorMessage(payload?.message,response.status,"代付往来办理失败，请刷新核对"));return payload as T;}
export function fetchContractProxyExecutions(projectId:string) { return read<ProxyData>(`/contract-proxy-executions?${new URLSearchParams({projectId})}`); }
export const prepareContractProxyExecution=(body:{receivingBankObservationId?:string;bankObservationId?:string;paymentRequestId?:string;allocations?:Array<{sourceRef:string;amountCents:string}>;projectId:string;sourceRef:string;entryKind:string;originalId?:string;amountCents:string;occurredAt:string;actualPayerKey:string;bankReference:string;evidenceFileId:string;reason:string;idempotencyKey:string;confirmationPassword:string})=>request("/contract-proxy-executions",body);
export const decideContractProxyExecution=(id:string,decision:"confirm"|"return",confirmationPassword:string)=>request(`/contract-proxy-executions/${encodeURIComponent(id)}/decision`,{decision,confirmationPassword});

export function fetchCompanyBankEvents(projectId:string) { return read<Array<{value:string;label:string}>>(`/contract-proxy-executions/bank-options?${new URLSearchParams({projectId})}`); }
