"use strict";

const { createHash } = require("node:crypto");
const { isDeepStrictEqual, types } = require("node:util");
const readbackFrameBytes = 24 * 1024;
const readbackPayloadLimit = 768 * 1024;
const readbackWireLimit = 1025 * 1024;
const need = ok => { if (!ok) throw new Error("LOCAL_MIGRATION_CONTROL"); };
const oid = value => typeof value === "string" && /^[1-9][0-9]{0,9}$/u.test(value) &&
  Number(value) <= 0xffffffff;
function dataRecord(value) {
  need(value && !types.isProxy(value) && Object.getPrototypeOf(value) === Object.prototype &&
    Reflect.ownKeys(value).every(key => typeof key === "string") &&
    Object.values(Object.getOwnPropertyDescriptors(value)).every(field => Object.hasOwn(field, "value")));
  return Object.freeze({ ...value });
}
function dataArray(value) {
  need(Array.isArray(value) && !types.isProxy(value) &&
    Object.values(Object.getOwnPropertyDescriptors(value)).every(field => Object.hasOwn(field, "value")));
  return Object.freeze([...value]);
}
function checkSetup(row, plan) {
  plan = checkPlan(plan);
  row = dataRecord(row);
  const callers = dataArray(row.fileCallerOids);
  need(row && !types.isProxy(row) && row.runId === plan.runId && row.qualified === true &&
    oid(row.appOid) && Number(row.appOid) >= 16384 && row.appOid !== plan.actorOid &&
    [row.schemaOid, row.controlOid, row.eventOid].every(oid) &&
    Array.isArray(row.fileCallerOids) && row.fileCallerOids.length > 0 && row.fileCallerOids.length <= 256 &&
    callers.every((value, index, values) => Number.isInteger(value) && value > 0 &&
      value <= 0xffffffff && (index === 0 || value > values[index - 1])));
}
module.exports = { checkSetup };

const fs = require("node:fs");
const path = require("node:path");
const technicalProfiles = require("./local-staged-technical-profile-policy.cjs");
const matrix = require("./local-staged-migration-qualification.json");
const hash = /^[a-f0-9]{64}$/u;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const literal = value => "'" + JSON.stringify(value).replaceAll("'", "''") + "'";
function checkPlan(input) {
  let plan = dataRecord(input);
  const keys = ["database", "databaseOid", "namespaceOid", "actorOid", "ownerOid", "systemIdentifier",
    "runId", "nonce", "appName", "schemaName", "migrations", "technicalProfile", "resourceRunId"];
  need(Object.keys(plan).every(key => keys.includes(key)));
  if (Object.hasOwn(plan, "migrations")) {
    const migrations = dataArray(plan.migrations).map(dataRecord);
    need(migrations.every(row => Object.keys(row).length === 2 &&
      Object.hasOwn(row, "name") && Object.hasOwn(row, "sha256") &&
      typeof row.name === "string" && /^[0-9]{14}_[a-z0-9_]+$/u.test(row.name) &&
      typeof row.sha256 === "string" && hash.test(row.sha256)));
    plan = Object.freeze({ ...plan, migrations: Object.freeze(migrations) });
  }
  const technical = technicalProfiles.planProfile(plan);
  need(plan && !types.isProxy(plan) && uuid.test(plan.runId) && hash.test(plan.nonce) &&
    /^jg_fixture_app_[a-f0-9]{24}$/u.test(plan.appName) &&
    /^jg_fixture_[a-f0-9]{24}$/u.test(plan.schemaName) &&
    (technical ? plan.database === "jg_task01_" + plan.resourceRunId.replaceAll("-", "") : /^jiangkong_project_financing_quota_[a-z0-9_]+$/u.test(plan.database)) &&
    [plan.databaseOid, plan.namespaceOid, plan.actorOid, plan.ownerOid].every(oid) &&
    plan.ownerOid === plan.actorOid && typeof plan.systemIdentifier === "string" &&
    /^[1-9][0-9]{0,19}$/u.test(plan.systemIdentifier) &&
    BigInt(plan.systemIdentifier) <= 0xffffffffffffffffn);
  return plan;
}
function setupSql(plan) {
  plan = checkPlan(plan);
  need(Array.isArray(plan.migrations) && plan.migrations.length === 205 &&
    plan.migrations.every(row => row && /^[0-9]{14}_[a-z0-9_]+$/u.test(row.name) && hash.test(row.sha256)) &&
    plan.migrations[203].sha256 === "296c6e2f502bc782bd83ab59190505e27b80623d1da1a3b6dddb72c414eb686f" &&
    plan.migrations[204].sha256 === "2ca118b29e8e75745a1ac7d6f8de3fbfa70fa5774b3d95c48c6119caff8b316a");
  return technicalProfiles.projectTechnicalSql(plan, fs.readFileSync(path.join(__dirname, "local-staged-migration-acl.sql"), "utf8"), "setup").sql
    .replaceAll("__SCHEMA__", plan.schemaName).replaceAll("__APP__", plan.appName)
    .replaceAll("__PLAN__", literal(plan)).replaceAll("__MATRIX__", literal(matrix))
    .replaceAll("__READBACK_FRAME_BYTES__", String(readbackFrameBytes))
    .replaceAll("__READBACK_PAYLOAD_LIMIT__", String(readbackPayloadLimit));
}

function inspectBody(extra = "'{}'::jsonb") {
  // XMLTABLE executes a fixed query only when the ledger actually exists.
  // Merely wrapping a nonexistent relation in CASE would still fail PostgreSQL parse analysis.
  const ledgerQuery = `SELECT coalesce(jsonb_agg(jsonb_build_object('name',migration_name,'sha256',checksum,
    'finished',finished_at IS NOT NULL,'rolledBack',rolled_back_at IS NOT NULL)
    ORDER BY migration_name COLLATE "C",started_at,id),'[]'::jsonb) AS payload FROM public._prisma_migrations`;
  return `SELECT jsonb_build_object('database',current_database(),'databaseOid',d.oid::text,
    'namespaceOid',to_regnamespace('public')::oid::text,'actorOid',current_user::regrole::oid::text,
    'ownerOid',d.datdba::text,'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
    'actor',current_user,'sessionActor',session_user,'version',current_setting('server_version_num')::integer,
    'encoding',getdatabaseencoding(),'replication',current_setting('session_replication_role'),
    'ledger',CASE WHEN to_regclass('public._prisma_migrations') IS NULL THEN '[]'::jsonb
      ELSE (SELECT payload::jsonb FROM XMLTABLE('/table/row' PASSING query_to_xml(
       '${ledgerQuery.replaceAll("'", "''")}',false,false,'') COLUMNS payload text PATH 'payload')) END,
    'roles',(SELECT jsonb_agg(jsonb_build_object('oid',r.oid::text,'name',r.rolname,
      'superuser',r.rolsuper,'createRole',r.rolcreaterole,'createDb',r.rolcreatedb,
      'replication',r.rolreplication,'bypassRls',r.rolbypassrls,'canLogin',r.rolcanlogin,
      'inherit',r.rolinherit,'connectionLimit',r.rolconnlimit,
      'memberships',(SELECT coalesce(jsonb_agg(jsonb_build_object('roleOid',m.roleid::text,
        'grantorOid',m.grantor::text,'set',m.set_option,'inherit',m.inherit_option,'admin',m.admin_option)
        ORDER BY m.roleid,m.grantor),'[]'::jsonb) FROM pg_auth_members m WHERE m.member=r.oid))
      ORDER BY r.oid) FROM pg_roles r)) || ${extra}
    FROM pg_database d WHERE datname=current_database();`;
}
function inspectSql() {
  return "-- local-fixture inspect\nBEGIN READ ONLY;\nSET LOCAL search_path=pg_catalog,pg_temp;\n" + inspectBody() + "\nROLLBACK;\n";
}
function boundScope(plan, setup) {
  plan = checkPlan(plan);
  checkSetup(setup, plan);
  return `DO $scope$ DECLARE ctl ${plan.schemaName}.control%ROWTYPE; BEGIN
    SELECT * INTO STRICT ctl FROM ${plan.schemaName}.verify_control();
    IF ctl.plan->>'runId' IS DISTINCT FROM '${plan.runId}'
      OR ctl.application_oid::text IS DISTINCT FROM '${setup.appOid}'
      OR to_regnamespace('${plan.schemaName}')::oid::text IS DISTINCT FROM '${setup.schemaOid}'
      OR '${plan.schemaName}.control'::regclass::oid::text IS DISTINCT FROM '${setup.controlOid}'
      OR (SELECT oid::text FROM pg_event_trigger WHERE evtname='${plan.schemaName}') IS DISTINCT FROM '${setup.eventOid}'
      OR ctl.file_caller_setting IS DISTINCT FROM '${JSON.stringify(setup.fileCallerOids)}'
    THEN RAISE EXCEPTION 'local fixture retained control identity changed'; END IF;
    END $scope$;`;
}
function readbackSql(plan, setup) {
  const scope = boundScope(plan, setup);
  const extra = `(SELECT jsonb_build_object('runId',plan->>'runId','appOid',application_oid::text,
    'fileCallerOids',file_caller_setting::jsonb,'schemaOid','${setup.schemaOid}',
    'controlOid','${setup.controlOid}','eventOid','${setup.eventOid}',
    'qualified',${plan.schemaName}.application_qualified(),'readerPid',pg_backend_pid(),
    'events',(SELECT coalesce(jsonb_agg(payload ORDER BY ordinal),'[]'::jsonb) FROM ${plan.schemaName}.events),
    'fileCallerTransition',${plan.schemaName}.verify_file_callers())
    FROM ${plan.schemaName}.control)`;
  return `-- local-fixture readback\nBEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
    SET LOCAL search_path=pg_catalog,pg_temp;
${scope}
WITH evidence(payload) AS MATERIALIZED (${inspectBody(extra).slice(0, -1)})
SELECT chunk.frame FROM evidence CROSS JOIN LATERAL ${plan.schemaName}.bound_readback(evidence.payload) AS chunk
ORDER BY chunk.ordinal;
ROLLBACK;
`;
}
function parseReadback(stdout) {
  const check = ok => { if (!ok) throw new Error("LOCAL_MIGRATION_STAGE205_FRAMING"); };
  check(typeof stdout === "string" && Buffer.byteLength(stdout) <= readbackWireLimit && stdout.endsWith("\n"));
  const lines = stdout.slice(0, -1).split("\n");
  const header = /^JG-PFQ205\/1\|([1-9][0-9]?)\|([1-9][0-9]{0,5})\|([a-f0-9]{64})$/u.exec(lines[0]);
  check(header);
  const count = Number(header[1]), bytes = Number(header[2]);
  check(bytes <= readbackPayloadLimit && count === Math.ceil(bytes / readbackFrameBytes) &&
    lines.length === count + 1);
  const chunks = lines.slice(1).map((line, index) => {
    const prefix = (index + 1) + "|";
    const expectedBytes = Math.min(readbackFrameBytes, bytes - index * readbackFrameBytes);
    check(line.startsWith(prefix));
    const encoded = line.slice(prefix.length);
    check(encoded.length === 4 * Math.ceil(expectedBytes / 3) && /^[A-Za-z0-9+/]+={0,2}$/u.test(encoded));
    const decoded = Buffer.from(encoded, "base64");
    check(decoded.length === expectedBytes && decoded.toString("base64") === encoded);
    return decoded;
  });
  const payload = Buffer.concat(chunks, bytes);
  check(createHash("sha256").update(payload).digest("hex") === header[3]);
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(payload)); }
  catch { check(false); }
}
// Independent readback proof over the whole frozen file-trigger operation vector.
function checkFileCallerTransition(input, setup, actorOid) {
  const proof = dataRecord(input), before = dataArray(proof.before).map(dataArray),
    after = dataArray(proof.after).map(dataArray);
  need(oid(proof.versionOid) && before.length > 0 && before.length <= 4096);
  const keys = new Set();
  for (const row of before) {
    need(row.length === 15 && row.slice(0, 3).every(oid) && Number.isInteger(row[3]) &&
      row[3] > 0 && row[3] <= 127 && row.slice(4, 10).every(x => typeof x === "boolean") &&
      (row[10] === null || typeof row[10] === "boolean") &&
      row.slice(12).every(x => typeof x === "boolean"));
    const updates = dataArray(row[11]).map(dataArray);
    need(updates.every((x, i) => x.length === 2 && Number.isInteger(x[0]) && x[0] > 0 &&
      typeof x[1] === "boolean" && (i === 0 || x[0] > updates[i - 1][0])));
    const key = row[0] + ":" + row[1]; need(!keys.has(key)); keys.add(key);
  }
  const callers = vector => [...new Set(vector.filter(r => r[4] && r[5] && r[6] &&
    (r[7] || ((r[3] & 4) === 4 && r[8]) || ((r[3] & 16) === 16 &&
      (r[10] === true || r[11].some(x => x[1]))))).map(r => Number(r[0])))].sort((a, b) => a - b);
  need(isDeepStrictEqual(callers(before), setup.fileCallerOids) &&
    !setup.fileCallerOids.includes(Number(setup.appOid)));
  let changed = 0, insertRoute = false;
  const expected = before.map(row => {
    if (row[0] !== setup.appOid || row[2] !== proof.versionOid) return row;
    need(row[8] === false && row[12] === false);
    changed++; insertRoute ||= (row[3] & 4) === 4;
    return [...row.slice(0, 8), true, ...row.slice(9)];
  });
  need(changed > 0 && insertRoute && isDeepStrictEqual(after, expected));
  const acl = dataArray(proof.acl).map(dataArray);
  need(isDeepStrictEqual(acl, ["INSERT", "SELECT", "UPDATE"].map(p =>
    [actorOid, setup.appOid, p, false])));
  const expectedCallers = [...setup.fileCallerOids, Number(setup.appOid)].sort((a, b) => a - b);
  need(isDeepStrictEqual(dataArray(proof.callers), expectedCallers) &&
    isDeepStrictEqual(callers(after), expectedCallers));
}
function checkCompletion(row, plan, setup) {
  plan = checkPlan(plan);
  setup = dataRecord(setup);
  row = dataRecord(row);
  const events = dataArray(row.events).map(dataRecord);
  checkSetup(row, plan);
  need(row.appOid === setup.appOid && isDeepStrictEqual(row.fileCallerOids, setup.fileCallerOids) &&
    row.schemaOid === setup.schemaOid && row.controlOid === setup.controlOid && row.eventOid === setup.eventOid &&
    Number.isInteger(row.readerPid) && row.readerPid > 0 && Array.isArray(row.events) && row.events.length === 4);
  need(dataRecord(row.fileCallerTransition).versionOid === events[2]?.objectOid);
  checkFileCallerTransition(row.fileCallerTransition, setup, plan.actorOid);
  const anchors = [
    [204, "ALTER TABLE", "pg_class", "ContractArchiveFile", null],
    [204, "CREATE FUNCTION", "pg_proc", "protectProjectParticipatingCompanyEndDate", "bf63fd6b2e56aa7d6562f0ab2793ee9f87fd3ffaacb03aee7f3f7162e34c5faa"],
    [205, "ALTER TABLE", "pg_class", "ContractVersion", null],
    [205, "ALTER FUNCTION", "pg_proc", "jg_contract_direct_pending_file_guard_v1", "106f9ccc402e856a5057ed0d73f7b3336bbaacdd8ed2eebe0588efef97a14aa1"]
  ];
  events.forEach((event, index) => {
    const [stage, tag, catalog, name, body] = anchors[index];
    need(event && event.ordinal === index + 1 && event.stage === stage && event.tag === tag &&
      event.catalog === catalog && event.name === name && event.bodySha256 === body && oid(event.objectOid) &&
      event.querySha256 === plan.migrations[stage - 1].sha256 && event.runId === plan.runId &&
      event.nonce === plan.nonce && event.databaseOid === plan.databaseOid &&
      event.systemIdentifier === plan.systemIdentifier && event.actorOid === plan.actorOid &&
      event.appOid === setup.appOid && isDeepStrictEqual(event.fileCallerOids, setup.fileCallerOids) &&
      Number.isInteger(event.backendPid) && event.backendPid > 0 && event.backendPid !== row.readerPid &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(event.backendStart) &&
      typeof event.transactionId === "string" && /^[1-9][0-9]{0,19}$/u.test(event.transactionId) &&
      isDeepStrictEqual(event.preceding, { ...plan.migrations[stage - 2], finished: true, rolledBack: false }));
    need(event.backendPid === row.events[0].backendPid && event.backendStart === row.events[0].backendStart);
  });
  need(row.events[0].transactionId === row.events[1].transactionId &&
    row.events[2].transactionId === row.events[3].transactionId &&
    BigInt(row.events[2].transactionId) > BigInt(row.events[0].transactionId));
}
function cleanupSql(plan, setup) {
  return `-- local-fixture cleanup\nBEGIN;\nSET LOCAL search_path=pg_catalog,pg_temp;
    ${boundScope(plan, setup)}
    ALTER EVENT TRIGGER ${plan.schemaName} DISABLE;
    DROP EVENT TRIGGER ${plan.schemaName};
    DROP FUNCTION ${plan.schemaName}.observe();
    DROP FUNCTION ${plan.schemaName}.verify_control();
    DROP FUNCTION ${plan.schemaName}.application_qualified();
    DROP FUNCTION ${plan.schemaName}.caller_acl_commands(integer,${plan.schemaName}.control);
    DROP FUNCTION ${plan.schemaName}.bound_readback(jsonb);
    DROP FUNCTION ${plan.schemaName}.verify_file_callers();
    DROP FUNCTION ${plan.schemaName}.file_dml_vector();
    DROP FUNCTION ${plan.schemaName}.file_callers();
    DROP FUNCTION ${plan.schemaName}.role_catalog();
    DROP TABLE ${plan.schemaName}.events,${plan.schemaName}.control;
    DROP SCHEMA ${plan.schemaName};
    SELECT '{}'::jsonb;\nCOMMIT;\n`;
}
function applicationAssertionSql(plan, setup) {
  const template = fs.readFileSync(path.join(__dirname, "local-staged-migration-acl.sql"), "utf8");
  const match = /AS \$application\$([\s\S]*?)\$application\$;/u.exec(template);
  need(match);
  const body = match[1].replace("ctl __SCHEMA__.control%ROWTYPE", "ctl record")
    .replace("SELECT * INTO STRICT ctl FROM __SCHEMA__.control;", `SELECT ${literal(plan)}::jsonb AS plan,
      '${setup.appOid}'::oid AS application_oid, '${plan.actorOid}'::oid AS actor_oid,
      '${plan.namespaceOid}'::oid AS namespace_oid, '${JSON.stringify(setup.fileCallerOids)}'::text AS file_caller_setting INTO STRICT ctl;`)
    .replaceAll("__MATRIX__", literal(matrix))
    .replaceAll("RETURN false;", "RAISE EXCEPTION 'local fixture final application ACL changed';")
    .replace("RETURN true;", "RETURN;");
  need(!body.includes("__SCHEMA__"));
  return "DO $application$" + body + "$application$;";
}
function cleanReadSql(plan, setup) {
  plan = checkPlan(plan);
  checkSetup(setup, plan);
  return `-- local-fixture cleanup-readback\nBEGIN READ ONLY;\nSET LOCAL search_path=pg_catalog,pg_temp;
    ${applicationAssertionSql(plan, setup)}
    SELECT jsonb_build_object('schemaAbsent',NOT EXISTS(SELECT FROM pg_namespace
      WHERE oid='${setup.schemaOid}'::oid OR nspname='${plan.schemaName}'),
      'eventAbsent',NOT EXISTS(SELECT FROM pg_event_trigger WHERE oid='${setup.eventOid}'::oid OR evtname='${plan.schemaName}'),
      'appOid',(SELECT oid::text FROM pg_roles WHERE rolname='${plan.appName}' AND oid='${setup.appOid}'::oid),
      'applicationQualified',current_database()='${plan.database}' AND
       (SELECT oid::text FROM pg_database WHERE datname=current_database())='${plan.databaseOid}' AND
       (SELECT system_identifier::text FROM pg_control_system())='${plan.systemIdentifier}' AND
       current_user=session_user AND current_user='${technicalProfiles.planProfile(plan)?.owner ?? "jiangkong"}' AND current_user::regrole::oid::text='${plan.actorOid}' AND
       to_regnamespace('public')::oid::text='${plan.namespaceOid}' AND
       (SELECT datdba::text FROM pg_database WHERE datname=current_database())='${plan.ownerOid}' AND
       EXISTS(SELECT FROM pg_roles WHERE oid='${setup.appOid}'::oid AND rolname='${plan.appName}'
         AND NOT (rolsuper OR rolinherit OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls)
         AND rolcanlogin AND rolconnlimit=0) AND
       NOT EXISTS(SELECT FROM pg_auth_members WHERE member='${setup.appOid}'::oid OR roleid='${setup.appOid}'::oid));
    ROLLBACK;\n`;
}
module.exports = { inspectSql, setupSql, checkSetup, readbackSql, parseReadback, readbackWireLimit, checkCompletion, cleanupSql, cleanReadSql };
