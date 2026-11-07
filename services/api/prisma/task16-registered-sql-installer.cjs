"use strict";

// A connected installation stage, NOT an executable entry point. Import is inert.
// A future controlled driver must obtain actual resource/SQL authorization first,
// verify its sealed source/dependencies and own the resource's lifecycle. Neither
// an authorizationReference nor a source-only packet constitutes authorization.
const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomBytes } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { readQualifiedTask16File: qualifiedFile } = require("./task16-runtime-inputs.cjs");
const {registeredObjectWitnessSql}=require("./task16-registered-object-witness.cjs");
const BASELINE_PATH = "services/api/prisma/task16-baseline-access.json";
const FRAGMENTS = ["registered-funding.sql", "registered-history-revision.sql", "registered-write-authority.sql", "registered-canonical-proof.sql", "registered-intercompany.sql", "registered-canonical-adapter.sql", "registered-voucher.sql"].map(name => `services/api/prisma/prepared/task16/${name}`);
const RESOURCE_KEYS = ["runId", "sourceSha", "containerId", "networkId", "daemonId", "endpoint", "imageId", "databaseName", "port"];
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const fail = code => { throw Object.assign(new Error(code), { code }); };
const need = (condition, code) => { if (!condition) fail(code); };
const quote = text => `'${text.replaceAll("'", "''")}'`;

function readPacket(options) {
  need(typeof options.packetFile === "string" && path.isAbsolute(options.packetFile), "TASK16_INSTALL_PACKET_PATH");
  need(/^[a-f0-9]{64}$/u.test(options.expectedPacketSha256), "TASK16_INSTALL_PACKET_HASH");
  const packetCapture = qualifiedFile(options.packetFile,{maxBytes:16*1024*1024,collect:true,code:"TASK16_INSTALL_PACKET_SIZE"});
  need(packetCapture.sha256===options.expectedPacketSha256,"TASK16_INSTALL_PACKET_HASH");
  // Reuse the source-only CLI's full Git/AST/membership verification. It is the
  // sole verifier; the bounds below only guard capture between verification and
  // installation. Nothing in this subprocess connects to PG or starts resources.
  const verified = JSON.parse(execFileSync(process.execPath, [path.resolve(__dirname, "../../../scripts/prepare-task16-registered-pg.cjs"), "--verify", "--packet", options.packetFile, "--expected-sha256", options.expectedPacketSha256], {
    env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", TZ: "UTC" },
    encoding: "utf8", timeout: 120000, maxBuffer: 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"]
  }));
  need(verified.status === "SOURCE_ONLY_VERIFIED_NOT_EXECUTED" && verified.packetSha256 === options.expectedPacketSha256 && verified.executionAllowed === false, "TASK16_INSTALL_SOURCE_NOT_VERIFIED");
  const bytes = packetCapture.bytes;
  need(qualifiedFile(options.packetFile,{maxBytes:16*1024*1024,expectedIdentity:packetCapture.identity,code:"TASK16_INSTALL_PACKET_CHANGED"}).sha256===packetCapture.sha256,"TASK16_INSTALL_PACKET_CHANGED");
  const captures=[{path:options.packetFile,sha256:packetCapture.sha256,identity:packetCapture.identity,maxBytes:16*1024*1024}];
  need(/^[a-f0-9]{64}$/u.test(options.expectedPacketSha256) && sha(bytes) === options.expectedPacketSha256, "TASK16_INSTALL_PACKET_HASH");
  const packet = JSON.parse(bytes.toString("utf8"));
  need(packet && packet.schemaVersion === 1 && packet.purpose === "task16-registered-pg-source-only-packet" && packet.status === "SOURCE_ONLY_NOT_EXECUTED" && packet.executionAllowed === false && packet.resourceExecutorImplemented === false, "TASK16_INSTALL_PACKET_KIND");
  const { sealSha256, ...payload } = packet;
  need(/^[a-f0-9]{64}$/u.test(sealSha256) && sha(JSON.stringify(payload)) === sealSha256, "TASK16_INSTALL_PACKET_SEAL");
  need(/^[a-f0-9]{40}$/u.test(packet.candidateSha), "TASK16_INSTALL_SOURCE_SHA");
  need(packet.installation?.status === "SOURCE_ONLY_NOT_EXECUTED" && Array.isArray(packet.installation.fragments) && packet.installation.fragments.length === 7 && packet.installation.fragments.every((row, index) => row.path === FRAGMENTS[index]), "TASK16_INSTALL_FRAGMENT_ORDER");
  const repo = packet.source?.repo;
  need(typeof repo === "string" && path.isAbsolute(repo) && fs.realpathSync(repo) === repo && fs.lstatSync(repo).isDirectory(), "TASK16_INSTALL_SOURCE_ROOT");
  const fragments = packet.installation.fragments.map(row => {
    let current = repo;
    for (const part of row.path.split("/")) {
      current = path.join(current, part);
      need(!fs.lstatSync(current).isSymbolicLink(), "TASK16_INSTALL_FRAGMENT_SYMLINK");
    }
    const capture=qualifiedFile(current,{maxBytes:2*1024*1024,collect:true,code:"TASK16_INSTALL_FRAGMENT_SIZE"});
    const source=capture.bytes;
    captures.push({path:current,sha256:capture.sha256,identity:capture.identity,maxBytes:2*1024*1024});
    need(source.length === row.bytes && sha(source) === row.sha256 && Buffer.from(source.toString("utf8")).equals(source) && !source.includes(0), "TASK16_INSTALL_FRAGMENT_HASH");
    return source.toString("utf8");
  });
  need(fragments.reduce((size, value) => size + Buffer.byteLength(value), 0) <= 8 * 1024 * 1024, "TASK16_INSTALL_SQL_SIZE");
  need(Array.isArray(packet.migrations) && packet.migrations.length > 0, "TASK16_INSTALL_MIGRATION_LIST");
  const migrations = packet.migrations.map(row => {
    const match = /^services\/api\/prisma\/migrations\/([^/]+)\/migration\.sql$/u.exec(row.path);
    need(match && /^[a-f0-9]{64}$/u.test(row.sha256), "TASK16_INSTALL_MIGRATION_LIST");
    return { name: match[1], sha256: row.sha256, finished: true, rolledBack: false };
  });
  need(new Set(migrations.map(row => row.name)).size === migrations.length, "TASK16_INSTALL_MIGRATION_LIST");
  if(options.expectedBaseline){
    const baseline=options.expectedBaseline;
    need(baseline.status==="BASELINE_ROLE_ACL_COMMIT_OBSERVED"&&baseline.sourceSha===packet.candidateSha&&baseline.candidateRoot===repo,"TASK16_INSTALL_BASELINE_SOURCE");
    const rows=packet.source.files.filter(row=>row.path===BASELINE_PATH);
    need(rows.length===1&&rows[0].sha256===baseline.manifestSha256,"TASK16_INSTALL_BASELINE_MANIFEST");
    const captured=qualifiedFile(path.join(repo,BASELINE_PATH),{maxBytes:64*1024*1024,code:"TASK16_INSTALL_BASELINE_MANIFEST"});
    need(captured.sha256===baseline.manifestSha256&&captured.identity.size===rows[0].bytes,"TASK16_INSTALL_BASELINE_MANIFEST");
    captures.push({path:path.join(repo,BASELINE_PATH),sha256:captured.sha256,identity:captured.identity,maxBytes:64*1024*1024});
  }
  return { packet, fragments, migrations, captures };
}

// This query is run via the existing resource-owned execOwnerSql: that adapter
// checks exact daemon/container/network identity before container-local psql.
// A pool URL or a caller's self-reported DB identity is never used here.
function strictRoleSql(role,ownerRole,observer=false){
 return `coalesce((SELECT NOT (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolinherit OR r.rolreplication OR r.rolbypassrls OR NOT r.rolcanlogin OR r.rolconnlimit<>1 OR pg_catalog.pg_has_role(r.oid,o.oid,'MEMBER') OR pg_catalog.has_schema_privilege(r.oid,'public','CREATE') OR pg_catalog.has_parameter_privilege(r.oid,'session_replication_role','SET') OR EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members WHERE member=r.oid) OR EXISTS(SELECT 1 FROM pg_catalog.pg_class WHERE relowner=r.oid) OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE proowner=r.oid) OR EXISTS(SELECT 1 FROM pg_catalog.pg_namespace WHERE nspowner=r.oid) OR EXISTS(SELECT 1 FROM pg_catalog.pg_database WHERE datdba=r.oid))${observer?" AND 'default_transaction_read_only=on'=ANY(r.rolconfig)":""} FROM pg_catalog.pg_roles r JOIN pg_catalog.pg_roles o ON o.rolname=${quote(ownerRole)} WHERE r.rolname=${quote(role)}),false)`;
}
function identitySql(ownerRole, runtimeRole, phase, nonce,baseline) {
  return `SELECT pg_catalog.json_build_object(
 'database',pg_catalog.current_database(),
 'databaseOid',(SELECT oid::text FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database()),
 'systemIdentifier',(SELECT system_identifier::text FROM pg_catalog.pg_control_system()),
 'ownerRole',current_user,
 'loginRole',session_user,
 'ownerOid',(SELECT oid::text FROM pg_catalog.pg_roles WHERE rolname=current_user),
 'ownerIsDatabaseOwner',EXISTS(SELECT 1 FROM pg_catalog.pg_database d JOIN pg_catalog.pg_roles r ON r.oid=d.datdba WHERE d.datname=pg_catalog.current_database() AND r.rolname=current_user),
 'runtimeRole',${quote(runtimeRole)},
 ${baseline?`'runtimeOid',(SELECT oid::text FROM pg_catalog.pg_roles WHERE rolname=${quote(runtimeRole)}),'observerRole',${quote(baseline.observerRole)},'observerOid',(SELECT oid::text FROM pg_catalog.pg_roles WHERE rolname=${quote(baseline.observerRole)}),'strictRuntimeSafe',${strictRoleSql(runtimeRole,ownerRole)},'observerSafe',${strictRoleSql(baseline.observerRole,ownerRole,true)},`:''}
 'runtimeSafe',coalesce((SELECT NOT (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls OR pg_catalog.pg_has_role(r.oid,o.oid,'MEMBER') OR pg_catalog.has_schema_privilege(r.oid,'public','CREATE')) FROM pg_catalog.pg_roles r JOIN pg_catalog.pg_roles o ON o.rolname=${quote(ownerRole)} WHERE r.rolname=${quote(runtimeRole)}),false),
 'serverVersion',pg_catalog.current_setting('server_version_num')::integer,
 'tls',coalesce((SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid=pg_catalog.pg_backend_pid()),false),
 'replication',pg_catalog.current_setting('session_replication_role'),
 'migrationLedger',(SELECT coalesce(pg_catalog.json_agg(pg_catalog.json_build_object('name',migration_name,'sha256',checksum,'finished',finished_at IS NOT NULL,'rolledBack',rolled_back_at IS NOT NULL) ORDER BY migration_name),'[]'::json) FROM public._prisma_migrations),
 ${phase==='committed'&&baseline?`'installedObjectWitness',${registeredObjectWitnessSql()},`:''}
 'phase',${quote(phase)},'nonce',n.nonce)
 FROM (SELECT ${quote(nonce)} AS nonce) n;`;
}

function resourceIdentity(options, candidateSha) {
  const receipt = structuredClone(options.resource.getReceipt());
  const expected = options.expectedResource;
  need(expected && RESOURCE_KEYS.every(key => expected[key] !== undefined && expected[key] === receipt[key]), "TASK16_INSTALL_RESOURCE_CHANGED");
  need(receipt.sourceSha === candidateSha && receipt.status === "started-awaiting-driver-verification" && receipt.cleanup?.status === "pending", "TASK16_INSTALL_RESOURCE_NOT_OWNED");
  return receipt;
}

function parseIdentity(result, options, snapshot, migrations, phase, nonce) {
  need(typeof result?.stdout === "string" && Buffer.byteLength(result.stdout) <= 1024 * 1024, "TASK16_INSTALL_RECEIPT_SIZE");
  const row = JSON.parse(result.stdout.trim());
  need(row.phase === phase && row.nonce === nonce && row.database === snapshot.databaseName && row.ownerRole === options.ownerRole && row.ownerIsDatabaseOwner === true && row.runtimeRole === options.runtimeRole && row.runtimeSafe === true && row.replication === "origin" && row.tls === true && row.serverVersion >= 160000 && row.serverVersion < 170000 && /^[1-9][0-9]*$/u.test(row.databaseOid) && /^[1-9][0-9]*$/u.test(row.systemIdentifier), "TASK16_INSTALL_DATABASE_IDENTITY");
  need(JSON.stringify(row.migrationLedger) === JSON.stringify(migrations), "TASK16_INSTALL_MIGRATION_LEDGER");
  if(options.expectedBaseline){
    const b=options.expectedBaseline;
    need(row.ownerOid===b.ownerOid&&row.loginRole===options.ownerRole&&row.databaseOid===b.databaseOid&&row.systemIdentifier===b.systemIdentifier&&row.runtimeOid===b.runtimeOid&&row.observerRole===b.observerRole&&row.observerOid===b.observerOid&&row.strictRuntimeSafe===true&&row.observerSafe===true,"TASK16_INSTALL_BASELINE_ROLE_IDENTITY");
  }
  return row;
}

async function installTask16RegisteredSql(options) {
  let attempted = false;
  let baselineContinuityVerified = false;
  try {
    options={...options,expectedResource:structuredClone(options?.expectedResource),expectedBaseline:options?.expectedBaseline===undefined?undefined:structuredClone(options.expectedBaseline)};
    if(options.expectedBaseline!==undefined){
      const b=options.expectedBaseline;
      need(b!==null&&typeof b==="object"&&!Array.isArray(b),"TASK16_INSTALL_BASELINE_ARGUMENTS");
      need(b.runtimeRole===options.runtimeRole&&b.observerRole!==options.runtimeRole&&b.observerRole!==options.ownerRole&&/^[a-z][a-z0-9_]{0,62}$/u.test(b.observerRole)&&[b.ownerOid,b.runtimeOid,b.observerOid,b.databaseOid,b.systemIdentifier].every(oid=>typeof oid==="string"&&/^[1-9][0-9]*$/u.test(oid))&&new Set([b.ownerOid,b.runtimeOid,b.observerOid]).size===3&&/^[a-f0-9]{64}$/u.test(b.manifestSha256),"TASK16_INSTALL_BASELINE_ARGUMENTS");
    }
    need(options && typeof options.authorizationReference === "string" && options.authorizationReference.trim().length > 0 && options.authorizationReference.length <= 1024, "TASK16_INSTALL_AUTHORIZATION_REFERENCE");
    need(options.resource && typeof options.resource.execOwnerSql === "function" && typeof options.resource.getReceipt === "function", "TASK16_INSTALL_RESOURCE_ADAPTER");
    for (const role of [options.ownerRole, options.runtimeRole]) need(typeof role === "string" && /^[a-z][a-z0-9_]{0,62}$/u.test(role), "TASK16_INSTALL_ROLE_NAME");
    need(options.ownerRole !== options.runtimeRole, "TASK16_INSTALL_ROLE_SEPARATION");
    const methods={execOwnerSql:options.resource.execOwnerSql,getReceipt:options.resource.getReceipt};
    const { packet, fragments, migrations, captures } = readPacket(options);
    const recheck=()=>{need(options.resource.execOwnerSql===methods.execOwnerSql&&options.resource.getReceipt===methods.getReceipt,"TASK16_INSTALL_RESOURCE_METHOD_CHANGED");for(const row of captures)need(qualifiedFile(row.path,{maxBytes:row.maxBytes,expectedIdentity:row.identity,code:"TASK16_INSTALL_SOURCE_CAPTURE_CHANGED"}).sha256===row.sha256,"TASK16_INSTALL_SOURCE_CAPTURE_CHANGED");};
    const snapshot = resourceIdentity(options, packet.candidateSha);
    const preflightNonce = randomBytes(32).toString("hex");
    const before = parseIdentity(await methods.execOwnerSql.call(options.resource,`BEGIN READ ONLY;\n${identitySql(options.ownerRole, options.runtimeRole, "preflight", preflightNonce,options.expectedBaseline)}\nROLLBACK;`, "task16-install-preflight"), options, snapshot, migrations, "preflight", preflightNonce);
    resourceIdentity(options, packet.candidateSha); recheck();
    const nonce = randomBytes(32).toString("hex");
    // Re-check identity in the installation transaction itself, before any DDL.
    const guard = `DO $jg_task16_install_guard$ BEGIN
 IF current_user IS DISTINCT FROM ${quote(options.ownerRole)} OR session_user IS DISTINCT FROM ${quote(options.ownerRole)}
 OR pg_catalog.current_database() IS DISTINCT FROM ${quote(before.database)}
 OR (SELECT oid::text FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database()) IS DISTINCT FROM ${quote(before.databaseOid)}
 OR (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) IS DISTINCT FROM ${quote(before.systemIdentifier)}
 OR pg_catalog.current_setting('session_replication_role') IS DISTINCT FROM 'origin'
 OR NOT coalesce((SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid=pg_catalog.pg_backend_pid()),false)
 THEN RAISE EXCEPTION 'task16 installation identity changed'; END IF;
 IF NOT coalesce((SELECT NOT (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls
 OR pg_catalog.pg_has_role(r.oid,o.oid,'MEMBER') OR pg_catalog.has_schema_privilege(r.oid,'public','CREATE'))
 FROM pg_catalog.pg_roles r JOIN pg_catalog.pg_roles o ON o.rolname=${quote(options.ownerRole)} WHERE r.rolname=${quote(options.runtimeRole)}),false)
 THEN RAISE EXCEPTION 'task16 installation runtime role changed'; END IF;
 IF (SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',migration_name,'sha256',checksum,'finished',finished_at IS NOT NULL,'rolledBack',rolled_back_at IS NOT NULL) ORDER BY migration_name),'[]'::jsonb) FROM public._prisma_migrations)
 IS DISTINCT FROM ${quote(JSON.stringify(migrations))}::jsonb
 THEN RAISE EXCEPTION 'task16 installation migration ledger changed'; END IF;
${options.expectedBaseline?` IF (SELECT oid::text FROM pg_catalog.pg_roles WHERE rolname=current_user) IS DISTINCT FROM ${quote(options.expectedBaseline.ownerOid)} OR (SELECT oid::text FROM pg_catalog.pg_roles WHERE rolname=${quote(options.runtimeRole)}) IS DISTINCT FROM ${quote(options.expectedBaseline.runtimeOid)} OR (SELECT oid::text FROM pg_catalog.pg_roles WHERE rolname=${quote(options.expectedBaseline.observerRole)}) IS DISTINCT FROM ${quote(options.expectedBaseline.observerOid)} OR NOT ${strictRoleSql(options.runtimeRole,options.ownerRole)} OR NOT ${strictRoleSql(options.expectedBaseline.observerRole,options.ownerRole,true)} THEN RAISE EXCEPTION 'task16 installation baseline restricted identity changed'; END IF;`:''}
END $jg_task16_install_guard$;`;
    const sql = `BEGIN;\nSET LOCAL search_path=pg_catalog,public,pg_temp;\nSET LOCAL lock_timeout='5s';\nLOCK TABLE public._prisma_migrations IN SHARE MODE;\n${guard}\nDO $jg_task16_role$ BEGIN PERFORM pg_catalog.set_config('jg.task16_runtime_role',${quote(options.runtimeRole)},true); END $jg_task16_role$;\n${fragments.join("\n")}\nCOMMIT;\nSET search_path=pg_catalog,public,pg_temp;\n${identitySql(options.ownerRole, options.runtimeRole, "committed", nonce,options.expectedBaseline)}\n`;
    attempted = true;
    const after = parseIdentity(await methods.execOwnerSql.call(options.resource,sql, "task16-install-transaction"), options, snapshot, migrations, "committed", nonce);
    need(after.databaseOid === before.databaseOid && after.systemIdentifier === before.systemIdentifier, "TASK16_INSTALL_DATABASE_CHANGED");
    resourceIdentity(options, packet.candidateSha); recheck();
    if(options.expectedBaseline!==undefined) baselineContinuityVerified=true;
    return { installedObjectWitness:after.installedObjectWitness,ownerOid:after.ownerOid, baselineContinuityVerified, runtimeOid:after.runtimeOid, observerRole:after.observerRole, observerOid:after.observerOid, baselineManifestSha256:options.expectedBaseline?.manifestSha256, status: "SQL_INSTALLATION_COMMIT_OBSERVED", candidateSha: packet.candidateSha, packetSha256: options.expectedPacketSha256, sourceSealSha256: packet.sealSha256, sqlSha256: sha(sql), databaseName: after.database, databaseOid: after.databaseOid, systemIdentifier: after.systemIdentifier, ownerRole: options.ownerRole, runtimeRole: options.runtimeRole, fragmentCount: 7, financialAcceptance: false, aclAcceptance: false, tlsAcceptance: false, resourceLifecycleOwnedByCaller: true };
  } catch (error) {
    const code = typeof error?.code === "string" && /^TASK16_INSTALL_[A-Z0-9_]+$/u.test(error.code) ? error.code : "TASK16_INSTALL_FAILED_CLOSED";
    const failure = Object.assign(new Error(code), { code, installationOutcome: attempted ? "UNKNOWN_DO_NOT_RETRY" : "NOT_ATTEMPTED" });
    // Never expose driver stderr/SQL, and never describe lost acknowledgement as
    // rollback. The lifecycle owner must close its exact resource on all paths.
    throw failure;
  }
}

module.exports = { installTask16RegisteredSql };
