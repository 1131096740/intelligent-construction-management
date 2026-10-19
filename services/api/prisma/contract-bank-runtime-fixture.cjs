"use strict";
const { spawnSync } = require("node:child_process");
const path = require("node:path");

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
   GRANT UPDATE ON "PaymentExecutionPayerVerification" TO contract_runtime;
   GRANT EXECUTE ON FUNCTION "appendOperatingFactThroughService"("OperatingLedgerFactWritePayload",text,text) TO contract_runtime;
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
 runDocker(['cp',path.resolve(__dirname,'../../../scripts/ops/db-backup-read-role.sql'),name+':/tmp/backup-role.sql']);
 runDocker(['exec',name,'psql','-v','ON_ERROR_STOP=1','-U','contract_backup','-d',db,'-f','/tmp/backup-role.sql']);
 return target.replace('://jiangkong:', '://contract_runtime:');
}
module.exports = { prepareContractBankRuntime };
