'use strict';

const { isIP } = require('node:net');
const { types } = require('node:util');

const ROLLBACK_TOPOLOGY = 'UNVERIFIED_FIRST_ROLLBACK_LOOPBACK_TLS';
const CODE = 'TASK16_CURRENT259_A16_FAULT';
const TABLE = 'public."OperatingImpactEntry"';
const OWNER = 'jg_task01_owner';
const RUNTIME = 'jg_task01_runtime';
const WAIT_SECONDS = 12;
const SETTLE_SECONDS = 3;
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const integer = (value, limit) => Number.isInteger(value) && value > 0 && value <= limit;
const oid = value => typeof value === 'string' && /^[1-9][0-9]{0,9}$/u.test(value) && Number(value) <= 0xffffffff;
const wide = value => typeof value === 'string' && /^[1-9][0-9]{0,19}$/u.test(value) && BigInt(value) <= 0xffffffffffffffffn;
const stamp = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/u.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString().slice(0, 19) === value.slice(0, 19);
const faultState = mode => mode === 'cancel-commit' ? 'commit-cancelled' : 'commit-disconnected';
const sqlTime = value => `pg_catalog.to_char(${value} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

function need(condition) {
  if (!condition) throw Object.assign(new Error(CODE), { code: CODE });
}

function data(record, keys) {
  need(record && typeof record === 'object' && !types.isProxy(record) && Reflect.ownKeys(record).length === keys.length);
  return Object.fromEntries(keys.map(key => {
    const property = Object.getOwnPropertyDescriptor(record, key);
    need(property && Object.hasOwn(property, 'value'));
    return [key, property.value];
  }));
}

function snapshot(input) {
  const transport = input && !types.isProxy(input) && Object.getOwnPropertyDescriptor(input, 'transport');
  const { mode, nonce, database, runtime } = data(input, ['mode', 'nonce', 'database', 'runtime', ...(transport ? ['transport'] : [])]);
  if (transport) need(transport.value === ROLLBACK_TOPOLOGY && mode === 'cancel-commit');
  const db = data(database, ['name', 'oid', 'namespaceOid', 'systemIdentifier']);
  const target = data(runtime, ['oid', 'pid', 'startedAt', 'clientAddress', 'clientPort']);
  need((mode === 'cancel-commit' || mode === 'disconnect-commit') && hex(nonce));
  need(typeof db.name === 'string' && /^jg_task01_[a-f0-9]{32}$/u.test(db.name) && oid(db.oid) &&
    oid(db.namespaceOid) && wide(db.systemIdentifier));
  need(oid(target.oid) && target.oid !== '10' && integer(target.pid, 0x7fffffff) && stamp(target.startedAt));
  need(typeof target.clientAddress === 'string' && isIP(target.clientAddress) === 4 &&
    (transport ? target.clientAddress === '127.0.0.1' :
      /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2[0-9]|3[01])\.)/u.test(target.clientAddress)) && integer(target.clientPort, 65535));
  return { mode, nonce, db, target, app: 'jg_a16_' + nonce.slice(0, 48) };
}

function identity(scope, readOnly) {
  const { db } = scope;
  return `current_user='${OWNER}' AND session_user=current_user
 AND current_user::regrole::oid=10 AND current_database()='${db.name}'
 AND EXISTS(SELECT FROM pg_catalog.pg_database d WHERE d.oid=${db.oid}::oid AND d.datname=current_database() AND d.datdba=10)
 AND pg_catalog.to_regnamespace('public')::oid=${db.namespaceOid}::oid
 AND (SELECT system_identifier::text FROM pg_catalog.pg_control_system())='${db.systemIdentifier}'
 AND current_setting('server_version_num')::integer BETWEEN 160000 AND 169999
 AND current_setting('transaction_read_only')='${readOnly ? 'on' : 'off'}'
 AND current_setting('session_replication_role')='origin'
 AND pg_catalog.host(inet_client_addr())='127.0.0.1' AND pg_catalog.host(inet_server_addr())='127.0.0.1'
 AND inet_server_port()=5432 AND EXISTS(SELECT FROM pg_catalog.pg_stat_ssl s WHERE s.pid=pg_backend_pid() AND s.ssl)`;
}

function ownerMarker(scope) {
  return `a.datid=${scope.db.oid}::oid AND a.usesysid=10 AND a.usename='${OWNER}' AND a.backend_type='client backend'
 AND pg_catalog.host(a.client_addr)='127.0.0.1' AND EXISTS(SELECT FROM pg_catalog.pg_stat_ssl s WHERE s.pid=a.pid AND s.ssl)`;
}

function readySql(scope) {
  return `BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY;
SET LOCAL search_path=pg_catalog,pg_temp;
SET LOCAL statement_timeout='2s';
WITH marked AS MATERIALIZED (
 SELECT a.* FROM pg_catalog.pg_stat_activity a WHERE a.application_name='${scope.app}'
), ready AS MATERIALIZED (
 SELECT a.pid,${sqlTime('a.backend_start')} AS start
 FROM marked a WHERE ${ownerMarker(scope)} AND a.pid<>pg_backend_pid() AND a.xact_start IS NOT NULL
 AND EXISTS(SELECT FROM pg_catalog.pg_locks l WHERE l.pid=a.pid AND l.locktype='relation'
   AND l.database=${scope.db.oid}::oid AND l.relation='${TABLE}'::regclass
   AND l.mode='AccessExclusiveLock' AND l.granted)
)
SELECT pg_catalog.jsonb_build_object('nonce','${scope.nonce}',
 'state',CASE WHEN NOT coalesce((${identity(scope, true)}),false) THEN 'invalid'
  WHEN (SELECT count(*) FROM marked)=0 THEN 'waiting'
  WHEN (SELECT count(*) FROM marked)=1 AND (SELECT count(*) FROM ready)=1 THEN 'ready'
  ELSE 'invalid' END,
 'owner',(SELECT pg_catalog.jsonb_build_object('pid',r.pid,'startedAt',r.start) FROM ready r LIMIT 1));
ROLLBACK;`;
}

function ownerSql(scope) {
  const { db, target, mode } = scope;
  const knownTarget = `a.pid=${target.pid} AND a.datid=${db.oid}::oid AND a.usesysid=${target.oid}::oid
 AND a.usename='${RUNTIME}' AND a.backend_type='client backend' AND ${sqlTime('a.backend_start')}='${target.startedAt}'
 AND pg_catalog.host(a.client_addr)='${target.clientAddress}' AND a.client_port=${target.clientPort}
 AND EXISTS(SELECT FROM pg_catalog.pg_stat_ssl s WHERE s.pid=a.pid AND s.ssl)`;
  const cancel = mode === 'cancel-commit';
  const signal = cancel ? 'pg_cancel_backend' : 'pg_terminate_backend';
  const settled = cancel ? `EXISTS(SELECT FROM pg_catalog.pg_stat_activity a WHERE ${knownTarget}
      AND a.state='idle' AND a.xact_start IS NULL AND a.backend_xid IS NULL)`
    : `NOT EXISTS(SELECT FROM pg_catalog.pg_stat_activity a WHERE a.pid=${target.pid} AND ${sqlTime('a.backend_start')}='${target.startedAt}')`;
  return `BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE;
SET LOCAL search_path=pg_catalog,pg_temp;
SET LOCAL statement_timeout='16s';
SET LOCAL lock_timeout='1s';
DO $a16_scope$ BEGIN
 IF NOT coalesce((${identity(scope, false)}),false) OR NOT EXISTS(
   SELECT FROM pg_catalog.pg_roles r WHERE r.oid=${target.oid}::oid AND r.rolname='${RUNTIME}'
     AND r.rolcanlogin AND r.rolconnlimit=1
     AND NOT (r.rolsuper OR r.rolinherit OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls)
     AND NOT EXISTS(SELECT FROM pg_catalog.pg_auth_members m WHERE r.oid IN (m.roleid,m.member))
 ) THEN RAISE EXCEPTION '${CODE}_OWNER'; END IF;
END $a16_scope$;
LOCK TABLE ${TABLE} IN ACCESS EXCLUSIVE MODE NOWAIT;
SET LOCAL application_name='${scope.app}';
DO $a16_barrier$
DECLARE
 observed record;
 locked_relation oid := '${TABLE}'::regclass;
 deadline timestamptz := pg_catalog.clock_timestamp()+interval '${WAIT_SECONDS} seconds';
BEGIN
 LOOP
  PERFORM pg_catalog.pg_stat_clear_snapshot();
  SELECT a.query,a.state,a.wait_event_type,a.wait_event,a.xact_start,a.query_start,a.backend_xid
   INTO STRICT observed FROM pg_catalog.pg_stat_activity a WHERE ${knownTarget};
  IF observed.wait_event_type='Lock' THEN
   IF observed.state IS DISTINCT FROM 'active' OR observed.wait_event IS DISTINCT FROM 'relation'
    OR NOT coalesce(pg_catalog.upper(pg_catalog.btrim(observed.query)) IN ('COMMIT','COMMIT;'),false)
    OR observed.xact_start IS NULL OR observed.xact_start<=pg_catalog.transaction_timestamp()
    OR observed.query_start IS NULL OR observed.query_start<observed.xact_start OR observed.backend_xid IS NULL
    OR pg_catalog.pg_blocking_pids(${target.pid}) IS DISTINCT FROM ARRAY[pg_backend_pid()]
    OR NOT EXISTS(SELECT FROM pg_catalog.pg_locks l WHERE l.pid=${target.pid} AND l.locktype='relation'
      AND l.database=${db.oid}::oid AND l.relation=locked_relation AND l.mode='AccessShareLock' AND NOT l.granted)
    OR NOT EXISTS(SELECT FROM pg_catalog.pg_locks l WHERE l.pid=pg_backend_pid() AND l.locktype='relation'
      AND l.database=${db.oid}::oid AND l.relation=locked_relation AND l.mode='AccessExclusiveLock' AND l.granted)
   THEN RAISE EXCEPTION '${CODE}_UNEXPECTED_WAITER'; END IF;
   EXIT;
  END IF;
  IF pg_catalog.clock_timestamp()>=deadline THEN RAISE EXCEPTION '${CODE}_WAIT_TIMEOUT'; END IF;
  PERFORM pg_catalog.pg_sleep(0.02);
 END LOOP;
 PERFORM pg_catalog.pg_stat_clear_snapshot();
 IF NOT (CASE WHEN EXISTS(SELECT FROM pg_catalog.pg_stat_activity a WHERE ${knownTarget}
      AND a.state='active' AND a.wait_event_type='Lock' AND a.wait_event='relation'
      AND pg_catalog.upper(pg_catalog.btrim(a.query)) IN ('COMMIT','COMMIT;')
      AND a.xact_start=observed.xact_start AND a.query_start=observed.query_start AND a.backend_xid=observed.backend_xid
      AND pg_catalog.pg_blocking_pids(a.pid)=ARRAY[pg_backend_pid()]
      AND EXISTS(SELECT FROM pg_catalog.pg_locks l WHERE l.pid=a.pid AND l.locktype='relation'
        AND l.database=${db.oid}::oid AND l.relation=locked_relation AND l.mode='AccessShareLock' AND NOT l.granted))
   THEN pg_catalog.${signal}(${target.pid}) ELSE false END) THEN RAISE EXCEPTION '${CODE}_SIGNAL'; END IF;
 deadline := pg_catalog.clock_timestamp()+interval '${SETTLE_SECONDS} seconds';
 LOOP
  PERFORM pg_catalog.pg_stat_clear_snapshot();
  EXIT WHEN ${settled};
  IF pg_catalog.clock_timestamp()>=deadline THEN RAISE EXCEPTION '${CODE}_SETTLE_TIMEOUT'; END IF;
  PERFORM pg_catalog.pg_sleep(0.02);
 END LOOP;
 PERFORM pg_catalog.set_config('app.jg_a16_proof',pg_catalog.jsonb_build_object(
  'nonce','${scope.nonce}','mode','${mode}','state','${faultState(mode)}',
  'owner',(SELECT pg_catalog.jsonb_build_object('pid',a.pid,'startedAt',${sqlTime('a.backend_start')})
     FROM pg_catalog.pg_stat_activity a WHERE a.pid=pg_backend_pid()),
  'runtimePid',${target.pid},'runtimeStartedAt','${target.startedAt}',
  'transactionId',observed.backend_xid::text,'commitStartedAt',${sqlTime('observed.query_start')}
 )::text,true);
END $a16_barrier$;
SELECT pg_catalog.current_setting('app.jg_a16_proof');
ROLLBACK;`;
}

function parse(stdout, keys) {
  need(typeof stdout === 'string' && Buffer.byteLength(stdout) <= 4096);
  let raw;
  try { raw = JSON.parse(stdout); } catch { need(false); }
  return data(raw, keys);
}

// SQL and observation checks only. The caller must separately own the
// actual resource, runtime session, and fault authorization.
function createCurrent259A16FaultPlan(input) {
  const scope = snapshot(input);
  let ready, stopped = false;
  return Object.freeze({
    ownerSql: ownerSql(scope), readySql: readySql(scope),
    parseReady(stdout) {
      need(!stopped);
      stopped = true;
      need(!ready);
      const row = parse(stdout, ['nonce', 'state', 'owner']);
      need(row.nonce === scope.nonce);
      if (row.state === 'waiting' && row.owner === null) {
        stopped = false;
        return null;
      }
      const owner = data(row.owner, ['pid', 'startedAt']);
      need(row.state === 'ready' && integer(owner.pid, 0x7fffffff) && owner.pid !== scope.target.pid && stamp(owner.startedAt));
      ready = Object.freeze(owner);
      stopped = false;
      return ready;
    },
    parseOutcome(stdout, readyWitness) {
      need(!stopped);
      stopped = true;
      need(ready && readyWitness === ready);
      const row = parse(stdout, ['nonce', 'mode', 'state', 'owner', 'runtimePid', 'runtimeStartedAt',
        'transactionId', 'commitStartedAt']);
      const owner = data(row.owner, ['pid', 'startedAt']);
      need(row.nonce === scope.nonce && row.mode === scope.mode && row.state === faultState(scope.mode) &&
        owner.pid === ready.pid && owner.startedAt === ready.startedAt &&
        row.runtimePid === scope.target.pid && row.runtimeStartedAt === scope.target.startedAt &&
        oid(row.transactionId) && stamp(row.commitStartedAt) &&
        row.commitStartedAt > ready.startedAt && row.commitStartedAt > scope.target.startedAt);
      return Object.freeze({ mode: row.mode, state: row.state, transactionId: row.transactionId,
        executionAllowed: false, nativeAdmission: false });
    }
  });
}

module.exports = Object.freeze({ createCurrent259A16FaultPlan });
