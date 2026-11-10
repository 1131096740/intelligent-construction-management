'use strict';

const { randomBytes } = require('node:crypto');
const { isDeepStrictEqual, types } = require('node:util');
const { claimCurrent259SevenInstallation } = require('./task16-current259-seven-install.cjs');
const { claimCurrent259TechnicalResource, closeCurrent259OwnedResource } = require('./task16-current259-owned-resource.cjs');
const { renderCurrent259RuntimeAcl } = require('./task16-current259-runtime-acl.cjs');
const { renderCurrent259PublicAccess } = require('./task16-current259-public-access.cjs');
const { parseCurrent259CatalogRead } = require('./task16-current259-catalog.cjs');

const CODE = 'TASK16_CURRENT259_PAYMENT_ACL';
const WRITE = 'current259-payment-acl-write';
const READ = 'current259-payment-acl-committed';
const RESULT = 'CURRENT259_PAYMENT_ACL_COMMITTED_NOT_ADMISSION';
const IDENTITY_ROUTINE = 'public.jg_task01_connection_identity()';
const receipts = new WeakMap();
const oid = value => typeof value === 'string' && /^[1-9][0-9]{0,9}$/u.test(value) && Number(value) <= 0xffffffff;
const xid = value => typeof value === 'string' && /^[1-9][0-9]{0,19}$/u.test(value) && BigInt(value) <= 0xffffffffffffffffn;
const xmin = value => (BigInt(value) & 0xffffffffn).toString();
const fail = suffix => Object.assign(new Error(CODE + '_' + suffix), { code: CODE + '_' + suffix });
function need(ok) {
  if (!ok) throw fail('INVALID');
}

function catalogRequest(source, provisioned, nonce) {
  const { database, databaseOid, namespaceOid, ownerOid, systemIdentifier } = provisioned.databaseIdentity;
  const roleOid = name => {
    const roles = provisioned.roles.filter(role => role.name === name);
    need(roles.length === 1 && oid(roles[0].oid));
    return roles[0].oid;
  };
  const profile = source.profile;
  return {
    source: { candidateSha: source.candidateSha, sealSha256: source.sourceSealSha256, schemaSha256: profile.schemaSha256,
      migrations: profile.ledger.map(row => ({ path: `services/api/prisma/migrations/${row.name}/migration.sql`, sha256: row.sha256 })) },
    identity: { runId: provisioned.runId, database, databaseOid, namespaceOid, ownerOid, systemIdentifier,
      runtimeOid: roleOid('jg_task01_runtime'), observerOid: roleOid('jg_task01_observer') },
    nonce, phase: 'before'
  };
}

function proofSql(catalog, nonce, transactionId, commitStatus) {
  return `SELECT pg_catalog.jsonb_build_object('challenge','${nonce}','aclXid',(${transactionId})::text,
 'commitStatus',${commitStatus},'guardXmin',(SELECT p.xmin::text FROM pg_catalog.pg_proc p
   WHERE p.oid='${IDENTITY_ROUTINE}'::regprocedure),'catalog',q.result) FROM ${catalog} q;`;
}

function writeScript(sevenXid, runtime, publicSql, projection, nonce) {
  return `BEGIN ISOLATION LEVEL SERIALIZABLE;
SET LOCAL search_path=pg_catalog,pg_temp;
SET LOCAL standard_conforming_strings=on;
SET LOCAL lock_timeout='5s';
DO $payment_acl_source$ BEGIN
 IF pg_catalog.pg_xact_status('${sevenXid}'::xid8) IS DISTINCT FROM 'committed' THEN
   RAISE EXCEPTION '${CODE}_SEVEN_COMMIT';
 END IF;
END $payment_acl_source$;
${runtime.sql}
${publicSql}
CREATE TEMP TABLE jg_c259_acl_proof ON COMMIT DROP AS ${projection};
DO $payment_acl_scope$
DECLARE report jsonb;
BEGIN
 SELECT result INTO STRICT report FROM pg_temp.jg_c259_acl_proof;
 IF report->'extraFunctions' IS DISTINCT FROM '[]'::jsonb
   OR report->'publicAclViolations' IS DISTINCT FROM '[]'::jsonb
   OR report->>'writeXid' IS DISTINCT FROM pg_catalog.pg_current_xact_id()::text
   OR NOT EXISTS(SELECT FROM pg_catalog.pg_proc p WHERE p.oid='${IDENTITY_ROUTINE}'::regprocedure
     AND p.xmin::text=(mod(pg_catalog.pg_current_xact_id()::text::numeric,4294967296))::text)
 THEN RAISE EXCEPTION '${CODE}_FINAL_CATALOG'; END IF;
END $payment_acl_scope$;
${proofSql('pg_temp.jg_c259_acl_proof', nonce, 'pg_catalog.pg_current_xact_id()', 'NULL::text')}
COMMIT;`;
}

function readScript(staged, projection, nonce) {
  const committedXid = `'${staged.aclXid}'::xid8`;
  return `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=pg_catalog,pg_temp;
${proofSql(`(${projection})`, nonce, committedXid, `pg_catalog.pg_xact_status(${committedXid})`)}
ROLLBACK;`;
}

function parseProof(result, nonce, committed) {
  need(result && typeof result.stdout === 'string' && Buffer.byteLength(result.stdout) <= 512 * 1024);
  const row = JSON.parse(result.stdout);
  need(row && Object.keys(row).length === 5 && row.challenge === nonce &&
    xid(row.aclXid) && row.guardXmin === xmin(row.aclXid) &&
    row.commitStatus === (committed ? 'committed' : null));
  const { catalog } = row;
  need(catalog?.identity && catalog.nonce === nonce && catalog.identity.readOnly === committed &&
    catalog.writeXid === (committed ? null : row.aclXid) &&
    Number.isInteger(catalog.identity.backendPid) && catalog.identity.backendPid > 0 &&
    typeof catalog.identity.backendStart === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/u.test(catalog.identity.backendStart) &&
    isDeepStrictEqual(catalog.extraFunctions, []) && isDeepStrictEqual(catalog.publicAclViolations, []));
  return row;
}

function stableCatalog(report) {
  const identity = Object.fromEntries(Object.entries(report.identity)
    .filter(([key]) => !['backendPid', 'backendStart', 'readOnly'].includes(key)));
  return { ...report, identity, writeXid: null };
}

async function installCurrent259PaymentAcl(sevenCompletion, handle) {
  need(arguments.length === 2);
  const lease = claimCurrent259SevenInstallation(sevenCompletion, handle);
  let writeAttempted = false;
  try {
    const { source, completion, roleCompletion } = lease;
    const view = claimCurrent259TechnicalResource(handle);
    const check = () => { lease.check(); view.check(); view.verifyFull(); };
    check();
    need(completion === sevenCompletion && xid(completion.installXid) &&
      isDeepStrictEqual(source, view.source) && roleCompletion.sourceSha === source.candidateSha &&
      roleCompletion.runId === view.runId && roleCompletion.containerId === view.resource.containerId &&
      roleCompletion.databaseIdentity.database === view.resource.databaseName);
    const nonce = randomBytes(32).toString('hex');
    const request = catalogRequest(source, roleCompletion, nonce);
    const runtime = renderCurrent259RuntimeAcl(source, roleCompletion, nonce);
    const publicSql = renderCurrent259PublicAccess(roleCompletion);
    const witness = runtime.witnessSql.trim();
    need(witness.endsWith(';'));
    const projection = witness.slice(0, -1);
    const sql = writeScript(completion.installXid, runtime, publicSql, projection, nonce);
    check();
    writeAttempted = true;
    const staged = parseProof(await view.resource.execOwnerSql(sql, WRITE), nonce, false);
    check();
    need(staged.aclXid !== completion.installXid);
    const committed = parseProof(await view.resource.execOwnerSql(readScript(staged, projection, nonce), READ), nonce, true);
    check();
    const stagedIdentity = staged.catalog.identity, committedIdentity = committed.catalog.identity;
    need(staged.aclXid === committed.aclXid && stagedIdentity.backendPid !== committedIdentity.backendPid &&
      stagedIdentity.backendStart !== committedIdentity.backendStart &&
      isDeepStrictEqual(stableCatalog(staged.catalog), stableCatalog(committed.catalog)));
    const catalogProof = parseCurrent259CatalogRead(JSON.stringify(committed.catalog), request);
    check();
    const result = Object.freeze({ status: RESULT, sourceSha: source.candidateSha, runId: view.runId,
      installXid: committed.aclXid, executionAllowed: false, nativeAdmission: false });
    receipts.set(result, { handle, source, roleCompletion, request, catalogProof, check });
    return result;
  } catch {
    const error = fail(writeAttempted ? 'COMMIT_UNCONFIRMED' : 'NOT_ATTEMPTED');
    try { await closeCurrent259OwnedResource(handle); }
    catch { Object.defineProperty(error, 'resourceCleanup', { value: 'UNKNOWN', enumerable: true }); }
    throw error;
  }
}

function claimCurrent259PaymentAcl(result, handle) {
  need(arguments.length === 2 && result && !types.isProxy(result) && receipts.has(result));
  const proof = receipts.get(result);
  need(proof.handle === handle);
  receipts.delete(result);
  proof.check();
  return Object.freeze({ source: proof.source, completion: result, roleCompletion: proof.roleCompletion,
    request: proof.request, catalogProof: proof.catalogProof, check: proof.check });
}

module.exports = Object.freeze({ installCurrent259PaymentAcl, claimCurrent259PaymentAcl });
