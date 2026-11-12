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
 return Object.freeze({remaining,async run(operation){
  scope.checkMaterials();remaining();
  let failed=false,first,result;
  try {result=await operation(remaining());}catch(error){failed=true;first=error;}
  try {scope.checkMaterials();remaining();}catch(error){first=failed?attachPostcheck(first,error):error;failed=true;}
  if(failed)throw first;return result;
 }});
}
module.exports=Object.freeze({createOfficialDocumentChildBudget,attachPostcheck});
