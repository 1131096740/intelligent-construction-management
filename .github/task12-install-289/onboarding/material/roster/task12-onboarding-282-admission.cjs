'use strict';

const { createHash } = require('node:crypto');
const {
  renderEmployeeOnboardingFileGuardGrant,
  renderTask398Owned280FileGuardGrant,
} = require('./contract-bank-runtime-fixture.cjs');

const role = 'onboarding_runtime';
const rawLookup = 'public.jg_project_owner_settlement_voucher_bound(pg_catalog.text)';
const approvedAlias = 'public.jg_file_business_binding_columns_before_owner_settlement()';
const legacyRendererSha256 = '70f9dbcbc9d2ec4647ed00231909c3ebd34623bbda50f387b09e7933d8b5660d';
const exactDatabase = /^jg_task01_[a-f0-9]{32}$/u;

function requireScope(condition) {
  if (!condition) throw new Error('EMPLOYEE_ONBOARDING_282_SCOPE');
}

function hbaLine(database) {
  requireScope(typeof database === 'string' && exactDatabase.test(database));
  return `hostssl ${database} ${role} 127.0.0.1/32 scram-sha-256`;
}

function grantStatements(sql) {
  return sql.split('\n').filter(line => line.includes("EXECUTE pg_catalog.format('GRANT")).map(line => line.trim());
}

function renderFileRegistryGrant(database) {
  requireScope(typeof database === 'string' && exactDatabase.test(database));
  const legacy = renderEmployeeOnboardingFileGuardGrant();
  requireScope(createHash('sha256').update(legacy).digest('hex') === legacyRendererSha256);
  const trusted = renderTask398Owned280FileGuardGrant(database);
  const roleAnchor = "fixture_role CONSTANT name := 'jg_task01_runtime';";
  requireScope(trusted.split(roleAnchor).length === 2);
  const scoped = trusted.replace(roleAnchor, `fixture_role CONSTANT name := '${role}';`);
  const expectedGrants = grantStatements(legacy).map(line => line.replace(', ' + rawLookup, ''));
  requireScope(expectedGrants.some(line => line.includes(approvedAlias))
    && !expectedGrants.some(line => line.includes(rawLookup))
    && JSON.stringify(grantStatements(scoped)) === JSON.stringify(expectedGrants));
  return scoped;
}

function runtimeProbeSql(database, port) {
  requireScope(typeof database === 'string' && exactDatabase.test(database)
    && Number.isInteger(port) && port > 1024 && port <= 65535 && port !== 5432);
  return `SELECT coalesce(d.datname = '${database}' AND d.datdba = 10
    AND pg_catalog.pg_get_userbyid(d.datdba) = 'jg_task01_owner'
    AND current_user = '${role}' AND session_user = current_user AND r.oid <> d.datdba
    AND r.rolcanlogin AND NOT (r.rolinherit OR r.rolsuper OR r.rolcreaterole OR r.rolcreatedb
      OR r.rolreplication OR r.rolbypassrls)
    AND NOT EXISTS (SELECT FROM pg_catalog.pg_auth_members a WHERE a.member=r.oid OR a.roleid=r.oid)
    AND pg_catalog.inet_client_addr() = '127.0.0.1'::inet
    AND pg_catalog.inet_server_addr() = '127.0.0.1'::inet
    AND pg_catalog.inet_server_port() = ${port}
    AND EXISTS (SELECT FROM pg_catalog.pg_stat_ssl WHERE pid=pg_catalog.pg_backend_pid() AND ssl)
    AND pg_catalog.has_function_privilege(r.oid,'${approvedAlias}','EXECUTE')
    AND NOT pg_catalog.has_function_privilege(r.oid,'${approvedAlias}','EXECUTE WITH GRANT OPTION')
    AND NOT pg_catalog.has_function_privilege(r.oid,'${rawLookup}','EXECUTE'),false) AS accepted
  FROM pg_catalog.pg_database d JOIN pg_catalog.pg_roles r ON r.rolname=current_user
  WHERE d.datname=current_database();`;
}

module.exports = { hbaLine, renderFileRegistryGrant, runtimeProbeSql };
