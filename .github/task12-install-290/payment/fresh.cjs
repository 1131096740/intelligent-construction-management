"use strict";
const {spawnSync}=require("node:child_process");
const {createHash,randomUUID}=require("node:crypto");
const fs=require("node:fs");
const path=require("node:path");
const {withPayment290}=require("./installer.cjs");
const workspace="/qualification/workspace";
const tree="a1be083076018686dd8afba68c44ff9c75502014";
const suite="src/database/payment-execution-concurrency.spec.ts";
const receipt={schemaVersion:1,purpose:"PAYMENT_EXECUTION_ORIGINAL_FRESH_290",status:"STOPPED",stages:[]};
function command(phase,file,args,options) {
  const child=spawnSync(file,args,{encoding:"utf8",maxBuffer:8*1024*1024,timeout:300_000,...options});
  if(child.status!==0 || child.error) {
    const output=(child.stderr??"")+(child.stdout??"");
    const denied=/permission denied for (function|table|relation|schema) ([A-Za-z_][A-Za-z0-9_.]{0,95})/u.exec(output);
    throw Object.assign(new Error(phase),{exit:child.status,signal:child.signal,os:child.error?.code,
      prisma:/\bP[0-9]{4}\b/u.exec(output)?.[0],sqlstate:/SqlState\(E([0-9A-Z]{5})\)/u.exec(output)?.[1],
      denied:denied?{kind:denied[1],object:denied[2]}:undefined});
  }
}
withPayment290(receipt,async context=>{
  if(context.candidateTree!==tree)throw new Error("PAYMENT_FRESH_TREE");
  const {ownerUrl,runId,workDir}=context;
  const target=new URL(ownerUrl);
  if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(runId) ||
     target.hostname!=="127.0.0.1" || target.username!=="jg_task01_owner" ||
     target.pathname!=="/jg_task01_"+runId.replaceAll("-","") ||
     target.searchParams.get("sslcert")!==path.join(workDir,"ca.crt") ||
     target.searchParams.get("sslmode")!=="require" || target.searchParams.get("sslaccept")!=="strict") {
    throw new Error("PAYMENT_FRESH_CONTEXT");
  }
  const options={cwd:workspace,env:{
    PATH:"/usr/local/bin:/usr/bin:/bin",HOME:workDir,TMPDIR:workDir,COREPACK_HOME:"/opt/corepack",
    COREPACK_ENABLE_NETWORK:"0",COREPACK_DEFAULT_TO_LATEST:"0",NODE_ENV:"test",CI:"true",
    DATABASE_URL:ownerUrl,FILE_STORAGE_DRIVER:"local", FILE_STORAGE_ROOT:path.join(workDir,"storage","private"),
    RUN_PAYMENT_EXECUTION_CONCURRENCY:"1",JG_TASK12_OWNED_280_RUN_ID:runId,
    OPERATING_LEDGER_DB_WRITE_SECRET:randomUUID(),SEED_PASSWORD:randomUUID()
  }};
  const result=await context.sql("SELECT (current_user=session_user AND current_user='jg_task01_owner' AND EXISTS (SELECT 1 FROM pg_roles r JOIN pg_database d ON d.datdba=r.oid WHERE r.oid=10 AND r.rolsuper AND d.datname=current_database()) AND (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()))::text;");
  if(result.stdout.trim()!=="true")throw new Error("PAYMENT_FRESH_OWNER");
  const pnpm=["--filter","@jiangkong/api","exec"];
  receipt.stages.push("PAYMENT_FRESH_STATUS");
  command("PAYMENT_FRESH_STATUS","pnpm",[...pnpm,"prisma","migrate","status","--schema",context.schemaPath],options);
  const query=fs.readFileSync("/qualification/seed-readback.sql","utf8");
  receipt.seedChecks=[];
  for (const stage of ["FIRST","SECOND"]) {
    receipt.stages.push("PAYMENT_FRESH_SEED_"+stage);
    command("PAYMENT_FRESH_SEED_"+stage,process.execPath,[path.join(workspace,"services/api/prisma/seed.cjs")],{...options,cwd:workDir});
    const readback=(await context.sql(query)).stdout.trim();
    if(readback!=="1|1|12800000|1|exact")throw new Error("PAYMENT_FRESH_SEED_READBACK_"+stage);
    receipt.seedChecks.push({stage,readback});
  }
  const report=path.join(workDir,"payment-jest.json");
  receipt.stages.push("PAYMENT_FRESH_JEST");
  command("PAYMENT_FRESH_JEST","pnpm",[...pnpm,"jest","--runInBand","--runTestsByPath",suite,"--json","--outputFile",report],options);
  const raw=fs.readFileSync(report);
  const parsed=JSON.parse(raw);
  if(parsed.success!==true || parsed.numPendingTests!==0 || parsed.numPassedTests!==2 || parsed.numPassedTestSuites!==1 ||
      parsed.testResults.length!==1 || !parsed.testResults[0].name.endsWith("/"+suite))throw new Error("PAYMENT_FRESH_COVERAGE");
  receipt.scope={suites:1,tests:2,skips:0,reportSha256:createHash("sha256").update(raw).digest("hex")};
}).then(()=>{receipt.status="PAYMENT_EXECUTION_FRESH_290_PASSED";}).catch(error=>{
  receipt.status="STOPPED";
  receipt.failure={stage:receipt.stages.at(-1),code:error.message,exit:error.exit,signal:error.signal,
    operatingSystem:error.os,prisma:error.prisma,sqlstate:error.sqlstate,denied:error.denied};
  process.exitCode=1;
}).finally(()=>console.log(JSON.stringify(receipt)));
