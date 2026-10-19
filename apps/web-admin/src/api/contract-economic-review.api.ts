import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";
export interface CoverageLine { scope:string;leftAmountCents:string;rightAmountCents:string;owner:"left"|"right" }
export interface EconomicReviewData {canReview:boolean;
 documents:Array<{formal?:boolean;hasFormalHistory?:boolean;ref:string;reference:string;title:string;counterparty:string;amountCents:string|null;settledCents:string}>;
 candidates:Array<{leftSourceRef:string;rightSourceRef:string;reason:string}>;
 reviews:Array<{id:string;leftSourceRef:string;rightSourceRef:string;relation:string;coverage:CoverageLine[];reason:string;status:string;revision:number;canContractReview:boolean;canFinanceReview:boolean;returnReason:string|null}>;
 pendingSettlements:Array<{ref:string;contractRef:string;label:string;amountCents:string;scopes:Array<{key:string;label:string;capacityCents:string}>}>;
 canPrepare:boolean;
}
async function read<T>(path: string): Promise<T> {
  const response = await apiFetch(path);
  if (response.ok) return response.json() as Promise<T>;
  const value = await response.json().catch(() => null);
  throw new Error(formatApiErrorMessage(typeof value?.message === "string" ? value.message : "", response.status, "台账读取失败，请刷新后重试"));
}
async function request<T>(path:string, body?:unknown):Promise<T> {
 const response=await apiFetch(path,body===undefined?{}:{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
 const payload:unknown=await response.json().catch(()=>null);
 if(!response.ok){const message=payload&&typeof payload==="object"&&"message" in payload&&typeof payload.message==="string"?payload.message:"";throw new Error(formatApiErrorMessage(message,response.status,"履约复核办理失败，请刷新后核对"));}
 return payload as T;
}
export function fetchEconomicReviews(projectId:string) { return read<EconomicReviewData>(`/contract-economic-reviews?${new URLSearchParams({projectId})}`); }
export const prepareEconomicReview=(body:{targetSourceRef?:string;supersedesReviewId?:string;projectId:string;leftSourceRef:string;rightSourceRef:string;relation:string;coverage:CoverageLine[];reason:string;idempotencyKey:string;confirmationPassword:string})=>request("/contract-economic-reviews",body);
export const decideEconomicReview=(id:string,body:{revision:number;decision:"confirm"|"return";reason?:string;confirmationPassword:string})=>request(`/contract-economic-reviews/${encodeURIComponent(id)}/decision`,body);

export const prepareEconomicSettlement=(body:{projectId:string;sourceRef:string;allocations:Array<{scopeKey:string;amountCents:string}>;confirmationPassword:string})=>request("/contract-economic-reviews/settlement-coverage",body);

export async function fetchContractCounterparties(projectId:string):Promise<Array<{value:string;label:string}>>{
 const response=await apiFetch(`/contract-economic-reviews/counterparties?${new URLSearchParams({projectId})}`);
 const data=await response.json();if(!response.ok)throw new Error("合作单位选项读取失败，请刷新");return data;
}
