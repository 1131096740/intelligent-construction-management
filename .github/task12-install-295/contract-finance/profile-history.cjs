'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createHash}=require('node:crypto');
const seedSha='43e2dd735b37852e1021d795906c3327db71524030c7ae11c92387643392ff99';

async function runProfileHistory({ledger,deploy,read,identity,checkLedger,enter,sql,receipt}){
  assert.equal(ledger[125]?.name,'20260814010000_project_operating_profile','REMAINING_PROFILE_126_SOURCE');
  assert.equal(ledger[125].sha256,'af512609e42dc1b2f026e3fb51c2cbafccd16d7e8b945e1281b725ca1acc9f4a',
    'REMAINING_PROFILE_126_SOURCE');
  await deploy(125);
  const before=await read(),bound=identity(before);
  checkLedger(before,125);
  enter('REMAINING_PROFILE_ORIGINAL_SEED');
  const seed=fs.readFileSync('/qualification/project-profile-original-seed.sql');
  assert.equal(createHash('sha256').update(seed).digest('hex'),seedSha,'REMAINING_PROFILE_ORIGINAL_SEED_SHA');
  await sql(seed.toString('utf8'));
  await deploy(126);
  const after=await read();
  assert.deepEqual(identity(after),bound,'REMAINING_PROFILE_HISTORY_IDENTITY');
  checkLedger(after,126);
  receipt.profileHistory={prefix:125,backfill:126,sameInstance:true,originalSeedSha256:seedSha};
  return bound;
}
module.exports={runProfileHistory};
