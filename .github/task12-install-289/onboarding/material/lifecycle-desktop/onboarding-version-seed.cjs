'use strict';

const { createServer } = require('node:net');
const { randomUUID } = require('node:crypto');
const path = require('node:path');

function renderVersionSeed({ database, projectId, contractId, versionId }) {
  if (!/^jg_task01_[0-9a-f]{32}$/u.test(database)
      || ![projectId, contractId, versionId].every(id => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(id))
      || new Set([projectId, contractId, versionId]).size !== 3) {
    throw new Error('ONBOARDING_VERSION_SEED_IDENTITY');
  }
  return `INSERT INTO public."ContractVersion" (
    "id","contractId","versionNo","changeType","status","amountCents","draftData","templateSnapshot","clauseSnapshot","updatedAt"
  )
  SELECT '${versionId}', c.id, 1, 'original', 'in_approval', 100, '{}', '{}', '{}',
    statement_timestamp() AT TIME ZONE 'UTC'
  FROM public."Contract" c JOIN public."Project" p ON p.id=c."projectId"
  WHERE current_database()='${database}' AND current_user='jg_task01_owner' AND session_user=current_user
    AND c.id='${contractId}' AND p.id='${projectId}'
    AND c.name='合成会签合同' AND c.counterparty='合成单位' AND p.name='合成已签会签项目'
    AND NOT EXISTS (SELECT 1 FROM public."ContractVersion" v WHERE v."contractId"=c.id)
  RETURNING 'SEEDED';`;
}

async function openVersionSeed(context) {
  const projectId=randomUUID(), contractId=randomUUID(), versionId=randomUUID();
  const requestKey=randomUUID();
  const socket=path.join(context.workDir,'onboarding-version.sock');
  const sql=renderVersionSeed({ database:context.database, projectId, contractId, versionId });
  let consumed=false;
  const server=createServer({allowHalfOpen:true},connection => {
    connection.on('error',()=>connection.destroy());
    let frame='';
    connection.setEncoding('utf8');
    connection.on('data',chunk=>{
      frame+=chunk;
      if (frame.length>requestKey.length) connection.destroy();
    });
    connection.once('end',async ()=>{
      if (consumed || frame!==requestKey) {
        connection.end('DENIED');
        return;
      }
      consumed=true;
      try {
        const result=await context.sql(sql);
        connection.end(result.stdout.trim().split('\n')[0]==='SEEDED' ? versionId : 'DENIED');
      } catch {
        connection.end('DENIED');
      }
    });
  });
  await new Promise((resolve,reject)=>server.once('error',reject).listen(socket,resolve));
  return {
    env:{TASK_ONBOARDING_VERSION_SOCKET:socket,TASK_ONBOARDING_VERSION_KEY:requestKey,
      TASK_ONBOARDING_VERSION_PROJECT:projectId,TASK_ONBOARDING_VERSION_CONTRACT:contractId},
    close:()=>new Promise((resolve,reject)=>server.close(error=>error ? reject(error) : resolve())),
  };
}
module.exports={openVersionSeed,renderVersionSeed};
