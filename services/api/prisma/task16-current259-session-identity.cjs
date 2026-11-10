'use strict';

const { isIP } = require('node:net');
const { types } = require('node:util');

// Fixed self-observation through the existing narrowly granted identity helper.
const current259ClientIdentitySql = `SELECT pg_catalog.current_database()::pg_catalog.text AS database,
 i."databaseOid" AS "databaseOid",i."systemIdentifier" AS "systemIdentifier",
 d.datdba::pg_catalog.text AS "ownerOid",
 current_user::pg_catalog.text AS "effectiveRole",session_user::pg_catalog.text AS "loginRole",
 current_user::pg_catalog.regrole::pg_catalog.oid::pg_catalog.text AS "effectiveOid",
 session_user::pg_catalog.regrole::pg_catalog.oid::pg_catalog.text AS "loginOid",
 a.pid,pg_catalog.to_char(a.backend_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS start,
 s.ssl AS tls,pg_catalog.current_setting('server_version_num')::pg_catalog.int4 AS version,
 pg_catalog.getdatabaseencoding() AS encoding,pg_catalog.current_setting('session_replication_role') AS replication,
 pg_catalog.current_setting('transaction_read_only') AS "readOnly",
 pg_catalog.current_setting('default_transaction_read_only') AS "defaultReadOnly",
 pg_catalog.host(pg_catalog.inet_client_addr()) AS "clientAddress",pg_catalog.inet_client_port() AS "clientPort",
 pg_catalog.host(pg_catalog.inet_server_addr()) AS "serverAddress",pg_catalog.inet_server_port() AS "serverPort",
 $1::pg_catalog.text AS nonce
FROM public.jg_task01_connection_identity() i
JOIN pg_catalog.pg_stat_activity a ON a.pid=pg_catalog.pg_backend_pid()
JOIN pg_catalog.pg_database d ON d.oid=a.datid AND d.datname=pg_catalog.current_database()
JOIN pg_catalog.pg_stat_ssl s ON s.pid=a.pid
WHERE i."backendPid"=pg_catalog.pg_backend_pid() AND i."loginRole"=session_user
  AND i."databaseOid"=d.oid::pg_catalog.text AND i.tls IS TRUE AND s.ssl IS TRUE`;

const CODE = 'TASK16_CURRENT259_SESSION_IDENTITY';
const kinds = ['owner', 'runtime', 'observer'];
const identityFields = ['database', 'databaseOid', 'systemIdentifier', 'effectiveRole', 'loginRole', 'effectiveOid',
  'loginOid', 'pid', 'start', 'tls'];
const endpointFields = ['clientAddress', 'clientPort', 'serverAddress', 'serverPort'];
const rawFields = [...identityFields, 'ownerOid', 'version', 'encoding', 'replication', 'readOnly', 'defaultReadOnly',
  ...endpointFields, 'nonce'];
const scopeFields = ['database', 'databaseOid', 'systemIdentifier', 'ownerOid', 'runtimeOid', 'observerOid',
  'publishedPort', 'nonce'];

function need(ok) {
  if (!ok) throw new Error(CODE);
}
function value(record, key) {
  need(record && typeof record === 'object' && !types.isProxy(record));
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  need(descriptor && Object.hasOwn(descriptor, 'value'));
  return descriptor.value;
}
function fixedRecord(record, fields) {
  need(record && typeof record === 'object' && !types.isProxy(record) &&
    Object.getPrototypeOf(record) === Object.prototype && Reflect.ownKeys(record).length === fields.length);
  return Object.fromEntries(fields.map(key => [key, value(record, key)]));
}
function exactArray(array, length) {
  need(Array.isArray(array) && !types.isProxy(array) && array.length === length);
  return Array.from({ length }, (_, index) => value(array, index));
}
const oid = x => typeof x === 'string' && /^[1-9][0-9]{0,9}$/u.test(x) && Number(x) <= 0xffffffff;
const wide = x => typeof x === 'string' && /^[1-9][0-9]{0,19}$/u.test(x) && BigInt(x) <= 0xffffffffffffffffn;
const port = x => Number.isInteger(x) && x > 0 && x <= 65535;
const privateIPv4 = x => typeof x === 'string' && isIP(x) === 4 &&
  /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2[0-9]|3[01])\.)/u.test(x);
function timestamp(x) {
  if (typeof x !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/u.test(x)) return false;
  const parsed = Date.parse(x);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 23) === x.slice(0, 23);
}

/** Coordinates only. Authenticity and continuity belong to the owning client producer. */
function parseCurrent259ClientSessions(observations, expected) {
  const scope = fixedRecord(expected, scopeFields);
  const roleOids = kinds.map(kind => scope[kind + 'Oid']);
  need(typeof scope.database === 'string' && /^jg_task01_[a-f0-9]{32}$/u.test(scope.database) &&
    oid(scope.databaseOid) && wide(scope.systemIdentifier) && scope.ownerOid === '10' &&
    roleOids.every(oid) && new Set(roleOids).size === 3 &&
    port(scope.publishedPort) && scope.publishedPort > 1024 &&
    typeof scope.nonce === 'string' && /^[a-f0-9]{64}$/u.test(scope.nonce));
  const rows = exactArray(observations, 3).map((rows, index) => {
    const row = fixedRecord(exactArray(rows, 1)[0], rawFields);
    const role = 'jg_task01_' + kinds[index];
    const readOnly = role === 'jg_task01_observer' ? 'on' : 'off';
    need(['database', 'databaseOid', 'systemIdentifier', 'ownerOid', 'nonce'].every(key => row[key] === scope[key]) &&
      row.effectiveRole === role && row.loginRole === role && row.effectiveOid === roleOids[index] &&
      row.loginOid === roleOids[index] && Number.isInteger(row.pid) && row.pid > 0 && row.pid <= 0x7fffffff &&
      timestamp(row.start) && row.tls === true && Number.isInteger(row.version) && row.version >= 160000 &&
      row.version < 170000 && row.encoding === 'UTF8' && row.replication === 'origin' &&
      row.readOnly === readOnly && row.defaultReadOnly === readOnly &&
      privateIPv4(row.clientAddress) && port(row.clientPort) && privateIPv4(row.serverAddress) && row.serverPort === 5432);
    return row;
  });
  const runtime = rows[1];
  need(['pid', 'start'].every(key => new Set(rows.map(row => row[key])).size === 3) &&
    rows.every(row => row.version === runtime.version && row.serverAddress === runtime.serverAddress) &&
    new Set(rows.map(row => row.clientAddress + ':' + row.clientPort)).size === 3);
  const identity = rows.map(row => Object.freeze(Object.fromEntries(identityFields.map(key => [key, row[key]]))));
  const endpoint = Object.freeze({
    publishedHost: '127.0.0.1', publishedPort: scope.publishedPort,
    ...Object.fromEntries(endpointFields.map(key => [key, runtime[key]]))
  });
  return Object.freeze({ identity: Object.freeze(identity), endpoint });
}

module.exports = Object.freeze({ current259ClientIdentitySql, parseCurrent259ClientSessions });
