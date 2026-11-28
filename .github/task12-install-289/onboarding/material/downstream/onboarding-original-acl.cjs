'use strict';

const { createHash } = require('node:crypto');
const fs = require('node:fs');
const { renderOriginalHardening } = require('./task12-onboarding-role-fixture.cjs');
const material = require('./onboarding-original-acl-controls.json');

async function verifyOriginalAcl(context) {
  if(createHash('sha256').update(fs.readFileSync(require.resolve('./original-onboarding.cjs'))).digest('hex')
    !==material.sourceSha256) throw Error('ONBOARDING_ORIGINAL_ACL_SOURCE');
  const ownerSql = text=>context.sql(text);
  const grantSql=renderOriginalHardening();
  const snapshot=async()=>(await ownerSql(material.acl)).stdout;
  const first=await snapshot(); // The bootstrap has applied the original grant exactly once.
  const check=async()=>{if(await snapshot()!==first)throw Error('ONBOARDING_ORIGINAL_ACL_DIFF');};
  await ownerSql(grantSql);
  await check();
  for(const [setup,cleanup,message] of material.negatives){
    await ownerSql(setup);
    let denied;
    try { denied=await context.onboardingOriginalGrantNegative(grantSql,message); }
    finally { await ownerSql(cleanup); }
    if(denied.code!==3||denied.expectedMarker!==true)throw Error('ONBOARDING_ORIGINAL_ACL_NEGATIVE');
    await check();
  }
  for(let offset=0;offset<material.positives.length;offset+=3){
    const [setup,assert,cleanup]=material.positives.slice(offset,offset+3);
    await ownerSql(setup);
    try { await ownerSql(grantSql);await ownerSql(assert); }
    finally { await ownerSql(cleanup); }
    await check();
  }
  await ownerSql(material.rollback);
  await check();
  return Object.freeze({idempotent:true,denied:material.negatives.length,
    unreachablePositive:material.positives.length/3,nonOwnerAndBackupRollback:true});
}
module.exports={verifyOriginalAcl};
