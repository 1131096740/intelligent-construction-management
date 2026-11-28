'use strict';
const {withInstalled289Onboarding}=require('./installer.cjs');
const receipt={schemaVersion:1,purpose:'ONBOARDING_FIXED_ORIGINAL_ROSTER10_289',stages:[],status:'STOPPED',business:'NOT_ENTERED',executionAllowed:false};
withInstalled289Onboarding(receipt).then(()=>{
  if(!receipt.onboardingAliasRevoked||!receipt.onboardingVoucherColumnRevoked||
    receipt.onboardingSuites?.length!==1||receipt.onboardingSuites[0].phase!=='ONBOARDING_ORIGINAL_ROSTER10'||
    receipt.onboardingSuites[0].passed!==10||receipt.rosterPeer?.coordinates?.length!==4||
    !receipt.rosterPeer.coordinates.every(Boolean)||receipt.rosterPeer.denials!==2||
    receipt.sameInstancePostConsume!==true||receipt.business!=='CALLBACK_COMPLETED'||receipt.orderedTails?.at(-1)?.size!==289) throw Error('ROSTER10_COMPLETE');
  receipt.status='ONBOARDING_FIXED_ORIGINAL_ROSTER10_289_PASSED';
}).catch(error=>{
  const code=error.code??error.message;
  receipt.status='STOPPED';
  receipt.failure={stage:receipt.stages.at(-1),code:/^[A-Z0-9_]+$/u.test(code)?code:'UNKNOWN',
    command:error.command,exit:error.exit,sqlstate:error.sqlstate,prismaCode:error.prismaCode};
  process.exitCode=1;
}).finally(()=>process.stdout.write(JSON.stringify(receipt)+'\n'));
