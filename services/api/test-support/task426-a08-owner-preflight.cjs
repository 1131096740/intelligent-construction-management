"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { assertA08Source } = require("./task426-a08-upward-pin-332-profile.cjs");

const sha256 = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const archivePrincipals = Object.freeze([
  "jg_c259_outside_executor_login", "jg_c259_outside_executor_owner", "jg_c259_outside_issuer_login",
  "jg_c259_outside_issuer_owner", "jg_c259_upward_issuer_login", "jg_c259_upward_issuer_owner",
  "jg_c259_upward_runtime_login"
]);

// Only the existing owned runner supplies this connection. The readback checks
// the current material and leaves all ACLs and single-use fixture tables untouched.
function prepareA08OwnerPreflight(source, sourceSha, { database, databaseOid, systemIdentifier, serverPort, appName, appOid }) {
  assertA08Source(source, sourceSha);
  assert.match(database, /^jg_task01_[a-f0-9]{32}$/u);
  assert.match(appName, /^jg_fixture_app_[a-f0-9]{24}$/u);
  for (const oid of [databaseOid, appOid]) {
    assert.match(oid, /^[1-9][0-9]{0,9}$/u);
    assert.ok(Number(oid) <= 0xFFFFFFFF && oid !== "10");
  }
  assert.match(systemIdentifier, /^[1-9][0-9]{0,19}$/u);
  assert.ok(BigInt(systemIdentifier) <= 0xFFFFFFFFFFFFFFFFn);
  assert.ok(Number.isInteger(serverPort) && serverPort > 1024 && serverPort <= 65535 && serverPort !== 5432);
  const principals = [...archivePrincipals, appName].sort();
  const sql = `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT jsonb_build_object(
  'identity', jsonb_build_object('database', current_database(), 'databaseOid', d.oid::text, 'ownerOid', d.datdba::text,
    'systemIdentifier', (SELECT system_identifier::text FROM pg_control_system()),
    'role', current_user, 'sessionRole', session_user, 'actorOid', current_user::regrole::oid::text,
    'serverPort', inet_server_port(), 'server', host(inet_server_addr()), 'client', host(inet_client_addr()),
    'tls', (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()),
    'readOnly', current_setting('transaction_read_only')='on', 'replication', current_setting('session_replication_role'),
    'ownedClusterOnly', NOT EXISTS(SELECT FROM pg_stat_activity s
      WHERE s.backend_type='client backend' AND s.pid<>pg_backend_pid())),
  'ledger', (SELECT jsonb_agg(jsonb_build_object('name', migration_name, 'sha256', checksum,
    'finished', finished_at IS NOT NULL, 'rolledBack', rolled_back_at IS NOT NULL)
    ORDER BY migration_name COLLATE "C") FROM public._prisma_migrations),
  'principals', (SELECT jsonb_agg(jsonb_build_object('name', r.rolname, 'oid', r.oid::text,
    'login', r.rolcanlogin, 'restricted', NOT(r.rolsuper OR r.rolinherit OR r.rolcreaterole OR r.rolcreatedb
      OR r.rolreplication OR r.rolbypassrls)
      AND NOT EXISTS(SELECT FROM pg_auth_members m WHERE r.oid IN (m.member,m.roleid)))
    ORDER BY r.rolname COLLATE "C") FROM pg_roles r WHERE r.rolname IN (${principals.map(name => `'${name}'`).join(", ")})),
  'closedFixtureScopes', NOT EXISTS(SELECT FROM public.jg_a08_outside_original_pair_v1)
    AND NOT EXISTS(SELECT FROM public.jg_a08_direct_original_voucher_binding_v1)
    AND (SELECT count(*)=2 AND bool_and(f.proowner=d.datdba AND f.prosecdef AND
      (SELECT count(*)=1 AND bool_and(a.grantee=f.proowner AND a.grantor=f.proowner
        AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)
      FROM aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) a)) FROM pg_proc f
      WHERE f.oid IN (to_regprocedure('public.jg_check_a08_outside_original_pair_v1(text,text,text,integer)'),
        to_regprocedure('public.jg_check_a08_direct_original_voucher_v1(text,text)'))))
FROM pg_database d WHERE d.datname=current_database();
ROLLBACK;`;

  return Object.freeze({ sql, verify(readback) {
    assert.deepEqual(readback.identity, {
      database, databaseOid, systemIdentifier, ownerOid: "10", role: "jg_task01_owner", sessionRole: "jg_task01_owner", actorOid: "10",
      serverPort, server: "127.0.0.1", client: "127.0.0.1", tls: true, readOnly: true, replication: "origin", ownedClusterOnly: true
    }, "A08_OWNER_PREFLIGHT_CONNECTION");
    assert.equal(readback.ledger.length, source.migrationCount, "A08_OWNER_PREFLIGHT_LEDGER_COUNT");
    const ledger = readback.ledger.map(({ name, sha256, finished, rolledBack }) => ({ name, sha256, finished, rolledBack }));
    assert.equal(sha256(ledger), source.ledgerSha256, "A08_OWNER_PREFLIGHT_LEDGER_SHA");
    assert.deepEqual(readback.principals.map(row => row.name), principals, "A08_OWNER_PREFLIGHT_PRINCIPALS");
    const oids = new Set();
    for (const role of readback.principals) {
      assert.match(role.oid, /^[1-9][0-9]{0,9}$/u);
      assert.ok(Number(role.oid) <= 0xFFFFFFFF && role.oid !== "10" && !oids.has(role.oid));
      oids.add(role.oid);
      assert.equal(role.login, !role.name.endsWith("_owner"), "A08_OWNER_PREFLIGHT_LOGIN");
      assert.equal(role.restricted, true, "A08_OWNER_PREFLIGHT_RESTRICTED");
      if (role.name === appName) assert.equal(role.oid, appOid, "A08_OWNER_PREFLIGHT_APPLICATION");
    }
    assert.equal(readback.closedFixtureScopes, true, "A08_OWNER_PREFLIGHT_CLOSED_SCOPES");
    return { sourceSha, migrationCount: source.migrationCount, ledgerSha256: source.ledgerSha256, restrictedPrincipals: oids.size,
      status: "A08_OWNER_PREFLIGHT_MATCHED" };
  } });
}

module.exports = { prepareA08OwnerPreflight };
