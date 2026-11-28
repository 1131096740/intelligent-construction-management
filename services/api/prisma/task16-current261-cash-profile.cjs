'use strict';
// Fixed source-derived cash scenario grants. This is a plan only, not authority
// or evidence that a physical role has these privileges.
const CASH_RUNTIME_READS=Object.freeze({
 PaymentExecutionAllocation:['allocationOrder'],
 ProjectCloseStageVersion:['amountSnapshot','id','projectId','projectionCutoffAt','projectionFingerprint','projectionReadAt','revision','stageKey','stateSnapshot','status'],
 ProjectCloseImpact:['id','projectId','sourceFingerprint','sourceId','sourceType'],
 ProjectCloseAggregate:['createdAt','projectId','revision','updatedAt'],
 ContractPartySnapshot:['businessPartyVersionId','contractVersionId','displayOrder','id','roleKey','snapshot'],
 SettlementArchiveFile:['confirmedAt','confirmedByUserId','id','settlementId','status'],
 ProjectAffiliateAssignment:['affiliateCreditCodeSnapshot','affiliateNameSnapshot','businessPartyId','businessPartyVersionId','effectiveFrom','endedAt','id','projectId'],
 ProjectParticipatingCompany:['companyCreditCodeSnapshot','companyEntityId','companyEntityVersionId','companyNameSnapshot','effectiveFrom','endedAt','id','projectId'],
 OperatingFact:['amountYuan','numericProtocolVersion'],
 OperatingImpactEntry:['amountCents','amountYuan','costCategoryCode','createdAt','description','direction','executionAllocationLineId','factId','fundExecutionCaseId','fundExecutionId','fundPurpose','id','idempotencyKey','impactKind','impactSnapshot','numericProtocolVersion','paymentExecutionId','projectId','sourceImpactKey','subjectId','subjectKind','subjectRole']
});
const CASH_OBSERVER_READS=Object.freeze({
 Settlement:['amountCents','projectId','status'],
 OperatingFact:['actualPayerSubjectId','actualPayerSubjectKind','projectId','status'],
 OperatingImpactEntry:['amountCents','direction','factId','impactKind','numericProtocolVersion','projectId','subjectId','subjectKind'],
 RegisteredFundAccount:['companyEntityId','id','kind','scopeKey']
});
const CASH_WRITER_FUNCTIONS=Object.freeze([
 'public."appendOperatingFactThroughService"(public."OperatingLedgerFactWritePayload",pg_catalog.text,pg_catalog.text)',
 'public."appendOperatingImpactThroughService"(public."OperatingLedgerImpactWritePayload",pg_catalog.text,pg_catalog.text)'
]);
function cashAccessPlan(plan){
 const result={...plan};
 for(const [role,delta]of [['runtime',CASH_RUNTIME_READS],['observer',CASH_OBSERVER_READS]]){
  const previous=plan[role];if(!previous||!Array.isArray(previous.tables)||!Array.isArray(previous.functions))throw Error('TASK16_CASH_ACL');
  const tables=previous.tables.map(row=>({...row,select:[...row.select]}));
  for(const [table,columns]of Object.entries(delta)){
   let row=tables.find(value=>value.table===table);
   if(!row){row={table,select:[],insert:[],update:[],references:[]};tables.push(row);}
   if(columns.some(column=>row.select.includes(column)))throw Error('TASK16_CASH_ACL');
   row.select=[...row.select,...columns].sort();
  }
  if(role==='runtime'){
   const aggregate=tables.find(row=>row.table==='ProjectCloseAggregate');
   const inserts=['createdAt','projectId','revision','updatedAt'];
   if(!aggregate||inserts.some(column=>aggregate.insert.includes(column)))throw Error('TASK16_CASH_ACL');
   aggregate.insert=[...aggregate.insert,...inserts].sort();
   // PostgreSQL requires UPDATE on one column for SELECT FOR UPDATE. This
   // also grants actual timestamp writes, so it is confined to this isolated profile.
   if(aggregate.update.includes('updatedAt'))throw Error('TASK16_CASH_ACL');
   aggregate.update=[...aggregate.update,'updatedAt'].sort();
  }
  const functions=[...previous.functions];
  if(role==='runtime')for(const signature of CASH_WRITER_FUNCTIONS){if(functions.includes(signature))throw Error('TASK16_CASH_ACL');functions.push(signature);}
  result[role]={...previous,tables,functions};
 }
 return result;
}
module.exports=Object.freeze({CASH_RUNTIME_READS,CASH_OBSERVER_READS,CASH_WRITER_FUNCTIONS,cashAccessPlan});
