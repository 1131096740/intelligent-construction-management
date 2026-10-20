import type { ContractLedgerSection, ContractRelationship, ContractRelationshipLedger } from "@jiangkong/shared-domain";
import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";
export interface RelationshipLedgerQuery { section: ContractLedgerSection; asOf?: string; projectId?: string; relationship?: ContractRelationship; companyEntityId?: string }
export async function fetchContractRelationshipLedger(query: RelationshipLedgerQuery): Promise<ContractRelationshipLedger> {
  const params = new URLSearchParams(Object.entries(query).filter(([, v]) => Boolean(v)) as [string, string][]);
  const response = await apiFetch(`/contract-relationship-ledger?${params}`);
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const message = payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string" ? payload.message : "";
    throw new Error(formatApiErrorMessage(message, response.status, "分类台账读取失败，请重试"));
  }
  return response.json() as Promise<ContractRelationshipLedger>;
}

export async function exportContractRelationshipLedger(query: RelationshipLedgerQuery): Promise<Blob> {
  const params = new URLSearchParams(Object.entries(query).filter(([, v]) => Boolean(v)) as [string, string][]);
  const response = await apiFetch(`/contract-relationship-ledger/export?${params}`);
  if (!response.ok) throw new Error("分类台账导出失败，请刷新权限和筛选条件后重试");
  return response.blob();
}

export async function fetchContractClassificationPreflight(projectId:string):Promise<{readOnly:true;unprojectedFormalSources:number;checkedFacts:number;unclassifiedExternalDocuments:number;pendingEconomicReviews:number;notice:string;differences:Array<{reference:string;status:string;relationship:string;beforeAmountCents:string;afterAmountCents:string|null;reason:string}>}>{
 const response=await apiFetch(`/contract-relationship-ledger/preflight?${new URLSearchParams({projectId})}`);const payload=await response.json();if(!response.ok)throw new Error(typeof payload?.message==="string"?payload.message:"历史口径预检失败");return payload;
}
