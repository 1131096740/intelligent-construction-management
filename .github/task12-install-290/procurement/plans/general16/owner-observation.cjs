"use strict";
const phases=new Set(["ROLE_SETUP","APPROVED_SCOPE_READ","EXACT_UPLOAD_BIND","ARCHIVE_READBACK","CONSUMED_BINDING_REMOVE","FAILED_BINDING_REMOVE","ROLE_TEARDOWN","EXPENSE_READBACK","EXPENSE_WITNESS_BIND","EXPENSE_WITNESS_REMOVE"]);
const fixedMarkers=[
  "PROCUREMENT_OWNED_ROLE_STILL_IN_USE",
  "PROCUREMENT_OWNED_ROLE_MISSING",
  "GENERAL_PROCUREMENT_ARCHIVE_BINDING",
  "GENERAL_PROCUREMENT_ARCHIVE_SCOPE",
  "GENERAL_PROCUREMENT_ARCHIVE_BUSY",
  "GENERAL_PROCUREMENT_ARCHIVE_TRIGGER_POSTIMAGE",
];
function projectPsql(stderr) {
  const output=typeof stderr==="string"?stderr:"";
  const sqlstate=/\b(?:ERROR|FATAL):\s*([0-9A-Z]{5}):/u.exec(output)?.[1];
  const marker=fixedMarkers.find(value=>output.includes(value));
  return {
    ...(sqlstate?{sqlstate}:{}),
    ...(marker?{marker}:{}),
    ...(/permission denied for (?:function|relation|table|schema)/u.test(output)?{permissionDenied:true}:{}),
    ...(/still in use|being accessed by other users|active SQL session|role .* cannot be dropped/iu.test(output)?{resourceInUse:true}:{}),
  };
}
function createOwnerSql(sql,receipt) {
  receipt.ownerOperations=[];
  return async function runOwner(phase,statement) {
    if(!phases.has(phase))throw new Error("PROCUREMENT_OWNER_PHASE_UNRECOGNIZED");
    const operation={phase,state:"STARTED"};
    receipt.ownerOperations.push(operation);
    try {
      const result=await sql(statement);
      operation.state="RETURNED";
      return result;
    } catch(error) {
      Object.assign(operation,{
        state:"STOPPED",
        code:/^[A-Z0-9_]+$/u.test(error.message??"")?error.message:"UNCLASSIFIED",
        exit:Number.isInteger(error.exit)?error.exit:undefined,
        executionError: /^(EAGAIN|ENOMEM|ETIMEDOUT|EACCES|ENOENT|ENOBUFS)$/u.test(error.executionError??"") ? error.executionError : undefined,
        signal: /^SIG[A-Z0-9]{1,12}$/u.test(error.signal??"") ? error.signal : undefined,

        ...error.psqlObservation,
      });
      throw error;
    }
  };
}
async function attemptCleanup(receipt, cleanup) {
  for(const [phase,step] of cleanup){
    try{await step();}
    catch(error){(receipt.cleanupFailures??=[]).push({phase,code:/^[A-Z0-9_]+$/u.test(error.message??"")?error.message:"UNCLASSIFIED"});}
  }
}
module.exports={projectPsql,createOwnerSql,attemptCleanup};
