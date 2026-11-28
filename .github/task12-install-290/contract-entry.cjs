'use strict';
const assert=require('node:assert/strict');
const mode=process.argv[2];
const counts={settlement:2,template:7,draft:1,v7:26,invoice:10,pol279:4,pol280:5,'pol108-core':12,'pol108-facts':1,'pol108-impacts':1};
assert.ok(process.argv.length===3 && Object.hasOwn(counts,mode));
const receipt={schemaVersion:1,purpose:'ORIGINAL_CONTRACT_SETTLEMENT_V2_EXACT_290',business:'NOT_ENTERED',stages:[]};
require('./installer.cjs').withOutside290Contract(receipt,mode).then(()=>{
  assert.equal(receipt.installOnly290?.count,290);
  assert.equal(receipt.business,'CALLBACK_COMPLETED');
  const suite=receipt.settlement ?? receipt.fundExecutionV7 ?? receipt.freshOwner ?? receipt.pol280 ?? receipt.operatingProjection;
  assert.equal(suite?.tests ?? suite?.passed,counts[mode]);
  if (!mode.startsWith('pol108-')) assert.equal(suite?.skipped,0);
  assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  receipt.status='ORIGINAL_CONTRACT_290_PASSED';
  receipt.mode=mode;
}).catch(error=>{
  receipt.status='STOPPED';
  const code=error.code??error.message;
  receipt.failure={stage:receipt.stages.at(-1)??'INPUTS',code:typeof code==='string'&&/^[A-Z0-9_]{1,100}$/u.test(code)?code:'SETTLEMENT_290_UNCLASSIFIED',sqlstate:error.sqlstate,prismaCode:error.prismaCode,exit:error.exit};
  process.exitCode=1;
}).finally(()=>console.log(JSON.stringify(receipt)));
