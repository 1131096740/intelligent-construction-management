'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash,randomUUID}=require('node:crypto'),{spawnSync}=require('node:child_process');
const material=require('./wage-material.json');
const api='/qualification/workspace/services/api';
const file='src/database/wage-statement-constraints.spec.ts';
const need=(ok,code)=>{if(!ok)throw new Error(code);};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

function verifyWageReport(report){
  const suites=report?.testResults??[];
  const rows=suites.length===1&&suites[0].name===path.join(api,file)?suites[0].assertionResults:[];
  const missing=material.originalNames.flatMap((title,i)=>{
    const matching=rows.filter(row=>row.title===title);
    return matching.length===1&&matching[0].status==='passed'?[]:[i+1];
  });
  return {exact:report?.success===true&&report.numTotalTests===25&&report.numPassedTests===25&&report.numPendingTests===0&&
    report.numPassedTestSuites===1&&rows.length===25&&!missing.length,originalPg:material.originalDatabaseTests,missing};
}

async function runWage(context,receipt) {
  need(sha(fs.readFileSync(path.join(api,file)))===material.fixtureSpecSha256,'REMAINING_WAGE_SPEC_BYTES');
  const {workDir,ownerUrl,runId,database}=context, endpoint=new URL(ownerUrl);
  need(endpoint.protocol==='postgresql:'&&endpoint.hostname==='127.0.0.1'&&endpoint.username==='jg_task01_owner'&&
    endpoint.pathname==='/'+database&&database==='jg_task01_'+runId.replaceAll('-','')&&
    endpoint.searchParams.get('sslmode')==='require'&&endpoint.searchParams.get('sslaccept')==='strict'&&
    endpoint.searchParams.get('sslcert')===path.join(workDir,'ca.crt'),'REMAINING_WAGE_OWNED_IDENTITY');
  const environment={PATH:'/usr/local/bin:/usr/bin:/bin',HOME:workDir,TMPDIR:workDir,NODE_ENV:'test',CI:'true'};
  const schema=path.join(workDir,'prefixes/combined289/schema.prisma');
  const prisma=path.join(api,'node_modules/prisma/build/index.js');
  const commands=[['deploy','No pending migrations to apply.'],['status','Database schema is up to date']];
  for(const [operation,marker] of commands){
    receipt.stages.push('REMAINING_WAGE_'+operation.toUpperCase());
    const result=spawnSync(process.execPath,[prisma,'migrate',operation,'--schema',schema],
      {cwd:api,env:{...environment,DATABASE_URL:ownerUrl},encoding:'utf8',timeout:180_000,maxBuffer:16*1024*1024});
    need(result.status===0&&result.stdout?.includes(marker),'REMAINING_WAGE_NOOP_STATUS');
  }
  receipt.wageHistory.noopAndStatus=true;
  endpoint.searchParams.delete('connection_limit');
  const reportPath=path.join(fs.mkdtempSync(path.join(workDir,'remaining-wage-jest-')),'jest.json');
  receipt.stages.push('REMAINING_WAGE_ORIGINAL_JEST');
  const result=spawnSync(process.execPath,[path.join(api,'node_modules/jest/bin/jest.js'),'--runInBand','--runTestsByPath',file,'--json','--outputFile='+reportPath],
    {cwd:api,env:{...environment,WAGE_STATEMENT_DATABASE_URL:endpoint.toString(),RUN_WAGE_STATEMENT_DATABASE:'1',
      JG_WAGE_289_RUN_ID:runId.replaceAll('-',''),JG_WAGE_289_CA_FILE:endpoint.searchParams.get('sslcert'),JG_WAGE_289_PG_PORT:endpoint.port,
      OPERATING_LEDGER_DB_WRITE_SECRET:randomUUID()},encoding:'utf8',timeout:900_000,maxBuffer:16*1024*1024});
  let report;
  try{
    const reportStat=fs.lstatSync(reportPath);
    if(reportStat.isFile()&&reportStat.size<=16*1024*1024)report=JSON.parse(fs.readFileSync(reportPath,'utf8'));
  }catch{}
  const coverage=verifyWageReport(report);
  receipt.wageJest={...coverage,exit:result.status,reportPresent:!!report};
  need(result.status===0&&coverage.exact,'REMAINING_WAGE_ORIGINAL_COVERAGE');
}
module.exports={runWage,verifyWageReport};
