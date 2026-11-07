"use strict";
// Task16 baseline-only installer. No import-time I/O, connections or commands.
const path = require("node:path");
const { randomBytes, createHash } = require("node:crypto");
const { readQualifiedTask16File: read } = require("./task16-runtime-inputs.cjs");
const ROOT = path.resolve(__dirname, "../../..");
const FILES = ["services/api/prisma/task16-baseline-access.cjs", "services/api/prisma/task16-baseline-access.json", "services/api/prisma/task16-baseline-access.sql"];
const OWNER = "jg_task01_owner", RUNTIME = "jg_task01_runtime", OBSERVER = "jg_task01_observer";
const fault = code => Object.assign(new Error(code), { code });
const need = (condition, code) => { if (!condition)
    throw fault(code); };
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const quote = value => `'${value.replaceAll("'", "''")}'`;
const identityBody = `\n SELECT session_user::text,(SELECT oid::text FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database()),(SELECT system_identifier::text FROM pg_catalog.pg_control_system()),pg_catalog.pg_backend_pid(),coalesce((SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid=pg_catalog.pg_backend_pid()),false)\n`;
const versionGuardBody = `\nBEGIN\n IF session_user = 'jg_task01_runtime' THEN RAISE EXCEPTION 'task16 runtime cannot update contract version'; END IF;\n RETURN NEW;\nEND\n`;
function identitySql(phase, nonce, plan) {
    const after = phase === "committed";
    return `SELECT pg_catalog.json_build_object('phase',${quote(phase)},'nonce',n.nonce,'database',pg_catalog.current_database(),'databaseOid',(SELECT oid::text FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database()),'systemIdentifier',(SELECT system_identifier::text FROM pg_catalog.pg_control_system()),'ownerRole',current_user::text,'loginRole',session_user::text,'ownerOid',(SELECT oid::text FROM pg_catalog.pg_roles WHERE rolname=current_user),'ownerIsDatabaseOwner',EXISTS(SELECT 1 FROM pg_catalog.pg_database d JOIN pg_catalog.pg_roles r ON r.oid=d.datdba WHERE d.datname=pg_catalog.current_database() AND r.rolname=current_user),'version',pg_catalog.current_setting('server_version_num')::integer,'tls',coalesce((SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid=pg_catalog.pg_backend_pid()),false),'replication',pg_catalog.current_setting('session_replication_role'),'readOnly',pg_catalog.current_setting('default_transaction_read_only'),'migrationLedger',(SELECT coalesce(pg_catalog.json_agg(pg_catalog.json_build_object('name',migration_name,'sha256',checksum,'finished',finished_at IS NOT NULL,'rolledBack',rolled_back_at IS NOT NULL) ORDER BY migration_name),'[]'::json) FROM public._prisma_migrations),${after ? `'matrixVerified',pg_temp.jg_task16_baseline_check(${quote(JSON.stringify(plan))}::jsonb),'guardVerified',EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgname='jg_task16_runtime_version_read_only' AND t.tgrelid='public."ContractVersion"'::regclass AND t.tgenabled='A' AND t.tgtype=19),'runtimeRole','${RUNTIME}','observerRole','${OBSERVER}','runtimeOid',(SELECT oid::text FROM pg_catalog.pg_roles WHERE rolname='${RUNTIME}'),'observerOid',(SELECT oid::text FROM pg_catalog.pg_roles WHERE rolname='${OBSERVER}')` : `'restrictedAbsent',NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname IN ('${RUNTIME}','${OBSERVER}')),'instrumentationAbsent',pg_catalog.to_regprocedure('public.jg_task01_connection_identity()') IS NULL AND pg_catalog.to_regprocedure('public.jg_task16_runtime_version_read_only()') IS NULL AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger WHERE tgname='jg_task16_runtime_version_read_only'),'freshScope',(SELECT count(*) FROM pg_catalog.pg_database)=4 AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_database WHERE datname NOT IN (pg_catalog.current_database(),'postgres','template0','template1')) AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname NOT IN ('public','information_schema') AND nspname !~ '^pg_') AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_roles r ON r.oid=c.relowner WHERE n.nspname='public' AND c.relkind IN ('r','p','S','v','m','f') AND r.rolname IS DISTINCT FROM coalesce((${quote(JSON.stringify(plan.legacyRelationOwners))}::jsonb)->>c.relname,'${OWNER}')) AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace JOIN pg_catalog.pg_roles r ON r.oid=p.proowner WHERE n.nspname='public' AND r.rolname IS DISTINCT FROM coalesce((SELECT mapped.value FROM pg_catalog.jsonb_each_text(${quote(JSON.stringify(plan.legacyFunctionOwners))}::jsonb) mapped WHERE pg_catalog.to_regprocedure(mapped.key)=p.oid),'${OWNER}')) AND EXISTS(SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspname='public' AND n.nspowner IN (SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN ('${OWNER}','pg_database_owner')))`}) FROM (SELECT ${quote(nonce)} AS nonce) n;`;
}
async function installTask16BaselineAccess(input) {
    let attempted = false;
    try {
        const context = { ...input, source: structuredClone(input.source), ownerTransport: structuredClone(input.ownerTransport), credentials: { ...input.credentials } };
        const { source, resource, signal } = context;
        need(source?.candidateRoot === ROOT && source.runtimeAdmission?.status === "INPUTS_AND_CODE_TREES_MATCHED" && /^[a-f0-9]{40}$/u.test(source.candidateSha), "TASK16_ACCESS_SOURCE");
        need(context.migrations?.status === "BASELINE_MIGRATIONS_LEDGER_VERIFIED" && context.migrations.migrationCount === 202, "TASK16_ACCESS_MIGRATIONS_REQUIRED");
        need(context.ownerTransport?.status === "OWNER_TLS_CONTROLS_VERIFIED" && context.ownerTransport.ownerRole === OWNER, "TASK16_ACCESS_OWNER_REQUIRED");
        need(typeof resource?.getReceipt === "function" && typeof resource?.execOwnerSql === "function", "TASK16_ACCESS_RESOURCE_ADAPTER");
        const methods = { getReceipt: resource.getReceipt, execOwnerSql: resource.execOwnerSql }, initial = structuredClone(methods.getReceipt.call(resource));
        const get = (file, options = {}) => read(file, { maxBytes: 64 * 1024 * 1024, code: "TASK16_ACCESS_SOURCE_FILE", ...options });
        const members = FILES.map(relative => {
            const listed = source.executionFiles?.filter(row => row.path === relative);
            need(listed?.length === 1, "TASK16_ACCESS_SOURCE_MEMBER");
            const actual = get(path.join(ROOT, relative), { collect: true });
            need(actual.sha256 === listed[0].sha256, "TASK16_ACCESS_SOURCE_MEMBER");
            return { relative, ...actual };
        });
        const manifest = JSON.parse(members[1].bytes.toString("utf8")), template = members[2].bytes.toString("utf8");
        need(manifest.schemaVersion === 1 && manifest.purpose === "task16-baseline-existing-object-acl-not-final-registered-acceptance" && manifest.caseId === "registered.null-cross-company.commit" && manifest.runtime?.role === RUNTIME && manifest.observer?.role === OBSERVER, "TASK16_ACCESS_MANIFEST");
        need(Array.isArray(manifest.functionProofs) && manifest.functionProofs.length === 1 && manifest.functionProofs[0].signature === "public.assert_inter_entity_relationship_lineage(text,text)" && manifest.functionProofs[0].securityDefiner === false && typeof manifest.functionProofs[0].body === "string" && manifest.functionProofs[0].body.length > 0, "TASK16_ACCESS_FUNCTION_PROOF");
        const evidence = manifest.sources.map(row => {
            need(typeof row.path === "string" && !path.isAbsolute(row.path) && !row.path.split("/").includes("..") && /^[a-f0-9]{64}$/u.test(row.sha256), "TASK16_ACCESS_EVIDENCE");
            const sealed = source.executionFiles?.filter(member => member.path === row.path);
            need(sealed?.length === 1 && sealed[0].sha256 === row.sha256, "TASK16_ACCESS_EVIDENCE");
            const actual = get(path.join(ROOT, row.path));
            need(actual.sha256 === row.sha256, "TASK16_ACCESS_EVIDENCE");
            return { ...row, identity: actual.identity };
        });
        for (const role of [manifest.runtime, manifest.observer]) {
            need(Array.isArray(role.tables) && new Set(role.tables.map(row => row.table)).size === role.tables.length && JSON.stringify(role.functions) === (role.role === RUNTIME ? '["public.assert_inter_entity_relationship_lineage(text,text)","public.jg_task01_connection_identity()"]' : '["public.jg_task01_connection_identity()"]'), "TASK16_ACCESS_MANIFEST");
            for (const row of role.tables) {
                need(/^[A-Za-z][A-Za-z0-9_]*$/u.test(row.table) && !manifest.registeredDeltaDeferredToFollowingStage.newTables.includes(row.table), "TASK16_ACCESS_MANIFEST");
                for (const op of ["select", "insert", "update"])
                    need(Array.isArray(row[op]) && new Set(row[op]).size === row[op].length && row[op].every(col => /^[A-Za-z][A-Za-z0-9_]*$/u.test(col) && !manifest.registeredDeltaDeferredToFollowingStage.newColumns[row.table]?.includes(col)), "TASK16_ACCESS_MANIFEST");
                if (role.role === OBSERVER)
                    need(row.insert.length === 0 && row.update.length === 0, "TASK16_ACCESS_MANIFEST");
                if (row.table === "Project")
                    need(row.insert.length === 0 && row.update.length === 0, "TASK16_ACCESS_MANIFEST");
                if (row.table === "ContractVersion")
                    need(JSON.stringify(row.update) === '["updatedAt"]' && row.lockOnlyUpdate?.requiresGuard === "jg_task16_runtime_version_read_only", "TASK16_ACCESS_LOCK_GUARD");
            }
        }
        need(Array.isArray(source.migrations) && source.migrations.length === 202 && new Set(source.migrations.map(row => row.path)).size === 202, "TASK16_ACCESS_MIGRATION_LIST");
        const ledger = source.migrations.map((row, index) => { const match = /^services\/api\/prisma\/migrations\/([0-9]{14}_[a-z0-9_]+)\/migration\.sql$/u.exec(row.path); need(match && /^[a-f0-9]{64}$/u.test(row.sha256) && (index === 0 || source.migrations[index - 1].path < row.path), "TASK16_ACCESS_MIGRATION_LIST"); return { name: match[1], sha256: row.sha256, finished: true, rolledBack: false }; });
        const caPath = resource.caPath, ca = get(caPath, { privateFile: true, maxBytes: 1024 * 1024 });
        const check = () => {
            need(!signal.aborted, "TASK16_ACCESS_ABORTED");
            need(resource.getReceipt === methods.getReceipt && resource.execOwnerSql === methods.execOwnerSql, "TASK16_ACCESS_RESOURCE_CHANGED");
            const r = methods.getReceipt.call(resource);
            const keys = ["runId", "sourceSha", "containerId", "networkId", "databaseName", "port", "endpoint", "daemonId", "imageId"];
            need(r.runId === context.runId && r.sourceSha === source.candidateSha && r.databaseName === `jg_task01_${context.runId.replaceAll("-", "")}` && r.status === "started-awaiting-driver-verification" && r.cleanup?.status === "pending" && keys.every(key => r[key] === initial[key]) && ["endpoint", "daemonId", "imageId"].every(key => r[key] === source.inputs.docker[key]) && ["containerId", "networkId"].every(key => /^[a-f0-9]{64}$/u.test(r[key]) && resource[key] === r[key]) && r.port === resource.port && r.databaseName === resource.databaseName && Number.isInteger(r.port) && r.port > 1024 && r.port <= 65535, "TASK16_ACCESS_RESOURCE_IDENTITY");
            need(resource.caPath === caPath && ca.sha256 === context.ownerTransport.caSha256 && r.tls?.caSha256 === ca.sha256 && resource.serverCertHashes?.caSha256 === ca.sha256 && get(caPath, { privateFile: true, maxBytes: 1024 * 1024, expectedIdentity: ca.identity }).sha256 === ca.sha256, "TASK16_ACCESS_CA_IDENTITY");
            for (const row of [...members, ...evidence])
                need(get(path.join(ROOT, row.relative ?? row.path), { expectedIdentity: row.identity }).sha256 === row.sha256, "TASK16_ACCESS_SOURCE_CHANGED");
        };
        const parse = (result, phase, nonce) => {
            need(typeof result?.stdout === "string" && Buffer.byteLength(result.stdout) <= 1024 * 1024, "TASK16_ACCESS_RESULT");
            const row = JSON.parse(result.stdout.trim());
            need(row.phase === phase && row.nonce === nonce && row.database === initial.databaseName && row.databaseOid === context.ownerTransport.databaseOid && row.systemIdentifier === context.ownerTransport.systemIdentifier && row.ownerRole === OWNER && row.loginRole === OWNER && row.ownerIsDatabaseOwner === true && row.tls === true && row.version >= 160000 && row.version < 170000 && row.replication === "origin" && row.readOnly === "off" && /^[1-9][0-9]*$/u.test(row.ownerOid), "TASK16_ACCESS_DATABASE_IDENTITY");
            need(JSON.stringify(row.migrationLedger) === JSON.stringify(ledger), "TASK16_ACCESS_MIGRATION_LEDGER");
            return row;
        };
        check();
        const preflightNonce = randomBytes(32).toString("hex");
        const before = parse(await methods.execOwnerSql.call(resource, `BEGIN READ ONLY;\n${identitySql("preflight", preflightNonce, manifest)}\nROLLBACK;`, "task16-baseline-access-preflight"), "preflight", preflightNonce);
        check();
        need(before.restrictedAbsent === true && before.instrumentationAbsent === true && before.freshScope === true, "TASK16_ACCESS_FRESH_SCOPE");
        need([context.credentials.runtime, context.credentials.observer].every(password => typeof password === "string" && /^[a-f0-9]{96}$/u.test(password)) && new Set(Object.values(context.credentials)).size === 3, "TASK16_ACCESS_CREDENTIAL");
        const transactionGuard = `DO $baseline_guard$ BEGIN IF current_user IS DISTINCT FROM '${OWNER}' OR session_user IS DISTINCT FROM '${OWNER}' OR (SELECT oid::text FROM pg_catalog.pg_roles WHERE rolname=current_user) IS DISTINCT FROM ${quote(before.ownerOid)} OR pg_catalog.current_database() IS DISTINCT FROM ${quote(before.database)} OR (SELECT oid::text FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database()) IS DISTINCT FROM ${quote(before.databaseOid)} OR (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) IS DISTINCT FROM ${quote(before.systemIdentifier)} OR pg_catalog.current_setting('session_replication_role') IS DISTINCT FROM 'origin' OR NOT coalesce((SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid=pg_catalog.pg_backend_pid()),false) THEN RAISE EXCEPTION 'task16 baseline identity changed'; END IF; IF (SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',migration_name,'sha256',checksum,'finished',finished_at IS NOT NULL,'rolledBack',rolled_back_at IS NOT NULL) ORDER BY migration_name),'[]'::jsonb) FROM public._prisma_migrations) IS DISTINCT FROM ${quote(JSON.stringify(ledger))}::jsonb THEN RAISE EXCEPTION 'task16 baseline ledger changed'; END IF;
IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname IN ('${RUNTIME}','${OBSERVER}'))
 OR pg_catalog.to_regprocedure('public.jg_task01_connection_identity()') IS NOT NULL
 OR pg_catalog.to_regprocedure('public.jg_task16_runtime_version_read_only()') IS NOT NULL
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_trigger WHERE tgname='jg_task16_runtime_version_read_only')
 OR (SELECT count(*) FROM pg_catalog.pg_database)<>4
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_database WHERE datname NOT IN (pg_catalog.current_database(),'postgres','template0','template1'))
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname NOT IN ('public','information_schema') AND nspname !~ '^pg_')
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_roles r ON r.oid=c.relowner WHERE n.nspname='public' AND c.relkind IN ('r','p','S','v','m','f') AND r.rolname IS DISTINCT FROM coalesce((${quote(JSON.stringify(manifest.legacyRelationOwners))}::jsonb)->>c.relname,'${OWNER}'))
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace JOIN pg_catalog.pg_roles r ON r.oid=p.proowner WHERE n.nspname='public' AND r.rolname IS DISTINCT FROM coalesce((SELECT mapped.value FROM pg_catalog.jsonb_each_text(${quote(JSON.stringify(manifest.legacyFunctionOwners))}::jsonb) mapped WHERE pg_catalog.to_regprocedure(mapped.key)=p.oid),'${OWNER}'))
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspname='public' AND n.nspowner IN (SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN ('${OWNER}','pg_database_owner')))
THEN RAISE EXCEPTION 'task16 baseline fresh scope changed'; END IF; END $baseline_guard$;`;
        const nonce = randomBytes(32).toString("hex");
        let sql = template;
        const replacements = { __TRANSACTION_GUARD__: transactionGuard, __RUNTIME_PASSWORD__: context.credentials.runtime, __OBSERVER_PASSWORD__: context.credentials.observer, __PLAN_JSON__: quote(JSON.stringify(manifest)), __IDENTITY_BODY__: identityBody, __IDENTITY_BODY_LITERAL__: quote(identityBody), __VERSION_GUARD_BODY__: versionGuardBody, __VERSION_GUARD_LITERAL__: quote(versionGuardBody), __COMMITTED_IDENTITY__: identitySql("committed", nonce, manifest) };
        for (const [marker, value] of Object.entries(replacements)) {
            need(sql.includes(marker), "TASK16_ACCESS_TEMPLATE");
            sql = sql.replaceAll(marker, value);
        }
        need(!/__[A-Z_]+__/u.test(sql), "TASK16_ACCESS_TEMPLATE");
        check();
        attempted = true;
        const after = parse(await methods.execOwnerSql.call(resource, sql, "task16-baseline-access-transaction"), "committed", nonce);
        check();
        need(after.ownerOid === before.ownerOid && after.matrixVerified === true && after.guardVerified === true && after.runtimeRole === RUNTIME && after.observerRole === OBSERVER && [after.runtimeOid, after.observerOid].every(oid => /^[1-9][0-9]*$/u.test(oid)) && new Set([after.ownerOid, after.runtimeOid, after.observerOid]).size === 3, "TASK16_ACCESS_EFFECTIVE_MATRIX");
        return { status: "BASELINE_ROLE_ACL_COMMIT_OBSERVED", sourceSha: source.candidateSha, databaseOid: after.databaseOid, systemIdentifier: after.systemIdentifier, runtimeRole: RUNTIME, observerRole: OBSERVER, runtimeOid: after.runtimeOid, observerOid: after.observerOid, manifestSha256: members[1].sha256, sqlSha256: hash(sql), expectedMatrixSha256: hash(JSON.stringify([manifest.runtime, manifest.observer])), financialAcceptance: false, aclAcceptance: false, tlsAcceptance: false };
    }
    catch (error) {
        const code = typeof error?.code === "string" && /^TASK16_ACCESS_[A-Z0-9_]+$/u.test(error.code) ? error.code : "TASK16_ACCESS_FAILED_CLOSED";
        throw Object.assign(new Error(code), { code, baselineAccessOutcome: attempted ? "UNKNOWN_DO_NOT_RETRY" : "NOT_ATTEMPTED" });
    }
}
module.exports = { installTask16BaselineAccess };
