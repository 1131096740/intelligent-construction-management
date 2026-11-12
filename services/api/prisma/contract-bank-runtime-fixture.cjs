"use strict";
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { collision_routines: collisionRoutines } = require("./local-staged-migration-qualification.json");

// Staged qualification retains EXECUTE for existing callers and removes it
// from PUBLIC. These finance test identities are created after that stage.
const fileGuardCalls = Object.freeze([
  ...Object.keys(collisionRoutines).filter(signature =>
    /^public\.jg_(?:has_exclusive_file_business_binding\(pg_catalog\.text\)|file_business_(?:collision_columns|binding_columns(?:_before_[a-z0-9_]+)?)\(\))$/u.test(signature)
  ),
  "public.jg_file_business_binding_columns_before_contract_archive_v2()"
]);

function renderContractFinanceFileGuardGrant(role) {
  if (typeof role !== "string" || !/^(?:contract_runtime|finance_runtime_[a-f0-9]{32})$/u.test(role)) {
    throw new Error("Contract finance file guard requires a fixture runtime identity");
  }
  return `DO $contract_finance_file_guard$
DECLARE
  fixture_role CONSTANT name := '${role}';
  fixture_oid oid;
  owner_oid oid := current_user::pg_catalog.regrole::oid;
  signature text;
  routine_oid oid;
BEGIN
  IF current_database() <> 'jiangkong_project_affiliate_company_contract_test'
    OR current_user <> 'jiangkong' OR session_user <> current_user
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_database WHERE datname=current_database() AND datdba=owner_oid) THEN
    RAISE EXCEPTION 'Contract finance file guard requires the owned fixture database';
  END IF;
  SELECT oid INTO STRICT fixture_oid FROM pg_catalog.pg_roles
  WHERE rolname=fixture_role AND rolcanlogin AND NOT rolinherit
    AND NOT (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls);
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member=fixture_oid OR roleid=fixture_oid)
    OR NOT pg_catalog.has_schema_privilege(fixture_oid,'public','USAGE')
    OR pg_catalog.has_schema_privilege(fixture_oid,'public','CREATE')
    OR NOT pg_catalog.has_column_privilege(fixture_oid,'public."ApprovalActionLog"','signatureFileIdSnapshot','INSERT') THEN
    RAISE EXCEPTION 'Contract finance file guard requires the restricted signature writer';
  END IF;
  FOREACH signature IN ARRAY ARRAY[${fileGuardCalls.map(signature => `'${signature}'`).join(", ")}] LOOP
    SELECT p.oid INTO STRICT routine_oid FROM pg_catalog.pg_proc p
    WHERE p.oid=pg_catalog.to_regprocedure(signature)
      AND p.pronamespace=pg_catalog.to_regnamespace('public') AND p.proowner=owner_oid
      AND p.prokind='f' AND NOT p.prosecdef
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
        WHERE a.grantee=0 OR (a.grantee=fixture_oid
          AND (a.grantor<>owner_oid OR a.privilege_type<>'EXECUTE' OR a.is_grantable)));
    EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION %s TO %I',signature,fixture_role);
    IF NOT pg_catalog.has_function_privilege(fixture_oid,routine_oid,'EXECUTE')
      OR pg_catalog.has_function_privilege(fixture_oid,routine_oid,'EXECUTE WITH GRANT OPTION') THEN
      RAISE EXCEPTION 'Contract finance file guard fixture grant did not match';
    END IF;
  END LOOP;
END;
$contract_finance_file_guard$;`;
}

// Shared by both real-PG runners. All identities belong to their disposable container.
function prepareContractBankRuntime({ name, db, password, target, env = process.env }) {
  if (env.NODE_ENV === "production" || db !== "jiangkong_project_affiliate_company_contract_test"
    || !/^[a-zA-Z0-9_-]+$/.test(name) || !/^[a-f0-9-]{36}$/.test(password)
    || new URL(target).hostname !== "127.0.0.1"
    || (env.DOCKER_HOST && !env.DOCKER_HOST.startsWith("unix://"))) {
    throw new Error("Contract bank fixture requires a disposable local database");
  }
  const docker = process.platform === "win32" ? "docker.exe" : "docker";
  function runDocker(args) {
    const result = spawnSync(docker, args, { env, encoding: "utf8", timeout: 60_000 });
    if (result.error || result.status !== 0) throw new Error(String(result.stderr || result.error).replaceAll(password, "[redacted]"));
    return result.stdout;
  }
 // Production-shaped roles: owner creates objects; runtime alone may invoke the bounded issuer.
 runDocker(['exec',name,'psql','-v','ON_ERROR_STOP=1','-U','jiangkong','-d',db,'-c',`
   CREATE ROLE contract_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '${password}';
   CREATE ROLE contract_backup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '${password}';
   GRANT USAGE ON SCHEMA public TO contract_runtime,contract_backup;
   GRANT SELECT ON ALL TABLES IN SCHEMA public TO contract_runtime,contract_backup;
   GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO contract_backup;
   REVOKE ALL ON TABLE "OperatingLedgerWriteSecret","OperatingLedgerWriteContext" FROM contract_runtime;
   GRANT INSERT,UPDATE ON "ContractBankVerificationRequest","VerifiedBankTransactionObservation","AuditLog","Project","CompanyEntity","User","HandwrittenSignatureVersion","FileObject" TO contract_runtime;
   GRANT INSERT,UPDATE ON "ApprovalInstance" TO contract_runtime;
   GRANT INSERT ON "ApprovalActionLog" TO contract_runtime;
   GRANT UPDATE ON "PaymentExecutionPayerVerification" TO contract_runtime;
   GRANT EXECUTE ON FUNCTION "appendOperatingFactThroughService"("OperatingLedgerFactWritePayload",text,text) TO contract_runtime;
   ${renderContractFinanceFileGuardGrant('contract_runtime')}
 `]);
 const grantFile=path.join(__dirname,'contract-bank-verification-runtime-grants.sql');
 {
   runDocker(['cp',grantFile,name+':/tmp/bank-grants.sql']);
   runDocker(['exec','--env','OPERATING_LEDGER_RUNTIME_ROLE=contract_runtime',name,'psql','-v','ON_ERROR_STOP=1','-U','jiangkong','-d',db,'-f','/tmp/bank-grants.sql']);
 }
 const badGrant=spawnSync(docker,['exec','--env','OPERATING_LEDGER_RUNTIME_ROLE=contract_backup',name,'psql','-v','ON_ERROR_STOP=1','-U','jiangkong','-d',db,'-f','/tmp/bank-grants.sql'],{encoding:'utf8',env});
 if(badGrant.status===0||!badGrant.stderr.includes('existing restricted operating-ledger runtime role')) throw Error('Backup identity must not receive runtime grants');
 const denied=spawnSync(docker,['exec',name,'psql','-v','ON_ERROR_STOP=1','-U','contract_backup','-d',db,'-c',"SELECT issue_contract_bank_holder('missing','missing','missing','missing','missing')"],{encoding:'utf8',env});
 if(denied.status===0||!denied.stderr.includes('permission denied for function issue_contract_bank_holder')) throw Error('Backup issuer invocation must fail at the privilege boundary');
 for (const signature of ["issue_contract_bank_holder(text,text,text,text,text,text)","record_verified_bank_observation(jsonb,text)","append_company_transfer_event(jsonb,text)"]) {
   const allowed=runDocker(['exec',name,'psql','-At','-U','jiangkong','-d',db,'-c',`SELECT has_function_privilege('contract_runtime','public.${signature}','EXECUTE'),has_function_privilege('contract_backup','public.${signature}','EXECUTE')`]).trim();
   if(allowed!=="t|f") throw Error('Only runtime may execute the narrow financial entries');
 }
 runDocker(['cp',path.resolve(__dirname,'../../../scripts/ops/db-backup-read-role.sql'),name+':/tmp/backup-role.sql']);
 runDocker(['exec',name,'psql','-v','ON_ERROR_STOP=1','-U','contract_backup','-d',db,'-f','/tmp/backup-role.sql']);
 return target.replace('://jiangkong:', '://contract_runtime:');
}
module.exports = { prepareContractBankRuntime, renderContractFinanceFileGuardGrant };
