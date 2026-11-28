'use strict';
const {withInstalled289Onboarding}=require('./installer.cjs');
const receipt={schemaVersion:1,purpose:'ONBOARDING_ORIGINAL_DESKTOP_LIFECYCLE_289',stages:[],status:'STOPPED',business:'NOT_ENTERED',executionAllowed:false};
withInstalled289Onboarding(receipt).then(()=>{
  if(!receipt.onboardingAliasRevoked||!receipt.onboardingVoucherColumnRevoked||receipt.onboardingSuites?.length!==1||
    receipt.onboardingSuites.reduce((sum,suite)=>sum+suite.passed,0)!==1||
    receipt.sameInstancePostConsume!==true||receipt.business!=='CALLBACK_COMPLETED'||receipt.orderedTails?.at(-1)?.size!==289) throw Error('ONBOARDING_CANVAS_COMPLETE');
  receipt.status='ONBOARDING_ORIGINAL_DESKTOP_LIFECYCLE_289_PASSED';
}).catch(error=>{
  receipt.status='STOPPED';
  const code=error.code??error.message;
  receipt.failure={stage:receipt.stages.at(-1),code:/^[0-9A-Z_]+$/u.test(code)?code:'UNKNOWN',
    command:error.command,exit:error.exit,sqlstate:error.sqlstate,prismaCode:error.prismaCode};
  process.exitCode=1;
}).finally(()=>process.stdout.write(JSON.stringify(receipt)+'\n'));
