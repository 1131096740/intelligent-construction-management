'use strict';

const { createHash, randomBytes } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { types } = require('node:util');
const { claimCurrent259ProvisionedRoles } = require('./task16-current259-role-provision.cjs');
const {
  claimCurrent259TechnicalResource, closeCurrent259OwnedResource,
} = require('./task16-current259-owned-resource.cjs');
const { archiveSevenMaterial } = require('./task16-current259-seven-install.cjs');

const OWNER = 'jg_task01_owner';
const LEDGER = 'd3538d5a3cc3a74627d70cf0e445915ef8a84c07ae06851f9aa50292d90d2952';
const STAGES = ['archive-install-before', 'archive-install-write', 'archive-install-committed'];
const REGISTERED_STAGES = ['archive-registered-write', 'archive-registered-committed'];
const OUTSIDE_ROLES = ['issuer_login', 'issuer_owner', 'executor_login', 'executor_owner'].map(role => `jg_c259_outside_${role}`);
const UPWARD_ROLES = ['issuer_login', 'issuer_owner', 'runtime_login'].map(role => `jg_c259_upward_${role}`);
const ROLE_NAMES = [...OUTSIDE_ROLES, ...UPWARD_ROLES, 'jg_task01_observer', 'jg_task01_runtime'].sort();
const OUTSIDE = 'jg_install_contract_direct_archive_outside_v1';
const UPWARD = 'jg_install_contract_direct_upward_v2';
const REGISTRY = 'public.jg_file_business_binding_columns()';
const REGISTERED_ALIAS = 'public.jg_file_business_binding_columns_before_registered_payment()';
const ENFORCER = 'public.jg_enforce_exclusive_file_business_binding()';
const PENDING = 'public.jg_contract_direct_pending_binding_v1';
const COLLISION_ROOTS = [
  'public.jg_file_business_collision_columns()',
  'public.jg_has_exclusive_file_business_binding(pg_catalog.text)',
  ENFORCER,
];
const EXECUTOR = 'jg_c259_outside_executor_owner';
const TABLES = {
  outside: 'jg_contract_direct_archive_intent_binding_v1',
  nativeNonce: 'jg_contract_direct_archive_native_nonce_v1',
  issuer: 'jg_contract_direct_upward_issuer_binding_v2',
  closure: 'jg_contract_direct_upward_closure_v2',
  execution: 'jg_contract_direct_upward_execution_binding_v2',
};
const INSTALLERS = [
  [OUTSIDE, 'name,name,name,name', 'void', '90f04575aa5697fcfd785327c6618d2f9ff09c66de45c675847ec4cf63b6bed9'],
  ['jg_install_direct_outside_operating_archive_read_v2', '', 'void', '292f302caf19a045928cfb8f05ccf8726f5fa76f62a88a1cf1864f5ce0f3f21e'],
  ['jg_install_direct_outside_operating_parent_v2', '', 'void', '7b3c26f6a6f87effbb24b07a990257387061bd24547a4a7e6c294a304b7f1d32'],
  ['jg_install_direct_outside_operating_slot_v2', '', 'void', '67a29d063e07ed82449433c37a658ef584cd4f1a2ca765a20c3510041ba7b234'],
  ['jg_install_direct_outside_operating_version_v2', '', 'void', 'a30b81204e1866a8e2b748bc247b89369655b2d318d8a2f8aef46076acaf8d10'],
  // M253 patches this installer's source checks after its original definition.
  ['jg_install_direct_outside_runtime_tls_v2', '', 'void', 'a6d9ae6409482eb52cf6d611558436b8bdeeb580a06f56fd6b6f0e03afa8a54f'],
  ['jg_install_direct_outside_operating_assignment_lock_v2', '', 'void', 'bcae0e7ce8ca8e2156e27230f5b3cfcafab0f209da71c7e3c051bdc07c17a710'],
  ['jg_install_direct_outside_operating_reference_clock_v2', '', 'void', '426a9a36576210e3a17486e8647eb532508c7b3d366c9ff5cdef784542468d94'],
  ['jg_install_direct_outside_operating_pair_v2', '', 'void', 'eb58353e205856efa7376013098a14214225f4390ba0c9c28d373147602980a8'],
  ['jg_install_direct_outside_operating_archive_completion_v2', '', 'void', 'a3572918b9fa5df028ade4844f1f34fb8ad7c4856ce45a4c0b2a3064e108befe'],
  ['jg_install_direct_outside_operating_generation_v2', '', 'void', '786e66605ca9c40a58c9bfa2b3b44d09cde2ec095dc42ea57ce1b117bf695000'],
  ['jg_install_direct_outside_operating_nonce_v2', '', 'void', '5dad4eab665c103d1f0a41bf523a3cc1dfc39700c143ee8417c18b0cf40f49c0'],
  ['jg_install_direct_outside_operating_basis_bridge_v2', '', 'void', '6370117491047371db515a703ef2bd1ca543e526ec87fb563c2e76e249d3fd5e'],
  [UPWARD, 'text,text,text,uuid', 'jsonb', '53d691e74321049c33b9769f433e080540058b00fd5d2ef4045b92abae354ce1'],
];
// These functions supply the operating and upward recipes used by the
// installers and by the independent committed readback.
const CHECKERS = [
  ['jg_direct_outside_operating_basis_catalog_v2()', 'bool', 'plpgsql', 's', false, '70cf96e31452748e7e01e8f4d4ec4dad8683e992072f3041bbde522cc8866f18'],
  ['jg_require_contract_direct_upward_source_v2()', 'text', 'plpgsql', 'v', false, '9af4c2c58ac1adabb2580d76f90130c856dd1743f608824859a44d1bb5b3c0c4'],
  ['jg_upward_archive_transform_v2(text,text)', 'text', 'plpgsql', 'i', true, '276bbe28a550eadec5efe180921ed6d9cb219b7f38553123ff31b9ea1621094d'],
  ['jg_upward_archive_splice_signatures_v2()', 'text[]', 'sql', 'i', false, '460833a053385e7d218743ff935a4e4465d1844c110c3881f3f693e47d55a2a9'],
  ['jg_upward_archive_splice_metadata_v2()', 'jsonb', 'sql', 'i', false, 'cbabcde24a8a4b272cf41ddc82705803776bc94d47c560e4dc731ef91cb19fb6'],
  ['jg_upward_archive_constraint_body_v2(text)', 'text', 'plpgsql', 'i', true, 'bf0b610bd25402782ec37e8a475da8d6033212c5b63afe3458070a647edf8829'],
  ['jg_upward_archive_recipe_v2()', 'jsonb', 'sql', 'i', false, '70cfbea26f01c95b0e4a7b5674829aae767718bad7513ba69a496b55fb4eb9c2'],
];
const attempted = new WeakSet();
const receipts = new WeakMap();
const fault = code => Object.assign(new Error(code), { code });
const need = (ok, code = 'CURRENT259_ARCHIVE_INSTALL_QUALIFICATION') => { if (!ok) throw fault(code); };
const sha = text => createHash('sha256').update(text).digest('hex');
const digestSql = value => `pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to((${value})::text,'UTF8')),'hex')`;
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${literal(JSON.stringify(value))}::jsonb`;
const hex = (value, length) => typeof value === 'string' && value.length === length && /^[0-9a-f]+$/u.test(value);
const numberString = (value, max) => typeof value === 'string' && /^[1-9][0-9]{0,19}$/u.test(value) && BigInt(value) <= max;
const oid = value => numberString(value, 0xffffffffn);
const xid = value => numberString(value, 0xffffffffffffffffn);

function collisionRecipe() {
  const source = readFileSync(join(__dirname, '../src/contract/contract-direct-pending-recipe.ts'), 'utf8');
  need(sha(source) === '439e62e0557342e54e26ecdf0201ccf7beb94ef01f9556e252e1662e62e003db');
  const recipe = JSON.parse(/export const DIRECT_PENDING_DB_RECIPE = ([\s\S]+) as const;\s*$/u.exec(source)[1]);
  const rows = recipe.routines.filter(({ signature }) => signature.startsWith('public.jg_file_business_binding_columns') || COLLISION_ROOTS.includes(signature));
  need(rows.length === 24 && new Set(rows.map(row => row.signature)).size === 24);
  return rows.map(({ signature, bodySha256 }) => ({ signature, bodySha256 }));
}

function roleInput(lease, view) {
  const { source, completion } = lease;
  const { databaseIdentity: identity, ordinary, roles, commitXid, databaseAcl } = completion;
  const { database, databaseOid, namespaceOid, ownerOid, systemIdentifier } = identity;
  const { ledger, ledgerSha256 } = source.profile;
  need(Object.isFrozen(completion) && completion.status === 'CURRENT259_ROLES_PROVISIONED_NOT_ADMISSION' &&
    completion.executionAllowed === false && completion.nativeAdmission === false);
  need(source.candidateSha === completion.sourceSha && source.candidateSha === view.source.candidateSha && hex(source.candidateSha, 40));
  need(hex(source.tree, 40) && source.tree === view.source.tree && hex(source.sourceSealSha256, 64) && source.sourceSealSha256 === view.source.sourceSealSha256);
  need(completion.runId === view.runId && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(view.runId) && database === `jg_task01_${view.runId.replaceAll('-', '')}`);
  need(completion.containerId === view.resource.containerId && hex(completion.containerId, 64));
  need(oid(databaseOid) && oid(namespaceOid) && ownerOid === '10' && xid(systemIdentifier) && xid(commitXid));
  need(ledgerSha256 === LEDGER && Array.isArray(ledger) && ledger.length === 259 && sha(JSON.stringify(ledger)) === LEDGER);
  need(ordinary && ordinary.login === true && /^jg_fixture_app_[a-f0-9]{24}$/u.test(ordinary.name) && oid(ordinary.oid));
  need(Array.isArray(roles) && roles.length === ROLE_NAMES.length);
  const roleXmin = String(BigInt(commitXid) % 4294967296n);
  const qualified = roles.map(({ name, oid: roleOid, login, xmin, unlimitedValidity }, index) => {
    need(name === ROLE_NAMES[index] && oid(roleOid) && login === !name.endsWith('_owner'));
    need(oid(xmin) && xmin === roleXmin && unlimitedValidity === true);
    return Object.freeze({ name, oid: roleOid, login, xmin, unlimitedValidity });
  });
  need(new Set([ownerOid, ordinary.oid, ...qualified.map(role => role.oid)]).size === qualified.length + 2);
  need(Object.isFrozen(databaseAcl) && Array.isArray(databaseAcl?.before) &&
    Object.isFrozen(databaseAcl.after) && Array.isArray(databaseAcl.after) && databaseAcl.after.length > 0);
  return { source, completion, database, databaseOid, namespaceOid, ownerOid, systemIdentifier, ledger, commitXid,
    ordinary: Object.freeze({ name: ordinary.name, oid: ordinary.oid, login: true }), roles: Object.freeze(qualified),
    databaseAcl, collision: collisionRecipe(),
  };
}

const databaseAclSql = `(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
  'oid',d.oid::text,'name',d.datname,'owner',d.datdba::text,'acl',COALESCE((SELECT pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_array(a.grantor::text,a.grantee::text,a.privilege_type,a.is_grantable)
    ORDER BY a.grantor,a.grantee,a.privilege_type COLLATE "C",a.is_grantable)
    FROM pg_catalog.aclexplode(COALESCE(d.datacl,pg_catalog.acldefault('d',d.datdba))) a),'[]'::jsonb)) ORDER BY d.datname COLLATE "C")
 FROM pg_catalog.pg_database d)`;

function roleGuards(input) {
  const roles = [{ ...input.ordinary, xmin: null, limit: 0, password: 'absent' }, ...input.roles.map(role => ({ ...role,
    limit: role.login ? 1 : 0, password: role.name.startsWith('jg_task01_') ? 'scram' : 'absent',
  }))];
  const settings = [{ oid: input.roles.find(role => role.name === 'jg_task01_observer').oid,
    database: '0', config: ['default_transaction_read_only=on'] }];
  return `IF EXISTS(SELECT 1 FROM pg_catalog.jsonb_to_recordset(${json(roles)}) expected(name text,oid text,login boolean,"limit" int,password text,xmin text)
   WHERE NOT EXISTS(SELECT 1 FROM pg_catalog.pg_authid r WHERE r.oid::text=expected.oid AND r.rolname=expected.name
     AND r.rolcanlogin=expected.login AND r.rolconnlimit=expected."limit" AND NOT (r.rolsuper OR r.rolinherit OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls)
     AND (expected.xmin IS NULL OR r.xmin::text=expected.xmin) AND r.rolvaliduntil IS NULL
     AND CASE expected.password WHEN 'absent' THEN r.rolpassword IS NULL ELSE r.rolpassword LIKE 'SCRAM-SHA-256$%' END
     AND NOT pg_catalog.has_schema_privilege(r.oid,${literal(input.namespaceOid)}::oid,'CREATE')
     AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member=r.oid OR m.roleid=r.oid)
     AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_stat_activity a WHERE a.usesysid=r.oid))) THEN
   RAISE EXCEPTION 'CURRENT259_ARCHIVE_INSTALL_ROLES';
 END IF;
 IF (SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('oid',s.setrole::text,'database',s.setdatabase::text,'config',s.setconfig)
       ORDER BY s.setrole,s.setdatabase),'[]'::jsonb) FROM pg_catalog.pg_db_role_setting s
     WHERE s.setrole IN (${input.roles.map(role => `${literal(role.oid)}::oid`).join(',')})) IS DISTINCT FROM ${json(settings)} THEN
   RAISE EXCEPTION 'CURRENT259_ARCHIVE_INSTALL_ROLE_SETTINGS';
 END IF;
 IF ${databaseAclSql} IS DISTINCT FROM ${json(input.databaseAcl.after)} THEN RAISE EXCEPTION 'CURRENT259_ARCHIVE_INSTALL_DATABASE_ACL'; END IF;`;
}

function backendGuards(input, write) {
  const standardPath = 'search_path=pg_catalog, pg_temp';
  const specs = [
    ...INSTALLERS.map(([name, args, result, body], index) => ({ signature: `public.${name}(${args})`, result, body,
      language: 'plpgsql', volatility: 'v', strict: index === 0 || index === INSTALLERS.length - 1,
      config: index === 0 ? 'search_path=pg_catalog, public, pg_temp' : standardPath,
    })),
    ...CHECKERS.map(([signature, result, language, volatility, strict, body]) => ({
      signature: `public.${signature}`, result, language, volatility, strict, body, config: standardPath,
    })),
  ];
  return `IF current_user<>${literal(OWNER)} OR session_user<>current_user OR current_user::regrole::oid::text<>${literal(input.ownerOid)}
 OR pg_catalog.current_database()<>${literal(input.database)}
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_database WHERE oid=${literal(input.databaseOid)}::oid AND datname=pg_catalog.current_database() AND datdba=current_user::regrole::oid)
 OR pg_catalog.to_regnamespace('public')::oid::text IS DISTINCT FROM ${literal(input.namespaceOid)}
 OR (SELECT system_identifier::text FROM pg_catalog.pg_control_system())<>${literal(input.systemIdentifier)}
 OR pg_catalog.host(pg_catalog.inet_client_addr()) IS DISTINCT FROM '127.0.0.1'
 OR pg_catalog.host(pg_catalog.inet_server_addr()) IS DISTINCT FROM '127.0.0.1' OR pg_catalog.inet_server_port() IS DISTINCT FROM 5432
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_stat_ssl WHERE pid=pg_catalog.pg_backend_pid() AND ssl)
 OR pg_catalog.current_setting('server_version_num')::int / 10000<>16 OR pg_catalog.current_setting('session_replication_role')<>'origin'
 OR pg_catalog.current_setting('transaction_isolation')<>${literal(write ? 'serializable' : 'repeatable read')}
 OR pg_catalog.current_setting('transaction_read_only')<>${literal(write ? 'off' : 'on')}
 OR pg_catalog.pg_xact_status(${literal(input.commitXid)}::xid8) IS DISTINCT FROM 'committed' THEN
   RAISE EXCEPTION 'CURRENT259_ARCHIVE_INSTALL_BACKEND';
 END IF;
 IF (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',migration_name,'sha256',checksum,'finished',finished_at IS NOT NULL,'rolledBack',rolled_back_at IS NOT NULL) ORDER BY migration_name COLLATE "C") FROM public._prisma_migrations)
 IS DISTINCT FROM ${json(input.ledger)} THEN RAISE EXCEPTION 'CURRENT259_ARCHIVE_INSTALL_LEDGER'; END IF;
 ${roleGuards(input)}
 IF EXISTS(SELECT 1 FROM pg_catalog.jsonb_to_recordset(${json(specs)}) expected(signature text,result text,body text,strict boolean,config text,language text,volatility text)
   WHERE NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang
     WHERE p.oid=pg_catalog.to_regprocedure(expected.signature) AND p.proowner=current_user::regrole::oid
       AND p.pronamespace=pg_catalog.to_regnamespace('public') AND l.lanname=expected.language AND p.prokind='f' AND p.provolatile::text=expected.volatility AND p.proparallel='u'
       AND p.proisstrict=expected.strict AND NOT (p.proretset OR p.prosecdef OR p.proleakproof)
       AND p.pronargdefaults=0 AND p.provariadic=0 AND p.prosupport=0 AND p.prorettype=pg_catalog.to_regtype('pg_catalog.'||expected.result)
       AND p.proconfig=ARRAY[expected.config] AND ${digestSql('p.prosrc')}=expected.body
       AND (SELECT count(*)=1 AND bool_and(a.grantee=p.proowner AND a.grantor=p.proowner AND a.privilege_type='EXECUTE')
         FROM pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a))) THEN
   RAISE EXCEPTION 'CURRENT259_ARCHIVE_INSTALL_ROUTINES';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM ${PENDING} b JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(${literal(REGISTRY)})
   WHERE b."protocolVersion"=1 AND b."applicationRoleOid"::text=${literal(input.ordinary.oid)} AND b."databaseOid"::text=${literal(input.databaseOid)}
     AND b."anchorOwnerOid"::text=${literal(input.ownerOid)} AND b."anchorNamespaceOid"::text=${literal(input.namespaceOid)}
     AND p.oid::text=b."bindings"->'routines'->${literal(REGISTRY)}->>'oid'
     AND ${digestSql('p.prosrc')}=b."bindings"->'routines'->${literal(REGISTRY)}->>'bodySha256')
   OR pg_catalog.to_regprocedure('public.jg_file_business_binding_columns_before_registered_payment()') IS NOT NULL
   OR pg_catalog.to_regclass('public."RegisteredPaymentVoucher"') IS NOT NULL THEN
   RAISE EXCEPTION 'CURRENT259_ARCHIVE_INSTALL_ORIGINAL_REGISTRY';
 END IF;`;
}

const registrySql = `(SELECT ${digestSql("pg_catalog.to_jsonb(p)-'proacl'")} FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure(${literal(REGISTRY)}))`;
const registeredOriginalRegistrySql = `(SELECT ${digestSql(`(pg_catalog.to_jsonb(p)-'proacl') || pg_catalog.jsonb_build_object(
  'proname','jg_file_business_binding_columns','proconfig',NULL::text[])`)}
  FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure(${literal(REGISTERED_ALIAS)}))`;
const pendingSql = `(SELECT ${digestSql('pg_catalog.to_jsonb(b)')} FROM ${PENDING} b WHERE b."protocolVersion"=1)`;
const catalogSql = digestSql(`pg_catalog.jsonb_build_array(
  (SELECT pg_catalog.jsonb_build_array(n.oid,n.nspowner,n.nspacl::text) FROM pg_catalog.pg_namespace n WHERE n.nspname='public'),
  (SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(d) ORDER BY d.oid) FROM pg_catalog.pg_default_acl d),
  (SELECT pg_catalog.jsonb_agg(${digestSql('pg_catalog.to_jsonb(p)')} ORDER BY p.oid) FROM pg_catalog.pg_proc p WHERE p.pronamespace=pg_catalog.to_regnamespace('public')),
  (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(c.oid,c.relname,c.relkind,c.relowner,c.relacl::text,c.relrowsecurity,c.relforcerowsecurity) ORDER BY c.oid)
   FROM pg_catalog.pg_class c WHERE c.relnamespace=pg_catalog.to_regnamespace('public')),
  (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(a.attrelid,a.attnum,a.attname,a.atttypid,a.attnotnull,a.attacl::text) ORDER BY a.attrelid,a.attnum)
   FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid WHERE c.relnamespace=pg_catalog.to_regnamespace('public') AND a.attnum>0 AND NOT a.attisdropped),
  (SELECT pg_catalog.jsonb_agg(${digestSql('pg_catalog.to_jsonb(t)')} ORDER BY t.oid) FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace=pg_catalog.to_regnamespace('public')),
  (SELECT pg_catalog.jsonb_agg(${digestSql('pg_catalog.to_jsonb(c)')} ORDER BY c.oid) FROM pg_catalog.pg_constraint c WHERE c.connamespace=pg_catalog.to_regnamespace('public')))`);

function beforeGuards() {
  return `IF ${Object.values(TABLES).map(table => `EXISTS(SELECT 1 FROM public.${table})`).join('\n OR ')} THEN
 RAISE EXCEPTION 'CURRENT259_ARCHIVE_INSTALL_PREEXISTING'; END IF;`;
}

function collisionGuards(input, phase) {
  const executor = input.roles.find(role => role.name === EXECUTOR).oid;
  const unavailable = input.roles.filter(role => role.name.startsWith('jg_task01_')).map(role => role.oid);
  const registered = phase === 'registered';
  const post = phase === 'post' || registered;
  const stage = post ? 'POSTIMAGE' : 'PREIMAGE';
  const faultSql = `RAISE EXCEPTION 'CURRENT259_ARCHIVE_INSTALL_COLLISION_${stage}';`;
  const specs = json(input.collision);
  const liveAcl = `(SELECT COALESCE(pg_catalog.jsonb_agg(grant_row ORDER BY grant_row),'[]'::jsonb)
   FROM (SELECT pg_catalog.jsonb_build_array(a.grantor::text,a.grantee::text,a.privilege_type,a.is_grantable) grant_row
     FROM pg_catalog.aclexplode(live.proacl) a) observed)`;
  const compare = post ? `IF ${liveAcl} IS DISTINCT FROM (
    SELECT pg_catalog.jsonb_agg(entry ORDER BY entry) FROM pg_catalog.jsonb_array_elements(
      old_acl || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_array(${literal(input.ownerOid)},${literal(executor)},'EXECUTE',false))) grants(entry))
    OR NOT pg_catalog.has_function_privilege(${literal(executor)}::oid,live.oid,'EXECUTE')
    OR pg_catalog.has_function_privilege(${literal(executor)}::oid,live.oid,'EXECUTE WITH GRANT OPTION') THEN ${faultSql} END IF;`
    : `IF pg_catalog.to_jsonb(live.proacl) IS DISTINCT FROM historical->'acl'
    OR pg_catalog.has_function_privilege(${literal(executor)}::oid,live.oid,'EXECUTE') THEN ${faultSql} END IF;`;
  return `DECLARE
  original_routines jsonb; original_callers oid[]; collision record; historical jsonb; live record; old_acl jsonb;
 BEGIN
  SELECT b."bindings"->'routines',b."fileCallerOids" INTO STRICT original_routines,original_callers FROM ${PENDING} b
   WHERE b."protocolVersion"=1 AND b."recipeVersion"='contract-direct-pending-input-v1/1';
  IF COALESCE(cardinality(original_callers),0)<1 OR ${literal(executor)}::oid=ANY(original_callers)
   OR (SELECT array_agg(k.signature ORDER BY k.signature COLLATE "C") FROM pg_catalog.jsonb_object_keys(original_routines) k(signature)
     WHERE pg_catalog.starts_with(k.signature,'public.jg_file_business_binding_columns') OR k.signature IN (${COLLISION_ROOTS.map(literal).join(',')}))
    IS DISTINCT FROM ARRAY(SELECT signature FROM pg_catalog.jsonb_to_recordset(${specs}) s(signature text) ORDER BY signature COLLATE "C")
   OR (SELECT count(DISTINCT original_routines->signature->>'oid') FROM pg_catalog.jsonb_to_recordset(${specs}) s(signature text))<>24
  THEN ${faultSql} END IF;
  FOR collision IN SELECT * FROM pg_catalog.jsonb_to_recordset(${specs}) s(signature text,"bodySha256" text) ORDER BY signature COLLATE "C" LOOP
   historical := original_routines->collision.signature;
   SELECT p.oid,p.proacl,pg_catalog.jsonb_build_object(
     'oid',p.oid::text,'namespaceOid',p.pronamespace::text,'ownerOid',p.proowner::text,
     'bodySha256',${digestSql('p.prosrc')},'securityDefiner',p.prosecdef,'configuration',p.proconfig,'language',l.lanname,
     'returnType',t.typname,'volatility',p.provolatile,'parallel',p.proparallel,'strict',p.proisstrict,'returnsSet',p.proretset) AS metadata
    INTO STRICT live FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang
     JOIN pg_catalog.pg_type t ON t.oid=p.prorettype
    WHERE p.oid=pg_catalog.to_regprocedure(${registered ? `CASE WHEN collision.signature=${literal(REGISTRY)} THEN ${literal(REGISTERED_ALIAS)} ELSE collision.signature END` : 'collision.signature'}) AND p.proowner=${literal(input.ownerOid)}::oid
      AND p.pronamespace=${literal(input.namespaceOid)}::oid AND p.prokind='f' AND NOT p.prosecdef;
   IF historical->>'bodySha256' IS DISTINCT FROM collision."bodySha256" OR live.metadata IS DISTINCT FROM ${registered
     ? `(CASE WHEN collision.signature IN (${[REGISTRY, ENFORCER].map(literal).join(',')})
       THEN jsonb_set(historical-'acl','{configuration}',${json(['search_path=pg_catalog, public, pg_temp'])}) ELSE historical-'acl' END)`
     : "historical-'acl'"}
     OR pg_catalog.jsonb_typeof(historical->'acl') IS DISTINCT FROM 'array' THEN ${faultSql} END IF;
   SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(a.grantor::text,a.grantee::text,a.privilege_type,a.is_grantable)) INTO old_acl
    FROM pg_catalog.aclexplode(ARRAY(SELECT raw::aclitem FROM pg_catalog.jsonb_array_elements_text(historical->'acl') h(raw))) a;
   IF old_acl IS NULL OR EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(old_acl) grants(entry)
     WHERE entry->>2<>'EXECUTE' OR entry->>1 IN (${['0', executor, ...unavailable].map(literal).join(',')}) OR entry->>0=${literal(executor)})
    OR EXISTS(SELECT 1 FROM pg_catalog.unnest(original_callers) c(oid)
      WHERE pg_catalog.has_function_privilege(c.oid,live.oid,'EXECUTE') IS DISTINCT FROM true)
   THEN ${faultSql} END IF;
   ${compare}
   ${phase === 'grant' ? `EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION %s TO %I',live.oid::regprocedure,${literal(EXECUTOR)});` : ''}
  END LOOP;
 END;`;
}

function installedGuards(input, writeXid, write) {
  const ids = Object.fromEntries(input.roles.map(role => [role.name, literal(role.oid)]));
  const bindings = Object.values(TABLES).map(table => `(SELECT count(*)=1 AND bool_and(xmin::text::numeric=mod((${writeXid})::text::numeric,4294967296)) FROM public.${table})`);
  return `IF NOT COALESCE(${bindings.join(' AND ')},false)
 OR NOT EXISTS(SELECT 1 FROM public.${TABLES.outside} o JOIN public.${TABLES.nativeNonce} n ON n."protocolVersion"=1
   AND n."intentBindingSha256"=${digestSql('pg_catalog.to_jsonb(o)')}
   JOIN public.jg_contract_direct_archive_completion_binding_v1 upstream ON upstream.tableoid=o."completionRelationOid"
     AND upstream."protocolVersion"=1 AND ${digestSql('pg_catalog.to_jsonb(upstream)')}=o."completionSha256"
   JOIN public.${TABLES.issuer} i ON i."outsideBindingSha256"=n."intentBindingSha256"
   JOIN public.${TABLES.closure} c ON c."issuerBindingSha256"=${digestSql('pg_catalog.to_jsonb(i)')}
   JOIN public.${TABLES.execution} e ON e."sourceClosureSha256"=${digestSql('pg_catalog.to_jsonb(c)')}
   WHERE o."protocolVersion"=1 AND o."databaseOid"::text=${literal(input.databaseOid)} AND o."namespaceOid"::text=${literal(input.namespaceOid)}
     AND o."anchorOwnerOid"::text=${literal(input.ownerOid)} AND o."ordinaryApplicationRoleOid"::text=${literal(input.ordinary.oid)}
     AND o."issuerSessionOid"::text=${ids[OUTSIDE_ROLES[0]]} AND o."issuerOwnerOid"::text=${ids[OUTSIDE_ROLES[1]]}
     AND o."runtimeSessionOid"::text=${ids[OUTSIDE_ROLES[2]]} AND o."executorOwnerOid"::text=${ids[OUTSIDE_ROLES[3]]}
     AND i."issuerSessionOid"::text=${ids[UPWARD_ROLES[0]]} AND i."issuerOwnerOid"::text=${ids[UPWARD_ROLES[1]]}
     ${write ? 'AND i."channelNonce"=install_nonce' : ''} AND c."runtimeSessionOid"::text=${ids[UPWARD_ROLES[2]]}
     AND c."applicationRoleOid"::text=${literal(input.ordinary.oid)} AND e."applicationRoleOid"=c."applicationRoleOid")
 OR public.jg_direct_outside_operating_basis_catalog_v2() IS DISTINCT FROM true
 OR public.jg_require_contract_direct_upward_source_v2() IS DISTINCT FROM (SELECT "sourceClosureSha256" FROM public.${TABLES.execution}) THEN
 RAISE EXCEPTION 'CURRENT259_ARCHIVE_INSTALL_POSTSTATE'; END IF;`;
}

const closureSql = `(SELECT "sourceClosureSha256" FROM public.${TABLES.execution})`;
const bindingSql = digestSql(`pg_catalog.jsonb_build_array(${Object.values(TABLES).map(table => `(SELECT pg_catalog.to_jsonb(b) FROM public.${table} b)`).join(',')})`);
const outsideCalls = input => [
    `PERFORM public.${OUTSIDE}(${OUTSIDE_ROLES.map(role => `${literal(role)}::name`).join(',')});`,
    ...INSTALLERS.slice(1, -1).map(([name]) => `PERFORM public.${name}();`),
  ].join('\n ');
function upwardCall(input) {
  const upwardRuntime = input.roles.find(role => role.name === UPWARD_ROLES[2]);
  return [
    'install_nonce := pg_catalog.gen_random_uuid();',
    `upward := public.${UPWARD}(${UPWARD_ROLES.map(role => `${literal(role)}::text`).join(',')},install_nonce);`,
    `IF upward IS DISTINCT FROM pg_catalog.jsonb_build_object('protocolVersion',2,'sourceClosureSha256',${closureSql},
       'databaseOid',${literal(input.databaseOid)},'applicationRoleOid',${literal(input.ordinary.oid)},'runtimeRoleOid',${literal(upwardRuntime.oid)})
      THEN RAISE EXCEPTION 'CURRENT259_ARCHIVE_INSTALL_UPWARD_RESULT'; END IF;`,
  ].join('\n ');
}
function beginArchive(write) {
  return `\\set VERBOSITY terse
SET log_min_error_statement TO 'panic';
SET log_error_verbosity TO 'terse';
SET log_statement TO 'none';
SET log_duration TO 'off';
SET log_min_duration_statement TO -1;
SET log_min_duration_sample TO -1;
SET log_transaction_sample_rate TO 0;
SET log_parameter_max_length TO 0;
SET log_parameter_max_length_on_error TO 0;
SET debug_print_parse TO 'off';
SET debug_print_rewritten TO 'off';
SET debug_print_plan TO 'off';
BEGIN ISOLATION LEVEL ${write ? 'SERIALIZABLE' : 'REPEATABLE READ READ ONLY'};
SET LOCAL search_path TO pg_catalog, pg_temp;
SET LOCAL lock_timeout TO '4s';
SET LOCAL statement_timeout TO '100s';
${write ? 'LOCK TABLE public._prisma_migrations IN SHARE MODE;\nLOCK TABLE '+Object.values(TABLES).map(table => `public.${table}`).join(',')+' IN ACCESS EXCLUSIVE MODE NOWAIT;' : ''}`;
}
function render(input, phase, challenge, prior) {
  const write = phase === STAGES[1], committed = phase === STAGES[2];
  const installXid = write ? 'pg_catalog.pg_current_xact_id()' : committed ? `${literal(prior.installXid)}::xid8` : 'NULL::xid8';
  const closure = write || committed ? closureSql : 'NULL::text';
  const binding = write || committed ? bindingSql : 'NULL::text';
  const calls = write ? outsideCalls(input)+'\n '+upwardCall(input) : '';
  return `${beginArchive(write)}
DO $archive_install$
DECLARE upward jsonb; install_nonce uuid;
BEGIN
 ${backendGuards(input, write)}
 ${!committed ? beforeGuards() : ''}
 ${write ? `IF ${catalogSql} IS DISTINCT FROM ${literal(prior.catalogSha256)} THEN RAISE EXCEPTION 'CURRENT259_ARCHIVE_INSTALL_DRIFT'; END IF;` : ''}
 ${!committed ? collisionGuards(input, write ? 'grant' : 'before') : ''}
 ${calls}
 ${write ? roleGuards(input) : '' }
 ${write || committed ? installedGuards(input, installXid, write) : ''}
 ${write || committed ? collisionGuards(input, 'post') : ''}
 ${write || committed ? `IF ${registrySql} IS DISTINCT FROM ${literal(prior.registrySha256)} THEN RAISE EXCEPTION 'CURRENT259_ARCHIVE_INSTALL_REGISTRY_DRIFT'; END IF;` : ''}
 ${write || committed ? `IF ${pendingSql} IS DISTINCT FROM ${literal(prior.pendingSha256)} THEN RAISE EXCEPTION 'CURRENT259_ARCHIVE_INSTALL_PENDING_DRIFT'; END IF;` : ''}
END;
$archive_install$;
SELECT pg_catalog.jsonb_build_object('challenge','${challenge}','phase',${literal(phase)},
 'backendPid',pg_catalog.pg_backend_pid(),'backendStart',pg_catalog.to_char(a.backend_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 'catalogSha256',${catalogSql},'registrySha256',${registrySql},'pendingSha256',${pendingSql},'installXid',(${installXid})::text,
 'commitStatus',${committed ? `pg_catalog.pg_xact_status(${installXid})` : 'NULL::text'},'closureSha256',${closure},'bindingSha256',${binding})
 FROM pg_catalog.pg_stat_activity a WHERE a.pid=pg_catalog.pg_backend_pid();
COMMIT;
`;
}

function registeredMidstate(input) {
  const ids = Object.fromEntries(input.roles.map(role => [role.name, literal(role.oid)]));
  return `IF NOT COALESCE(${[TABLES.outside,TABLES.nativeNonce].map(table =>
    `(SELECT count(*)=1 AND bool_and(xmin::text::numeric=mod(pg_catalog.pg_current_xact_id()::text::numeric,4294967296)) FROM public.${table})`).join(' AND ')},false)
  OR NOT EXISTS(SELECT 1 FROM public.${TABLES.outside} o JOIN public.${TABLES.nativeNonce} n ON n."protocolVersion"=1
   AND n."intentBindingSha256"=${digestSql('pg_catalog.to_jsonb(o)')} AND n."nonce" IS NOT NULL
   JOIN public.jg_contract_direct_archive_completion_binding_v1 c ON c.tableoid=o."completionRelationOid"
     AND c."protocolVersion"=1 AND ${digestSql('pg_catalog.to_jsonb(c)')}=o."completionSha256"
   WHERE o."protocolVersion"=1 AND o."databaseOid"::text=${literal(input.databaseOid)} AND o."namespaceOid"::text=${literal(input.namespaceOid)}
    AND o."anchorOwnerOid"::text=${literal(input.ownerOid)} AND o."ordinaryApplicationRoleOid"::text=${literal(input.ordinary.oid)}
    AND o."issuerSessionOid"::text=${ids[OUTSIDE_ROLES[0]]} AND o."issuerOwnerOid"::text=${ids[OUTSIDE_ROLES[1]]}
    AND o."runtimeSessionOid"::text=${ids[OUTSIDE_ROLES[2]]} AND o."executorOwnerOid"::text=${ids[OUTSIDE_ROLES[3]]})
  OR ${[TABLES.issuer,TABLES.closure,TABLES.execution].map(table=>`EXISTS(SELECT 1 FROM public.${table})`).join(' OR ')}
  OR public.jg_direct_outside_operating_basis_catalog_v2() IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'CURRENT259_ARCHIVE_INSTALL_REGISTERED_MIDSTATE'; END IF;`;
}
function renderRegistered(input, phase, challenge, before, material, staged) {
  const write = phase === REGISTERED_STAGES[0];
  const installXid = write ? 'pg_catalog.pg_current_xact_id()' : `${literal(staged.installXid)}::xid8`;
  return `${beginArchive(write)}
${write ? `DO $archive_registered_before$
BEGIN
 ${backendGuards(input, true)}
 ${beforeGuards()}
 IF ${catalogSql} IS DISTINCT FROM ${literal(before.catalogSha256)}
   OR ${registrySql} IS DISTINCT FROM ${literal(before.registrySha256)}
   OR ${pendingSql} IS DISTINCT FROM ${literal(before.pendingSha256)}
 THEN RAISE EXCEPTION 'CURRENT259_ARCHIVE_INSTALL_DRIFT'; END IF;
 ${collisionGuards(input, 'before')}
END;
$archive_registered_before$;
${material.writerBefore}
SET LOCAL search_path TO pg_catalog, pg_temp;
DO $archive_registered_middle$
BEGIN
 ${collisionGuards(input, 'grant')}
 ${outsideCalls(input)}
 ${registeredMidstate(input)}
 ${collisionGuards(input, 'post')}
 IF ${registrySql} IS DISTINCT FROM ${literal(before.registrySha256)}
   OR ${pendingSql} IS DISTINCT FROM ${literal(before.pendingSha256)}
 THEN RAISE EXCEPTION 'CURRENT259_ARCHIVE_INSTALL_REGISTERED_DRIFT'; END IF;
END;
$archive_registered_middle$;
${material.writerMiddle}
SET LOCAL search_path TO pg_catalog, pg_temp;` : ''}
DO $archive_registered_final$
DECLARE upward jsonb; install_nonce uuid;
BEGIN
 ${backendGuards(input, write)}
 ${write ? upwardCall(input) : `IF pg_catalog.pg_xact_status(${installXid}) IS DISTINCT FROM 'committed'
   THEN RAISE EXCEPTION 'CURRENT259_ARCHIVE_INSTALL_REGISTERED_NOT_COMMITTED'; END IF;`}
 ${write ? roleGuards(input) : ''}
 ${installedGuards(input, installXid, write)}
 ${collisionGuards(input, 'registered')}
 IF ${registeredOriginalRegistrySql} IS DISTINCT FROM ${literal(before.registrySha256)}
   OR ${pendingSql} IS DISTINCT FROM ${literal(before.pendingSha256)}
 THEN RAISE EXCEPTION 'CURRENT259_ARCHIVE_INSTALL_REGISTERED_DRIFT'; END IF;
END;
$archive_registered_final$;
SET LOCAL search_path TO pg_catalog, public, pg_temp;
SET LOCAL quote_all_identifiers TO off;
SET LOCAL standard_conforming_strings TO on;
${!write ? `${material.committedCheck(staged.installXid)}
DO $archive_registered_committed$
BEGIN
 IF ${catalogSql} IS DISTINCT FROM ${literal(staged.catalogSha256)}
   OR ${registrySql} IS DISTINCT FROM ${literal(staged.registrySha256)}
   OR ${material.finalCatalog} IS DISTINCT FROM ${literal(staged.sevenCatalogSha256)}
 THEN RAISE EXCEPTION 'CURRENT259_ARCHIVE_INSTALL_REGISTERED_COMMITTED_DRIFT'; END IF;
END;
$archive_registered_committed$;` : ''}
SELECT pg_catalog.jsonb_build_object('challenge','${challenge}','phase',${literal(phase)},
 'backendPid',pg_catalog.pg_backend_pid(),'backendStart',pg_catalog.to_char(a.backend_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 'catalogSha256',${catalogSql},'registrySha256',${registrySql},'pendingSha256',${pendingSql},'installXid',(${installXid})::text,
 'commitStatus',${write ? 'NULL::text' : `pg_catalog.pg_xact_status(${installXid})`},'closureSha256',${closureSql},'bindingSha256',${bindingSql},
 'originalRegistrySha256',${registeredOriginalRegistrySql},'sevenCatalogSha256',${material.finalCatalog})
 FROM pg_catalog.pg_stat_activity a WHERE a.pid=pg_catalog.pg_backend_pid();
COMMIT;
`;
}
function readResult(result, phase, challenge) {
  need(result && typeof result.stdout === 'string' && Buffer.byteLength(result.stdout) <= 8192);
  const row = JSON.parse(result.stdout);
  const registered = REGISTERED_STAGES.includes(phase);
  need(row && Object.keys(row).length === (registered ? 13 : 11) && row.phase === phase && row.challenge === challenge &&
    Number.isInteger(row.backendPid) && row.backendPid > 0 && row.backendPid <= 0x7fffffff &&
    typeof row.backendStart === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/u.test(row.backendStart) &&
    hex(row.catalogSha256, 64) && hex(row.registrySha256, 64) && hex(row.pendingSha256, 64));
  if (phase === STAGES[0]) need(row.installXid === null && row.commitStatus === null && row.closureSha256 === null && row.bindingSha256 === null);
  else need(xid(row.installXid) && hex(row.closureSha256, 64) && hex(row.bindingSha256, 64) && row.commitStatus === (phase === STAGES[2] || phase === REGISTERED_STAGES[1] ? 'committed' : null));
  if (registered) need(hex(row.originalRegistrySha256, 64) && hex(row.sevenCatalogSha256, 64));
  return row;
}

async function installCurrent259ArchiveAuthorities(provisionResult, handle) {
  need(arguments.length === 2);
  return installArchive(provisionResult, handle, false);
}
async function installCurrent259ArchiveAuthoritiesWithRegisteredFileSource(provisionResult, handle) {
  need(arguments.length === 2);
  return installArchive(provisionResult, handle, true);
}
async function installArchive(provisionResult, handle, registered) {
  need(handle && typeof handle === 'object' && !types.isProxy(handle) && !attempted.has(handle));
  const lease = claimCurrent259ProvisionedRoles(provisionResult, handle);
  attempted.add(handle);
  let writing = false, phase = STAGES[0];
  try {
    const view = claimCurrent259TechnicalResource(handle);
    const check = () => { lease.check(); view.check(); view.verifyFull(); };
    check();
    const input = roleInput(lease, view);
    const read = async (next, prior) => {
      phase = next;
      check();
      const challenge = randomBytes(32).toString('hex');
      const sql = render(input, phase, challenge, prior);
      if (phase === STAGES[1]) writing = true;
      const result = await view.resource.execOwnerSql(sql, phase);
      check();
      return readResult(result, phase, challenge);
    };
    const before = await read(STAGES[0]);
    let staged, committed;
    if (registered) {
      phase = 'current259-seven-before';
      const plan = archiveSevenMaterial(lease, view, randomBytes(32).toString('hex'));
      check();
      const beforeSeven = await view.resource.execOwnerSql(plan.beforeSql, phase);
      check();
      const material = plan.readBefore(beforeSeven);
      const distinct = (a, b) => a.backendPid !== b.backendPid && a.backendStart !== b.backendStart;
      need(distinct(before, material));
      const runRegistered = async (next, prior) => {
        phase = next;
        const challenge = randomBytes(32).toString('hex');
        const sql = renderRegistered(input, phase, challenge, before, material, prior);
        check();
        if (next === REGISTERED_STAGES[0]) writing = true;
        const result = await view.resource.execOwnerSql(sql, phase);
        check();
        return readResult(result, phase, challenge);
      };
      staged = await runRegistered(REGISTERED_STAGES[0]);
      need(staged.originalRegistrySha256 === before.registrySha256 && staged.registrySha256 !== before.registrySha256 &&
        staged.pendingSha256 === before.pendingSha256 && staged.catalogSha256 !== before.catalogSha256 &&
        staged.installXid !== input.commitXid && distinct(staged, before) && distinct(staged, material));
      committed = await runRegistered(REGISTERED_STAGES[1], staged);
      need(committed.originalRegistrySha256 === staged.originalRegistrySha256 && committed.sevenCatalogSha256 === staged.sevenCatalogSha256 &&
        distinct(committed, before) && distinct(committed, material));
    } else {
      staged = await read(STAGES[1], before);
      need(staged.registrySha256 === before.registrySha256 && staged.pendingSha256 === before.pendingSha256 &&
        staged.catalogSha256 !== before.catalogSha256 && staged.installXid !== input.commitXid);
      committed = await read(STAGES[2], staged);
    }
    need(committed.backendPid !== staged.backendPid && committed.backendStart !== staged.backendStart &&
      ['installXid', 'bindingSha256', 'closureSha256', 'registrySha256', 'pendingSha256', 'catalogSha256'].every(key => committed[key] === staged[key]));
    check();
    const completion = Object.freeze({ status: 'CURRENT259_ARCHIVE_AUTHORITIES_INSTALLED', sourceSha: input.completion.sourceSha,
      runId: input.completion.runId, containerId: input.completion.containerId, databaseIdentity: input.completion.databaseIdentity,
      ordinary: input.ordinary, roles: input.roles, installXid: committed.installXid, upwardClosureSha256: committed.closureSha256,
      bindingSha256: committed.bindingSha256, registrySha256: committed.registrySha256, pendingSha256: committed.pendingSha256,
      catalogSha256: committed.catalogSha256,
      ...(registered ? { registeredFileSource: true, nativeAdmission: false, executionAllowed: false,
        originalRegistrySha256: committed.originalRegistrySha256, sevenCatalogSha256: committed.sevenCatalogSha256 } : {}),
    });
    receipts.set(completion, { source: input.source, roleCompletion: input.completion, handle, check });
    return completion;
  } catch {
    try { await closeCurrent259OwnedResource(handle); }
    catch { throw Object.assign(fault(writing ? 'CURRENT259_ARCHIVE_INSTALL_COMMIT_AND_CLEANUP_UNCONFIRMED' : 'CURRENT259_ARCHIVE_INSTALL_CLEANUP_UNCONFIRMED'), { phase }); }
    throw Object.assign(fault(writing ? 'CURRENT259_ARCHIVE_INSTALL_COMMIT_UNCONFIRMED' : 'CURRENT259_ARCHIVE_INSTALL_PRESTATE_REJECTED'), { phase });
  }
}

function claimCurrent259ArchiveInstallation(completion, handle) {
  need(arguments.length === 2 && completion && !types.isProxy(completion) && receipts.has(completion));
  const receipt = receipts.get(completion);
  need(receipt.handle === handle);
  receipts.delete(completion);
  receipt.check();
  return Object.freeze({ source: receipt.source, completion, roleCompletion: receipt.roleCompletion, check: receipt.check });
}

module.exports = Object.freeze({ installCurrent259ArchiveAuthorities, installCurrent259ArchiveAuthoritiesWithRegisteredFileSource, claimCurrent259ArchiveInstallation });
