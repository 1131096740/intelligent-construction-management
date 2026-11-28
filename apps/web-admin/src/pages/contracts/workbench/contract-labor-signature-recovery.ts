import type { ContractBodyEditPlan, ContractDraftBodyReadModel } from "../../../api/contract-workbench.api";
import { restorePartyRoles } from "./contract-party-recovery";
type Recovery=NonNullable<ContractDraftBodyReadModel["laborSignatureRecovery"]>;
/** Restores one explicitly confirmed position; every other edit and addition stays intact. */
export function restoreLaborSignaturePosition(plan:ContractBodyEditPlan,recovery:Recovery,id:string):ContractBodyEditPlan|null {
 const entry=recovery.entries.find(item=>item.id===id);
 if(!entry||recovery.entries.filter(item=>item.id===id).length!==1)return null;
 if(entry.kind==="edit"&&!plan.edits.some(edit=>edit.positionId===id&&edit.text===entry.text))return null;
 if(entry.kind==="deletion"&&!(plan.deletedPositionIds??[]).includes(id))return null;
 if(recovery.groups.flat().includes(id))return restorePartyRoles(plan,{roleIds:[id],groups:recovery.groups});
 return {...plan,edits:plan.edits.filter(edit=>edit.positionId!==id),...(plan.deletedPositionIds?{deletedPositionIds:plan.deletedPositionIds.filter(value=>value!==id)}:{})};
}
