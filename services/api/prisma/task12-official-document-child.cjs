'use strict';
const {performance}=require('node:perf_hooks');
const deadline=()=>Object.assign(new Error('TASK12_OFFICIAL_DOCUMENT_DEADLINE'),{code:'TASK12_OFFICIAL_DOCUMENT_DEADLINE'});
function attachPostcheck(primary,secondary) {
 if(primary&&typeof primary==='object'&&Object.isExtensible(primary)&&!Object.hasOwn(primary,'postcheckFailure')) {
  Object.defineProperty(primary,'postcheckFailure',{value:secondary});return primary;
 }
 return new AggregateError([primary,secondary],'TASK12_OFFICIAL_DOCUMENT_CHILD_AND_POSTCHECK_FAILED',{cause:primary});
}
/** Budget policy only, not a capability issuer. Callers must obtain their scope
 * from the private verifier authority. All hash work consumes the same budget. */
function createOfficialDocumentChildBudget(scope,milliseconds,started=performance.now()) {
 const remaining=()=>{
  const value=Math.floor(Math.min(milliseconds-(performance.now()-started),scope.remainingTotalMilliseconds()));
  if(value<=0)throw deadline();return value;
 };
 const diagnosticNow=()=>{try{return performance.now();}catch{return NaN;}};
 const costs={setupMs:0,precheckMs:0,childMs:0,postcheckMs:0};
 let firstFailurePhase=null,childOutcome='NOT_STARTED',postcheckOutcome='NOT_STARTED';
 const timing=()=>{
  const values={...costs,elapsedMs:diagnosticNow()-started};
  if(!Object.values(values).every(value=>Number.isFinite(value)&&value>=0&&value<=3600000))return Object.freeze({status:'UNKNOWN'});
  return Object.freeze({status:'OBSERVED',...Object.fromEntries(Object.entries(values).map(([key,value])=>[key,Math.floor(value)])),firstFailurePhase,childOutcome,postcheckOutcome});
 };
 return Object.freeze({remaining,timing,async run(operation){
  Object.assign(costs,{setupMs:0,precheckMs:0,childMs:0,postcheckMs:0});firstFailurePhase=null;childOutcome=postcheckOutcome='NOT_STARTED';
  let tick=diagnosticNow();costs.setupMs=tick-started;
  try{scope.checkMaterials();remaining();}catch(error){firstFailurePhase='PRECHECK';throw error;}
  finally{costs.precheckMs=diagnosticNow()-tick;}
  let failed=false,first,result;tick=diagnosticNow();
  try {result=await operation(remaining());childOutcome='RETURNED';}catch(error){failed=true;first=error;firstFailurePhase='CHILD';childOutcome='THREW';}
  finally{costs.childMs=diagnosticNow()-tick;}
  tick=diagnosticNow();
  try {scope.checkMaterials();remaining();postcheckOutcome='RETURNED';}catch(error){first=failed?attachPostcheck(first,error):error;failed=true;firstFailurePhase??='POSTCHECK';postcheckOutcome='THREW';}
  finally{costs.postcheckMs=diagnosticNow()-tick;}
  if(failed)throw first;return result;
 }});
}
module.exports=Object.freeze({createOfficialDocumentChildBudget,attachPostcheck});
