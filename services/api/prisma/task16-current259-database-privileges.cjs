'use strict';

// SQL fragment for the owned current259 ACL transaction. No execution authority.
const OWNER = '10';
const RESTRICTED = ['jg_task01_runtime', 'jg_task01_observer'];
const PRIVILEGES = ['CONNECT', 'CREATE', 'TEMPORARY'];
const oid = value => typeof value === 'string' && /^[1-9][0-9]{0,9}$/u.test(value) && Number(value) <= 0xffffffff;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const compareAcl = (a, b) => Number(a[0]) - Number(b[0]) || Number(a[1]) - Number(b[1]) || compare(a[2], b[2]);
const literal = value => "'" + value.replaceAll("'", "''") + "'";
const json = value => literal(JSON.stringify(value)) + '::jsonb';

function requireScope(valid) {
  if (!valid) throw new Error('TASK16_CURRENT259_DATABASE_PRIVILEGES');
}

function databaseSnapshotSql() {
  return `(
    SELECT jsonb_agg(jsonb_build_object('oid',d.oid::text,'name',d.datname,'owner',d.datdba::text,
      'acl',(SELECT jsonb_agg(jsonb_build_array(g.grantor::text,g.grantee::text,g.privilege_type,g.is_grantable)
        ORDER BY g.grantor,g.grantee,g.privilege_type COLLATE "C")
        FROM aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) g)) ORDER BY d.datname COLLATE "C")
    FROM pg_catalog.pg_database d)`;
}

function renderCurrent259DatabasePrivileges(provisioned) {
  const { identity, ordinary, observed, roles } = structuredClone({
    identity: provisioned?.databaseIdentity,
    ordinary: provisioned?.ordinary,
    observed: provisioned?.databaseAcl?.after,
    roles: provisioned?.roles
  });
  requireScope(identity && typeof identity.database === 'string' && /^jg_task01_[a-f0-9]{32}$/u.test(identity.database) &&
    oid(identity.databaseOid) && identity.ownerOid === OWNER &&
    typeof identity.systemIdentifier === 'string' && /^[1-9][0-9]{0,19}$/u.test(identity.systemIdentifier));
  requireScope(ordinary && oid(ordinary.oid) && typeof ordinary.name === 'string' && /^jg_fixture_app_[a-f0-9]{24}$/u.test(ordinary.name));
  requireScope(Array.isArray(roles));
  const restricted = RESTRICTED.map(name => {
    const matches = roles.filter(role => role?.name === name);
    requireScope(matches.length === 1 && oid(matches[0].oid));
    return { name, oid: matches[0].oid };
  });
  requireScope(new Set([OWNER, ordinary.oid, ...restricted.map(role => role.oid)]).size === 4);

  const names = [identity.database, 'postgres', 'template0', 'template1'];
  requireScope(Array.isArray(observed) && observed.length === names.length);
  const before = names.map(name => {
    const matches = observed.filter(row => row?.name === name);
    requireScope(matches.length === 1);
    const { oid: databaseOid, owner, acl } = matches[0];
    const target = name === identity.database;
    requireScope(oid(databaseOid) && owner === OWNER && (!target || databaseOid === identity.databaseOid) &&
      Array.isArray(acl) && acl.length > 0);
    const grants = new Set();
    for (const row of acl) {
      requireScope(Array.isArray(row) && row.length === 4 && oid(row[0]) && (row[1] === '0' || oid(row[1])) &&
        PRIVILEGES.includes(row[2]) && typeof row[3] === 'boolean');
      if (row[1] === '0' || restricted.some(role => role.oid === row[1])) {
        requireScope(row[0] === OWNER && !row[3] && (row[1] === '0'
          ? row[2] !== 'CREATE'
          : target && row[2] === 'CONNECT'));
      }
      const key = row.slice(0, 3).join(':');
      requireScope(!grants.has(key));
      grants.add(key);
    }
    if (target) {
      for (const role of [ordinary, ...restricted]) {
        requireScope(acl.some(row => row[0] === OWNER && row[1] === role.oid && row[2] === 'CONNECT' && !row[3]));
      }
    }
    return { oid: databaseOid, name, owner, acl: acl.map(row => [...row]).sort(compareAcl) };
  });
  requireScope(new Set(before.map(db => db.oid)).size === before.length);
  const target = before[0];
  const preserveOrdinaryTemp = target.acl.some(row => row[1] === '0' && row[2] === 'TEMPORARY') &&
    !target.acl.some(row => row[1] === ordinary.oid && row[2] === 'TEMPORARY');
  const expected = before.map(db => ({
    ...db,
    acl: [
      ...db.acl.filter(row => row[1] !== '0'),
      ...(db === target && preserveOrdinaryTemp ? [[OWNER, ordinary.oid, 'TEMPORARY', false]] : [])
    ].sort(compareAcl)
  }));

  const databaseName = literal(identity.database);
  const roleBindings = [ordinary, ...restricted].map(role => `(${literal(role.name)},${role.oid}::oid)`).join(',');
  const restrictedOids = restricted.map(role => `(${role.oid}::oid)`).join(',');
  const sql = `DO $current259_database_privileges$
DECLARE
  db record;
  scope_before constant jsonb := ${json(before)};
BEGIN
  IF current_user IS DISTINCT FROM 'jg_task01_owner' OR session_user IS DISTINCT FROM current_user
    OR current_user::regrole::oid <> 10 OR current_database() IS DISTINCT FROM ${databaseName}
    OR current_setting('transaction_isolation') IS DISTINCT FROM 'serializable'
    OR current_setting('transaction_read_only') IS DISTINCT FROM 'off'
    OR current_setting('session_replication_role') IS DISTINCT FROM 'origin'
    OR (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) IS DISTINCT FROM ${literal(identity.systemIdentifier)}
    OR pg_catalog.host(inet_client_addr()) IS DISTINCT FROM '127.0.0.1'
    OR pg_catalog.host(inet_server_addr()) IS DISTINCT FROM '127.0.0.1'
    OR inet_server_port() IS DISTINCT FROM 5432
    OR NOT EXISTS (SELECT FROM pg_catalog.pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl)
    OR EXISTS (SELECT FROM (VALUES ${roleBindings}) AS e(name,oid)
      WHERE NOT EXISTS (SELECT FROM pg_catalog.pg_roles r WHERE r.oid=e.oid AND r.rolname::text=e.name))
    OR EXISTS (SELECT FROM pg_catalog.pg_auth_members m CROSS JOIN (VALUES ${restrictedOids}) r(oid)
      WHERE m.member=r.oid OR m.roleid=r.oid)
    OR ${databaseSnapshotSql()} IS DISTINCT FROM scope_before THEN
    RAISE EXCEPTION 'TASK16_CURRENT259_DATABASE_ACL_PREIMAGE';
  END IF;
  FOR db IN SELECT d->>'name' AS name, string_agg(a->>2,', ' ORDER BY (a->>2) COLLATE "C") AS privileges
    FROM jsonb_array_elements(scope_before) v(d) CROSS JOIN LATERAL jsonb_array_elements(d->'acl') x(a)
    WHERE a->>1='0' GROUP BY d->>'name' ORDER BY (d->>'name') COLLATE "C"
  LOOP
    EXECUTE format('REVOKE %s ON DATABASE %I FROM PUBLIC',db.privileges,db.name);
  END LOOP;
  ${preserveOrdinaryTemp ? `EXECUTE format('GRANT TEMPORARY ON DATABASE %I TO %I',${databaseName},${literal(ordinary.name)});` : ''}
  IF ${databaseSnapshotSql()} IS DISTINCT FROM ${json(expected)}
    OR EXISTS (SELECT FROM pg_catalog.pg_database d CROSS JOIN
      (VALUES ${restrictedOids}) r(oid)
      WHERE has_database_privilege(r.oid,d.oid,'CONNECT') IS DISTINCT FROM (d.oid=${identity.databaseOid}::oid)
         OR has_database_privilege(r.oid,d.oid,'CREATE') OR has_database_privilege(r.oid,d.oid,'TEMPORARY')) THEN
    RAISE EXCEPTION 'TASK16_CURRENT259_DATABASE_ACL_POSTIMAGE';
  END IF;
END $current259_database_privileges$;`;
  return { sql, expected };
}

module.exports = { renderCurrent259DatabasePrivileges };
