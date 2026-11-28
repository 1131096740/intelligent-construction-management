'use strict';

const before = "OR current_user <> 'jg_task01_owner' OR current_user <> session_user THEN";
const after = "OR current_user <> 'jiangkong' OR current_user <> session_user THEN";

function bindNamedSevenPreimage(preimage) {
  const parts = preimage.setupSql.split(before);
  if (parts.length !== 2 || preimage.setupSql.includes(after)) {
    throw new Error('NAMED_SEVEN_PREIMAGE_OWNER_PREDICATE');
  }
  return Object.freeze({...preimage, setupSql: parts.join(after)});
}

const ownerOidBefore = "p.proowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='jg_task01_owner')";
const ownerOidAfter = "p.proowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='jiangkong' AND oid=10)";

function bindNamedSevenDelta(sql) {
  const parts = sql.split(ownerOidBefore);
  if (parts.length !== 2 || sql.includes(ownerOidAfter)) {
    throw new Error('NAMED_SEVEN_DELTA_OWNER_PREDICATE');
  }
  return parts.join(ownerOidAfter);
}

function bindNamedSevenFunctionProofs(proofs, render) {
  if (!Array.isArray(proofs) || proofs.length !== 41 ||
      new Set(proofs.map(proof => proof.signature)).size !== 41 ||
      proofs.some(proof => proof.owner !== 'jg_task01_owner')) {
    throw new Error('NAMED_SEVEN_FUNCTION_PROOF_OWNER_PREIMAGE');
  }
  const rendered = render({functionProofs:proofs.map(proof=>({...proof, owner:'jiangkong'}))});
  const join = 'JOIN pg_catalog.pg_roles r ON r.oid=p.proowner JOIN';
  const parts=rendered.split(join);
  if(parts.length!==2) throw new Error('NAMED_SEVEN_FUNCTION_PROOF_OID_PREIMAGE');
  return parts.join('JOIN pg_catalog.pg_roles r ON r.oid=p.proowner AND r.oid=10 JOIN');
}

module.exports = {bindNamedSevenPreimage,bindNamedSevenDelta,bindNamedSevenFunctionProofs};
