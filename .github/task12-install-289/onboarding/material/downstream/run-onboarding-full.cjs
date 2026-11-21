'use strict';
const {withInstalled289Onboarding}=require('./installer.cjs');
const receipt={schemaVersion:1,purpose:'ONBOARDING_ORIGINAL_DUAL_BROWSER_CASE12_289',stages:[],status:'STOPPED',business:'NOT_ENTERED',executionAllowed:false};
withInstalled289Onboarding(receipt).then(()=>{
  if(!receipt.onboardingAliasRevoked||!receipt.onboardingVoucherColumnRevoked||
    receipt.onboardingSuites?.length!==1||receipt.onboardingSuites[0].phase!=='ONBOARDING_ORIGINAL_INDEPENDENT_29'||
    receipt.onboardingSuites[0].passed!==29||
    receipt.sameInstancePostConsume!==true||receipt.business!=='CALLBACK_COMPLETED'||receipt.orderedTails?.at(-1)?.size!==289) throw Error('ONBOARDING_CANVAS_COMPLETE');
  receipt.status='ONBOARDING_ORIGINAL_INDEPENDENT_29_289_PASSED';
}).catch(error=>{
  receipt.status='STOPPED';
  const code=error.code??error.message;
  receipt.failure={stage:receipt.stages.at(-1),code:/^[0-9A-Z_]+$/u.test(code)?code:'UNKNOWN',
    command:error.command,exit:error.exit,sqlstate:error.sqlstate,prismaCode:error.prismaCode};
  process.exitCode=1;
}).finally(()=>process.stdout.write(JSON.stringify(receipt)+'\n'));
