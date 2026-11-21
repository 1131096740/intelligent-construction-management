'use strict';

const { createServer }=require('node:net');
const { randomUUID }=require('node:crypto');
const {chmodSync,lstatSync,realpathSync}=require('node:fs');
const path=require('node:path');

const sequence=Object.freeze([46,47,52,53]);
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
const dbName=/^jg_task01_[a-f0-9]{32}$/u;
const positiveId=/^[1-9][0-9]{0,19}$/u;
const need=(ok,tag)=>{if(!ok)throw new Error('ROSTER10_'+tag);};

function renderVersionSeed(bound, item) {
  const {database,databaseOid,systemIdentifier,port}=bound;
  const {ordinal,contractId,versionId}=item;
  need(dbName.test(database)&&positiveId.test(databaseOid)&&positiveId.test(systemIdentifier)
    &&Number.isInteger(port)&&port>1024&&port<=65535&&port!==5432,'DATABASE_WITNESS');
  need(sequence.includes(ordinal)&&uuid.test(contractId)&&uuid.test(versionId)&&contractId!==versionId,'COORDINATE');
  return `WITH parent AS (
    SELECT c.id
    FROM public."Contract" c JOIN public."Project" p ON p.id=c."projectId"
    JOIN pg_catalog.pg_database d ON d.datname=current_database()
    JOIN pg_catalog.pg_stat_ssl ssl ON ssl.pid=pg_backend_pid() AND ssl.ssl
    WHERE d.datname='${database}' AND d.oid::text='${databaseOid}' AND d.datdba=10
      AND current_user='jg_task01_owner' AND session_user=current_user AND current_user::regrole::oid=10
      AND (SELECT system_identifier::text FROM pg_catalog.pg_control_system())='${systemIdentifier}'
      AND inet_client_addr()='127.0.0.1'::inet AND inet_server_addr()='127.0.0.1'::inet AND inet_server_port()=${port}
      AND c.id='${contractId}' AND p.id='legacy-roster-${ordinal}' AND p.code='ROSTER-${ordinal}'
      AND p.name='花名册合成空项目${ordinal}' AND c.name='合成交接合同' AND c.counterparty='合成单位'
      AND NOT EXISTS (SELECT FROM public."ContractVersion" v WHERE v."contractId"=c.id OR v.id='${versionId}')
    FOR UPDATE OF c
  )
  INSERT INTO public."ContractVersion" (
    "id","contractId","versionNo","changeType","status","amountCents","draftData","templateSnapshot","clauseSnapshot","updatedAt"
  )
  SELECT '${versionId}', parent.id, 1, 'original', 'in_approval', 100, '{}', '{}', '{}',
    statement_timestamp() AT TIME ZONE 'UTC'
  FROM parent
  RETURNING 'SEEDED';`;
}

async function openRosterVersionSeed(context, receipt) {
  const owner=new URL(context.ownerUrl);
  const {database,databaseOid,systemIdentifier,serverPort:port}=receipt.databaseIdentity;
  const workDir=context.workDir;
  need(context.candidateTree==='a1be083076018686dd8afba68c44ff9c75502014'&&
    database===context.database&&database==='jg_task01_'+context.runId.replaceAll('-','')&&
    owner.username==='jg_task01_owner'&&owner.hostname==='127.0.0.1'&&owner.pathname==='/'+database&&
    Number(owner.port)===port&&owner.searchParams.get('sslaccept')==='strict'&&
    owner.searchParams.get('sslmode')==='require'&&owner.searchParams.get('sslcert')===path.join(workDir,'ca.crt')&&
    /^\/tmp\/jg394-[A-Za-z0-9]+$/u.test(workDir)&&realpathSync(workDir)===workDir&&
    lstatSync(workDir).uid===process.getuid()&&(lstatSync(workDir).mode&0o777)===0o700,'ENDPOINT');
  const scope={database,databaseOid,systemIdentifier,port};
  const items=sequence.map(ordinal=>({ordinal,contractId:randomUUID(),versionId:randomUUID(),key:randomUUID()}));
  need(new Set(items.flatMap(({contractId,versionId,key})=>[contractId,versionId,key])).size===12,'DISTINCT_IDS');
  const requests=new Map(items.map(item=>[item.key,{...item,sql:renderVersionSeed(scope,item)}]));
  const success=new Set(), connections=new Set();
  let denials=0;
  const socket=path.join(workDir,'roster-version.sock');
  const server=createServer({allowHalfOpen:true},connection=>{
    connections.add(connection);
    connection.on('close',()=>connections.delete(connection));
    connection.on('error',()=>connection.destroy());
    connection.setTimeout(10_000,()=>connection.destroy());
    let frame='';
    connection.setEncoding('utf8');
    connection.on('data',chunk=>{
      frame+=chunk;
      if(frame.length>36)connection.destroy();
    });
    connection.once('end',async ()=>{
      const item=requests.get(frame);
      if(!item){
        denials++;
        connection.end('DENIED');
        return;
      }
      requests.delete(frame);
      try {
        const result=await context.sql(item.sql);
        const output=result.stdout.trim().split('\n').filter(Boolean);
        if(output[0]==='SEEDED'&&output.length===1){
          success.add(item.ordinal);
          connection.end(item.versionId);
          return;
        }
      } catch {
        // The caller receives only a finite refusal. An errored slot is consumed.
      }
      denials++;
      connection.end('DENIED');
    });
  });
  await new Promise((resolve,reject)=>server.once('error',reject).listen(socket,resolve));
  chmodSync(socket,0o600);
  return {
    env:{TASK_ROSTER_VERSION_SOCKET:socket,TASK_ROSTER_VERSION_COORDINATES:JSON.stringify(items.map(item=>({
      projectId:'legacy-roster-'+item.ordinal,contractId:item.contractId,versionId:item.versionId,key:item.key})))},
    report:()=>({coordinates:sequence.map(ordinal=>success.has(ordinal)),denials}),
    close:()=>new Promise((resolve,reject)=>{
      for(const connection of connections)connection.destroy();
      server.close(error=>error?reject(error):resolve());
    }),
  };
}

module.exports={openRosterVersionSeed,renderVersionSeed};
