'use strict';
const {createHash,randomBytes}=require('node:crypto');
const {isDeepStrictEqual:equal}=require('node:util');
const path=require('node:path');
const fs=require('node:fs');
const {runJest}=require('./task12-pfq-jest-wire.cjs');
const need=(ok,label)=>{if(!ok) throw new Error(label);};
const ask=async(context,sql)=>JSON.parse((await context.sql(sql)).stdout.trim());

async function runPfqApp(context,receipt) {
    const ownedSpec='/qualification/workspace/services/api/src/database/project-financing-quota-concurrency.owned282.spec.ts';
    need(createHash('sha256').update(fs.readFileSync(ownedSpec)).digest('hex')===
      '1621f3b8235757dfdeb4a2504ceb1164f0fd60ddeac96e4e87e8e4d25d1ae313','PFQ_SPEC_POSTIMAGE');
    const {ownerUrl,workDir,database}=context;
    const dsn=new URL(ownerUrl);
    need(receipt.pfqAppMigrationStatus===true&&
      database==='jg_task01_'+context.runId.replaceAll('-','')&&
      dsn.protocol==='postgresql:'&&dsn.hostname==='127.0.0.1'&&Number(dsn.port)>1024&&Number(dsn.port)<=65535&&dsn.port!=='5432'&&dsn.pathname==='/'+database&&
      dsn.username==='jg_task01_owner'&&/^[a-f0-9]{96}$/u.test(dsn.password)&&
      dsn.searchParams.get('connection_limit')==='1'&&dsn.searchParams.get('sslmode')==='require'&&
      dsn.searchParams.get('sslaccept')==='strict'&&dsn.searchParams.get('sslcert')===path.join(workDir,'ca.crt')&&
      /^\/tmp\/jg394-[A-Za-z0-9]+$/u.test(workDir),'PFQ_APP_BOUND_ENDPOINT');
    const identityQuery=`SELECT jsonb_build_object('database',current_database(),'databaseOid',d.oid::text,
      'systemIdentifier',(SELECT system_identifier::text FROM pg_catalog.pg_control_system()),'ownerOid',d.datdba::text,
      'verified',current_user=session_user AND current_user='jg_task01_owner' AND current_user::regrole::oid=10
        AND d.datdba=10 AND inet_server_port()=${Number(dsn.port)} AND host(inet_server_addr())='127.0.0.1'
        AND (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()))
      FROM pg_database d WHERE d.datname=current_database();`;
    const observed=await ask(context,identityQuery);
    need(observed.verified&&observed.database===database&&observed.databaseOid===receipt.databaseIdentity.databaseOid&&
      observed.systemIdentifier===receipt.databaseIdentity.systemIdentifier,'PFQ_APP_OWNER_IDENTITY');
    const {verified,...identity}=observed;
    const nonce=randomBytes(16).toString('hex');
    receipt.stages.push('PFQ_APP_ORIGINAL_JEST');
    const result=await runJest({url:ownerUrl,identity,nonce},new AbortController().signal,async rows=>{
      need(Array.isArray(rows)&&rows.length===4&&new Set(rows.map(row=>row?.pid)).size===4&&
        rows.every(row=>Number.isInteger(row?.pid)&&row.pid>0&&row.pid<=0x7fffffff&&typeof row.start==='string'&&
          /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/u.test(row.start)),'PFQ_APP_SESSION_PACKET');
      const foreign=await ask(context,`SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'pid',a.pid,'start',to_char(a.backend_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'name',a.application_name)),'[]'::jsonb)
        FROM pg_stat_activity a JOIN pg_stat_ssl s USING(pid)
        WHERE s.ssl AND a.datid=(SELECT oid FROM pg_database WHERE datname=current_database())
          AND a.usename=current_user AND host(a.client_addr)='127.0.0.1'
          AND a.pid IN (${rows.map(row=>row.pid).join(',')});`);
      need(foreign.length===4&&rows.every((row,index)=>foreign.some(bound=>
        bound.pid===row.pid&&bound.start===row.start&&bound.name===`jg_pfq_${nonce}_${index}`)),
        'PFQ_APP_SESSION_BINDING');
    });
    need(equal(await ask(context,identityQuery),observed),'PFQ_APP_FINAL_IDENTITY');
    receipt.pfqApp={...result,sessionAttestationRounds:2,sessions:4};
}

module.exports={runPfqApp};
