import type { ContractBodyEditPlan, ContractDraftBodyReadModel } from "../../../api/contract-workbench.api";

/** Restore only confirmed role positions, keeping unrelated edits and their order. */
export function restorePartyRoles(plan:ContractBodyEditPlan,recovery:NonNullable<ContractDraftBodyReadModel["partyDetailsRecovery"]>):ContractBodyEditPlan|null {
  const roles=new Set(recovery.roleIds),deleted=new Set(plan.deletedPositionIds??[]);
  if(!roles.size||roles.size!==recovery.roleIds.length) return null;
  const all=recovery.groups.flat();
  if(new Set(all).size!==all.length||[...roles].some(id=>!all.includes(id))) return null;
  let order:string[]|undefined;
  if(plan.paragraphOrder){
    order=[];let offset=0;
    for(const sourceGroup of recovery.groups){
      const active=sourceGroup.filter(id=>!deleted.has(id));
      const current=plan.paragraphOrder.slice(offset,offset+active.length);offset+=active.length;
      if(current.length!==active.length||new Set(current).size!==current.length||current.some(id=>!active.includes(id))) return null;
      const restored=[...current];
      for(const role of sourceGroup.filter(id=>roles.has(id)&&deleted.has(id))){
        const sourceIndex=sourceGroup.indexOf(role);
        const next=sourceGroup.slice(sourceIndex+1).find(id=>restored.includes(id));
        if(next)restored.splice(restored.indexOf(next),0,role);else restored.push(role);
      }
      order.push(...restored);
    }
    if(offset!==plan.paragraphOrder.length) return null;
  }
  return {...plan,edits:plan.edits.filter(edit=>!roles.has(edit.positionId)),
    ...(plan.deletedPositionIds?{deletedPositionIds:plan.deletedPositionIds.filter(id=>!roles.has(id))}:{}),
    ...(order?{paragraphOrder:order}:{})};
}
