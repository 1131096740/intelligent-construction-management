'use strict';
const { createHash, createHmac, pbkdf2Sync, randomBytes } = require('node:crypto');
const { isIP } = require('node:net');
const fs = require('node:fs');
const { isDeepStrictEqual: equal, types } = require('node:util');
const {projectGeneratedDraftHttpFailure,createGeneratedDraftAdmissionDiagnostic}=require('./task12-current259-generated-draft-diagnostic.cjs');
const { readQualifiedTask16File: readFile } = require('./task16-runtime-inputs.cjs');
const { isCurrent259FirstQ2Fixture } = require('./task12-current259-q2-fixture.cjs');
const { createCurrent259FirstQ2Seed, createCurrent259GeneratedDraftSeed, createCurrent259FirstQ2UploadReadback, createCurrent259FirstQ2ArchiveReadback } = require('./task12-current259-q2-seed.cjs');
// A fixed controller loads this scope before the ACL producer, which loads the
// genuine technical/physical lineage. A preloaded ACL export is never adopted.
const aclPath = require.resolve('./task16-current259-ordinary-archive-acl.cjs');
const aclCache = require.cache;
if (Object.getOwnPropertyDescriptor(aclCache,aclPath)) throw new Error('CURRENT259_CONTRACT_LOGIN_IMPORT');
const aclExports = require('./task16-current259-ordinary-archive-acl.cjs');
const aclModule = Object.getOwnPropertyDescriptor(aclCache,aclPath)?.value;
const { claimCurrent259TechnicalResource, closeCurrent259OwnedResource } = require('./task16-current259-owned-resource.cjs');

const OWNER = 'jg_task01_owner';
const CURRENT259_FIRST_Q2_TRANSPORT='UNVERIFIED_FIRST_Q2_LOOPBACK_TLS';
const LEGACY_TRANSPORT='UNVERIFIED_HOST_PUBLISHED_TLS';
const relayIdShape=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const LOGIN_NAMES = ['jg_c259_outside_issuer_login', 'jg_c259_outside_executor_login',
  'jg_c259_upward_issuer_login', 'jg_c259_upward_runtime_login'];
const BINDINGS = ['jg_contract_direct_archive_intent_binding_v1', 'jg_contract_direct_archive_native_nonce_v1',
  'jg_contract_direct_upward_issuer_binding_v2', 'jg_contract_direct_upward_closure_v2', 'jg_contract_direct_upward_execution_binding_v2'];
const METHODS = ['execOwnerSql', 'getReceipt', 'applyCurrent259ContractHbaV1', 'inspectConnectionEndpoint',
  'observePresentedCertificate', 'beginCurrent259ContractPlaintextProbe', 'verifyCurrent259ContractPlaintextRejection'];
const CLIENT_METHODS = ['$disconnect', '$connect', '$queryRawUnsafe'];
const APP_DSN_KEYS = ['DATABASE_URL','DIRECT_ARCHIVE_ISSUER_DATABASE_URL','DIRECT_ARCHIVE_RUNTIME_DATABASE_URL',
  'UPWARD_DIRECT_ARCHIVE_ISSUER_DATABASE_URL','UPWARD_DIRECT_ARCHIVE_RUNTIME_DATABASE_URL'];
const PROOFS = new WeakMap();
const USED = new WeakSet();
const APP_BRIDGES = new WeakSet();
const ownFaults = new WeakMap();
function fail(phase) {
  const error=Object.assign(new Error('CURRENT259_CONTRACT_LOGIN_' + phase), { code:'CURRENT259_CONTRACT_LOGIN_' + phase });
  ownFaults.set(error,phase);
  return error;
}
const need = (value, phase) => { if (!value) throw fail(phase); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const oid = value => typeof value === 'string' && /^[1-9][0-9]{0,9}$/u.test(value) && BigInt(value) <= 0xffffffffn;
const xid = value => typeof value === 'string' && /^[1-9][0-9]{0,19}$/u.test(value) && BigInt(value) <= 0xffffffffffffffffn;
const xid32 = value => String(BigInt(value) % 0x100000000n);
const quote = value => "'" + value.replaceAll("'", "''") + "'";
const json = value => quote(JSON.stringify(value)) + '::jsonb';
const stamp = expression => `pg_catalog.to_char(${expression} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const digest = expression => `pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to((${expression})::text,'UTF8')),'hex')`;
const backend = (pid, start) => Number.isInteger(pid) && pid > 0 && pid <= 2147483647 &&
  typeof start === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/u.test(start) && Number.isFinite(Date.parse(start));
const privateIPv4 = value => typeof value==='string' && isIP(value)===4 && /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2[0-9]|3[01])\.)/u.test(value);
const distinct = (a, b) => a.pid !== b.pid && a.start !== b.start;
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const member of Object.values(value)) freeze(member);
    Object.freeze(value);
  }
  return value;
};
const own = (object, key) => {
  need(object && !types.isProxy(object), 'METHOD');
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  need(descriptor && Object.hasOwn(descriptor, 'value'), 'METHOD');
  return descriptor.value;
};

const claimAcl = own(aclExports,'claimCurrent259OrdinaryArchiveAcl');
function checkAclImport() {
  need(require.cache===aclCache && Object.getOwnPropertyDescriptor(aclCache,aclPath)?.value===aclModule &&
    own(aclModule,'exports')===aclExports &&
    own(aclExports,'claimCurrent259OrdinaryArchiveAcl')===claimAcl && typeof claimAcl==='function','IMPORT');
}

function makeVerifier(password) {
  const salt = randomBytes(16);
  const salted = pbkdf2Sync(password, salt, 4096, 32, 'sha256');
  try {
    const hmac = label => createHmac('sha256', salted).update(label).digest();
    const stored = createHash('sha256').update(hmac('Client Key')).digest('base64');
    return `SCRAM-SHA-256$4096:${salt.toString('base64')}$${stored}:${hmac('Server Key').toString('base64')}`;
  } finally { salted.fill(0); salt.fill(0); }
}

const databaseAclSql = `(SELECT jsonb_agg(jsonb_build_object(
 'oid',d.oid::text,'name',d.datname,'owner',d.datdba::text,'acl',COALESCE((SELECT jsonb_agg(
 jsonb_build_array(a.grantor::text,a.grantee::text,a.privilege_type,a.is_grantable)
 ORDER BY a.grantor,a.grantee,a.privilege_type COLLATE "C",a.is_grantable)
 FROM aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) a),'[]'::jsonb)) ORDER BY d.datname COLLATE "C") FROM pg_database d)`;
const archiveBindingSql = digest(`jsonb_build_array(${BINDINGS.map(table => `(SELECT to_jsonb(b) FROM public.${table} b)`).join(',')})`);
const ownerIdentitySql = `(SELECT jsonb_build_object('database',current_database(),'databaseOid',d.oid::text,
 'namespaceOid',to_regnamespace('public')::oid::text,'ownerOid',d.datdba::text,'actorOid',current_user::regrole::oid::text,
 'actor',current_user,'sessionActor',session_user,'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
 'tls',s.ssl,'clientAddress',host(inet_client_addr()),'serverAddress',host(inet_server_addr()),'serverPort',inet_server_port())
 FROM pg_database d JOIN pg_stat_ssl s ON s.pid=pg_backend_pid() WHERE d.datname=current_database())`;
const backendSql = `(SELECT jsonb_build_object('pid',pid,'start',${stamp('backend_start')})
 FROM pg_stat_activity WHERE pid=pg_backend_pid())`;
const logging = [
  ['log_transaction_sample_rate', '0'], ['log_statement', 'none'], ['log_min_error_statement', 'panic'],
  ['log_error_verbosity', 'terse'], ['log_parameter_max_length_on_error', '0'], ['log_parameter_max_length', '0'],
  ['log_duration', 'off'], ['log_min_duration_statement', '-1'], ['log_min_duration_sample', '-1'],
  ['debug_print_parse', 'off'], ['debug_print_rewritten', 'off'], ['debug_print_plan', 'off'],
];
const writerSetup = logging.map(([name, value]) => `SET ${name}=${quote(value)};`).join('\n');
const loggingOk = logging.map(([name, value]) => `current_setting(${quote(name)})=${quote(value)}`).join(' AND ');
const environmentOk = `current_setting('server_version_num')::int BETWEEN 160000 AND 169999
 AND current_setting('session_replication_role')='origin' AND getdatabaseencoding()='UTF8'`;
const noConnections = `NOT EXISTS(SELECT 1 FROM pg_stat_activity a WHERE a.backend_type='client backend' AND a.pid<>pg_backend_pid())`;

function projection(scope) {
  const { prior, role, archive, targets } = scope;
  const ids = [role.ordinary, ...role.roles].map(r => quote(r.oid) + '::oid').join(',');
  const targetIds = targets.map(r => quote(r.oid) + '::oid').join(',');
  return `jsonb_build_object(
 'identity',${ownerIdentitySql},
 'catalogSha256',${prior.catalogSql},'protectedSha256',${prior.protectedSql},'bindingSha256',${archiveBindingSql},
 'archiveXmins',jsonb_build_array(${BINDINGS.map(table => `(SELECT xmin::text FROM public.${table})`).join(',')}),
 'databaseAcl',${databaseAclSql},
 'rawDatabaseSha256',${digest('(SELECT jsonb_agg(to_jsonb(d) ORDER BY d.oid) FROM pg_database d)')},
 'otherAuthSha256',${digest(`(SELECT jsonb_agg(jsonb_build_array(to_jsonb(r),r.xmin::text) ORDER BY r.oid) FROM pg_authid r WHERE r.oid NOT IN (${ids}))`)},
 'membershipsSha256',${digest('(SELECT jsonb_agg(jsonb_build_array(to_jsonb(m),m.xmin::text) ORDER BY m.oid) FROM pg_auth_members m)')},
 'settingsSha256',${digest('(SELECT jsonb_agg(jsonb_build_array(to_jsonb(s),s.xmin::text) ORDER BY s.setdatabase,s.setrole) FROM pg_db_role_setting s)')},
 'roleSettings',(SELECT COALESCE(jsonb_agg(jsonb_build_object('oid',s.setrole::text,'database',s.setdatabase::text,'config',s.setconfig)
   ORDER BY s.setrole,s.setdatabase),'[]'::jsonb) FROM pg_db_role_setting s WHERE s.setrole IN (${ids})),
 'managedRoleSafe',NOT EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member IN (${ids}) OR m.roleid IN (${ids}))
   AND NOT EXISTS(SELECT 1 FROM pg_authid r WHERE r.oid IN (${ids}) AND has_schema_privilege(r.oid,'public','CREATE')),
 'roles',(SELECT jsonb_agg(jsonb_build_object(
   'oid',r.oid::text,'name',r.rolname,'login',r.rolcanlogin,'limit',r.rolconnlimit,
   'password',CASE WHEN r.rolpassword IS NULL THEN 'absent' WHEN r.rolpassword LIKE 'SCRAM-SHA-256$%' THEN 'scram' ELSE 'other' END,
   'superuser',r.rolsuper,'createRole',r.rolcreaterole,'createDb',r.rolcreatedb,'inherit',r.rolinherit,
   'replication',r.rolreplication,'bypassRls',r.rolbypassrls,'unlimitedValidity',r.rolvaliduntil IS NULL,
   'xmin',r.xmin::text,'verifierSha256',CASE WHEN r.oid IN (${targetIds}) AND r.rolpassword IS NOT NULL THEN ${digest('r.rolpassword')} ELSE NULL END)
   ORDER BY r.rolname COLLATE "C") FROM pg_authid r WHERE r.oid IN (${ids})),
 'limits',jsonb_build_array(current_setting('max_connections')::int,current_setting('superuser_reserved_connections')::int,
   current_setting('reserved_connections')::int),
 'originCommitted',${[role.commitXid, archive.installXid, prior.completion.installXid].map(id => `pg_xact_status(${quote(id)}::xid8)='committed'`).join(' AND ')},
 'environmentOk',${environmentOk},'noConnections',${noConnections})`;
}
const catalogSettings = 'SET LOCAL search_path=pg_catalog,public,pg_temp;\nSET LOCAL quote_all_identifiers=off;\nSET LOCAL standard_conforming_strings=on;';
const readerStart = 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n' + catalogSettings;
function readerSql(scope, installXid) {
  return `${readerStart}
SELECT jsonb_build_object('state',${projection(scope)},'backend',${backendSql},
 'readOnly',current_setting('transaction_read_only')='on','isolation',current_setting('transaction_isolation'),
 'writeXid',pg_current_xact_id_if_assigned()::text,'commitStatus',${installXid ? `pg_xact_status(${quote(installXid)}::xid8)` : 'NULL::text'});
ROLLBACK;`;
}

function writerSql(scope, before, verifiers) {
  const projectionSql = projection(scope);
  const changes = scope.targets.map((r, index) => `ALTER ROLE "${r.name}" PASSWORD ${quote(verifiers[index])}${index === 0 ? ' CONNECTION LIMIT 4' : ''};`).join('\n');
  const expected = scope.targets.map((r, index) => ({ oid:r.oid, limit:index===0?4:1, hash:hash(verifiers[index]) }));
  const targets = expected.map(r => quote(r.oid)).join(',');
  const baseline = { ...before.state };
  delete baseline.roles;
  return `${writerSetup}
BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE;
${catalogSettings}
SET LOCAL password_encryption='scram-sha-256';
LOCK TABLE pg_catalog.pg_authid IN SHARE ROW EXCLUSIVE MODE NOWAIT;
LOCK TABLE public._prisma_migrations, ${BINDINGS.map(table => 'public.' + table).join(', ')} IN SHARE MODE NOWAIT;
DO $login_guard$
BEGIN
 IF (${projectionSql}) IS DISTINCT FROM ${json(before.state)} OR NOT (${loggingOk})
    OR current_setting('transaction_isolation') <> 'serializable' OR current_setting('transaction_read_only') <> 'off' THEN
   RAISE EXCEPTION 'CURRENT259_CONTRACT_LOGIN_PREIMAGE';
 END IF;
END
$login_guard$;
${changes}
DO $login_guard$
DECLARE after_state jsonb;
BEGIN
 after_state := ${projectionSql};
 IF (after_state - 'roles') IS DISTINCT FROM ${json(baseline)}
    OR EXISTS(SELECT 1 FROM jsonb_to_recordset(${json(expected)}) e(oid text,"limit" int,hash text)
      WHERE NOT EXISTS(SELECT 1 FROM pg_authid r WHERE r.oid::text=e.oid AND r.rolconnlimit=e."limit"
        AND r.xmin::text::numeric=mod(pg_current_xact_id()::text::numeric,4294967296)
        AND ${digest('r.rolpassword')}=e.hash))
    OR (SELECT jsonb_agg(role ORDER BY pos) FROM jsonb_array_elements(after_state->'roles') WITH ORDINALITY x(role,pos)
        WHERE role->>'oid' NOT IN (${targets})) IS DISTINCT FROM ${json(before.state.roles.filter(r => !scope.targets.some(t => t.oid===r.oid)))}
    OR (SELECT jsonb_agg(role - 'limit' - 'password' - 'xmin' - 'verifierSha256' ORDER BY pos)
        FROM jsonb_array_elements(after_state->'roles') WITH ORDINALITY x(role,pos)
        WHERE role->>'oid' IN (${targets})) IS DISTINCT FROM ${json(before.state.roles.filter(r => scope.targets.some(t => t.oid===r.oid)).map(stripTargetChanges))} THEN
   RAISE EXCEPTION 'CURRENT259_CONTRACT_LOGIN_POSTIMAGE';
 END IF;
END
$login_guard$;
SELECT jsonb_build_object('state',${projectionSql},'backend',${backendSql},
 'readOnly',false,'isolation',current_setting('transaction_isolation'),'writeXid',pg_current_xact_id()::text,'commitStatus',NULL::text);
COMMIT;`;
}

function stripTargetChanges(role) {
  const { limit, password, xmin, verifierSha256, ...identity } = role;
  return identity;
}
function parse(stdout) {
  need(typeof stdout === 'string' && Buffer.byteLength(stdout) <= 128 * 1024, 'OUTPUT');
  try { return JSON.parse(stdout); } catch { throw fail('OUTPUT'); }
}
function scopeOf(prior, view, completion) {
  const { source, archiveCompletion: archive, roleCompletion: role } = prior;
  const identity = role.databaseIdentity;
  need(prior.completion === completion && completion.status === 'CURRENT259_ORDINARY_ARCHIVE_ACL_COMMITTED_NOT_ADMISSION' &&
    completion.executionAllowed === false && completion.nativeAdmission === false && completion.sourceSha === source.candidateSha &&
    completion.runId === view.runId && completion.containerId === view.resource.containerId && equal(view.source, source) &&
    role.status === 'CURRENT259_ROLES_PROVISIONED_NOT_ADMISSION' && archive.status === 'CURRENT259_ARCHIVE_AUTHORITIES_INSTALLED' &&
    archive.registeredFileSource === true && archive.executionAllowed === false && archive.nativeAdmission === false &&
    [role, archive].every(r => r.sourceSha === completion.sourceSha && r.runId === completion.runId && r.containerId === completion.containerId) &&
    archive.installXid === completion.archiveInstallXid && [role.commitXid, archive.installXid, completion.installXid].every(xid) &&
    new Set([role.commitXid, archive.installXid, completion.installXid]).size === 3 &&
    [completion.catalogSha256, completion.protectedSha256, completion.requirementsSha256, archive.bindingSha256].every(sha) &&
    [prior.catalogSql, prior.protectedSql].every(value => typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 256 * 1024) &&
    identity.database === view.resource.databaseName && identity.actor === OWNER && identity.sessionActor === OWNER &&
    identity.ownerOid === '10' && identity.actorOid === '10' && identity.tls === true &&
    identity.clientAddress === '127.0.0.1' && identity.serverAddress === '127.0.0.1' && identity.serverPort === 5432 &&
    oid(identity.databaseOid) && oid(identity.namespaceOid) && /^jg_task01_[a-f0-9]{32}$/u.test(identity.database) &&
    /^jg_fixture_app_[a-f0-9]{24}$/u.test(role.ordinary.name) && Array.isArray(role.roles) && role.roles.length === 9 &&
    [role.ordinary, ...role.roles].every(r => oid(r.oid)) && new Set([role.ordinary, ...role.roles].map(r => r.oid)).size === 10 &&
    role.roles.every(r => r.xmin === xid32(role.commitXid)), 'HANDLE');
  const targets = [role.ordinary, ...LOGIN_NAMES.map(name => role.roles.find(r => r.name === name))];
  need(targets.every(r => r && r.login === true && r.password === 'absent') &&
    targets.every((r,i) => r.limit === Number(i !== 0)), 'HANDLE');
  return { prior, role, archive, identity, targets };
}
function checkState(row, scope, phase, installXid = null) {
  const { prior, role, archive, identity } = scope;
  const { state } = row ?? {};
  need(row?.backend && backend(row.backend.pid,row.backend.start) && state &&
    row.readOnly === (phase !== 'WRITE') && row.isolation === (phase === 'WRITE' ? 'serializable' : 'repeatable read') &&
    (phase === 'WRITE' ? xid(row.writeXid) : row.writeXid === null) && row.commitStatus === (installXid ? 'committed' : null) &&
    equal(state.identity, identity) && state.catalogSha256 === prior.completion.catalogSha256 &&
    state.protectedSha256 === prior.completion.protectedSha256 && state.bindingSha256 === archive.bindingSha256 &&
    equal(state.archiveXmins, BINDINGS.map(() => xid32(archive.installXid))) &&
    equal(state.databaseAcl, role.databaseAcl.after) && state.managedRoleSafe === true &&
    ['rawDatabaseSha256','otherAuthSha256','membershipsSha256','settingsSha256'].every(key => sha(state[key])) &&
    state.originCommitted === true && state.noConnections === true && state.environmentOk === true &&
    Array.isArray(state.limits) && state.limits.length === 3 && state.limits.every(v => Number.isInteger(v) && v >= 0) &&
    state.limits[0] === 16 && 13 <= state.limits[0] && 9 <= state.limits[0] - state.limits[1] - state.limits[2] &&
    equal(state.roleSettings,[{oid:role.roles.find(r=>r.name==='jg_task01_observer')?.oid,database:'0',config:['default_transaction_read_only=on']}]),
    phase);
  return state;
}
const stateWithoutRoles = ({ roles, ...state }) => state;
function checkBefore(row, scope) {
  const state = checkState(row, scope, 'BEFORE');
  const expected = [scope.role.ordinary, ...scope.role.roles].map(r => ({ ...r, verifierSha256:null }));
  const ordinary = state.roles?.find?.(r => r.name === scope.role.ordinary.name);
  need(ordinary && oid(ordinary.xmin), 'BEFORE');
  expected[0].xmin = ordinary.xmin;
  expected.sort((a,b) => a.name < b.name ? -1 : 1);
  need(equal(state.roles,expected), 'BEFORE');
}
function checkWritten(row, before, scope, verifiers) {
  const state = checkState(row, scope, 'WRITE');
  const expected = before.state.roles.map(role => {
    const index = scope.targets.findIndex(target => target.oid === role.oid);
    return index < 0 ? role : { ...role, limit:index===0?4:1, password:'scram', xmin:xid32(row.writeXid), verifierSha256:hash(verifiers[index]) };
  });
  need(distinct(row.backend,before.backend) && equal(state.roles,expected) &&
    equal(stateWithoutRoles(state),stateWithoutRoles(before.state)), 'WRITE');
}

function claimCurrent259ContractLogin(proof, handle) {
  need(arguments.length===2 && proof && !types.isProxy(proof) && PROOFS.has(proof), 'HANDLE');
  const record = PROOFS.get(proof);
  need(record.handle === handle, 'HANDLE');
  PROOFS.delete(proof);
  record.check();
  // The future fixed factory must continue inside this lifetime. The claim
  // intentionally carries no URL, password, client constructor or SQL method.
  return Object.freeze({ completion:proof, source:record.source, check:record.check });
}

function withCurrent259FirstQ2Application(proof, handle) {
  try{
    need(arguments.length===2 && proof && !types.isProxy(proof) && PROOFS.has(proof),'HANDLE');
    const record=PROOFS.get(proof);
    need(record.handle===handle,'HANDLE');
    PROOFS.delete(proof);
    record.check();
    return record.openApplication();
  }catch(error){return Promise.reject(error);}
}

function withCurrent259FirstQ2NativeApplication(proof,handle,permit) {
  try{
    need(arguments.length===3 && proof && !types.isProxy(proof) && PROOFS.has(proof),'HANDLE');
    const record=PROOFS.get(proof);
    need(record.handle===handle && record.fixture,'HANDLE');
    PROOFS.delete(proof);
    record.check();
    const {claimCurrent259FirstQ2ApplicationPermit}=require('./task12-current259-first-q2-once.cjs');
    const native=claimCurrent259FirstQ2ApplicationPermit(permit,proof,handle,record.fixture);
    need(native.fixture===record.fixture,'HANDLE');
    return record.openApplication(native);
  }catch(error){return Promise.reject(error);}
}

function takeCurrent259FirstQ2Bridge(bridge) {
  need(arguments.length===1 && APP_BRIDGES.delete(bridge),'HANDLE');
}

const hostSql = `SELECT pg_catalog.current_database()::text AS database,a.datid::text AS "databaseOid",
 current_user::text AS role,session_user::text AS "sessionRole",a.usesysid::text AS oid,a.pid,${stamp('a.backend_start')} AS start,
 s.ssl AS tls,pg_catalog.host(pg_catalog.inet_client_addr()) AS "clientAddress",pg_catalog.inet_client_port() AS "clientPort",
 pg_catalog.host(pg_catalog.inet_server_addr()) AS "serverAddress",pg_catalog.inet_server_port() AS "serverPort",$1::text AS challenge
 FROM pg_catalog.pg_stat_activity a JOIN pg_catalog.pg_stat_ssl s ON s.pid=a.pid WHERE a.pid=pg_catalog.pg_backend_pid()`;
function liveSql(row, challenge) {
  return `${readerStart}
SELECT jsonb_build_object('identity',${ownerIdentitySql},'reader',${backendSql},
 'session',(SELECT jsonb_build_object('database',a.datname,'databaseOid',a.datid::text,
 'role',a.usename,'oid',a.usesysid::text,'pid',a.pid,'start',${stamp('a.backend_start')},
 'tls',s.ssl,'clientAddress',host(a.client_addr),'clientPort',a.client_port)
 FROM pg_stat_activity a JOIN pg_stat_ssl s ON s.pid=a.pid
 WHERE a.backend_type='client backend' AND a.pid=${row.pid} AND ${stamp('a.backend_start')}=${quote(row.start)}),
 'challenge',${quote(challenge)});
ROLLBACK;`;
}
function relayEndpointEvidence(endpoint,resource,getReceipt) {
  const row=getReceipt.call(resource),relay=row?.relay;
  need(row?.topology===CURRENT259_FIRST_Q2_TRANSPORT && row.containerId===resource.containerId &&
    row.networkId===resource.networkId && row.databaseName===resource.databaseName &&
    relay && typeof relay.id==='string' && relayIdShape.test(relay.id) &&
    relay.id===endpoint.relayId && relay.containerId===resource.containerId &&
    relay.host==='127.0.0.1' && relay.port===resource.port,'PHYSICAL_ENDPOINT');
}
function qualifyEndpoint(endpoint,resource,getReceipt) {
  need(endpoint && !types.isProxy(endpoint) && endpoint.containerId===resource.containerId &&
    endpoint.networkId===resource.networkId && endpoint.databaseName===resource.databaseName &&
    Number.isInteger(resource.port) && resource.port>1024 && resource.port<=65535 && endpoint.serverPort===5432,'PHYSICAL_ENDPOINT');
  if(resource.topology===CURRENT259_FIRST_Q2_TRANSPORT){
    need(endpoint.transport===CURRENT259_FIRST_Q2_TRANSPORT && endpoint.host==='127.0.0.1' &&
      endpoint.port===resource.port && endpoint.serverAddress==='127.0.0.1' &&
      !Object.hasOwn(endpoint,'publishedHost') && !Object.hasOwn(endpoint,'publishedPort'),'PHYSICAL_ENDPOINT');
    const check=()=>relayEndpointEvidence(endpoint,resource,getReceipt);
    check();
    return check;
  }
  need(resource.topology===LEGACY_TRANSPORT && !Object.hasOwn(endpoint,'transport') &&
    endpoint.publishedHost==='127.0.0.1' && endpoint.publishedPort===resource.port &&
    privateIPv4(endpoint.serverAddress),'PHYSICAL_ENDPOINT');
  return undefined;
}
function clientIdentity(rows, challenge, scope, role, endpoint) {
  const row = Array.isArray(rows) && rows.length===1 && rows[0];
  need(row && row.challenge===challenge && row.database===scope.identity.database && row.databaseOid===scope.identity.databaseOid &&
    row.role===role.name && row.sessionRole===role.name && row.oid===role.oid && backend(row.pid,row.start) && row.tls===true &&
    (endpoint.transport===CURRENT259_FIRST_Q2_TRANSPORT ? row.clientAddress==='127.0.0.1'
      : privateIPv4(row.clientAddress) && row.clientAddress!==endpoint.serverAddress) && Number.isInteger(row.clientPort) && row.clientPort>0 && row.clientPort<=65535 &&
    row.serverAddress===endpoint.serverAddress && row.serverPort===endpoint.serverPort, 'TLS_IDENTITY');
  return row;
}
function engineError(error) {
  if (!error || typeof error!=='object' || types.isProxy(error)) return {};
  const message=Object.getOwnPropertyDescriptor(error,'message')?.value;
  return {
    code:Object.getOwnPropertyDescriptor(error,'errorCode')?.value ?? Object.getOwnPropertyDescriptor(error,'code')?.value,
    certificateMarker:typeof message==='string' && message.toLowerCase().includes('tls connection') &&
      message.toLowerCase().includes('certificate was not trusted'),
  };
}
function expectedTlsRejection(kind,error) {
  const observed=engineError(error);
  const expected={password:'P1000',ca:'P1011',plaintext:'P1010'}[kind];
  return observed.code===expected&&(kind!=='ca'||observed.certificateMarker);
}
async function bounded(operation, phase, context) {
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{
      timer=setTimeout(()=>{context.cleanup='UNKNOWN';reject(fail(phase));},15000);
    })]);
  } finally { clearTimeout(timer); }
}
function getCa(resource) {
  return [resource.caPath,resource.wrongCaPath].map((file,index)=>{
    const data=readFile(file,{privateFile:false,maxBytes:1024*1024,code:'CURRENT259_CONTRACT_LOGIN_CA'});
    need(data.identity.uid===process.getuid() &&
      data.sha256===resource.serverCertHashes[index?'wrongCaSha256':'caSha256'],'CA');
    return Object.freeze({file,identity:data.identity,sha256:data.sha256});
  });
}
function verifyCa(cas) {
  for(const ca of cas){
    const data=readFile(ca.file,{privateFile:false,maxBytes:1024*1024,expectedIdentity:ca.identity,code:'CURRENT259_CONTRACT_LOGIN_CA'});
    need(data.identity.uid===process.getuid() && data.sha256===ca.sha256,'CA');
  }
}

async function readLiveClient(context, client, query, role, endpoint, check) {
  const inspect=async()=>{
    const challenge=randomBytes(32).toString('hex');
    const sql=context.identityQualification?hostSql.replace(' s.ssl AS tls,',
      " current_setting('transaction_read_only') = 'on' AS readonly,s.ssl AS tls,"):hostSql;
    let rows=await bounded(()=>query.call(client,sql,challenge),'QUERY_TIMEOUT',context);
    if(context.identityQualification){
      need(Array.isArray(rows)&&rows.length===1&&rows[0].readonly===true,'TLS_IDENTITY');
      const {readonly,...row}=rows[0];rows=[row];
    }
    check();
    return clientIdentity(rows,challenge,context.scope,role,endpoint);
  };
  const first=await inspect();
  const challenge=randomBytes(32).toString('hex');
  const observed=await context.run(liveSql(first,challenge),'tls-live');
  const { challenge:ignored,sessionRole,serverAddress,serverPort,...session }=first;
  need(observed.challenge===challenge && equal(observed.identity,context.scope.identity) && observed.reader &&
    backend(observed.reader.pid,observed.reader.start) && distinct(observed.reader,first) &&
    equal(observed.session,session),'TLS_LIVE');
  const { challenge:next,...nextIdentity }=await inspect();
  const { challenge:previous,...firstIdentity }=first;
  need(equal(nextIdentity,firstIdentity)&&(!context.identityQualification||next!==previous),'TLS_SESSION_CHANGED');
  return Object.freeze({name:role.name,oid:role.oid,pid:first.pid,start:first.start});
}

async function verifyTls(context) {
  const { check, run, resource, Class, methods, scope, secrets, diagnostic, beginNegativeDrain }=context;
  diagnostic?.enter('TLS_CA_FILES');
  const cas=getCa(resource);
  const full=()=>{ check(); verifyCa(cas); context.checkTransport?.(); };
  diagnostic?.enter('TLS_ENDPOINT');
  const endpoint=await methods.inspectConnectionEndpoint.call(resource);
  full();
  context.checkTransport=qualifyEndpoint(endpoint,resource,methods.getReceipt);
  diagnostic?.enter('TLS_CERTIFICATE');
  const certificate=await methods.observePresentedCertificate.call(resource,'correct');
  full();
  need(certificate.mode==='correct' && certificate.derSha256===resource.serverCertHashes.correctCertificateDerSha256,'CERTIFICATE');
  context.cas=cas;
  context.endpoint=endpoint;
  const accepted=[];
  async function probe(index, kind) {
    const probeName={ca:'WRONG_CA',password:'WRONG_PASSWORD',plaintext:'PLAINTEXT',positive:'POSITIVE'}[kind];
    const enter=step=>diagnostic?.enter('TLS_'+probeName+'_'+step,index);
    enter('CONSTRUCT');
    full();
    const role=scope.targets[index];
    const secret=kind==='password'?randomBytes(48).toString('hex'):secrets[index];
    const url=new URL(`postgresql://${role.name}:${secret}@127.0.0.1:${resource.port}/${resource.databaseName}`);
    for(const [key,value] of Object.entries({schema:'public',connection_limit:'1',sslmode:kind==='plaintext'?'disable':'require',
      sslaccept:'strict',sslcert:cas[kind==='ca'?1:0].file,application_name:'jg_394_contract_tls',connect_timeout:'5',pool_timeout:'5'})) {
      url.searchParams.set(key,value);
    }
    if(kind==='positive'&&context.identityQualification)url.searchParams.set('options','-c default_transaction_read_only=on');
    let client;
    try { client=new Class({datasources:{db:{url:url.toString()}},log:[]}); }
    catch { context.cleanup='UNKNOWN'; throw fail('CONSTRUCT_UNKNOWN'); }
    let disconnect, primary, result, connectionError, hasPrimary=false,identityWindow;
    try {
      disconnect=client.$disconnect;
      const clientMethods=Object.fromEntries(CLIENT_METHODS.map(key=>[key,key==='$disconnect'?disconnect:client[key]]));
      need(typeof client.then!=='function' && CLIENT_METHODS.every(key=>typeof clientMethods[key]==='function'),'CLIENT');
      const clientCheck=()=>{
        full();
        need(CLIENT_METHODS.every(key=>client[key]===clientMethods[key]),'CLIENT_CHANGED');
      };
      enter('CONNECT');
      clientCheck();
      const drain=kind!=='positive'?beginNegativeDrain?.():undefined;
      if(kind==='positive'&&context.identityQualification)
        identityWindow=context.identityLease.begin(index,role.name);
      let rejected=false;
      try { await bounded(()=>clientMethods.$connect.call(client),'CONNECT_TIMEOUT',context); }
      catch (error) {
        if (ownFaults.has(error)) throw error;
        connectionError=error; rejected=true;
      }
      let expectedNegative;
      if(drain&&rejected){
        expectedNegative=expectedTlsRejection(kind,connectionError);
        if(expectedNegative){
          // Give the exact rejected peer's relay worker time to consume its FIN
          // before the synchronous source and ownership checks run again.
          enter('DRAIN');
          await drain();
          enter('CONTINUITY');
        }
      }
      if(kind==='positive'&&!rejected)enter('CONTINUITY');
      clientCheck();
      if (kind!=='positive') {
        need(rejected&&(expectedNegative??expectedTlsRejection(kind,connectionError)),'TLS_NEGATIVE');
      } else {
        need(!rejected,'TLS_CONNECT');
        enter('IDENTITY');
        result=await readLiveClient(context,client,clientMethods.$queryRawUnsafe,role,endpoint,clientCheck);
        need(accepted.every(item=>distinct(item,result)),'TLS_SESSION_CHANGED');
        if(identityWindow)identityWindow.markDisconnect(result.pid,result.start);
      }
    } catch(error) {
      primary=error; hasPrimary=true;
      const reason=ownFaults.get(error);
      diagnostic?.capture(error,reason,reason==='TLS_NEGATIVE'||reason==='TLS_CONNECT'?connectionError??error:error);
    }
    enter('DISCONNECT');
    try {
      need(typeof disconnect==='function','DISCONNECT_UNKNOWN');
      await bounded(()=>disconnect.call(client),'DISCONNECT_UNKNOWN',context);
    } catch(error) {
      context.cleanup='UNKNOWN';
      if (!hasPrimary) {
        primary=fail('DISCONNECT_UNKNOWN'); hasPrimary=true;
        diagnostic?.capture(primary,'DISCONNECT_UNKNOWN',error);
      }
    }
    if (hasPrimary) throw primary;
    if(identityWindow){
      enter('DRAIN');
      const closeKind=await identityWindow.finish();
      need(closeKind==='REAL_FIN'||closeKind==='CLOSED_BY_RESET','TLS_IDENTITY');
    }
    full();
    if (result) accepted.push(Object.freeze(result));
  }
  await probe(0,'ca');
  await probe(0,'password');
  diagnostic?.enter('TLS_PLAINTEXT_WINDOW');
  full();
  await methods.beginCurrent259ContractPlaintextProbe.call(resource);
  full();
  await probe(0,'plaintext');
  diagnostic?.enter('TLS_PLAINTEXT_EVIDENCE');
  const rejected = await methods.verifyCurrent259ContractPlaintextRejection.call(resource);
  full();
  need(rejected===true,'TLS_PLAINTEXT_HBA');
  if(context.identityQualification)context.identityLease=context.beginIdentityQualification();
  for (let index=0; index<scope.targets.length; index++) await probe(index,'positive');
  if(context.identityQualification)context.identityClosures=context.identityLease.finish();
  return Object.freeze(accepted);
}

// The full loader verified this exact live cache immediately before capture.
function captureHttpFiles(cache) {
  const fields=['dev','ino','mode','uid','gid','size','mtimeNs','ctimeNs'];
  const identify=file=>{
    const stat=fs.lstatSync(file,{bigint:true});
    need(stat.isFile()&&!stat.isSymbolicLink(),'APP_CONTINUITY');
    return fields.map(key=>stat[key]);
  };
  const files=Object.keys(cache).map(file=>{
    const module=own(cache,file);
    need(module.filename===file&&module.loaded===true,'APP_CONTINUITY');
    return {file,module,exports:own(module,'exports'),children:module.children.slice(),identity:identify(file)};
  });
  return verifyFiles=>{
    need(require.cache===cache&&Object.keys(cache).length===files.length,'APP_CONTINUITY');
    for(const row of files){
      const module=own(cache,row.file);
      need(module===row.module&&own(module,'exports')===row.exports&&module.loaded===true&&
        module.children.length===row.children.length&&row.children.every((child,i)=>module.children[i]===child),'APP_CONTINUITY');
      if(verifyFiles)need(equal(identify(row.file),row.identity),'APP_CONTINUITY');
    }
  };
}

function openContractApplication(context, loader, originalSessions, verifyCommitted, native, generated) {
  const {diagnostic}=context;
  diagnostic?.enter('APP_IMPORT');
  context.check();verifyCa(context.cas);
  const assemblyPath=require.resolve('./task12-current259-contract-application.cjs');
  const cache=require.cache;
  need(!Object.getOwnPropertyDescriptor(cache,assemblyPath),'APP_IMPORT');
  const assembly=require('./task12-current259-contract-application.cjs');
  const entry=Object.getOwnPropertyDescriptor(cache,assemblyPath)?.value;
  const run=own(assembly,'runCurrent259FirstQ2Application');
  need(entry && typeof run==='function' && Object.isFrozen(assembly),'APP_IMPORT');
  const load=own(loader,'loadContractApplicationModules');
  const create=own(loader,'createContractTestingModule');
  let verifyHttpFiles;
  const check=()=>{
    if(verifyHttpFiles){context.checkLifetime();verifyHttpFiles(false);}
    else context.check();
    verifyCa(context.cas);context.checkTransport?.();
    if(native){native.check();native.cos.check();}
    need(require.cache===cache && Object.getOwnPropertyDescriptor(cache,assemblyPath)?.value===entry &&
      own(entry,'exports')===assembly && own(assembly,'runCurrent259FirstQ2Application')===run &&
      own(loader,'loadContractApplicationModules')===load && own(loader,'createContractTestingModule')===create,'APP_IMPORT');
  };
  check();
  diagnostic?.enter('APP_MODULES');
  const loaded=load.call(loader);
  const tokens=['PrismaService','ContractDirectArchiveRuntime','ContractUpwardDirectArchiveRuntime'];
  const [PrismaService, Outside, Upward]=tokens.map(key=>own(loaded,key));
  const clients=[], operations=[];
  const remember=client=>{
    need(client,'APP_CLIENTS');
    clients.push(client);
    const captured=Object.fromEntries(CLIENT_METHODS.map(key=>[key,client[key]]));
    operations.push(captured);
    need(CLIENT_METHODS.every(key=>typeof captured[key]==='function'),'APP_CLIENTS');
  };
  let providers, constructed=false;
  const httpContinuity={
    beginHttp(){
      need(!verifyHttpFiles,'APP_CONTINUITY');
      check();
      verifyHttpFiles=captureHttpFiles(cache);
      check();
    },
    checkHttpFiles(){check();need(verifyHttpFiles,'APP_CONTINUITY');verifyHttpFiles(true);},
    endHttp(success){
      if(success){check();verifyHttpFiles(true);}
      verifyHttpFiles=undefined;
      if(success)check();
    },
  };
  const nativeBridge=native?Object.freeze({
    check,signal:native.signal,fixture:native.fixture,cos:native.cos,
    storageEnvironment(){check();return native.cos.environment();},...httpContinuity,
    async observeUpload(input){
      check();
      const readback=createCurrent259FirstQ2UploadReadback(native.fixture,context.scope.identity,native.cosPlan.bucket,input);
      const raw=await context.runSql(readback.sql,'q2-upload',check);
      check();
      return readback.finish(raw);
    },
    async observeArchive(input){
      check();
      const readback=createCurrent259FirstQ2ArchiveReadback(native.fixture,context.scope.identity,input);
      const raw=await context.runSql(readback.sql,'q2-archive',check);
      check();
      return readback.finish(raw);
    },
  }):undefined;
  const bridge=Object.freeze({
    check, loaded, caPath:context.cas[0].file,...(nativeBridge?{native:nativeBridge}:{}),
    ...(diagnostic?{diagnostic}:{}),
    ...(generated?{generated:Object.freeze({check,...httpContinuity,projectId:generated.fixture.project.id,seed:generated.seed,
      openDraft(send){check();return generated.openDraft(generated.fixture,generated.password,send);},
    })}:{}),
    createTestingModule(){check();return create.call(loader);},
    constructProviders(){
      check();need(!constructed,'APP_CONSTRUCT');constructed=true;
      const env=process.env;
      need(!types.isProxy(env),'APP_ENV');
      const saved=APP_DSN_KEYS.map(key=>Object.getOwnPropertyDescriptor(env,key));
      need(saved.every(value=>value===undefined),'APP_ENV');
      const urls=context.scope.targets.map((role,index)=>{
        const url=new URL(`postgresql://${role.name}:${context.secrets[index]}@127.0.0.1:${context.resource.port}/${context.resource.databaseName}`);
        for(const [key,value] of Object.entries({schema:'public',connection_limit:index===0?'4':'1',sslmode:'require',
          sslaccept:'strict',sslcert:context.cas[0].file,application_name:'jg_394_contract_app',connect_timeout:'5',pool_timeout:'5'}))url.searchParams.set(key,value);
        return url.toString();
      });
      try {
        APP_DSN_KEYS.forEach((key,index)=>{env[key]=urls[index];});
        const ordinary=new PrismaService({datasources:{db:{url:urls[0]}},log:[]});
        remember(ordinary);
        const outside=new Outside();
        remember(own(outside,'issuer'));remember(own(outside,'executor'));
        const upward=new Upward();
        remember(own(upward,'issuer'));remember(own(upward,'executor'));
        need(new Set(clients).size===5,'APP_CLIENTS');
        providers=Object.freeze([ordinary,outside,upward]);
      } catch(error) {
        context.cleanup='UNKNOWN';
        if(ownFaults.has(error))throw error;
        throw fail('APP_CONSTRUCT');
      } finally {
        try{
          APP_DSN_KEYS.forEach((key,index)=>{
            if(saved[index])Object.defineProperty(env,key,saved[index]);else delete env[key];
          });
        }finally{urls.fill(null);}
      }
      need(process.env===env && APP_DSN_KEYS.every(key=>Object.getOwnPropertyDescriptor(env,key)===undefined),'APP_ENV');
      check();return providers;
    },
    async verifyProviders(){
      check();need(providers && clients.length===5,'APP_CLIENTS');
      const observed=[];
      for(const [index,client] of clients.entries()){
        diagnostic?.enter('APP_PROVIDER_CONNECT',index);
        const methods=operations[index];
        const clientCheck=()=>{
          check();need(CLIENT_METHODS.every(key=>typeof methods[key]==='function' && methods[key]===client[key]),'APP_CLIENTS');
          need([providers[0],providers[1].issuer,providers[1].executor,providers[2].issuer,providers[2].executor].every((value,i)=>value===clients[i]),'APP_CLIENTS');
        };
        clientCheck();await bounded(()=>methods.$connect.call(client),'CONNECT_TIMEOUT',context);clientCheck();
        diagnostic?.enter('APP_PROVIDER_IDENTITY',index);
        const session=await readLiveClient(context,client,methods.$queryRawUnsafe,context.scope.targets[index],context.endpoint,clientCheck);
        need([...originalSessions,...observed].every(item=>distinct(item,session)),'TLS_SESSION_CHANGED');
        observed.push(session);
      }
      return observed.length;
    },
    async verifyClosed(){
      const reader=await verifyCommitted('application-closed');
      need(originalSessions.every(row=>distinct(row,reader)),'COMMITTED');
    },
    async disconnectUnowned(){
      const results=await Promise.allSettled(clients.map((client,index)=>
        bounded(()=>operations[index].$disconnect.call(client),'DISCONNECT_UNKNOWN',context)));
      need(results.every(result=>result.status==='fulfilled'),'DISCONNECT_UNKNOWN');
    },
  });
  check();APP_BRIDGES.add(bridge);
  return run(bridge);
}

async function withCurrent259ContractLogin(completion, handle, use) {
  need(arguments.length===3,'HANDLE');
  return contractLogin(completion,handle,use);
}

async function withCurrent259FirstQ2SeededLogin(completion, handle, fixture, use) {
  need(arguments.length===4 && isCurrent259FirstQ2Fixture(fixture),'HANDLE');
  return contractLogin(completion,handle,use,fixture);
}

async function withCurrent259GeneratedDraftAdmission(completion,handle,caseId) {
  need(arguments.length===3 && typeof caseId==='string' && relayIdShape.test(caseId),'HANDLE');
  return generatedAdmission(completion,handle,caseId);
}
async function withCurrent261GeneratedDraftIdentityAdmission(completion,handle,caseId,permit) {
  need(arguments.length===4&&typeof caseId==='string'&&relayIdShape.test(caseId)&&permit,'HANDLE');
  return generatedAdmission(completion,handle,caseId,{permit,profile:'TASK12_DRAFT261_TLS_IDENTITY_V2',caseId});
}
async function withCurrent261UpwardIdentitySeededLogin(completion,handle,fixture,caseId,permit,use) {
  need(arguments.length===6&&permit&&typeof use==='function'&&!types.isProxy(use)&&isCurrent259FirstQ2Fixture(fixture)&&fixture.relationship===undefined&&
    relayIdShape.test(caseId)&&fixture.seed.Project.code==='Q2-'+caseId,'HANDLE');
  return contractLogin(completion,handle,async proof=>{
    const result=await use(proof);
    return Object.freeze({...result,identityQualification:proof.identityQualification});
  },fixture,undefined,{permit,profile:'TASK12_UPWARD_Q2_TLS_IDENTITY_V2',caseId});
}
async function generatedAdmission(completion,handle,caseId,qualification) {
  return contractLogin(completion,handle,async proof=>{
    const record=PROOFS.get(proof);
    need(record?.handle===handle&&record.generated,'HANDLE');
    PROOFS.delete(proof);record.check();
    const result=await record.openApplication(undefined,record.generated);
    need(result?.status==='CURRENT259_GENERATED_DRAFT_PROTOCOL_AND_NEST_CLOSED'&&result.nativeAdmission===false,'APP_IMPORT');
    return qualification?Object.freeze({...result,identityQualification:proof.identityQualification}):result;
  },undefined,caseId,qualification);
}

async function contractLogin(completion, handle, use, fixture, generatedCaseId, identityQualification) {
  need(typeof use==='function' && !types.isProxy(use) &&
    completion && !types.isProxy(completion) && Object.isFrozen(completion) && handle && !types.isProxy(handle),'HANDLE');
  checkAclImport();
  let prior;
  try { prior=claimAcl(completion,handle); }
  catch { throw fail('HANDLE'); }
  let phase='BEFORE', proof, active=true, context, secrets, verifiers, roleCommit='NOT_ATTEMPTED';
  let application, applicationFailure, seedCommit='NOT_ATTEMPTED';
  let generated;
  const diagnostic=generatedCaseId?createGeneratedDraftAdmissionDiagnostic():undefined;
  try {
    const view=claimCurrent259TechnicalResource(handle);
    need(!USED.has(handle),'HANDLE');
    USED.add(handle);
    const { resource, loader }=view;
    need(resource.topology===CURRENT259_FIRST_Q2_TRANSPORT ||
      (!generatedCaseId&&resource.topology===LEGACY_TRANSPORT),'PHYSICAL_ENDPOINT');
    const Class=own(loader,'Class');
    const methods=Object.fromEntries(METHODS.map(key=>[key,own(resource,key)]));
    need(typeof Class==='function' && METHODS.every(key=>typeof methods[key]==='function'),'METHOD');
    const check=()=>{
      need(active,'CLOSED');
      checkAclImport();
      prior.check();
      view.verifyFull();
      need(claimCurrent259TechnicalResource(handle)===view && view.loader===loader && own(loader,'Class')===Class &&
        METHODS.every(key=>own(resource,key)===methods[key]),'METHOD');
    };
    const checkLifetime=()=>{
      need(active,'CLOSED');
      checkAclImport();
      view.checkLifetime();
      need(view.loader===loader&&own(loader,'Class')===Class&&METHODS.every(key=>own(resource,key)===methods[key]),'METHOD');
    };
    check();
    need(Boolean(generatedCaseId)===(prior.generatedDraft===true),'ACL_PROFILE');
    if(identityQualification)need(prior.source.profile?.ledgerSha256===require('./task16-current259-profile.cjs').PAYMENT261_LEDGER_SHA256&&
      (generatedCaseId?identityQualification.profile==='TASK12_DRAFT261_TLS_IDENTITY_V2':
        identityQualification.profile==='TASK12_UPWARD_Q2_TLS_IDENTITY_V2'&&fixture&&fixture.relationship===undefined),'ACL_PROFILE');
    const scope=scopeOf(prior,view,completion);
    const runSql=async(sql,label,continuity=check)=>{
      continuity();
      const output=await methods.execOwnerSql.call(resource,sql,'current259-contract-login-'+label);
      continuity();
      return output?.stdout;
    };
    const run=async(sql,label)=>parse(await runSql(sql,label));
    let before=await run(readerSql(scope),'before');
    checkBefore(before,scope);
    if(fixture||generatedCaseId){
      phase='SEED_BEFORE';
      diagnostic?.enter('SEED_FIXTURE');
      let seed;
      if(generatedCaseId){
        const entries=own(loader,'loadGeneratedContractDraftAdmission').call(loader);
        const input=own(entries,'buildTask12GeneratedApprovalFixture')(generatedCaseId);
        const password=randomBytes(32).toString('hex');
        const passwordHash=await own(entries,'hashTask12GeneratedAdmissionPassword')(password);
        check();
        generated={fixture:input,password,openDraft:own(entries,'openTask12GeneratedApprovalDraft')};
        seed=createCurrent259GeneratedDraftSeed(input,scope.identity,passwordHash);
      }else seed=createCurrent259FirstQ2Seed(fixture,scope.identity);
      diagnostic?.enter('SEED_BEFORE');
      seed.verifyBefore(await runSql(seed.beforeSql(),'seed-before'));
      phase='SEED_WRITE';
      diagnostic?.enter('SEED_WRITE');
      const sql=seed.writeSql();
      seedCommit='UNKNOWN';
      seed.verifyWritten(await runSql(sql,'seed-write'));
      phase='SEED_COMMITTED';
      diagnostic?.enter('SEED_COMMITTED');
      const seeded=seed.finish(await runSql(seed.committedSql(),'seed-committed'));
      seedCommit='COMMITTED';
      need(![scope.role.commitXid,scope.archive.installXid,completion.installXid].includes(seeded.seedXid),'SEED_COMMITTED');
      if(generated)generated.seed=seeded;
      phase='SEED_CONTINUITY';
      diagnostic?.enter('SEED_CONTINUITY');
      const after=await run(readerSql(scope),'before');
      checkBefore(after,scope);
      need(distinct(before.backend,after.backend) && equal(before.state,after.state),'SEED_CONTINUITY');
      before=after;
    }
    secrets=scope.targets.map(()=>randomBytes(48).toString('hex'));
    need(new Set(secrets).size===5,'SECRETS');
    verifiers=secrets.map(makeVerifier);
    phase='ROLE_COMMIT_UNCONFIRMED';
    diagnostic?.enter('ROLE_WRITE');
    roleCommit='UNKNOWN';
    const written=await run(writerSql(scope,before,verifiers),'write');
    checkWritten(written,before,scope,verifiers);
    const verifyCommitted=async label=>{
      const row=await run(readerSql(scope,written.writeXid),label);
      const state=checkState(row,scope,'COMMITTED',written.writeXid);
      need([before,written].every(old=>distinct(row.backend,old.backend)) && equal(state,written.state),'COMMITTED');
      return row.backend;
    };
    diagnostic?.enter('ROLE_COMMITTED');
    const committed=await verifyCommitted('committed');
    roleCommit='COMMITTED';
    phase='HBA';
    diagnostic?.enter('HBA_APPLY');
    const hba=await methods.applyCurrent259ContractHbaV1.call(resource);
    check();
    const hbaReceipt=methods.getReceipt.call(resource);
    const relay=resource.topology===CURRENT259_FIRST_Q2_TRANSPORT;
    need(hba && sha(hba.beforeSha256) && sha(hba.afterSha256) && hba.beforeSha256!==hba.afterSha256 &&
      hba.rules===(relay?14:22) && hbaReceipt.configuration.hbaSha256===hba.beforeSha256 &&
      (!relay || equal(hbaReceipt.contractHba,hba)),'HBA');
    diagnostic?.enter('HBA_COMMITTED');
    need(distinct(committed,await verifyCommitted('hba-committed')),'COMMITTED');
    phase='TLS';
    const upwardQ2=relay&&isCurrent259FirstQ2Fixture(fixture)&&fixture.relationship===undefined;
    const useNegativeDrain=Boolean(generatedCaseId)||upwardQ2;
    const beginRelayDrain=useNegativeDrain?own(view,'beginPrismaRelayDrain'):undefined;
    if(useNegativeDrain)need(typeof beginRelayDrain==='function','METHOD');
    const beginNegativeDrain=beginRelayDrain?()=>{
      need(own(view,'beginPrismaRelayDrain')===beginRelayDrain,'METHOD');
      const drain=beginRelayDrain.call(view);
      need(typeof drain==='function','METHOD');
      return drain;
    }:undefined;
    context={check,checkLifetime,run,runSql,resource,Class,methods,scope,secrets,diagnostic,beginNegativeDrain,
      ...(identityQualification?{identityQualification,beginIdentityQualification:()=>{
        const begin=own(view,'beginIdentityQualification');
        need(typeof begin==='function','METHOD');
        return begin.call(view,identityQualification.permit,scope.targets.map(role=>role.name));
      }}:{}),cleanup:'DISCONNECTED'};
    const sessions=await verifyTls(context);
    diagnostic?.enter('TLS_COMMITTED');
    const last=await verifyCommitted('tls-committed');
    need(distinct(committed,last) && sessions.every(row=>distinct(row,last)),'COMMITTED');
    check();
    proof=freeze({
      status:'CURRENT259_CONTRACT_FIVE_TLS_VERIFIED_NOT_ADMISSION',sourceSha:completion.sourceSha,runId:completion.runId,
      containerId:completion.containerId,databaseOid:scope.identity.databaseOid,roleInstallXid:written.writeXid,aclInstallXid:completion.installXid,
      hba:{beforeSha256:hba.beforeSha256,afterSha256:hba.afterSha256,rules:hba.rules},
      roles:scope.targets.map((role,index)=>({name:role.name,oid:role.oid,limit:index===0?4:1})),
      probes:{verified:5,negative:3,cleanup:'DISCONNECTED'},executionAllowed:false,nativeAdmission:false,
      ...(identityQualification?{identityQualification:{profile:identityQualification.profile,clients:context.identityClosures}}:{}),
    });
    // A downstream source stage can extend this private record with a fixed
    // credential bridge. No untrusted callback receives its contents.
    PROOFS.set(proof,{handle,source:prior.source,check,fixture,generated,openApplication(native,generatedDraft){
      application=Promise.resolve().then(()=>openContractApplication(context,loader,sessions,verifyCommitted,native,generatedDraft));
      void application.catch(error=>{applicationFailure=error;});
      return application;
    }});
    phase='CONSUMER';
    diagnostic?.enter('CONSUMER');
    let result,consumerFailure,consumerFailed=false;
    try{result=await use(proof);}catch(error){consumerFailed=true;consumerFailure=error;}
    if(application){
      try{await application;}catch(error){if(!consumerFailed)throw error;}
    }
    if(consumerFailed)throw consumerFailure;
    diagnostic?.enter('FINAL_CONTINUITY');
    check();
    return result;
  } catch(primary) {
    active=false;
    const error=fail(phase);
    Object.defineProperty(error,'roleCommit',{value:roleCommit,enumerable:true});
    if(fixture||generatedCaseId)Object.defineProperty(error,'seedCommit',{value:seedCommit,enumerable:true});
    const reason=ownFaults.get(primary);
    if(reason)Object.defineProperty(error,'stageFailure',{value:reason,enumerable:true});
    const admissionFailure=diagnostic?.capture(primary,reason);
    if(admissionFailure)Object.defineProperty(error,'admissionFailure',{value:admissionFailure,enumerable:true});
    if(applicationFailure && !types.isProxy(applicationFailure)){
      if(generatedCaseId&&Object.getOwnPropertyDescriptor(applicationFailure,'code')?.value==='CURRENT259_FIRST_Q2_APP_GENERATED_HTTP'){
        const detail=projectGeneratedDraftHttpFailure(Object.getOwnPropertyDescriptor(applicationFailure,'generatedHttpFailure')?.value);
        if(detail)Object.defineProperty(error,'generatedHttpFailure',{value:detail,enumerable:true});
      }
      const cleanup=Object.getOwnPropertyDescriptor(applicationFailure,'appCleanupOutcome');
      if(cleanup && Object.hasOwn(cleanup,'value') && cleanup.value==='UNKNOWN_DO_NOT_CONTINUE')
        Object.defineProperty(error,'appCleanupOutcome',{value:cleanup.value,enumerable:true});
    }
    if(context?.cleanup==='UNKNOWN')Object.defineProperty(error,'clientCleanup',{value:'UNKNOWN',enumerable:true});
    try { await closeCurrent259OwnedResource(handle); }
    catch { Object.defineProperty(error,'resourceCleanup',{value:'UNKNOWN',enumerable:true}); }
    throw error;
  } finally {
    active=false;
    if (proof) PROOFS.delete(proof);
    if(generated)generated.password=undefined;
    secrets?.fill(null);
    verifiers?.fill(null);
  }
}
module.exports=Object.freeze({CURRENT259_FIRST_Q2_TRANSPORT,withCurrent259ContractLogin,withCurrent259FirstQ2SeededLogin,claimCurrent259ContractLogin,withCurrent259FirstQ2Application,withCurrent259FirstQ2NativeApplication,withCurrent259GeneratedDraftAdmission,withCurrent261GeneratedDraftIdentityAdmission,withCurrent261UpwardIdentitySeededLogin,takeCurrent259FirstQ2Bridge});
