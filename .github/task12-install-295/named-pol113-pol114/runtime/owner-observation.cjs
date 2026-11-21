"use strict";
const phases=new Set(["ROLE_SETUP","APPROVED_SCOPE_READ","EXACT_UPLOAD_BIND","ARCHIVE_READBACK","CONSUMED_BINDING_REMOVE","FAILED_BINDING_REMOVE","ROLE_TEARDOWN","EXPENSE_READBACK","EXPENSE_WITNESS_BIND","EXPENSE_WITNESS_REMOVE","PROJECT_SIGNATURE_ALIAS_GRANT","PROJECT_SIGNATURE_ALIAS_CHECK","PROJECT_SIGNATURE_ALIAS_REMOVE","PROJECT_DRAFT_BIND","PROJECT_DRAFT_READBACK","PROJECT_DRAFT_REMOVE","PROJECT_LEGACY_REVIEW_BIND","PROJECT_LEGACY_REVIEW_READBACK","PROJECT_LEGACY_REVIEW_REMOVE"]);
const fixedMarkers=[
  "PROCUREMENT_OWNED_ROLE_STILL_IN_USE",
  "PROCUREMENT_OWNED_ROLE_MISSING",
  "GENERAL_PROCUREMENT_ARCHIVE_BINDING",
  "GENERAL_PROCUREMENT_ARCHIVE_SCOPE",
  "GENERAL_PROCUREMENT_ARCHIVE_BUSY",
  "GENERAL_PROCUREMENT_ARCHIVE_TRIGGER_POSTIMAGE",
];
const namedSevenMarkers=new Set([
  "CURRENT259_ARCHIVE_INSTALL_BACKEND","CURRENT259_ARCHIVE_INSTALL_LEDGER",
  "CURRENT259_ARCHIVE_INSTALL_ROLES","CURRENT259_ARCHIVE_INSTALL_ROLE_SETTINGS",
  "CURRENT259_ARCHIVE_INSTALL_DATABASE_ACL","CURRENT259_ARCHIVE_INSTALL_TASK07_PREIMAGE",
  "CURRENT259_ARCHIVE_INSTALL_ROUTINES","CURRENT259_ARCHIVE_INSTALL_ORIGINAL_REGISTRY",
  "CURRENT259_ARCHIVE_INSTALL_PREEXISTING","CURRENT259_ARCHIVE_INSTALL_POSTSTATE",
  "CURRENT259_ARCHIVE_INSTALL_COLLISION_PREIMAGE","CURRENT259_ARCHIVE_INSTALL_COLLISION_POSTIMAGE",
  "CURRENT259_ARCHIVE_INSTALL_OUTSIDE_NATIVE_PREIMAGE","CURRENT259_ARCHIVE_INSTALL_OUTSIDE_NATIVE_POSTIMAGE",
  "CURRENT259_ARCHIVE_INSTALL_UPWARD_RESULT","CURRENT259_ARCHIVE_INSTALL_DRIFT",
  "CURRENT259_ARCHIVE_INSTALL_REGISTRY_DRIFT","CURRENT259_ARCHIVE_INSTALL_PENDING_DRIFT",
  "CURRENT259_ARCHIVE_INSTALL_REGISTERED_MIDSTATE","CURRENT259_ARCHIVE_INSTALL_REGISTERED_DRIFT",
  "CURRENT259_ARCHIVE_INSTALL_REGISTERED_NOT_COMMITTED","CURRENT259_ARCHIVE_INSTALL_REGISTERED_COMMITTED_DRIFT",
  "CURRENT259_SEVEN_INSTALL_SCOPE","CURRENT259_SEVEN_INSTALL_FRESH_OBJECTS",
  "CURRENT259_SEVEN_INSTALL_PREIMAGE_DRIFT","CURRENT259_SEVEN_INSTALL_REGISTRY_INTERMEDIATE",
  "CURRENT259_SEVEN_INSTALL_VOUCHER_ACL","CURRENT259_SEVEN_INSTALL_POSTIMAGE",
  "CURRENT259_SEVEN_INSTALL_CHECK_TRANSITION","CURRENT259_SEVEN_INSTALL_XMIN",
  "CURRENT259_SEVEN_INSTALL_ARCHIVE_PREIMAGE_DRIFT REGISTRY",
  "CURRENT259_SEVEN_INSTALL_ARCHIVE_PREIMAGE_DRIFT FILE_ROLES",
  "CURRENT259_SEVEN_INSTALL_ARCHIVE_PREIMAGE_DRIFT DIGEST",
  "TASK16_CURRENT259_SEVEN_PREIMAGE",
]);
const namedSevenDetails=new Set([
  "OWNER_SESSION","DATABASE_IDENTITY","CLUSTER_IDENTITY","TLS_ENDPOINT","TLS_SESSION",
  "SERVER_REPLICATION","TRANSACTION_MODE","ROLE_XID","ORDINARY_ROLE","RUNTIME_ROLE",
  "OBSERVER_ROLE","ROLE_SETTINGS","DATABASE_ACL","MIGRATION_LEDGER","PENDING_BINDING",
  "ARCHIVE_INTENT_BINDING","ARCHIVE_NATIVE_NONCE","UPWARD_ISSUER_BINDING","UPWARD_CLOSURE_BINDING",
  "UPWARD_EXECUTION_BINDING","SCHEMA205_ROUTINE","OPERATING_FACT_ROUTINE","OPERATING_IMPACT_ROUTINE",
  "FUND_IMMUTABLE_ROUTINE",
]);
const namedSevenRoutines=new Set([
  "inline_code_block","jg_install_contract_direct_archive_outside_v1",
  "jg_install_contract_direct_upward_v2","jg_require_contract_direct_upward_source_v2",
  "jg_file_business_binding_columns","jg_enforce_exclusive_file_business_binding",
]);
function projectNamedSevenFailure(stderr) {
  if(typeof stderr!=="string")return {};
  const lines=stderr.split(/\r?\n/u);
  const error=lines.map(line=>/^(?:psql:(?:<stdin>|stdin):[0-9]+:\s*)?ERROR:\s+([0-9A-Z]{5}):\s+(.+)$/u.exec(line)).find(Boolean);
  if(!error)return {};
  const marker=namedSevenMarkers.has(error[2])?error[2]:undefined;
  const detail=marker==="CURRENT259_SEVEN_INSTALL_SCOPE"
    ? lines.map(line=>/^DETAIL:\s+CURRENT259_SEVEN_SCOPE_([A-Z_]+)$/u.exec(line)?.[1]).find(value=>namedSevenDetails.has(value))
    : undefined;
  const frames=lines.flatMap(line=>{
    const found=/^(?:CONTEXT:\s*)?PL\/pgSQL function (?:public\.)?([a-z0-9_]+)(?:\([^)]*\))? line ([0-9]{1,5}) at (RAISE|EXECUTE|assignment|IF|SQL statement)$/u.exec(line.trim());
    return found&&namedSevenRoutines.has(found[1])?[{routine:found[1],line:Number(found[2]),action:found[3]}]:[];
  }).slice(0,3);
  return {sqlstate:error[1],...(marker?{marker}:{}),...(detail?{detail}:{}),...(frames.length?{frames}:{})};
}
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
module.exports={projectPsql,projectNamedSevenFailure,createOwnerSql,attemptCleanup};
